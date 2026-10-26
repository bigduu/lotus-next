import { execFileSync, spawnSync } from "node:child_process"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { featureSource, requireFeatureResults, verifyFeatureSource } from "./feature-acceptance.mjs"

const directories = []
afterEach(() => { for (const root of directories.splice(0)) rmSync(root, { recursive: true, force: true }) })
const fixture = () => {
  const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "lotus-feature-source-")))
  directories.push(directory)
  const root = path.join(directory, "source")
  mkdirSync(root)
  const git = (...args) => execFileSync("git", ["-C", root, ...args.flat()], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
  git("init", "-q", "--initial-branch=dev")
  git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid")
  git("config", "commit.gpgSign", "false"); git("config", "core.hooksPath", "/dev/null")
  writeFileSync(path.join(root, "common"), "common\n"); git("add", "."); git("commit", "-qm", "common")
  git("checkout", "-qb", "feature/example")
  writeFileSync(path.join(root, "feature"), "feature\n"); git("add", "."); git("commit", "-qm", "feature")
  const head = git("rev-parse", "HEAD")
  git("checkout", "-q", "dev")
  writeFileSync(path.join(root, "base"), "base\n"); git("add", "."); git("commit", "-qm", "advance dev")
  const base = git("rev-parse", "HEAD")
  git("merge", "--no-ff", "-qm", "actual PR merge snapshot", "feature/example")
  const snapshot = git("rev-parse", "HEAD"), tree = git("rev-parse", "HEAD^{tree}")
  const event = { number: 446, pull_request: { number: 446,
    base: { ref: "dev", sha: base, repo: { full_name: "bigduu/lotus-next" } },
    head: { ref: "feature/example", sha: head, repo: { full_name: "bigduu/lotus-next" } } } }
  const eventPath = path.join(directory, "event.json")
  writeFileSync(eventPath, JSON.stringify(event))
  const environment = { GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "bigduu/lotus-next", GITHUB_EVENT_NAME: "pull_request",
    GITHUB_BASE_REF: "dev", GITHUB_HEAD_REF: "feature/example", GITHUB_REF: "refs/pull/446/merge",
    GITHUB_WORKFLOW_REF: "bigduu/lotus-next/.github/workflows/ci.yml@refs/pull/446/merge",
    GITHUB_SHA: snapshot, FEATURE_WORKFLOW_SHA: snapshot, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2", GITHUB_EVENT_PATH: eventPath }
  return { root, directory, git, head, base, snapshot, tree, event, environment }
}

describe("feature merge snapshot admission", () => {
  it("records the actual merged inputs without relabeling the feature head or future dev commit", () => {
    const f = fixture(), receipt = featureSource(f)
    expect(receipt).toMatchObject({ kind: "lotus-feature-source/v1", pullRequest: 446, baseSha: f.base,
      headSha: f.head, testedSnapshot: f.snapshot, testedTree: f.tree, runId: "123", sourceRunAttempt: 2 })
    expect(receipt.testedSnapshot).not.toBe(receipt.headSha)
    expect(receipt).not.toHaveProperty("releaseSource")
    expect(receipt).not.toHaveProperty("admittedDev")
  })

  it.each([
    { GITHUB_ACTIONS: "false" }, { GITHUB_REPOSITORY: "other/repo" }, { GITHUB_EVENT_NAME: "push" },
    { GITHUB_EVENT_NAME: "workflow_dispatch" }, { GITHUB_BASE_REF: "main" }, { GITHUB_HEAD_REF: "different" },
    { GITHUB_REF: "refs/heads/dev" }, { GITHUB_REF: "refs/pull/447/merge" },
    { GITHUB_WORKFLOW_REF: "bigduu/lotus-next/.github/workflows/publish-npm.yml@refs/pull/446/merge" },
    { GITHUB_SHA: "a".repeat(40) }, { GITHUB_SHA: "A".repeat(40) }, { FEATURE_WORKFLOW_SHA: "" },
    { GITHUB_RUN_ID: "0" }, { GITHUB_RUN_ATTEMPT: "0" }, { GITHUB_RUN_ATTEMPT: "2suffix" },
  ])("rejects event or execution identity drift %j", (change) => {
    const f = fixture()
    expect(() => featureSource({ ...f, environment: { ...f.environment, ...change } })).toThrow()
  })

  it.each(["number", "base", "head", "repository", "target", "head-ref"])("rejects changed PR %s inputs", (change) => {
    const f = fixture(), event = structuredClone(f.event)
    if (change === "number") event.number++
    if (change === "base") event.pull_request.base.sha = f.head
    if (change === "head") event.pull_request.head.sha = f.base
    if (change === "repository") event.pull_request.base.repo.full_name = "other/repo"
    if (change === "target") event.pull_request.base.ref = "main"
    if (change === "head-ref") delete event.pull_request.head.ref
    expect(() => featureSource({ ...f, event })).toThrow()
  })

  it("permits a read-only fork test while keeping the canonical target and exact parent proof", () => {
    const f = fixture(), event = structuredClone(f.event)
    event.pull_request.head.repo.full_name = "contributor/lotus-next"
    expect(featureSource({ ...f, event }).headRepository).toBe("contributor/lotus-next")
  })

  it("rejects a head-only checkout, dirty source and Git inspection errors", () => {
    const f = fixture()
    f.git("checkout", "--detach", "-q", f.head)
    expect(() => featureSource({ ...f, environment: { ...f.environment, GITHUB_SHA: f.head } })).toThrow(/parents/)
    f.git("checkout", "--detach", "-q", f.snapshot)
    writeFileSync(path.join(f.root, "untracked"), "dirty")
    expect(() => featureSource(f)).toThrow(/clean/)
    expect(() => featureSource({ ...f, git: () => { throw new Error("Git unavailable") } })).toThrow(/Git unavailable/)
  })

  it("reuses only this same-run source receipt on a later failed-job rerun", () => {
    const f = fixture(), expected = featureSource(f), original = { ...expected, sourceRunAttempt: 1 }
    expect(verifyFeatureSource(original, expected)).toBe(original)
    for (const change of [{ sourceRunAttempt: 3 }, { sourceRunAttempt: 0 }, { runId: "124" },
      { testedSnapshot: f.head }, { testedTree: f.head }, { baseSha: f.head }, { headSha: f.base }, { extra: true }]) {
      expect(() => verifyFeatureSource({ ...original, ...change }, expected)).toThrow()
    }
  })

  it("executes receipt creation and the final aggregate without installing project dependencies", () => {
    const f = fixture(), sourcePath = path.join(f.directory, "feature-source.json"), acceptedPath = path.join(f.directory, "accepted.json")
    const cli = path.resolve("scripts/feature-acceptance.mjs")
    const environment = { ...process.env, ...f.environment, FEATURE_RECEIPT_PATH: sourcePath,
      FEATURE_ACCEPTANCE_PATH: acceptedPath, GITHUB_OUTPUT: path.join(f.directory, "outputs"),
      SOURCE_RESULT: "success", VERIFY_RESULT: "success", BROWSER_RESULT: "success", REAL_BAMBOO_RESULT: "success", NATIVE_ACTOR_RESULT: "success" }
    const run = (command, changes = {}) => spawnSync(process.execPath, [cli, command], { cwd: f.root, encoding: "utf8", env: { ...environment, ...changes } })
    expect(run("source").status).toBe(0)
    const failed = run("summarize", { REAL_BAMBOO_RESULT: "skipped" })
    expect(failed.status).not.toBe(0)
    expect(failed.stderr).toContain("realBamboo")
    expect(run("summarize").status).toBe(0)
    const receipt = JSON.parse(readFileSync(acceptedPath, "utf8"))
    expect(receipt).toMatchObject({ kind: "lotus-feature-acceptance/v1", acceptanceRunAttempt: 2,
      source: { testedSnapshot: f.snapshot, testedTree: f.tree }, gates: { realBamboo: "success", nativeActor: "success" } })
  })
})

describe("complete feature result collection", () => {
  const results = { source: "success", verify: "success", browser: "success", realBamboo: "success", nativeActor: "success" }
  it("requires all tests before dev admission", () => expect(requireFeatureResults(results)).toBe(results))
  it.each(Object.keys(results))("propagates missing, skipped and failed %s", (name) => {
    for (const value of ["failure", "cancelled", "skipped", "", "unknown", undefined]) expect(() => requireFeatureResults({ ...results, [name]: value })).toThrow()
    const missing = { ...results }; delete missing[name]
    expect(() => requireFeatureResults(missing)).toThrow()
  })
})

describe("feature workflow phase policy", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8"), actor = readFileSync(".github/workflows/actor-native.yml", "utf8")
  const job = (id) => ci.split(`\n  ${id}:\n`)[1]?.split(/\n  [a-z][a-z0-9-]*:\n/u)[0]
  it("tests dev PR merge snapshots and performs no main push or release tests", () => {
    expect(ci).toContain("  pull_request:\n    branches: [dev]")
    expect(ci).not.toMatch(/^  (?:push|workflow_dispatch):/m)
    expect(ci).not.toContain("github.event.pull_request.head.sha || github.sha")
    for (const block of ci.split(/(?=^      - name: Check out)/m).filter((part) => part.startsWith("      - name: Check out") && !part.startsWith("      - name: Check out the paired Bamboo"))) {
      expect(block.split(/\n      - /u)[0]).toContain("ref: ${{ github.sha }}")
    }
  })
  it("requires every gate and rejects success stubs or skipped real-runtime admission", () => {
    const aggregate = job("feature-acceptance")
    expect(aggregate).toContain("if: ${{ always() }}")
    expect(aggregate).toContain("needs: [source, verify, browser-summary, real-bamboo, native-actor]")
    expect(aggregate).toContain("run: node scripts/feature-acceptance.mjs summarize")
    for (const [name, id] of [["SOURCE_RESULT", "source"], ["VERIFY_RESULT", "verify"], ["BROWSER_RESULT", "browser-summary"], ["REAL_BAMBOO_RESULT", "real-bamboo"], ["NATIVE_ACTOR_RESULT", "native-actor"]]) {
      expect(aggregate).toContain(`${name}: \${{ needs.${id}.result }}`)
    }
    expect(ci).not.toContain("continue-on-error:")
    expect(job("real-bamboo")).not.toContain("workflow_dispatch")
    expect(job("real-bamboo")).toContain("needs: [source, verify, browser-summary]")
  })
  it("shares the one verified Node24 dist instead of rebuilding it for real-runtime tests", () => {
    const real = job("real-bamboo")
    expect(real).toContain("name: browser-input-node-24")
    expect(real).toContain("node scripts/browser-shards.mjs check-source")
    expect(real).not.toMatch(/npm run (?:build|verify)/u)
    expect(real).toContain("npx playwright install-deps chromium")
    expect(real).toContain("npx playwright install ffmpeg")
    expect(real).not.toContain("playwright install --with-deps")
  })
  it("keeps Unit compatibility on Node22 and24 while building and testing browsers only on Node24", () => {
    const verify = job("verify"), browser = job("browser")
    expect(verify).toContain("          - 22\n          - 24")
    expect(verify).toContain("if: matrix.node == 22\n        run: npm run test:run")
    expect(verify).toContain("if: matrix.node == 24\n        run: npm run verify")
    expect(verify).toContain("if: matrix.node == 24\n        run: node scripts/browser-shards.mjs inventory")
    expect(verify).toContain("Share the verified exact-source artifact and inventory\n        if: matrix.node == 24")
    expect(browser).toContain("        node:\n          - 24\n        shard:")
    expect(browser).not.toContain("          - 22")
    expect(job("real-bamboo")).toContain("node-version: 24")
  })
  it("calls native Actor acceptance once as part of the same feature gate", () => {
    expect(job("native-actor")).toContain("uses: ./.github/workflows/actor-native.yml")
    expect(job("native-actor")).toContain("needs: [source, verify]")
    expect(actor).toContain("name: browser-input-node-24")
    expect(actor).not.toContain("npm ci && npm run build")
    expect(actor).toContain("shutil.copytree(pristine_dist, root / 'dist')")
    expect(actor).not.toContain("restored-build.log")
    expect(actor).toContain("on:\n  workflow_call:")
    expect(actor).not.toMatch(/^  (?:pull_request|push|workflow_dispatch):/m)
  })
  it("preserves each runtime evidence attempt when failed jobs are rerun", () => {
    for (const [workflow, name] of [
      [job("real-bamboo"), "real-bamboo-verification-browser"],
      [job("real-bamboo"), "playwright-report-real-bamboo-node-24"],
      [actor, "native-actor-browser-evidence"],
    ]) {
      expect(workflow).toContain(`name: ${name}-attempt-\${{ github.run_attempt }}\n`)
      expect(workflow).not.toContain(`name: ${name}\n`)
      expect(workflow).not.toContain("overwrite: true")
    }
  })
})

