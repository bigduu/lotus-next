import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import bootstrapRequirements from "../src/services/bootstrap/bootstrapRequirements.json" with { type: "json" }
import {
  ARTIFACT_MANIFEST_FILE,
  BOOTSTRAP_REQUIREMENTS_FILE,
  LOTUS_NEXT_PACKAGE_NAME,
  assertPackageVersion,
  assertResourcePath,
  buildArtifactManifest,
  calculateResourcesSha256,
  verifyArtifactManifest,
  verifyBootstrapRequirements,
  writeArtifactManifest,
} from "./artifact-manifest.mjs"

const revision = "0123456789abcdef0123456789abcdef01234567"
const temporaryDirectories = []

const createArtifact = () => {
  const directory = mkdtempSync(path.join(tmpdir(), "lotus-next-artifact-"))
  temporaryDirectories.push(directory)
  mkdirSync(path.join(directory, "assets"))
  writeFileSync(path.join(directory, "index.html"), "<!doctype html>\n")
  writeFileSync(path.join(directory, "asset-manifest.json"), "{}\n")
  writeFileSync(path.join(directory, "assets", "main.js"), "export {}\n")
  return directory
}

const writeManifest = (directory, manifest) => {
  writeFileSync(
    path.join(directory, ARTIFACT_MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`,
  )
}

const generateFixtureManifest = (directory, overrides = {}) => {
  const manifest = buildArtifactManifest({
    distDirectory: directory,
    packageVersion: "2026.9.12",
    sourceRevision: revision,
    sourceDirty: false,
    ...overrides,
  })
  writeManifest(directory, manifest)
  return manifest
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("packaged Bootstrap requirements", () => {
  function createPackage() {
    const root = mkdtempSync(path.join(tmpdir(), "lotus-next-bootstrap-"))
    temporaryDirectories.push(root)
    const distDirectory = path.join(root, "dist")
    mkdirSync(distDirectory)
    writeFileSync(path.join(distDirectory, "index.html"), "<!doctype html>\n")
    const packageJsonPath = path.join(root, "package.json")
    writeFileSync(packageJsonPath, JSON.stringify({
      name: LOTUS_NEXT_PACKAGE_NAME,
      version: "2026.9.12",
      files: ["dist"],
    }))

    const repositoryDirectory = process.cwd()
    const sourceRevision = execFileSync("git", ["rev-parse", "HEAD"], {
      cwd: repositoryDirectory,
      encoding: "utf8",
    }).trim()
    writeArtifactManifest({
      distDirectory,
      packageJsonPath,
      repositoryDirectory,
      environment: { LOTUS_NEXT_SOURCE_REVISION: sourceRevision, LOTUS_NEXT_SOURCE_DIRTY: "false" },
    })
    return { root, distDirectory, sourceRevision }
  }

  it("includes the exact source-bound resource in the npm archive and v1 manifest", () => {
    const { root, sourceRevision } = createPackage()
    const args = ["pack", "--ignore-scripts", "--json"]
    const npmExecPath = process.env.npm_execpath
    const output = npmExecPath
      ? execFileSync(process.execPath, [npmExecPath, ...args], { cwd: root })
      : execFileSync("npm", args, { cwd: root })
    const [pack] = JSON.parse(output.toString())
    expect(pack.files.map(({ path: filename }) => filename)).toContain(
      `dist/${BOOTSTRAP_REQUIREMENTS_FILE}`,
    )
    execFileSync("tar", ["-xzf", pack.filename], { cwd: root })
    const distDirectory = path.join(root, "package", "dist")
    const proof = JSON.parse(readFileSync(path.join(distDirectory, BOOTSTRAP_REQUIREMENTS_FILE), "utf8"))
    expect(proof).toEqual({
      schemaVersion: 1,
      packageName: LOTUS_NEXT_PACKAGE_NAME,
      packageVersion: pack.version,
      sourceRevision,
      sourceDirty: false,
      bootstrap: bootstrapRequirements,
    })
    const artifactManifest = verifyArtifactManifest({
      distDirectory,
      expectedPackageName: pack.name,
      expectedPackageVersion: pack.version,
      expectedSourceRevision: sourceRevision,
      expectedSourceDirty: false,
    })
    expect(artifactManifest.resources.map(({ path: filename }) => filename)).toContain(
      BOOTSTRAP_REQUIREMENTS_FILE,
    )
    verifyBootstrapRequirements({ distDirectory, artifactManifest })
  })

  it.each([
    ["missing declaration", null],
    ["unsupported schema", { schemaVersion: 2 }],
    ["another version", { packageVersion: "2026.9.11" }],
    ["another source", { sourceRevision: revision }],
    ["changed contract", { bootstrap: {} }],
  ])("rejects %s even with a consistent resource inventory", (_label, change) => {
    const { distDirectory, sourceRevision } = createPackage()
    const proofPath = path.join(distDirectory, BOOTSTRAP_REQUIREMENTS_FILE)
    if (change) {
      const proof = JSON.parse(readFileSync(proofPath, "utf8"))
      writeFileSync(proofPath, `${JSON.stringify({ ...proof, ...change }, null, 2)}\n`)
    } else {
      rmSync(proofPath)
    }
    generateFixtureManifest(distDirectory, { sourceRevision })
    const artifactManifest = verifyArtifactManifest({ distDirectory })
    expect(() => verifyBootstrapRequirements({ distDirectory, artifactManifest })).toThrow(
      /Bootstrap requirements|ENOENT/,
    )
  })
})

describe("universal artifact manifest", () => {
  it("binds every regular resource in stable path order", () => {
    const directory = createArtifact()
    const manifest = generateFixtureManifest(directory)

    expect(manifest.resources.map((resource) => resource.path)).toEqual([
      "asset-manifest.json",
      "assets/main.js",
      "index.html",
    ])
    expect(manifest.resourcesSha256).toBe(calculateResourcesSha256(manifest.resources))
    expect(verifyArtifactManifest({ distDirectory: directory })).toEqual(manifest)

    rmSync(path.join(directory, ARTIFACT_MANIFEST_FILE))
    expect(generateFixtureManifest(directory)).toEqual(manifest)
  })

  it("rejects missing, unlisted, and modified resources", () => {
    const directory = createArtifact()
    generateFixtureManifest(directory)

    writeFileSync(path.join(directory, "extra.txt"), "unlisted\n")
    expect(() => verifyArtifactManifest({ distDirectory: directory })).toThrow(
      /unlisted: extra\.txt/,
    )
    rmSync(path.join(directory, "extra.txt"))

    writeFileSync(path.join(directory, "assets", "main.js"), "tampered\n")
    expect(() => verifyArtifactManifest({ distDirectory: directory })).toThrow(
      /does not match its declared size and digest/,
    )
    rmSync(path.join(directory, "assets", "main.js"))
    expect(() => verifyArtifactManifest({ distDirectory: directory })).toThrow(
      /missing: assets\/main\.js/,
    )
  })

  it.each([
    "../secret.txt",
    "/absolute.js",
    "C:/absolute.js",
    "assets\\main.js",
    "assets//main.js",
    "assets/./main.js",
    "assets/../main.js",
    "assets/control\u0000.js",
    "assets/control\u0085.js",
    "lotus-next-manifest.json",
  ])("rejects unsafe or self-referential path %s", (resourcePath) => {
    expect(() => assertResourcePath(resourcePath)).toThrow()
  })

  it("rejects symlinked artifact resources", () => {
    const directory = createArtifact()
    symlinkSync(path.join(directory, "index.html"), path.join(directory, "linked.html"))
    expect(() => generateFixtureManifest(directory)).toThrow(/symbolic link/)
  })

  it("does not follow an existing manifest symlink while generating", () => {
    const directory = createArtifact()
    const target = path.join(directory, "outside.txt")
    writeFileSync(target, "preserve me\n")
    symlinkSync(target, path.join(directory, ARTIFACT_MANIFEST_FILE))

    expect(() => generateFixtureManifest(directory)).toThrow(/must not be a symbolic link/)
    expect(readFileSync(target, "utf8")).toBe("preserve me\n")
  })

  it("rejects duplicate, unsorted, and self-listed records", () => {
    const directory = createArtifact()
    const base = generateFixtureManifest(directory)

    const duplicate = structuredClone(base)
    duplicate.resources.splice(1, 0, structuredClone(duplicate.resources[0]))
    duplicate.resourcesSha256 = calculateResourcesSha256(duplicate.resources)
    writeManifest(directory, duplicate)
    expect(() => verifyArtifactManifest({ distDirectory: directory })).toThrow(
      /unique and strictly sorted/,
    )

    const selfListed = structuredClone(base)
    selfListed.resources.push({
      path: ARTIFACT_MANIFEST_FILE,
      size: 1,
      sha256: createHash("sha256").update("x").digest("hex"),
    })
    selfListed.resourcesSha256 = calculateResourcesSha256(selfListed.resources)
    writeManifest(directory, selfListed)
    expect(() => verifyArtifactManifest({ distDirectory: directory })).toThrow(
      /must not list itself/,
    )
  })

  it("rejects non-canonical JSON and unknown schema fields", () => {
    const directory = createArtifact()
    const manifest = generateFixtureManifest(directory)
    writeFileSync(
      path.join(directory, ARTIFACT_MANIFEST_FILE),
      JSON.stringify({ ...manifest, extra: true }),
    )
    expect(() => verifyArtifactManifest({ distDirectory: directory })).toThrow(
      /canonical JSON form/,
    )

    writeManifest(directory, { ...manifest, extra: true })
    expect(() => verifyArtifactManifest({ distDirectory: directory })).toThrow(
      /must contain exactly/,
    )
  })

  it("enforces package, revision, and clean-source expectations", () => {
    const directory = createArtifact()
    generateFixtureManifest(directory)

    expect(() =>
      verifyArtifactManifest({
        distDirectory: directory,
        expectedPackageName: "@bigduu/lotus-next",
        expectedPackageVersion: "2026.9.13",
        expectedSourceRevision: revision,
        expectedSourceDirty: false,
      }),
    ).toThrow(/package version/)
    expect(() =>
      verifyArtifactManifest({
        distDirectory: directory,
        expectedSourceRevision: "f".repeat(40),
      }),
    ).toThrow(/source revision/)
    expect(() =>
      verifyArtifactManifest({ distDirectory: directory, expectedSourceDirty: true }),
    ).toThrow(/source dirty state/)
  })

  it.each(["0.0.0", "2026.9.12", "1.2.3-rc.1+build.5"])(
    "accepts strict SemVer %s",
    (version) => {
      expect(assertPackageVersion(version)).toBe(version)
    },
  )

  it.each([
    "v1.2.3",
    "01.2.3",
    "1.02.3",
    "1.2",
    "latest",
    "1.2.3.4",
    "1.2.3\n",
    "1.2.3\r\n",
  ])(
    "rejects non-canonical version %s",
    (version) => {
      expect(() => assertPackageVersion(version)).toThrow(/strict SemVer/)
    },
  )

  it("detects a resource-record digest mismatch before reading files", () => {
    const directory = createArtifact()
    const manifest = generateFixtureManifest(directory)
    manifest.resources[0].sha256 = "0".repeat(64)
    writeManifest(directory, manifest)

    expect(() => verifyArtifactManifest({ distDirectory: directory })).toThrow(
      /combined resource digest/,
    )
  })

  it("keeps the manifest itself out of a repeated inventory", () => {
    const directory = createArtifact()
    const first = generateFixtureManifest(directory)
    const second = buildArtifactManifest({
      distDirectory: directory,
      packageVersion: "2026.9.12",
      sourceRevision: revision,
      sourceDirty: false,
    })
    expect(second).toEqual(first)
    expect(readFileSync(path.join(directory, ARTIFACT_MANIFEST_FILE), "utf8")).not.toBe("")
  })
})
