import { readFileSync } from "node:fs"
import { resolve } from "node:path"

import { describe, expect, it } from "vitest"

const workflow = readFileSync(
  resolve(process.cwd(), ".github/workflows/publish-npm.yml"),
  "utf8",
)
const stepName = "      - name: Download and verify the registry copy"
const nextStepName = "      - name: Record immutable publication identity"
const stepStart = workflow.indexOf(stepName)
const stepEnd = workflow.indexOf(nextStepName, stepStart)
const registryRoundTripStep = workflow.slice(stepStart, stepEnd)

describe("publication reuses accepted source CI", () => {
  it("keeps source tests in CI and publishes without repeating the Node test matrix", () => {
    const sourceCi = readFileSync(resolve(process.cwd(), ".github/workflows/ci.yml"), "utf8")
    expect(sourceCi).toContain("run: npm run verify")
    expect(sourceCi).toContain("run: npm run test:e2e:built -- --shard=${{ matrix.shard }}/4")
    const jobs = workflow.slice(workflow.indexOf("\njobs:\n"))
    expect([...jobs.matchAll(/^  ([a-z-]+):$/gm)].map((match) => match[1]))
      .toEqual(["preflight", "build", "publish"])
    expect(workflow).not.toMatch(/npm run (?:verify|test(?::[\w:-]+)?)(?:\s|$)/)
    expect(workflow).not.toContain("release-browser/all-surface.config.mjs")
    expect(workflow).toContain("run: node scripts/release-source.mjs")
  })
  it("builds and packs once, then publishes only the retained original tarball", () => {
    const build = workflow.indexOf("      - name: Build and verify the final package tree")
    const pack = workflow.indexOf("      - name: Pack once without another lifecycle build")
    const checks = workflow.slice(build, pack)
    expect(checks).toContain("npm run build")
    expect(checks).toContain("npm run artifact:verify")
    expect(checks).toContain("npm run package:contents")
    expect(pack).toBeGreaterThan(build)
    expect((workflow.match(/npm run build/g) || [])).toHaveLength(1)
    expect((workflow.match(/npm pack --ignore-scripts --json/g) || [])).toHaveLength(1)
    const publish = workflow.split("\n  publish:\n")[1]
    expect(publish).not.toMatch(/npm ci|npm run build|npm version|npm pack --ignore-scripts --json/)
    expect(publish).toContain("name: frontend-release-${{ github.run_id }}")
    expect(workflow).toContain('npm publish "${PACKED_FILENAME}" --ignore-scripts --provenance --access public')
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


describe("minimal publication source and recovery boundary", () => {
  it("does not run release E2E or require a committed candidate before publication", () => {
    expect(workflow).not.toContain("  real-bamboo:")
    expect(workflow).not.toContain("playwright")
    const source = readFileSync("scripts/release-source.mjs", "utf8").split("const main = async () => {")[1]
    expect(source).not.toContain("release-candidates.json")
    expect(source).not.toContain("release-acceptance/")
    expect(source).toContain("FEATURE_PR_INPUT")
    expect(source).toContain("FEATURE_RUN_INPUT")
  })
  it("retains the first artifact and cannot silently rebuild a workflow retry", () => {
    expect(workflow).toContain('run: test "$GITHUB_RUN_ATTEMPT" = 1')
    expect(workflow).toContain("overwrite: false")
    expect(workflow).toContain("Refresh the accepted Dev source immediately before publication")
    expect(workflow).toContain("Verify the existing version against the original tarball below")
  })
})


describe("protected Dev publication controller", () => {
  it("guards both admission and credentialed publication without compiling Dev", () => {
    const guard = "    if: github.ref == 'refs/heads/dev' && github.ref_protected"
    expect(workflow.split(guard)).toHaveLength(3)
    expect(workflow).toContain("ref: ${{ needs.preflight.outputs.source_sha }}")
    expect(workflow).toContain("ref: ${{ needs.preflight.outputs.workflow_sha }}")
    expect(workflow).not.toContain('refs/heads/${DEFAULT_BRANCH}')
    expect(workflow.indexOf("Refresh the accepted Dev source immediately before publication"))
      .toBeLessThan(workflow.indexOf("Recheck the immutable source tag before publication"))
    expect(workflow.indexOf("Recheck the immutable source tag before publication"))
      .toBeLessThan(workflow.indexOf("Publish the exact verified tarball with provenance"))
  })
})
