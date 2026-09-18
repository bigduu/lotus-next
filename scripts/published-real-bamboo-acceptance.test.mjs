import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

import {
  PUBLISHED_ARTIFACT_IDENTITY,
  acceptanceRunPlan,
  assertPublishedArtifactIdentity,
  assertSafeTarMembers,
} from "./published-real-bamboo-acceptance.mjs"

const expectedBambooRevision =
  "a8b5385dc4318ab02ba35c0692bdf48914275f6c"
const readRepositoryFile = (relativePath) =>
  readFileSync(resolve(process.cwd(), relativePath), "utf8")

describe("published real-Bamboo acceptance policy", () => {
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

  it("runs both public-artifact topologies and retains their evidence in CI", () => {
    const ci = readRepositoryFile(".github/workflows/ci.yml")

    expect(ci).toContain("run: npm run test:e2e:published-bamboo")
    for (const directory of [
      "playwright-report-real-bamboo/",
      "playwright-report-real-bamboo-local/",
      "playwright-report-real-bamboo-remote/",
      "test-results-real-bamboo/",
      "test-results-real-bamboo-local/",
      "test-results-real-bamboo-remote/",
    ]) {
      expect(ci).toContain(directory)
    }
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
