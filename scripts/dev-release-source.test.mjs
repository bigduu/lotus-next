import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { execFileSync, spawnSync } from "node:child_process"
import { tmpdir } from "node:os"
import { delimiter, join, resolve } from "node:path"
import { describe, expect, it } from "vitest"
import { acceptanceJobNames, devFeatureJobNames, verifyDevAcceptance, verifyProtectedDevMerge } from "./release-source.mjs"

const clone = value => JSON.parse(JSON.stringify(value))

describe("historical explicit pre-merge Dev feature evidence", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8")
  const fixture = () => {
    const source = "d".repeat(40), head = "f".repeat(40), base = "b".repeat(40), snapshot = "a".repeat(40), tree = "c".repeat(40)
    const pr = { number: 450, state: "closed", merged: true, base: { ref: "dev", repo: { full_name: "bigduu/lotus-next" } },
      head: { sha: head, repo: { full_name: "bigduu/lotus-next" } }, merge_commit_sha: source, merged_at: "2026-10-27T12:00:00Z" }
    const run = { id: 10, run_attempt: 1, workflow_id: 1, path: ".github/workflows/ci.yml", event: "pull_request", head_sha: head,
      repository: { full_name: "bigduu/lotus-next" }, head_repository: { full_name: "bigduu/lotus-next" }, status: "completed", conclusion: "success" }
    const steps = { "Node 22": ["Verify Node 22 Unit compatibility"], "Node 24": ["Verify architecture, build, and package contents"],
      "Real Bamboo / Node 24": ["Verify a real chat round trip with the pinned published Bamboo", "Verify the current source artifact on local and secure browser surfaces"],
      "Native Actor acceptance / Native Actor / Node 24": ["Verify three negative controls and restored real Actor proof"] }
    for (const n of [1, 2, 3, 4]) steps[`Browser / Node 24 / shard ${n} of 4`] = ["Verify the all-surface browser shard"]
    const jobs = { total_count: 11, jobs: devFeatureJobNames(workflow).map(name => ({ name, run_id: 10, run_attempt: 1, head_sha: head, status: "completed", conclusion: "success",
      completed_at: "2026-10-27T11:00:00Z", steps: (steps[name] || []).map(name => ({ name, status: "completed", conclusion: "success" })) })) }
    const receipt = { schemaVersion: 1, kind: "lotus-feature-acceptance/v1", source: { repository: "bigduu/lotus-next", pullRequest: 450,
      baseRef: "dev", headSha: head, baseSha: base, runId: "10", sourceRunAttempt: 1, testedSnapshot: snapshot, testedTree: tree },
      gates: { source: "success", verify: "success", browser: "success", realBamboo: "success", nativeActor: "success" }, acceptanceRunAttempt: 1 }
    const merged = { sha: source, parents: [{ sha: base }, { sha: head }], tree: { sha: tree } }
    const tested = { ...clone(merged), sha: snapshot }
    return { source, pr, run, jobs, receipt, merged, tested }
  }
  const verify = x => verifyDevAcceptance(x.source, x.pr, x.run, x.jobs, x.receipt, x.merged, x.tested, 1, workflow)
  it("accepts the actual tested M and normally merged D without any Main candidate registration", () => {
    const x = fixture()
    expect(verify(x)).toEqual({ sourceTree: x.merged.tree.sha, testedSnapshot: x.tested.sha, featureRunAttempt: 1 })
  })
  it.each(["failure", "cancelled", "skipped"])("rejects every incomplete feature owner: %s", state => {
    for (let i = 0; i < 11; i++) { const x = fixture(); x.jobs.jobs[i].conclusion = state; expect(() => verify(x)).toThrow() }
  })
  it("rejects skipped runtime steps even if the enclosing job is green", () => {
    const x = fixture(); x.jobs.jobs.find(j => j.name === "Real Bamboo / Node 24").steps[1].conclusion = "skipped"
    expect(() => verify(x)).toThrow()
  })
  it("accepts successful earlier-attempt jobs when the final acceptance receipt matches its own attempt", () => {
    const x = fixture(); x.run.run_attempt = 2; x.receipt.acceptanceRunAttempt = 2
    x.jobs.jobs.find(job => job.name === "Feature acceptance").run_attempt = 2
    expect(() => verify(x)).not.toThrow()
  })
  it.each([
    ["foreign source", x => { x.pr.head.repo.full_name = "other/repo" }],
    ["Main instead of Dev", x => { x.pr.base.ref = "main" }],
    ["unmerged source", x => { x.pr.merged = false }],
    ["foreign run", x => { x.run.workflow_id = 2 }],
    ["manual diagnostic", x => { x.run.event = "workflow_dispatch" }],
    ["wrong run source", x => { x.run.head_sha = x.source }],
    ["job from another run", x => { x.jobs.jobs[0].run_id = 999 }],
    ["future job attempt", x => { x.jobs.jobs[0].run_attempt = 2 }],
    ["missing job attempt", x => { delete x.jobs.jobs[0].run_attempt }],
    ["fractional job attempt", x => { x.jobs.jobs[0].run_attempt = 0.5 }],
    ["acceptance job from another attempt", x => { x.run.run_attempt = 2; x.receipt.acceptanceRunAttempt = 2 }],
    ["fractional source attempt", x => { x.receipt.source.sourceRunAttempt = 0.5 }],
    ["fractional acceptance attempt", x => { x.receipt.acceptanceRunAttempt = 0.5 }],
    ["invalid tested snapshot", x => { x.receipt.source.testedSnapshot = "invalid" }],
    ["missing job", x => { x.jobs.jobs.pop() }],
    ["wrong tested tree", x => { x.tested.tree.sha = "e".repeat(40) }],
    ["rewritten Dev parents", x => { x.merged.parents.reverse() }],
    ["post-merge tests", x => { x.jobs.jobs[0].completed_at = "2026-10-27T13:00:00Z" }],
    ["partial runtime receipt", x => { x.receipt.gates.realBamboo = "skipped" }],
  ])("rejects %s", (_name, change) => { const x = fixture(); change(x); expect(() => verify(x)).toThrow() })
})

