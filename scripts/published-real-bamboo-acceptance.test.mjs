import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import {
  PUBLISHED_ARTIFACT_IDENTITY,
  acceptanceArtifactMode,
  acceptanceArguments,
  acceptanceConfigArgument,
  runAcceptanceSurfaces,
  runInherited,
  acceptanceRunPlan,
  assertPublishedArtifactIdentity,
  assertSafeTarMembers,
  verifyExtractedCurrentArtifact,
} from "./published-real-bamboo-acceptance.mjs"
import { buildArtifactManifest } from "./artifact-manifest.mjs"

const expectedBambooRevision =
  "4786b7db862cabbebce49e288da62b284ccf5b72"
const readRepositoryFile = (relativePath) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8")

const currentRevision = "0123456789abcdef0123456789abcdef01234567"
const currentVersion = "0.0.0"

const currentArtifactFixture = () => {
  const root = mkdtempSync(join(tmpdir(), "lotus-current-artifact-test-"))
  const sourceDistRoot = join(root, "source", "dist")
  const packageRoot = join(root, "extracted", "package")
  const extractedDistRoot = join(packageRoot, "dist")
  mkdirSync(sourceDistRoot, { recursive: true })
  mkdirSync(extractedDistRoot, { recursive: true })
  const html = "<!doctype html><title>Current browser artifact</title>"
  writeFileSync(join(sourceDistRoot, "index.html"), html)
  writeFileSync(join(extractedDistRoot, "index.html"), html)
  const manifest = buildArtifactManifest({
    distDirectory: sourceDistRoot,
    packageVersion: currentVersion,
    sourceRevision: currentRevision,
    sourceDirty: false,
  })
  const manifestSource = `${JSON.stringify(manifest, null, 2)}\n`
  writeFileSync(join(sourceDistRoot, "lotus-next-manifest.json"), manifestSource)
  writeFileSync(join(extractedDistRoot, "lotus-next-manifest.json"), manifestSource)
  writeFileSync(join(packageRoot, "package.json"), JSON.stringify({
    name: PUBLISHED_ARTIFACT_IDENTITY.packageName,
    version: currentVersion,
  }))
  const tarballPath = join(root, "bigduu-lotus-next-0.0.0.tgz")
  const tarball = Buffer.from("locally packed fixture")
  writeFileSync(tarballPath, tarball)
  const packRecord = {
    name: PUBLISHED_ARTIFACT_IDENTITY.packageName,
    version: currentVersion,
    filename: "bigduu-lotus-next-0.0.0.tgz",
    shasum: createHash("sha1").update(tarball).digest("hex"),
    integrity: `sha512-${createHash("sha512").update(tarball).digest("base64")}`,
  }
  return {
    root,
    sourceDistRoot,
    packageRoot,
    tarballPath,
    packRecord,
    verify: (overrides = {}) => verifyExtractedCurrentArtifact({
      tarballPath,
      packageRoot,
      sourceDistRoot,
      expectedRevision: currentRevision,
      expectedVersion: currentVersion,
      packRecord,
      ...overrides,
    }),
  }
}

