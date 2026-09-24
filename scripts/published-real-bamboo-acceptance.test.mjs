import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"

import { describe, expect, it } from "vitest"

import {
  PUBLISHED_ARTIFACT_IDENTITY,
  acceptanceArtifactMode,
  acceptanceRunPlan,
  assertPublishedArtifactIdentity,
  assertSafeTarMembers,
  verifyExtractedCurrentArtifact,
} from "./published-real-bamboo-acceptance.mjs"
import { buildArtifactManifest } from "./artifact-manifest.mjs"

const expectedBambooRevision =
  "f959c05566bfea3bd3566626851cda543f2b71d2"
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

    for (const workflow of [ci, publication]) {
      expect(workflow).toContain(
        `BAMBOO_E2E_REVISION: ${expectedBambooRevision}`,
      )
    }
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

  it("runs both current-source topologies and retains their evidence in CI and publication", () => {
    const ci = readRepositoryFile(".github/workflows/ci.yml")
    const publication = readRepositoryFile(".github/workflows/publish-npm.yml")

    for (const workflow of [ci, publication]) {
      expect(workflow).toContain(
        "run: node scripts/published-real-bamboo-acceptance.mjs --current-source",
      )
    }
    for (const directory of [
      "playwright-report-real-bamboo/",
      "playwright-report-real-bamboo-local/",
      "playwright-report-real-bamboo-remote/",
      "test-results-real-bamboo/",
      "test-results-real-bamboo-local/",
      "test-results-real-bamboo-remote/",
    ]) {
      expect(ci).toContain(directory)
      expect(publication).toContain(directory)
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

  it("blocks publication until the final Node 24 tarball matches Node 22 browser acceptance", () => {
    const publication = readRepositoryFile(".github/workflows/publish-npm.yml")
    const index = (step) => publication.indexOf(`      - name: ${step}`)
    const acceptance = index("Verify the release artifact on local and secure browser surfaces")
    const upload = index("Upload the accepted browser artifact identity")
    const finalPack = index("Verify the exact local tarball")
    const download = index("Download the accepted browser artifact identity")
    const compare = index("Require the final tarball to match both real browser surfaces")
    const publish = index("Publish the exact verified tarball with provenance")
    expect([acceptance, upload, finalPack, download, compare, publish].every((position) => position >= 0)).toBe(true)
    expect(publication).toContain(
      'run: node scripts/published-real-bamboo-acceptance.mjs --current-source --accepted-identity "${ACCEPTED_IDENTITY_PATH}"',
    )
    expect(acceptance).toBeLessThan(upload)
    expect(publication).toContain("uses: actions/upload-artifact@v7")
    expect(publication.match(/name: real-bamboo-accepted-identity/g)).toHaveLength(2)
    expect(finalPack).toBeLessThan(download)
    expect(download).toBeLessThan(compare)
    expect(compare).toBeLessThan(publish)
    expect(publication).toContain("uses: actions/download-artifact@v8")
    expect(publication).toContain("node scripts/release-acceptance-identity.mjs verify")
  })

  it("reserves real Bamboo for manual CI runs", () => {
    const ci = readRepositoryFile(".github/workflows/ci.yml")

    expect(ci).toContain("  workflow_dispatch:")
    expect(ci).toContain("    branches:\n      - main")
    expect(ci).toContain(
      "    if: ${{ github.event_name == 'workflow_dispatch' }}",
    )
  })
})