describe("publication trusts normal protected Dev admission", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8")
  const fixture = () => ({ source: "d".repeat(40),
    pr: { number: 450, state: "closed", merged: true, merge_commit_sha: "d".repeat(40),
      base: { ref: "dev", sha: "b".repeat(40), repo: { full_name: "bigduu/lotus-next" } },
      head: { sha: "f".repeat(40), repo: { full_name: "bigduu/lotus-next" } } },
    merged: { sha: "d".repeat(40), parents: [{ sha: "b".repeat(40) }, { sha: "f".repeat(40) }], tree: { sha: "c".repeat(40) } } })
  const verify = (x, ci = workflow) => verifyProtectedDevMerge(x.source, x.pr, x.merged, ci)
  it("accepts a normal merged Dev source without claiming a historical CI snapshot or attempt", () => {
    expect(verify(fixture())).toEqual({ sourceTree: "c".repeat(40) })
  })
  it.each([
    ["unmerged PR", x => { x.pr.merged = false }], ["open PR", x => { x.pr.state = "open" }],
    ["Main PR", x => { x.pr.base.ref = "main" }], ["foreign base", x => { x.pr.base.repo.full_name = "other/lotus-next" }],
    ["foreign head", x => { x.pr.head.repo.full_name = "other/lotus-next" }],
    ["different admitted source", x => { x.pr.merge_commit_sha = "e".repeat(40) }],
    ["different Git object", x => { x.merged.sha = "e".repeat(40) }],
    ["invalid admitted base", x => { x.pr.base.sha = "dev" }],
    ["different admitted base", x => { x.pr.base.sha = "e".repeat(40) }],
    ["squash merge", x => { x.merged.parents.pop() }],
    ["octopus merge", x => { x.merged.parents.push({ sha: "e".repeat(40) }) }],
    ["indirect feature head", x => { x.merged.parents[1].sha = "e".repeat(40) }],
    ["reversed parents", x => { x.merged.parents.reverse() }],
    ["invalid parent", x => { x.merged.parents[0].sha = "dev" }],
    ["duplicate parents", x => { x.merged.parents[0].sha = x.pr.head.sha }],
    ["invalid tree", x => { x.merged.tree.sha = "main" }],
  ])("rejects %s", (_name, mutate) => { const x = fixture(); mutate(x); expect(() => verify(x)).toThrow() })
  it.each([
    ["old source graph", () => readFileSync("scripts/fixtures/ci-sharded-main-v1.yml", "utf8")],
    ["temporary bridge", () => readFileSync("scripts/fixtures/ci-dev-bridge-v1.yml", "utf8")],
    ["Main push trigger", s => s.replace("on:\n", "on:\n  push:\n    branches: [main]\n")],
    ["conditional owner", s => s.replace("  real-bamboo:\n", "  real-bamboo:\n    if: false\n")],
    ["ignored failure", s => s.replace("  verify:\n", "  verify:\n    continue-on-error: true\n")],
    ["missing aggregate always", s => s.replace("    name: Feature acceptance\n    if: ${{ always() }}", "    name: Feature acceptance\n    if: success()")],
    ["missing runtime need", s => s.replace("[source, verify, browser-summary, real-bamboo, native-actor]", "[source, verify, browser-summary, native-actor]")],
    ["missing browser need", s => s.replace("needs: [verify, browser]", "needs: [verify]")],
    ["fake aggregate", s => s.replace("run: node scripts/feature-acceptance.mjs summarize", "run: echo success")],
    ["skipped aggregate step", s => s.replace("        run: node scripts/feature-acceptance.mjs summarize", "        if: false\n        run: node scripts/feature-acceptance.mjs summarize")],
    ["forged runtime result", s => s.replace("REAL_BAMBOO_RESULT: ${{ needs.real-bamboo.result }}", "REAL_BAMBOO_RESULT: success")],
    ["quoted conditional override", s => s.replace("    name: Real Bamboo / Node 24", "    'if': false\n    name: Real Bamboo / Node 24")],
    ["verify matrix excludes the Unit lane", s => s.replace("      matrix:\n        node:\n", "      matrix:\n        exclude:\n          - node: 22\n        node:\n")],
    ["verify matrix adds an included lane", s => s.replace("      matrix:\n        node:\n", "      matrix:\n        include:\n          - node: 22\n        node:\n")],
    ["browser matrix excludes a shard", s => s.replace("        shard:\n", "        exclude:\n          - node: 24\n            shard: 1\n        shard:\n")],
    ["browser matrix includes an extra shard", s => s.replace("        shard:\n", "        include:\n          - node: 24\n            shard: 5\n        shard:\n")],
    ["verify matrix has a quoted exclusion", s => s.replace("      matrix:\n        node:\n", "      matrix:\n        'exclude':\n          - node: 22\n        node:\n")],
    ["browser matrix repeats the shard key", s => s.replace("        shard:\n", "        shard:\n          - 1\n        shard:\n")],
  ])("rejects incomplete gate wiring: %s", (_name, mutate) => {
    expect(() => verify(fixture(), mutate(workflow))).toThrow()
  })
})

