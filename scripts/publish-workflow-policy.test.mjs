import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { delimiter, join, resolve } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"

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
    expect(workflow).toContain('assert.equal(steps[0].conclusion, "skipped"')
    expect(workflow).toContain("overwrite: false")
    expect(workflow).toContain("Refresh the accepted Dev source immediately before publication")
    expect(workflow).toContain("Verify the existing version against the original tarball below")
  })
})

describe("publication build retry boundary", () => {
  const guard = workflow.split("      - name: Refuse another build on workflow retries\n")[1]
    .split("          node --input-type=module <<'NODE'\n")[1].split("          NODE\n")[0].replace(/^ {10}/gm, "")
  const source = "a".repeat(40)
  const runGuard = (attempt, mutate = () => {}) => {
    const root = mkdtempSync(join(tmpdir(), "lotus-build-retry-"))
    const history = Array.from({ length: attempt - 1 }, (_, index) => ({ total_count: 1, jobs: [{
      name: "Build and pack the final artifact once", run_id: 77, run_attempt: index + 1, head_sha: source, status: "completed",
      steps: [ { name: "Install exact dependencies", status: "completed", conclusion: "failure" },
        ...["Build and verify the final package tree", "Pack once without another lifecycle build"].map(name => ({ name, status: "completed", conclusion: "skipped" })) ],
    }] }))
    mutate(history)
    try {
      writeFileSync(join(root, "gh"), `#!${process.execPath}\nconst fs = require('node:fs');
const match = process.argv[3].match(/^repos\\/bigduu\\/lotus-next\\/actions\\/runs\\/77\\/attempts\\/([1-9][0-9]*)\\/jobs\\?per_page=100$/);
if (!match || process.argv[2] !== 'api') process.exit(2);
fs.appendFileSync(process.env.RETRY_LOG, match[1] + '\\n');
process.stdout.write(JSON.stringify(JSON.parse(process.env.RETRY_HISTORY)[Number(match[1]) - 1]));\n`, { mode: 0o755 })
      const result = spawnSync(process.execPath, ["--input-type=module", "-e", guard], { encoding: "utf8", timeout: 5000,
        env: { ...process.env, PATH: root + delimiter + process.env.PATH, GITHUB_REPOSITORY: "bigduu/lotus-next", GITHUB_RUN_ID: "77",
          GITHUB_RUN_ATTEMPT: String(attempt), GITHUB_SHA: source, RETRY_HISTORY: JSON.stringify(history), RETRY_LOG: join(root, "calls") } })
      return { ...result, calls: attempt === 1 ? [] : readFileSync(join(root, "calls"), "utf8").trim().split("\n") }
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
  it.each([1, 2, 3])("permits attempt %s only before any prior build or pack began", (attempt) => {
    const result = runGuard(attempt)
    expect(result.status, result.stderr).toBe(0)
    expect(result.calls).toEqual(Array.from({ length: attempt - 1 }, (_, index) => String(index + 1)))
  })
  it.each([
    ["latest build succeeded", h => { h[1].jobs[0].steps[1].conclusion = "success" }],
    ["build failed", h => { h[0].jobs[0].steps[1].conclusion = "failure" }],
    ["build cancelled", h => { h[0].jobs[0].steps[1].conclusion = "cancelled" }],
    ["pack started", h => { h[0].jobs[0].steps[2].status = "in_progress" }],
    ["earlier build before a skipped retry", h => { h[0].jobs[0].steps[1].conclusion = "success" }],
    ["missing build step", h => { h[0].jobs[0].steps.splice(1, 1) }],
    ["missing pack step", h => { h[0].jobs[0].steps.pop() }],
    ["missing job", h => { h[0].jobs = []; h[0].total_count = 0 }],
    ["truncated jobs", h => { h[0].total_count = 2 }],
    ...[ ["run_id", 78], ["run_attempt", 2], ["head_sha", "b".repeat(40)], ["status", "in_progress"] ]
      .map(([key, value]) => [`wrong ${key}`, h => { h[0].jobs[0][key] = value }]),
  ])("refuses %s instead of rebuilding", (_name, mutate) => {
    expect(runGuard(3, mutate).status).toBe(1)
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
