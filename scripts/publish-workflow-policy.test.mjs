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

describe("npm publication workflow cache policy", () => {
  it("isolates the post-publish round trip from all vacancy-check caches", () => {
    expect(stepStart).toBeGreaterThanOrEqual(0)
    expect(stepEnd).toBeGreaterThan(stepStart)
    expect(workflow.slice(0, stepStart)).not.toContain("registry-roundtrip-cache")
    expect(registryRoundTripStep).toContain(
      'REGISTRY_CACHE="${RUNNER_TEMP}/registry-roundtrip-cache"',
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
        .find((line) => line.trimStart().startsWith(command))

      expect(commandLine).toBeDefined()
      expect(commandLine).toContain("--prefer-online")
      expect(commandLine).toContain('--cache="${REGISTRY_CACHE}"')
      expect(commandLine).toContain("--registry=https://registry.npmjs.org/")
    },
  )
})
