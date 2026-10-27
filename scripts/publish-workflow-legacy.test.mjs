// Historical compatibility only. Current producer policy is owned by #455.
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const workflow = readFileSync(
  resolve(process.cwd(), "scripts/fixtures/publish-npm-legacy-v29.yml"),
  "utf8",
)
it("pins the byte-exact legacy publisher without describing it as the current producer", () => {
  expect(createHash("sha256").update(workflow).digest("hex"))
    .toBe("99f7c60d3579284c8c12ec4046e9565c45d150293640ea4fdf952a95b67f4345")
})

const stepName = "      - name: Download and verify the registry copy"
const nextStepName = "      - name: Record immutable publication identity"
const stepStart = workflow.indexOf(stepName)
const stepEnd = workflow.indexOf(nextStepName, stepStart)
const registryRoundTripStep = workflow.slice(stepStart, stepEnd)

describe("frozen legacy publication reuses accepted source CI", () => {
  it("keeps source tests in CI and publishes without repeating the Node test matrix", () => {
    const sourceCi = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8")
    expect(sourceCi).toContain("run: npm run verify")
    expect(sourceCi).toContain("run: npm run test:e2e:built -- --shard=${{ matrix.shard }}/4")
    const jobs = workflow.slice(workflow.indexOf("\njobs:\n"))
    expect([...jobs.matchAll(/^  ([a-z-]+):$/gm)].map((match) => match[1]))
      .toEqual(["preflight", "real-bamboo", "publish"])
    expect(workflow).not.toMatch(/npm run (?:verify|test(?::[\w:-]+)?)(?:\s|$)/)
    expect(workflow).not.toContain("release-browser/all-surface.config.mjs")
    expect(workflow).toContain("run: node scripts/release-source.mjs")
  })
  it("builds and statically checks the final package before matching its real-runtime identity", () => {
    const build = workflow.indexOf("      - name: Build and verify the final package tree")
    const pack = workflow.indexOf("      - name: Pack once without another lifecycle build")
    const checks = workflow.slice(build, pack)
    expect(checks).toContain("npm run build")
    expect(checks).toContain("npm run artifact:verify")
    expect(checks).toContain("npm run package:contents")
    expect(pack).toBeGreaterThan(build)
    expect(workflow).toContain("node scripts/release-acceptance-identity.mjs verify")
    expect(workflow).toContain('run: npm publish "${PACKED_FILENAME}" --provenance --access public')
  })
})

describe("npm publication workflow cache policy", () => {
  it("isolates the post-publish round trip from all vacancy-check caches", () => {
    expect(stepStart).toBeGreaterThanOrEqual(0)
    expect(stepEnd).toBeGreaterThan(stepStart)
    expect(workflow.slice(0, stepStart)).not.toContain("registry-roundtrip-cache")
    expect(registryRoundTripStep).toContain(
      'REGISTRY_CACHE="${RUNNER_TEMP}/registry-roundtrip-cache-${READBACK_ATTEMPT}"',
    )

    const freshCacheCheck = registryRoundTripStep.indexOf(
      'test ! -e "${REGISTRY_CACHE}"',
    )
    const registryPack = registryRoundTripStep.indexOf(
      'npm pack "@bigduu/lotus-next@${LOTUS_NEXT_RELEASE_VERSION}"',
    )
    expect(freshCacheCheck).toBeGreaterThanOrEqual(0)
    expect(registryPack).toBeGreaterThan(freshCacheCheck)
  })

  it.each(["npm pack", "npm view"])(
    "forces the final %s through the dedicated online cache",
    (command) => {
      const commandLine = registryRoundTripStep
        .split("\n")
        .find((line) =>
          line.trimStart().startsWith(`${command} `) ||
          line.trimStart().startsWith(`if ${command} `),
        )

      expect(commandLine).toBeDefined()
      expect(commandLine).toContain("--prefer-online")
      expect(commandLine).toContain('--cache="${REGISTRY_CACHE}"')
      expect(commandLine).toContain("--registry=https://registry.npmjs.org/")
    },
  )
})