describe("feature compiler ownership", () => {
  const scripts = JSON.parse(readFileSync("package.json", "utf8")).scripts
  it("lets build own TypeScript compilation while preserving its failure status", () => {
    expect(scripts.build).toBe("tsc -b && vite build && node scripts/artifact-manifest.mjs generate")
    expect(scripts.verify).not.toContain("npm run type-check")
    expect(scripts.verify.match(/npm run build/gu)).toHaveLength(1)
    const directory = realpathSync(mkdtempSync(path.join(tmpdir(), "lotus-compiler-owner-")))
    directories.push(directory)
    const record = path.join(directory, "commands")
    const stub = (name, body) => writeFileSync(path.join(directory, name), `#!/bin/bash\n${body}\n`, { mode: 0o755 })
    stub("npm", 'echo "npm $*" >> "$COMMAND_RECORD"\nif [[ "$*" == "run build" ]]; then exec bash -c "$BUILD_SCRIPT"; fi')
    stub("tsc", 'echo "tsc $*" >> "$COMMAND_RECORD"\nexit "$TSC_STATUS"')
    stub("vite", 'echo "vite $*" >> "$COMMAND_RECORD"')
    stub("node", 'echo "node $*" >> "$COMMAND_RECORD"')
    const run = (status) => {
      writeFileSync(record, "")
      const result = spawnSync("bash", ["-c", scripts.verify], { encoding: "utf8", env: { ...process.env,
        PATH: `${directory}${path.delimiter}${process.env.PATH}`, BUILD_SCRIPT: scripts.build,
        COMMAND_RECORD: record, TSC_STATUS: String(status) } })
      return { ...result, commands: readFileSync(record, "utf8").trim().split("\n") }
    }
    const success = run(0)
    expect(success.status).toBe(0)
    expect(success.commands.filter((command) => command.startsWith("tsc "))).toEqual(["tsc -b"])
    expect(success.commands).toContain("npm run package:contents")
    const failure = run(42)
    expect(failure.status).toBe(42)
    expect(failure.commands.filter((command) => command.startsWith("tsc "))).toEqual(["tsc -b"])
    expect(failure.commands).not.toContain("vite build")
    expect(failure.commands).not.toContain("npm run package:contents")
  })
})