describe("published real-Bamboo acceptance policy", () => {
  it("selects the immutable registry default and only one explicit current-source mode", () => {
    expect(acceptanceArtifactMode([])).toBe("published")
    expect(acceptanceArtifactMode(["--current-source"])).toBe("current-source")
    expect(acceptanceArtifactMode(["--current-source", "--accepted-identity", "/tmp/accepted.json"])).toBe("current-source")
    expect(() => acceptanceArtifactMode(["--published"])).toThrow(/Usage/)
    expect(() => acceptanceArtifactMode(["--current-source", "extra"])).toThrow(/Usage/)
    expect(() => acceptanceArtifactMode(["--accepted-identity", "/tmp/accepted.json"])).toThrow(/Usage/)
  })

  it("binds a local pack to the exact clean source manifest and twelve-field identity", () => {
    const fixture = currentArtifactFixture()
    try {
      const { distRoot, identity } = fixture.verify()
      expect(distRoot).toBe(join(fixture.packageRoot, "dist"))
      expect(Object.keys(identity)).toEqual(Object.keys(PUBLISHED_ARTIFACT_IDENTITY))
      expect(identity).toMatchObject({
        registry: "local-pack",
        packageName: PUBLISHED_ARTIFACT_IDENTITY.packageName,
        packageVersion: currentVersion,
        sourceRevision: currentRevision,
        sourceDirty: false,
        npmShasum: fixture.packRecord.shasum,
        npmIntegrity: fixture.packRecord.integrity,
      })
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it("rejects local pack metadata, source, and extracted-byte drift", () => {
    const fixture = currentArtifactFixture()
    try {
      expect(() => fixture.verify({ packRecord: {
        ...fixture.packRecord,
        integrity: "sha512-wrong",
      } })).toThrow(/npm pack metadata/)
      expect(() => fixture.verify({
        expectedRevision: "f".repeat(40),
      })).toThrow(/source revision/)
      writeFileSync(join(fixture.packageRoot, "dist", "index.html"), "tampered")
      expect(() => fixture.verify()).toThrow(/resource.*(size|digest)/)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it("accepts only the committed immutable artifact identity", () => {
    expect(
      assertPublishedArtifactIdentity({ ...PUBLISHED_ARTIFACT_IDENTITY }),
    ).toEqual(PUBLISHED_ARTIFACT_IDENTITY)

    for (const [key, replacement] of [
      ["packageVersion", "2026.9.15"],
      ["sourceRevision", "0".repeat(40)],
      ["sourceDirty", true],
      ["npmShasum", "0".repeat(40)],
      ["npmIntegrity", "sha512-invalid"],
      ["manifestSha256", "0".repeat(64)],
      ["resourcesSha256", "0".repeat(64)],
      ["resourceCount", 33],
    ]) {
      expect(() =>
        assertPublishedArtifactIdentity({
          ...PUBLISHED_ARTIFACT_IDENTITY,
          [key]: replacement,
        }),
      ).toThrow(new RegExp(key))
    }
  })

  it("rejects missing, reordered, and additional identity fields", () => {
    const { registry: _registry, ...missing } = PUBLISHED_ARTIFACT_IDENTITY
    expect(() => assertPublishedArtifactIdentity(missing)).toThrow(/exactly/)
    expect(() =>
      assertPublishedArtifactIdentity({
        packageName: PUBLISHED_ARTIFACT_IDENTITY.packageName,
        ...PUBLISHED_ARTIFACT_IDENTITY,
      }),
    ).toThrow(/exactly/)
    expect(() =>
      assertPublishedArtifactIdentity({
        ...PUBLISHED_ARTIFACT_IDENTITY,
        extra: true,
      }),
    ).toThrow(/exactly/)
  })

  it("accepts a package-rooted tarball inventory", () => {
    expect(
      assertSafeTarMembers(
        [
          "package/README.md",
          "package/dist/index.html",
          "package/dist/lotus-next-manifest.json",
          "package/package.json",
        ].join("\n"),
      ),
    ).toHaveLength(4)
  })

  it.each([
    "../escape",
    "/absolute",
    "package/../escape",
    "package\\dist\\index.html",
    "foreign/index.html",
  ])("rejects unsafe tar member %s", (member) => {
    expect(() =>
      assertSafeTarMembers(
        [
          member,
          "package/dist/index.html",
          "package/dist/lotus-next-manifest.json",
          "package/package.json",
        ].join("\n"),
      ),
    ).toThrow(/Unsafe/)
  })

  it("runs local first and then the named TLS remote topology", () => {
    expect(
      acceptanceRunPlan({
        certificatePath: "/tmp/test.crt",
        keyPath: "/tmp/test.key",
      }),
    ).toEqual([
      { mode: "local", tls: null },
      {
        mode: "remote",
        tls: {
          certificatePath: "/tmp/test.crt",
          keyPath: "/tmp/test.key",
          hostname: "remote.lotus.test",
        },
      },
    ])
  })

  it("keeps CI, publication, runtime, and image revision authorities aligned", () => {
    const ci = readRepositoryFile(".github/workflows/ci.yml")
    const publication = readRepositoryFile(
      ".github/workflows/publish-npm.yml",
    )
    const runtime = readRepositoryFile("e2e/support/realBambooRuntime.ts")
    const dockerfile = readRepositoryFile(
      "e2e/support/Dockerfile.real-bamboo",
    )

    expect(ci).toContain(`BAMBOO_E2E_REVISION: ${expectedBambooRevision}`)
    expect(ci).toContain("BAMBOO_E2E_HOST_REVISION: 4786b7db862cabbebce49e288da62b284ccf5b72")
    expect(ci).not.toContain("      - name: Check out the accepted feature browser host\n")
    expect(ci.match(/BAMBOO_E2E_HOST_SOURCE_DIR: \${{ github.workspace }}\/.e2e-bamboo\n/g)).toHaveLength(2)
    expect(publication).not.toContain("BAMBOO_E2E_HOST_REVISION")
    expect(publication).not.toContain("BAMBOO_E2E_HOST_SOURCE_DIR")
    expect(publication).toContain("run: node scripts/release-source.mjs")
    const source = readRepositoryFile("scripts/release-source.mjs")
    expect(source).toContain('"Real Bamboo / Node 24", "Verify a real chat round trip with the pinned published Bamboo"')
    expect(source).toContain('"Real Bamboo / Node 24", "Verify the current source artifact on local and secure browser surfaces"')
    expect(runtime).toContain(
      `export const REAL_BAMBOO_REVISION = "${expectedBambooRevision}";`,
    )
    expect(runtime).toContain('"--build-arg"')
    expect(runtime).toContain("`BAMBOO_REVISION=${REAL_BAMBOO_REVISION}`")
    expect(dockerfile).toContain("ARG BAMBOO_REVISION")
    expect(dockerfile).toContain(
      'LABEL org.opencontainers.image.revision="${BAMBOO_REVISION}"',
    )
    expect(dockerfile).not.toContain(expectedBambooRevision)
  })

  it("runs both current-source topologies and retains their evidence in feature CI", () => {
    const ci = readRepositoryFile(".github/workflows/ci.yml")
    const publication = readRepositoryFile(".github/workflows/publish-npm.yml")

    expect(ci).toContain("run: node scripts/feature-bamboo-package.mjs surface ${{ matrix.mode }}")
    expect(ci).toContain("        mode:\n          - local\n          - remote")
    expect(publication).toContain("run: node scripts/release-source.mjs")
    expect(publication).not.toContain("published-real-bamboo-acceptance.mjs --current-source")
    for (const directory of [
      "playwright-report-real-bamboo/",
      "playwright-report-real-bamboo-${{ matrix.mode }}/",
      "test-results-real-bamboo/",
      "test-results-real-bamboo-${{ matrix.mode }}/",
    ]) {
      expect(ci).toContain(directory)
      expect(publication).not.toContain(directory)
    }
  })

  it("checks landscape phone identity and zero browser API requests in both real-Bamboo modes", () => {
    const surfaces = readRepositoryFile("e2e/real-bamboo-published-surfaces.spec.ts")
    expect(surfaces).toContain('label: "phone-landscape"')
    expect(surfaces).toContain("viewport: { width: 915, height: 412 }")
    expect(surfaces).toContain('userAgent: devices["Pixel 7"].userAgent')
    expect(surfaces).toContain("userAgent: definition.userAgent")
    expect(surfaces).toContain("if (definition.viewport.width <= 768)")
    expect(surfaces).toContain("for (const definition of definitions)")
    expect(surfaces).toContain("for (const definition of surfaces)")
    expect(surfaces).toContain('pathname.startsWith("/api/v1/browser/")')
  })

  it("blocks publication until retained bytes and original feature acceptance are rechecked", () => {
    const publication = readRepositoryFile(".github/workflows/publish-npm.yml")
    const index = (step) => publication.indexOf(`      - name: ${step}`)
    const upload = index("Retain the original final tarball and pack identity")
    const download = index("Download the original final tarball")
    const bytes = index("Verify retained bytes and original source identity")
    const finalPack = publication.indexOf("      - name: Verify the exact local tarball", download)
    const acceptance = index("Refresh the accepted Dev source immediately before publication")
    const tag = index("Recheck the immutable source tag before publication")
    const publish = index("Publish the exact verified tarball with provenance")
    expect([upload, download, bytes, finalPack, acceptance, tag, publish].every((position) => position >= 0)).toBe(true)
    expect(upload).toBeLessThan(download)
    expect(publication).toContain("uses: actions/upload-artifact@v7")
    expect(download).toBeLessThan(bytes)
    expect(bytes).toBeLessThan(finalPack)
    expect(finalPack).toBeLessThan(acceptance)
    expect(acceptance).toBeLessThan(tag)
    expect(tag).toBeLessThan(publish)
    expect(publication.slice(0, publish)).not.toContain("secrets.NPM_TOKEN")
    expect(publication).toContain("uses: actions/download-artifact@v8")
    expect(publication.slice(acceptance, tag)).toContain("run: node scripts/release-source.mjs")
  })

  it("requires real Bamboo in feature CI before dev admission", () => {
    const ci = readRepositoryFile(".github/workflows/ci.yml")
    expect(ci).toContain("  pull_request:\n    branches: [dev]")
    expect(ci).not.toMatch(/^  (?:push|workflow_dispatch):/m)
    expect(ci).toContain("needs: [source, verify, real-bamboo-package]")
    expect(ci).toContain("needs: [source, verify, browser-summary, real-bamboo, real-bamboo-package, real-bamboo-surface, native-actor]")
    expect(ci).toContain("REAL_BAMBOO_RESULT: ${{ needs.real-bamboo.result }}")
  })})


describe("publication browser acceptance controller", () => {
  it("accepts only an explicit absolute publication browser directory", () => {
    expect(acceptanceArguments(["--current-source", "--accepted-identity", "/tmp/accepted.json", "--publication-browser", "/tmp/release-browser"])).toEqual({
      artifactMode: "current-source", acceptedIdentityPath: "/tmp/accepted.json", browserRoot: "/tmp/release-browser",
    })
    expect(() => acceptanceArguments(["--publication-browser", "/tmp/release-browser"])).toThrow(/Usage/)
    expect(() => acceptanceArguments(["--current-source", "--publication-browser", "relative"])).toThrow(/absolute/)
    expect(() => acceptanceArguments(["--current-source", "--publication-browser", "/tmp/one", "--publication-browser", "/tmp/two"])).toThrow(/Usage/)
  })

  it("has no bundled-browser fallback for a split publication checkout", () => {
    expect(acceptanceConfigArgument(undefined, process.cwd(), {})).toBe("--config=playwright.real-bamboo.config.ts")
    expect(() => acceptanceConfigArgument(undefined, process.cwd(), { LOTUS_NEXT_ACCEPTANCE_SOURCE_DIR: process.cwd() })).toThrow(/requires the verified/)
    expect(() => acceptanceConfigArgument(undefined, process.cwd(), { LOTUS_NEXT_RELEASE_SOURCE_RECEIPT: "/tmp/receipt.json" })).toThrow(/requires the verified/)
    expect(() => acceptanceConfigArgument("/tmp/missing-browser", process.cwd(), {})).toThrow()
  })

  it.each(["local", "remote"])("a nonzero %s child prevents accepted identity", (failureMode) => {
    const fixture = currentArtifactFixture()
    const acceptedIdentityPath = join(fixture.root, "accepted.json")
    const visited = []
    try {
      expect(() => runAcceptanceSurfaces({
        tls: { certificatePath: "/tmp/test.crt", keyPath: "/tmp/test.key" },
        artifact: fixture.verify(), browserRoot: "/tmp/release-browser", acceptedIdentityPath,
      }, ({ mode }, _artifact, browserRoot) => {
        visited.push(mode)
        expect(browserRoot).toBe("/tmp/release-browser")
        runInherited(process.execPath, ["-e", `process.exit(${mode === failureMode ? 7 : 0})`])
      })).toThrow(/failed with exit 7/)
      expect(visited).toEqual(failureMode === "local" ? ["local"] : ["local", "remote"])
      expect(existsSync(acceptedIdentityPath)).toBe(false)
    } finally {
      rmSync(fixture.root, { recursive: true, force: true })
    }
  })

  it("retains the original packed-surface filter, dependency mode and mode-specific child environment", () => {
    const script = readRepositoryFile("scripts/published-real-bamboo-acceptance.mjs")
    expect(script).toContain('"--no-deps",')
    expect(script).toContain('"--grep",\n      "verified artifact browser surfaces",')
    expect(script).toContain("LOTUS_REAL_ACCEPTANCE_MODE: mode")
    expect(script).toContain("environment.NODE_EXTRA_CA_CERTS = tls.certificatePath")
    expect(script).toContain("acceptanceConfigArgument(browserRoot, repositoryRoot, environment)")
    expect(script).not.toMatch(/NODE_OPTIONS|NODE_PATH/)
  })
})