describe("protected Dev publication CLI", () => {
  const runSource = (change) => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "lotus-dev-merge-trust-"))), repo = join(root, "repo"), bin = join(root, "bin")
    mkdirSync(repo); mkdirSync(bin); mkdirSync(join(repo, "scripts")); mkdirSync(join(repo, ".github", "workflows"), { recursive: true })
    const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8", stdio: "pipe" }).trim()
    try {
      git("init", "--quiet", "--initial-branch=dev"); git("config", "user.name", "Dev source policy")
      git("config", "user.email", "dev-source@example.invalid")
      writeFileSync(join(repo, "scripts/release-source.mjs"), readFileSync(resolve("scripts/release-source.mjs")))
      writeFileSync(join(repo, ".github/workflows/ci.yml"), readFileSync(".github/workflows/ci.yml"))
      writeFileSync(join(repo, "package.json"), JSON.stringify({ name: "@bigduu/lotus-next", version: "0.0.0" }))
      git("add", "."); git("commit", "--quiet", "-m", "Dev base")
      const base = git("rev-parse", "HEAD")
      git("checkout", "--quiet", "-b", "feature"); writeFileSync(join(repo, "feature.txt"), "feature\n")
      git("add", "."); git("commit", "--quiet", "-m", "Feature head")
      const head = git("rev-parse", "HEAD")
      git("checkout", "--quiet", "dev"); git("merge", "--quiet", "--no-ff", "feature", "-m", "Normal Dev merge")
      const source = git("rev-parse", "HEAD"), tree = git("rev-parse", "HEAD^{tree}")
      git("tag", "-a", "lotus-next-v2026.10.30", "-m", "Reserved formal version")
      git("commit", "--quiet", "--allow-empty", "-m", "Later trusted controller")
      const controller = git("rev-parse", "HEAD")
      git("remote", "add", "origin", repo)
      const pr = { number: 450, state: "closed", merged: true, merged_at: "2020-01-01T00:00:00Z", merge_commit_sha: source,
        base: { ref: "dev", sha: base, repo: { full_name: "bigduu/lotus-next" } }, head: { sha: head, repo: { full_name: "bigduu/lotus-next" } } }
      const routes = { "actions/runs/99": { id: 99, created_at: "2026-10-30T00:00:00Z" },
        "actions/workflows/publish-npm.yml/runs?event=workflow_dispatch&per_page=100&page=1": { total_count: 0, workflow_runs: [] },
        "pulls/450": pr, [`git/commits/${source}`]: { sha: source, parents: [{ sha: base }, { sha: head }], tree: { sha: tree } },
        "branches/dev": { protected: true, commit: { sha: controller } },
        [`compare/${controller}...${controller}`]: { merge_base_commit: { sha: controller }, status: "identical" },
        [`compare/${source}...${controller}`]: { merge_base_commit: { sha: source }, status: "ahead" },
        [`git/ref/heads/release/${source}`]: { object: { sha: source } } }
      if (change === "unprotected Dev") routes["branches/dev"].protected = false
      if (change === "unaccepted controller") routes[`compare/${controller}...${controller}`].merge_base_commit.sha = base
      if (change === "non-ancestor source") routes[`compare/${source}...${controller}`].merge_base_commit.sha = base
      if (change === "moved release ref") routes[`git/ref/heads/release/${source}`].object.sha = controller
      if (change === "forged Git parents") routes[`git/commits/${source}`].parents[0].sha = controller
      if (change === "moved tag") { git("tag", "--delete", "lotus-next-v2026.10.30"); git("tag", "-a", "lotus-next-v2026.10.30", "-m", "Wrong source") }
      writeFileSync(join(bin, "gh"), `#!${process.execPath}\nconst fs = require('node:fs');
const route = process.argv[3]?.replace('repos/bigduu/lotus-next/', '');
fs.appendFileSync(process.env.SOURCE_API_LOG, route + '\\n');
const routes = JSON.parse(process.env.SOURCE_API_ROUTES);
if (process.argv[2] !== 'api' || !Object.hasOwn(routes, route)) { console.error('No retained feature CI record: ' + route); process.exit(2); }
process.stdout.write(JSON.stringify(routes[route]));\n`, { mode: 0o755 })
      const output = join(root, "receipt.json"), calls = join(root, "api.log")
      const result = spawnSync(process.execPath, [join(repo, "scripts/release-source.mjs")], { cwd: repo, encoding: "utf8", timeout: 10000,
        env: { ...process.env, PATH: bin + delimiter + process.env.PATH, GITHUB_REPOSITORY: "bigduu/lotus-next",
          GITHUB_REF: "refs/heads/dev", GITHUB_REF_PROTECTED: "true", GITHUB_EVENT_NAME: "workflow_dispatch",
          GITHUB_SHA: controller, GITHUB_WORKFLOW_SHA: controller, EXPECTED_WORKFLOW_SHA: controller,
          GITHUB_WORKFLOW_REF: "bigduu/lotus-next/.github/workflows/publish-npm.yml@refs/heads/dev",
          GITHUB_RUN_ID: "99", GITHUB_RUN_ATTEMPT: "1", FEATURE_PR_INPUT: "450", FEATURE_RUN_INPUT: "",
          EXPECTED_SOURCE_SHA_INPUT: source, SOURCE_REF_INPUT: "refs/tags/lotus-next-v2026.10.30",
          LOTUS_NEXT_RELEASE_VERSION: "2026.10.30", SOURCE_RECEIPT_PATH: output, GITHUB_OUTPUT: join(root, "outputs"),
          SOURCE_API_LOG: calls, SOURCE_API_ROUTES: JSON.stringify(routes) } })
      return { ...result, source, controller, tree, receipt: result.status === 0 ? JSON.parse(readFileSync(output, "utf8")) : null,
        calls: readFileSync(calls, "utf8").trim().split("\n") }
    } finally { rmSync(root, { recursive: true, force: true }) }
  }
  it("admits an unchanged old source when all original feature run/artifact records are unavailable", () => {
    const result = runSource()
    expect(result.status, result.stderr).toBe(0)
    expect(result.receipt).toMatchObject({ sourceSha: result.source, sourceTree: result.tree, workflowSha: result.controller, featurePr: 450 })
    expect(result.source).not.toBe(result.controller)
    for (const key of ["testedSnapshot", "featureRun", "featureRunAttempt"]) expect(result.receipt).not.toHaveProperty(key)
    expect(result.calls.filter(route => route.startsWith("actions/"))).toEqual([
      "actions/runs/99", "actions/workflows/publish-npm.yml/runs?event=workflow_dispatch&per_page=100&page=1",
    ])
  })
  it.each(["unprotected Dev", "unaccepted controller", "non-ancestor source", "moved release ref", "forged Git parents", "moved tag"])(
    "fails closed for %s without tests or product builds", change => { expect(runSource(change).status).toBe(1) },
  )
})


describe("historical publication boundary", () => {
  it("keeps new Dev receipts out of the existing historical parser", () => {
    const feature = readFileSync(".github/workflows/ci.yml", "utf8")
    const historical = readFileSync("scripts/fixtures/ci-sharded-main-v1.yml", "utf8")
    expect(() => acceptanceJobNames(feature)).toThrow(/Unknown acceptance workflow graph/)
    expect(() => devFeatureJobNames(historical)).toThrow()
  })
  it("rejects a feature graph with missing or duplicate matrix coverage", () => {
    const feature = readFileSync(".github/workflows/ci.yml", "utf8")
    expect(() => devFeatureJobNames(feature.replace("          - 4\n", "          - 3\n"))).toThrow()
  })
})
