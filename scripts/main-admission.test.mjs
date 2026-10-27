// Inert APIs/tiny Git only. These contracts install no producer or Main gate.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, writeFileSync, mkdirSync, rmSync, unlinkSync, symlinkSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { afterEach, it, vi } from "vitest"
import * as main from "./main-admission.mjs"
import * as published from "./published-npm-admission.mjs"
import { fixture as sourceFixture, safeEnv } from "./frozen-dev-source.test-fixture.mjs"

const h = byte => byte.repeat(40), clone = value => structuredClone(value)
const hash = bytes => createHash("sha256").update(bytes).digest("hex")
const blob = bytes => { bytes = Buffer.from(bytes); return { path: "", type: "file", sha: createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex"), size: bytes.length, encoding: "base64", content: bytes.toString("base64") } }
const body = locator => "<!-- lotus-main-locator/v1\n" + JSON.stringify(locator) + "\n-->"
const noNetwork = () => assert.fail("Unregistered port; no actual network or publication")
const cleanup = []
const temporary = () => { const root = mkdtempSync(path.join(tmpdir(), "lotus-main459-")); cleanup.push(root); return root }
afterEach(() => { vi.restoreAllMocks(); while (cleanup.length) rmSync(cleanup.pop(), { recursive: true, force: true }) })

function model(B = h("b")) {
  const F = h("f"), M = h("c"), S = h("1"), repository = { id: 1281544268, full_name: "bigduu/lotus-next", owner: { id: 18681616 }, default_branch: "main" }
  const locator = { mode: "promotion", sourceRevision: S, version: "2026.10.99", feature: { pullRequest: 17, runId: 42, attempt: 1 }, releaseRunId: 900 }
  const pr = { number: 88, state: "open", merged: false, draft: false, mergeable: true, body: body(locator), merge_commit_sha: M,
    base: { ref: "main", sha: B, repo: repository }, head: { ref: "release/promotion", sha: F, repo: repository } }
  const event = { repository, number: 88, action: "opened", pull_request: clone(pr) }
  const env = { ...safeEnv, GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: repository.full_name, GITHUB_EVENT_NAME: "pull_request_target",
    GITHUB_REF: "refs/heads/main", GITHUB_REF_PROTECTED: "true", GITHUB_SHA: B, GITHUB_WORKFLOW_SHA: B,
    GITHUB_WORKFLOW_REF: `${repository.full_name}/${published.MAIN_WORKFLOW}@refs/heads/main`, GITHUB_JOB: "main-admission", GITHUB_RUN_ID: "700", GITHUB_RUN_ATTEMPT: "1" }
  const run = { id: 700, run_attempt: 1, workflow_id: 701, check_suite_id: 702, check_suite_node_id: "CS_inert",
    name: main.WORKFLOW_NAME, path: published.MAIN_WORKFLOW, event: "pull_request_target", head_sha: F, head_branch: pr.head.ref,
    status: "in_progress", conclusion: null, repository, head_repository: repository }
  const job = { id: 703, run_id: 700, run_attempt: 1, name: main.JOB, head_sha: F, head_branch: pr.head.ref, status: "in_progress", conclusion: null,
    started_at: "2026-10-27T00:00:00Z", completed_at: null, steps: [{ name: main.STEP, number: 1, status: "in_progress", conclusion: null }] }
  const suite = { databaseId: 702, repository: { databaseId: repository.id, nameWithOwner: repository.full_name },
    app: { databaseId: 15368, slug: "github-actions" }, commit: { oid: F }, workflowRun: { databaseId: 700, event: run.event, runAttempt: 1,
      workflow: { databaseId: 701, name: main.WORKFLOW_NAME }, file: { path: published.MAIN_WORKFLOW, repositoryName: repository.full_name,
        repositoryFileUrl: `https://github.com/${repository.full_name}/blob/${F}/${published.MAIN_WORKFLOW}` } } }
  const branch = { name: "main", protected: true, commit: { sha: B }, protection: { required_status_checks: { enforcement_level: "everyone",
    contexts: [main.JOB], checks: [{ context: main.JOB, app_id: 15368 }] } } }
  const state = { repository, pr, run, job, suite, branch }, calls = []
  const reads = { request: endpoint => {
    calls.push(endpoint)
    if (endpoint === "") return clone(state.repository)
    if (endpoint === "branches/main") return clone(state.branch)
    if (endpoint === "pulls/88") return clone(state.pr)
    if (endpoint === "git/commits/" + M) return { sha: M, tree: { sha: h("8") }, parents: [{ sha: B }, { sha: F }] }
    if (endpoint === "actions/runs/700") return clone(state.run)
    if (endpoint === "actions/workflows/main-admission.yml") return { id: 701, path: published.MAIN_WORKFLOW, state: "active" }
    if (endpoint === "actions/runs/700/attempts/1/jobs?per_page=100&page=1") return { total_count: 1, jobs: [clone(state.job)] }
    if (endpoint === "actions/jobs/703") return clone(state.job)
    return noNetwork()
  }, checkSuite: value => { assert.equal(value, "CS_inert"); return clone(state.suite) }, binary: noNetwork, jobLog: noNetwork, registry: noNetwork }
  return { B,F,M,S,env,event,reads,state,calls,locator }
}
function tiny() {
  const root = temporary(), git = (...args) => execFileSync("git", ["--no-replace-objects", "-C", root, "-c", "core.hooksPath=/dev/null",
    "-c", "commit.gpgsign=false", "-c", "user.name=Fixture", "-c", "user.email=fixture@invalid", ...args], { env: safeEnv, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
  git("init", "-q", "--initial-branch=main")
  for (const name of published.MAIN_CONTROLS) { const file = path.join(root, name); mkdirSync(path.dirname(file), { recursive: true }); writeFileSync(file, readFileSync(name)) }
  writeFileSync(path.join(root, "package.json"), '{"version":"0.0.0"}\n'); writeFileSync(path.join(root, "package-lock.json"), "stable product lock\n")
  const commit = () => { git("add", "."); git("commit", "-qm", "inert trusted Base"); return git("rev-parse", "HEAD") }
  return { root, git, commit, B: commit() }
}

it("Main459 preserves actual B while official Target metadata/file name F", () => {
  const f = model(), value = main.runtime(f.env, f.event, f.reads)
  assert.equal(value.B, f.B); assert.equal(value.F, f.F); assert.equal(value.M, f.M)
  assert.equal(value.execution.revision, f.B); assert.equal(value.execution.metadataRevision, f.F)
})
for (const fault of ["PR event", "default dev", "unprotected", "relabeled M", "foreign app", "metadata as B", "suite file as B", "same-name stub", "wrong physical attempt", "changed locator", "foreign head", "missing protection", "missing step"])
it("Main459 rejects " + fault, () => {
  const f = model()
  if (fault === "PR event") f.env.GITHUB_EVENT_NAME = "pull_request"
  if (fault === "default dev") f.event.repository.default_branch = "dev"
  if (fault === "unprotected") f.env.GITHUB_REF_PROTECTED = "false"
  if (fault === "relabeled M") f.env.GITHUB_SHA = f.M
  if (fault === "foreign app") f.state.suite.app.databaseId = 1
  if (fault === "metadata as B") f.state.run.head_sha = f.B
  if (fault === "suite file as B") f.state.suite.workflowRun.file.repositoryFileUrl = f.state.suite.workflowRun.file.repositoryFileUrl.replace(f.F, f.B)
  if (fault === "same-name stub") f.state.run.path = ".github/workflows/candidate.yml"
  if (fault === "wrong physical attempt") f.state.job.run_attempt = 2
  if (fault === "changed locator") f.state.pr.body = body({ ...f.locator, version: "2026.10.100" })
  if (fault === "foreign head") f.state.pr.head.repo.id = 1
  if (fault === "missing protection") f.state.branch.protection.required_status_checks.checks = []
  if (fault === "missing step") f.state.job.steps = []
  assert.throws(() => main.runtime(f.env, f.event, f.reads))
})
it("Main459 rejects unknown/controller locators and keeps bootstrap outside the CLI", () => {
  const f = model()
  for (const mode of ["unknown", "controller"]) assert.throws(() => main.locator(body({ ...f.locator, mode })), /Unknown Main mode/)
  f.event.pull_request.body = body({ mode: "bootstrap", sourceRevision: f.S, feature: f.locator.feature })
  assert.throws(() => main.eventIdentity(f.env, f.event), /rejects bootstrap/)
  assert.throws(() => main.locator(body(f.locator) + body(f.locator)))
  assert.throws(() => main.locator(body({ ...f.locator, approved: true })))
})
it("Main459 tiny Git verifies the literal22 controls and both complete shared documents", () => {
  const f = tiny(); main.checkout(f.root, f.B)
  assert.equal(published.MAIN_CONTROLS.length, 22)
  for (const name of ["docs/delivery-workflow.md", "docs/ci-workflow-audit.md"]) assert.deepEqual(readFileSync(path.join(f.root, name)), readFileSync(name))
  assert.ok(!published.MAIN_CONTROLS.includes("package.json") && !published.MAIN_CONTROLS.includes("package-lock.json"))
  writeFileSync(path.join(f.root, "scripts/main-admission.mjs"), "changed\n"); assert.throws(() => main.checkout(f.root, f.B), /clean/)
})
it("Main459 tiny Git rejects a missing or symlinked control even if committed", () => {
  for (const link of [false, true]) {
    const f = tiny(), file = path.join(f.root, "docs/delivery-workflow.md"); unlinkSync(file)
    if (link) symlinkSync("delivery.md", file)
    assert.throws(() => main.checkout(f.root, f.commit()))
  }
})
it("Main459 real public default stays inactive and calls no publisher or release read", async () => {
  const git = tiny(), f = model(git.B)
  await assert.rejects(() => main.executeMain(f.env, f.event, git.root, f.reads), /No accepted complete release producer/)
  assert.ok(!f.calls.some(value => /^(releases|actions\/runs\/900)/u.test(value)))
})
it("Main459 component emits one bounded frame only after fresh identity checks", async () => {
  const git = tiny(), f = model(git.B)
  // Existing verifier seam only; this is not a genuine accepted producer/CLI.
  const spy = vi.spyOn(published, "verifyPromotion").mockImplementation(async (...args) => {
    assert.equal(args.length, 2); assert.equal(args[1], f.reads)
    assert.deepEqual(args[0], { sourceRevision: f.S, version: f.locator.version, feature: f.locator.feature, releaseRunId: 900,
      pullRequest: 88, baseRevision: f.B, headRevision: f.F, snapshotRevision: f.M })
    return { kind: "lotus-main-promotion-facts/v1", publicationAuthorized: false, source: { revision: f.S, tree: h("5") },
      completion: { assetId: 2, sha256: "a".repeat(64) }, promotion: { pullRequest: 88, baseRevision: f.B, headRevision: f.F, snapshotRevision: f.M, snapshotTree: h("8"), controlMode: "complete-trusted-base" } }
  })
  const line = await main.executeMain(f.env, f.event, git.root, f.reads), value = JSON.parse(Buffer.from(line.slice(main.PREFIX.length), "base64"))
  assert.equal(spy.mock.calls.length, 1); assert.ok(line.startsWith(main.PREFIX)); assert.equal(value.execution.revision, f.B)
  assert.equal(value.execution.metadataRevision, f.F); assert.equal(value.promotion.snapshotRevision, f.M); assert.equal(value.publicationAuthorized, false)
  assert.equal(Buffer.from(line.slice(main.PREFIX.length), "base64").toString(), main.canonical(value))
  assert.throws(() => main.frame({ kind: "lotus-main-admission/v1", publicationAuthorized: false, extra: "x".repeat(32768) }))
})
for (const fault of ["locator after proof", "Main after proof"])
it("Main459 rejects " + fault + " before a frame", async () => {
  const git = tiny(), f = model(git.B)
  vi.spyOn(published, "verifyPromotion").mockImplementation(async () => {
    if (fault === "locator after proof") f.state.pr.body = body({ ...f.locator, releaseRunId: 901 })
    else f.state.branch.commit.sha = h("0")
    return { kind: "lotus-main-promotion-facts/v1", publicationAuthorized: false }
  })
  await assert.rejects(() => main.executeMain(f.env, f.event, git.root, f.reads))
})

function bootstrap() {
  const f = sourceFixture(), D = f.pr.merge_commit_sha, F = h("a"), M = h("9"), headTree = h("8"), repo = model().state.repository
  const leaf = bytes => ({ mode: "100644", sha: blob(bytes).sha })
  const base = new Map([["src/product.txt", leaf("legacy stable product")], ["package.json", leaf("legacy version0.0.0")], ["package-lock.json", leaf("legacy lock")], ["vendor/module", { mode: "160000", sha: h("7") }]])
  const controls = new Map(published.MAIN_CONTROLS.map(name => [name, leaf(readFileSync(name))]))
  const head = new Map([...base, ...controls].map(([name, value]) => [name, clone(value)])), selected = { mode: "bootstrap", sourceRevision: D, feature: { pullRequest: 17, runId: 42, attempt: 1 } }
  const pr = { number: 88, state: "open", merged: false, draft: false, mergeable: true, body: body(selected), merge_commit_sha: M,
    base: { ref: "main", sha: main.LEGACY_MAIN, repo }, head: { ref: "controller/bootstrap", sha: F, repo } }
  const commits = { [main.LEGACY_MAIN]: { sha: main.LEGACY_MAIN, tree: { sha: main.LEGACY_TREE } },
    [F]: { sha: F, tree: { sha: headTree } }, [M]: { sha: M, tree: { sha: headTree }, parents: [{ sha: main.LEGACY_MAIN }, { sha: F }] } }
  const rows = (sha, map) => ({ sha, truncated: false, tree: [...map].map(([path, value]) => ({ path, type: value.mode === "160000" ? "commit" : "blob", ...value })) })
  let mainHead = main.LEGACY_MAIN, sourcePRReads = 0, change = () => {}
  const reads = { request: endpoint => {
    if (endpoint === "") return clone(repo)
    if (endpoint === "branches/main") return { name: "main", protected: false, commit: { sha: mainHead } }
    if (endpoint === "pulls/88") { change(); return clone(pr) }
    if (endpoint.startsWith("git/commits/") && commits[endpoint.slice(12)]) return clone(commits[endpoint.slice(12)])
    if (endpoint === `compare/${main.LEGACY_MAIN}...${F}`) return { status: "ahead", base_commit: { sha: main.LEGACY_MAIN }, merge_base_commit: { sha: main.LEGACY_MAIN } }
    if (endpoint === `git/trees/${main.LEGACY_TREE}?recursive=1`) return rows(main.LEGACY_TREE, base)
    if (endpoint === `git/trees/${f.accepted.tree.sha}?recursive=1`) return rows(f.accepted.tree.sha, controls)
    if (endpoint === `git/trees/${headTree}?recursive=1`) return rows(headTree, head)
    if (endpoint === `contents/${published.MAIN_WORKFLOW}?ref=${D}`) return { ...blob(readFileSync(published.MAIN_WORKFLOW)), path: published.MAIN_WORKFLOW }
    if (endpoint === "pulls/17") sourcePRReads++
    return f.request(endpoint)
  }, binary: endpoint => { const match = /^actions\/artifacts\/(\d+)\/zip$/u.exec(endpoint); assert.ok(match); return f.archives[Number(match[1])] }, checkSuite: noNetwork, jobLog: noNetwork, registry: noNetwork }
  const input = { sourceRevision: D, feature: selected.feature, pullRequest: 88, headRevision: F, snapshotRevision: M }
  return { f, input, reads, head, controls, base, pr, commits, setMain: value => { mainHead = value }, onPR: value => { change = value }, sourcePRReads: () => sourcePRReads }
}
it("Main459 independent legacy bootstrap proves real Source component and whole22 postimage without a frozen ref", () => {
  const f = bootstrap(), value = main.verifyLegacyBootstrap(f.input, f.reads)
  assert.equal(value.kind, "lotus-legacy-main-bootstrap/v1"); assert.equal(value.publicationAuthorized, false)
  assert.equal(value.base.revision, main.LEGACY_MAIN); assert.equal(value.base.tree, main.LEGACY_TREE)
  assert.deepEqual(value.controlPaths, published.MAIN_CONTROLS); assert.ok(f.sourcePRReads() >= 4)
  assert.ok(!f.f.reads.some(value => value.startsWith("git/ref/heads/release/")))
})
for (const fault of ["Main moved", "legacy tree", "partial controls", "control symlink", "product", "lock", "mode", "gitlink", "parents", "unaccepted feature", "locator freshness"])
it("Main459 bootstrap rejects " + fault, () => {
  const f = bootstrap()
  if (fault === "Main moved") f.setMain(h("0"))
  if (fault === "legacy tree") f.commits[main.LEGACY_MAIN].tree.sha = h("0")
  if (fault === "partial controls") f.head.delete(published.MAIN_CONTROLS[0])
  if (fault === "control symlink") f.controls.set(published.MAIN_CONTROLS[0], { mode: "120000", sha: h("0") })
  if (fault === "product") f.head.get("src/product.txt").sha = h("0")
  if (fault === "lock") f.head.get("package-lock.json").sha = h("0")
  if (fault === "mode") f.head.get("src/product.txt").mode = "100755"
  if (fault === "gitlink") f.head.get("vendor/module").sha = h("0")
  if (fault === "parents") f.commits[f.input.snapshotRevision].parents.reverse()
  if (fault === "unaccepted feature") f.f.jobs[1].conclusion = "failure"
  if (fault === "locator freshness") { let calls = 0; f.onPR(() => { if (++calls === 2) f.pr.body = body({ mode: "bootstrap", sourceRevision: h("0"), feature: f.input.feature }) }) }
  assert.throws(() => main.verifyLegacyBootstrap(f.input, f.reads))
})
for (const fault of ["Main after proof", "Source after proof"])
it("Main459 bootstrap refreshes " + fault, () => {
  const f = bootstrap()
  if (fault === "Main after proof") { let calls = 0; f.onPR(() => { if (++calls === 2) f.setMain(h("0")) }) }
  else {
    const request = f.reads.request; let calls = 0
    f.reads.request = endpoint => { if (endpoint === "pulls/17" && ++calls === 3) f.f.jobs[1].conclusion = "failure"; return request(endpoint) }
  }
  assert.throws(() => main.verifyLegacyBootstrap(f.input, f.reads))
})

it("Main459 fixed ports retain ANSI/binary bytes and expose no writer or credential override", async () => {
  const calls = [], raw = "2026-10-27T00:00:00Z \u001b[32moriginal\u001b[0m\r\n", bytes = Buffer.from([80,75,0,27,255])
  const reads = main.createReadPorts({ PATH: "/inert/bin", HOME: "/inert/home", GH_TOKEN: "inert", NODE_AUTH_TOKEN: "unused", NODE_OPTIONS: "unused", ACTIONS_RUNTIME_TOKEN: "unused" }, (program, args, options) => {
    assert.equal(program, "gh"); calls.push({ args, options })
    return { status: 0, stdout: options.encoding === null ? bytes : args.some(value => value.endsWith("/logs")) ? raw : "{}" }
  }, noNetwork)
  assert.deepEqual(Object.keys(reads).sort(), ["binary", "checkSuite", "jobLog", "registry", "request"])
  assert.deepEqual(Buffer.from(reads.jobLog(7)), Buffer.from(raw)); assert.deepEqual(reads.binary("actions/artifacts/8/zip"), bytes); reads.request("")
  assert.equal(calls[0].options.maxBuffer, 64 * 1024 * 1024); assert.ok(calls[0].args.includes("--allow-escape-sequences"))
  assert.equal(calls[1].options.maxBuffer, 128 * 1024 * 1024); assert.ok(calls[1].args.includes("--allow-escape-sequences")); assert.ok(!calls[2].args.includes("--allow-escape-sequences"))
  for (const call of calls) assert.deepEqual(Object.keys(call.options.env).sort(), ["GH_PROMPT_DISABLED", "GH_TOKEN", "HOME", "PATH"])
  for (const endpoint of ["../escape", "/outside", "https://example.invalid", "contents/%2e%2e/no"]) assert.throws(() => reads.request(endpoint))
  assert.throws(() => main.createPublicReads({ approved: true }), /no caller policy/)
  await assert.rejects(reads.registry({ repository: "foreign", version: "2026.10.99" }))
})
it("Main459 public npm port reads only fixed credential-free registry identities", async () => {
  const version = "2026.10.99", expected = { repository: "bigduu/lotus-next", version }, calls = []
  const base = "https://registry.npmjs.org", tarball = base + "/@bigduu/lotus-next/-/lotus-next-" + version + ".tgz"
  const attestation = base + "/-/npm/v1/attestations/@bigduu%2flotus-next@" + version
  let status = 200, wrongTarball = false
  const reads = main.createReadPorts({}, noNetwork, async (url, options) => {
    calls.push(url); assert.equal(options.redirect, "error"); assert.deepEqual(options.headers, { Accept: "application/json" })
    assert.ok(options.signal instanceof AbortSignal)
    const bytes = url === tarball ? Buffer.from("original tgz") : Buffer.from(JSON.stringify(url === attestation ? { original: true }
      : { dist: { tarball: wrongTarball ? "https://foreign.invalid/file.tgz" : tarball, attestations: { url: attestation } } }))
    return { status, body: [bytes] }
  })
  const result = await reads.registry(expected)
  assert.deepEqual(calls, [base + "/@bigduu%2flotus-next/" + version, tarball, attestation])
  assert.deepEqual(result.archive, Buffer.from("original tgz")); assert.deepEqual(result.attestations, { original: true })
  status = 302; await assert.rejects(reads.registry(expected), /Public npm read failed/)
  status = 200; wrongTarball = true; const previous = calls.length
  await assert.rejects(reads.registry(expected)); assert.equal(calls.length, previous + 1)
})
it("Main459 repository workflow and22 controls keep feature ownership, no install/compiler/Main publication", () => {
  const yaml = readFileSync(published.MAIN_WORKFLOW, "utf8"), ci = readFileSync(".github/workflows/ci.yml", "utf8"), helper = readFileSync("scripts/main-admission.mjs", "utf8")
  assert.equal(hash(Buffer.from(yaml)), published.MAIN_WORKFLOW_SHA256)
  assert.match(yaml, /pull_request_target:\n    branches: \[main\]/u); assert.match(yaml, /edited, ready_for_review/u)
  assert.match(yaml, /ref: \$\{\{ github.workflow_sha \}\}/u); assert.match(yaml, /persist-credentials: false/u)
  assert.doesNotMatch(yaml, /\bwrite\b|environment:|id-token:|secrets\.|npm |cargo |vite|tsc|pull_request:|workflow_dispatch:|push:/u)
  assert.match(yaml, /name: Main Admission/u); assert.match(yaml, /test "\$GITHUB_SHA" = "\$GITHUB_WORKFLOW_SHA"/u)
  assert.ok(yaml.indexOf("Require the actual protected") < yaml.indexOf("uses: actions/checkout@"))
  assert.ok([...yaml.matchAll(/uses: ([^\n]+)/gu)].every(([, value]) => /@[0-9a-f]{40} # v[0-9]+$/u.test(value)))
  assert.match(ci, /pull_request:\n    branches: \[dev\]/u); assert.doesNotMatch(ci, /main-admission|Main Admission/u)
  assert.doesNotMatch(helper, /from ["']\.\/release-npm-lifecycle|controllerPorts\(|GITHUB_SHA\s*=|GITHUB_EVENT_NAME\s*=/u)
  assert.deepEqual(published.ACCEPTED_RELEASE_PRODUCERS, {})
})
it("Main459 actual dependency-free CLI rejects default dev, bootstrap and arguments before external commands", () => {
  const root = temporary(), f = model(), event = path.join(root, "event.json"), script = path.resolve("scripts/main-admission.mjs")
  for (const mode of ["dev", "bootstrap", "arguments"]) {
    const record = clone(f.event), environment = { ...f.env, PATH: "/inert/no-executables", GITHUB_EVENT_PATH: event }
    if (mode === "dev") record.repository.default_branch = "dev"
    if (mode === "bootstrap") record.pull_request.body = body({ mode, sourceRevision: f.S, feature: f.locator.feature })
    writeFileSync(event, JSON.stringify(record))
    const result = spawnSync(process.execPath, [script, ...(mode === "arguments" ? ["--approved"] : [])], { env: environment, encoding: "utf8", timeout: 10000 })
    assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, mode === "dev" ? /establish default Main/u : mode === "bootstrap" ? /rejects bootstrap/u : /accepts no argument/u)
  }
})
it("Main459 actual CLI uses fixed read-only ports and rejects the empty registry without dependencies", () => {
  const git = tiny(), f = model(git.B), outside = temporary(), event = path.join(outside, "event.json"), calls = path.join(outside, "calls.jsonl")
  const endpoints = ["", "branches/main", "pulls/88", "git/commits/" + f.M, "actions/runs/700", "actions/workflows/main-admission.yml",
    "actions/runs/700/attempts/1/jobs?per_page=100&page=1", "actions/jobs/703"]
  const replies = Object.fromEntries(endpoints.map(endpoint => [endpoint, f.reads.request(endpoint)]))
  const program = `#!${process.execPath}\nconst fs=require('node:fs'),assert=require('node:assert/strict');const args=process.argv.slice(2);
assert.deepEqual(args.slice(0,3),['api','--hostname','github.com']);let result;
if(args[3]==='graphql'){assert.equal(args[7],'suite=CS_inert');result=${JSON.stringify({ data: { node: f.state.suite } })}}
else {assert.deepEqual(args.slice(3,5),['--method','GET']);const prefix='repos/bigduu/lotus-next';assert.ok(args[5]===prefix||args[5].startsWith(prefix+'/'));
const endpoint=args[5].slice(prefix.length).replace(/^\\//u,'');const replies=${JSON.stringify(replies)};assert.ok(Object.hasOwn(replies,endpoint));result=replies[endpoint]}
fs.appendFileSync(${JSON.stringify(calls)},JSON.stringify(args[3]==='graphql'?'official-suite':args[5])+'\\n');process.stdout.write(JSON.stringify(result));\n`
  const bin = path.join(outside, "bin"); mkdirSync(bin); writeFileSync(path.join(bin, "gh"), program, { mode: 0o755 }); writeFileSync(event, JSON.stringify(f.event))
  const result = spawnSync(process.execPath, [path.join(git.root, "scripts/main-admission.mjs")], {
    env: { ...f.env, PATH: bin + path.delimiter + safeEnv.PATH, GH_TOKEN: "inert", GITHUB_EVENT_PATH: event }, encoding: "utf8", timeout: 10000 })
  assert.equal(result.status, 1); assert.equal(result.stdout, ""); assert.match(result.stderr, /No accepted complete release producer/u)
  const invoked = readFileSync(calls, "utf8").trim().split("\n").map(line => JSON.parse(line))
  assert.ok(invoked.includes("official-suite")); assert.ok(!invoked.some(value => /releases|artifacts|\/900/u.test(value)))
  assert.equal(git.git("status", "--porcelain", "--untracked-files=all"), "")
})
it("Main459 independent bootstrap export imports without invoking the normal CLI", () => {
  const url = pathToFileURL(path.resolve("scripts/main-admission.mjs")).href
  const code = `import {verifyLegacyBootstrap} from ${JSON.stringify(url)}; if(typeof verifyLegacyBootstrap!=='function') throw new Error('Missing component');`
  const result = spawnSync(process.execPath, ["--input-type=module", "-e", code], { env: { PATH: "/inert/no-executables" }, encoding: "utf8", timeout: 10000 })
  assert.equal(result.status, 0, result.stderr); assert.equal(result.stdout, ""); assert.equal(result.stderr, "")
})
