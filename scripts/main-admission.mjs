// Trusted Base code only. Candidate Git objects, archives and locators are data.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { lstatSync, readFileSync, realpathSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { REPOSITORY, verifyAcceptedDev } from "./frozen-dev-source.mjs"
import { assertPackageVersion } from "./artifact-manifest.mjs"
import { MAIN_CONTROLS, MAIN_WORKFLOW, MAIN_WORKFLOW_SHA256, publicReader, jobKey, prKey, treeLeaves, verifyPromotion } from "./published-npm-admission.mjs"

export const WORKFLOW_NAME = "Lotus Main admission", JOB = "Main Admission"
export const STEP = "Verify published source and exact Main promotion", PREFIX = "LOTUS_MAIN_ADMISSION_V1 "
export const LEGACY_MAIN = "ae53034cd4622a4b501c6fac196dd574936b6aac"
export const LEGACY_TREE = "79df4aa86d7b1d6d667ea5364ccc18a97be4e72b"
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const REPO_ID = 1281544268, OWNER_ID = 18681616, SHA = /^[0-9a-f]{40}$/u
const sha = value => { assert.match(value ?? "", SHA); return value }
const id = value => { assert.match(String(value), /^[1-9][0-9]*$/u); assert.ok(Number.isSafeInteger(Number(value))); return Number(value) }
const same = (a, b) => assert.deepEqual(a, b)
const exact = (value, names) => same(Object.keys(value ?? {}).sort(), [...names].sort())
const repo = value => { assert.equal(value?.id, REPO_ID); assert.equal(value.full_name, REPOSITORY) }
export const canonical = value => Array.isArray(value) ? "[" + value.map(canonical).join(",") + "]"
  : value && typeof value === "object" ? "{" + Object.keys(value).sort().map(key => JSON.stringify(key) + ":" + canonical(value[key])).join(",") + "}" : JSON.stringify(value)
const hash = value => createHash("sha256").update(value).digest("hex")
const digest = value => hash(Buffer.from(canonical(value)))

export function childEnv(environment, github = false) {
  const names = ["PATH", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL", ...(github ? ["GH_TOKEN"] : [])]
  return { ...Object.fromEntries(names.filter(name => environment[name] !== undefined).map(name => [name, environment[name]])), GH_PROMPT_DISABLED: "1" }
}
// Injectable command/network ports are components for inert tests, never a
// production policy or authority parameter. The actual CLI uses the zero-arg factory.
export function createReadPorts(environment = process.env, execute = spawnSync, fetchImpl = fetch) {
  const gh = (args, maximum, binary = false) => {
    const result = execute("gh", ["api", "--hostname", "github.com", ...args], {
      env: childEnv(environment, true), encoding: binary ? null : "utf8", maxBuffer: maximum, timeout: 30000 })
    assert.ok(!result.error && result.status === 0, "Read-only GitHub request failed")
    assert.ok(Buffer.byteLength(result.stdout) <= maximum, "Oversized read-only GitHub response"); return result.stdout
  }
  const publicBytes = async (url, maximum) => {
    const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(30000), headers: { Accept: "application/json" } })
    assert.equal(response.status, 200, "Public npm read failed")
    const chunks = []; let size = 0
    for await (const chunk of response.body) { size += chunk.length; assert.ok(size <= maximum); chunks.push(Buffer.from(chunk)) }
    return Buffer.concat(chunks)
  }
  return {
    request: endpoint => {
      assert.ok(typeof endpoint === "string" && /^[A-Za-z0-9_./?=&%+-]*$/u.test(endpoint) && !endpoint.startsWith("/") && !endpoint.split("/").includes("..") && !/%2e/iu.test(endpoint))
      return JSON.parse(gh(["--method", "GET", "repos/" + REPOSITORY + (endpoint ? "/" + endpoint : "")], 24 * 1024 * 1024))
    },
    binary: endpoint => {
      assert.match(endpoint, /^(?:actions\/artifacts\/[1-9][0-9]*\/zip|releases\/assets\/[1-9][0-9]*)$/u)
      return gh(["--method", "GET", "repos/" + REPOSITORY + "/" + endpoint, "--allow-escape-sequences", "-H", "Accept: application/octet-stream"], 128 * 1024 * 1024, true)
    },
    jobLog: job => gh(["--method", "GET", `repos/${REPOSITORY}/actions/jobs/${id(job)}/logs`, "--allow-escape-sequences"], 64 * 1024 * 1024),
    checkSuite: node => {
      assert.match(node, /^[A-Za-z0-9_=-]{1,128}$/u)
      const query = "query($suite:ID!){node(id:$suite){... on CheckSuite{databaseId repository{databaseId nameWithOwner} app{databaseId slug} commit{oid} workflowRun{databaseId event runAttempt workflow{databaseId name} file{path repositoryName repositoryFileUrl}}}}}"
      const value = JSON.parse(gh(["graphql", "-f", "query=" + query, "-f", "suite=" + node], 24 * 1024 * 1024))
      assert.ok(!value.errors); return value.data?.node
    },
    registry: async expected => {
      assert.equal(expected.repository, REPOSITORY); assertPackageVersion(expected.version)
      const base = "https://registry.npmjs.org", version = encodeURIComponent(expected.version)
      const metadata = JSON.parse(await publicBytes(base + "/@bigduu%2flotus-next/" + version, 64 * 1024 * 1024))
      const tarball = base + "/@bigduu/lotus-next/-/lotus-next-" + expected.version + ".tgz"
      const attestation = base + "/-/npm/v1/attestations/@bigduu%2flotus-next@" + version
      assert.equal(metadata.dist.tarball, tarball); assert.equal(metadata.dist.attestations.url, attestation)
      return { metadata, archive: await publicBytes(tarball, 64 * 1024 * 1024), attestations: JSON.parse(await publicBytes(attestation, 64 * 1024 * 1024)) }
    },
  }
}
export function createPublicReads() {
  assert.equal(arguments.length, 0, "Public reads accept no caller policy, credentials or authority")
  return createReadPorts()
}
export function locator(body) {
  assert.ok(typeof body === "string" && Buffer.byteLength(body) <= 1024 * 1024)
  assert.equal(body.split("<!-- lotus-main-locator/v1").length, 2)
  const matches = [...body.matchAll(/<!-- lotus-main-locator\/v1\r?\n([^]*?)\r?\n-->/gu)]; assert.equal(matches.length, 1)
  assert.ok(Buffer.byteLength(matches[0][1]) <= 32768)
  const value = JSON.parse(matches[0][1])
  assert.ok(["promotion", "bootstrap"].includes(value.mode), "Unknown Main mode; controller maintenance requires a separate versioned boundary")
  exact(value, ["mode", "sourceRevision", "feature", ...(value.mode === "promotion" ? ["version", "releaseRunId"] : [])])
  sha(value.sourceRevision); exact(value.feature, ["pullRequest", "runId", "attempt"])
  for (const number of Object.values(value.feature)) assert.ok(Number.isSafeInteger(number) && number > 0)
  if (value.mode === "promotion") { assertPackageVersion(value.version); assert.notEqual(value.version, "0.0.0"); assert.ok(Number.isSafeInteger(value.releaseRunId) && value.releaseRunId > 0) }
  return value
}
export function eventIdentity(environment, event) {
  repo(event.repository); assert.equal(event.repository.owner?.id, OWNER_ID)
  assert.equal(event.repository.default_branch, "main", "STOP: separate Ops must establish default Main")
  assert.equal(environment.GITHUB_ACTIONS, "true"); assert.equal(environment.GITHUB_REPOSITORY, REPOSITORY)
  assert.equal(environment.GITHUB_EVENT_NAME, "pull_request_target"); assert.equal(environment.GITHUB_REF, "refs/heads/main")
  assert.equal(environment.GITHUB_REF_PROTECTED, "true", "STOP: separate Ops must protect Main")
  assert.equal(environment.GITHUB_WORKFLOW_REF, `${REPOSITORY}/${MAIN_WORKFLOW}@refs/heads/main`)
  assert.equal(environment.GITHUB_JOB, "main-admission")
  assert.ok(["opened", "synchronize", "reopened", "edited", "ready_for_review"].includes(event.action))
  const B = sha(environment.GITHUB_WORKFLOW_SHA); assert.equal(environment.GITHUB_SHA, B)
  assert.equal(event.pull_request?.base.sha, B); assert.equal(event.pull_request.base.ref, "main")
  const selected = locator(event.pull_request.body); assert.equal(selected.mode, "promotion", "Ordinary Main CLI rejects bootstrap")
  return { B, F: sha(event.pull_request.head.sha), pullRequest: id(event.number), locator: selected,
    runId: id(environment.GITHUB_RUN_ID), attempt: id(environment.GITHUB_RUN_ATTEMPT) }
}
export function checkout(root, B, execute = spawnSync) {
  root = realpathSync(root)
  const git = args => {
    const result = execute("git", ["--no-replace-objects", "-C", root, ...args], { env: childEnv(process.env), encoding: null, maxBuffer: 32 * 1024 * 1024, timeout: 30000 })
    assert.ok(!result.error && result.status === 0, "Trusted Base Git read failed"); return result.stdout
  }
  assert.equal(git(["rev-parse", "HEAD"]).toString().trim(), sha(B))
  assert.equal(git(["status", "--porcelain", "--untracked-files=all"]).toString().trim(), "", "Trusted Base checkout must remain clean")
  for (const name of MAIN_CONTROLS) {
    const file = path.join(root, name), stat = lstatSync(file)
    assert.ok(stat.isFile() && !stat.isSymbolicLink() && realpathSync(file).startsWith(root + path.sep))
    const row = git(["ls-tree", B, "--", name]).toString().trim()
    assert.match(row, new RegExp("^100(?:644|755) blob [0-9a-f]{40}\\t" + name.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&") + "$", "u"))
    assert.ok(readFileSync(file).equals(git(["show", B + ":" + name])), "Local Base control changed")
  }
  assert.equal(hash(readFileSync(path.join(root, MAIN_WORKFLOW))), MAIN_WORKFLOW_SHA256)
}
function protectedMain(reads) {
  const repository = reads.request(""); repo(repository); assert.equal(repository.owner?.id, OWNER_ID); assert.equal(repository.default_branch, "main")
  const value = reads.request("branches/main"); assert.equal(value.name, "main"); assert.equal(value.protected, true)
  const checks = value.protection?.required_status_checks
  assert.equal(checks?.enforcement_level, "everyone"); assert.ok(checks.contexts?.includes(JOB))
  assert.ok(checks.checks?.some(check => check.context === JOB && check.app_id === 15368))
  return sha(value.commit?.sha)
}
export function runtime(environment, event, reads) {
  const identity = eventIdentity(environment, event), { B, F, runId, attempt, pullRequest } = identity
  const { get, pages } = publicReader(reads)
  assert.equal(protectedMain(reads), B, "Main changed since the Target event")
  const pr = get("pulls/" + pullRequest); repo(pr.base.repo); repo(pr.head.repo)
  assert.equal(pr.number, pullRequest); assert.equal(pr.state, "open"); assert.equal(pr.merged, false); assert.equal(pr.draft, false); assert.equal(pr.mergeable, true)
  assert.equal(pr.base.ref, "main"); assert.equal(pr.base.sha, B); assert.equal(pr.head.sha, F); assert.equal(pr.head.ref, event.pull_request.head.ref)
  assert.match(pr.head.ref, /^[A-Za-z0-9_./-]{1,255}$/u)
  same(locator(pr.body), identity.locator)
  const M = sha(pr.merge_commit_sha), commit = get("git/commits/" + M)
  assert.equal(commit.sha, M); same(commit.parents.map(parent => parent.sha), [B, F])
  const run = get("actions/runs/" + runId); repo(run.repository); repo(run.head_repository)
  for (const [key, value] of Object.entries({ id: runId, run_attempt: attempt, path: MAIN_WORKFLOW, name: WORKFLOW_NAME,
    event: "pull_request_target", head_sha: F, head_branch: pr.head.ref, status: "in_progress", conclusion: null })) assert.equal(run[key], value)
  id(run.workflow_id); id(run.check_suite_id)
  const suite = reads.checkSuite(run.check_suite_node_id)
  same(suite.repository, { databaseId: REPO_ID, nameWithOwner: REPOSITORY }); same(suite.app, { databaseId: 15368, slug: "github-actions" })
  assert.equal(suite.databaseId, run.check_suite_id); assert.equal(suite.commit.oid, F)
  same(suite.workflowRun, { databaseId: runId, event: "pull_request_target", runAttempt: attempt,
    workflow: { databaseId: run.workflow_id, name: WORKFLOW_NAME }, file: { path: MAIN_WORKFLOW, repositoryName: REPOSITORY,
      repositoryFileUrl: `https://github.com/${REPOSITORY}/blob/${F}/${MAIN_WORKFLOW}` } })
  const workflow = get("actions/workflows/main-admission.yml"); assert.equal(workflow.id, run.workflow_id); assert.equal(workflow.path, MAIN_WORKFLOW); assert.equal(workflow.state, "active")
  const jobs = pages(`actions/runs/${runId}/attempts/${attempt}/jobs`, "jobs"); assert.equal(jobs.length, 1)
  const job = jobs[0]; assert.equal(job.name, JOB); assert.equal(job.run_id, runId); assert.equal(job.run_attempt, attempt)
  assert.equal(job.head_sha, F); assert.equal(job.head_branch, pr.head.ref); assert.equal(job.status, "in_progress"); assert.equal(job.conclusion, null)
  same(jobKey(get("actions/jobs/" + id(job.id))), jobKey(job))
  const selected = job.steps.filter(step => step.name === STEP); assert.equal(selected.length, 1)
  assert.equal(selected[0].status, "in_progress"); assert.equal(selected[0].conclusion, null)
  return { ...identity, M, execution: { revision: B, metadataRevision: F, workflowPath: MAIN_WORKFLOW,
    workflowSha256: MAIN_WORKFLOW_SHA256, workflowId: run.workflow_id, runId, physicalAttempt: attempt,
    jobId: job.id, checkSuiteId: run.check_suite_id, checkSuiteNodeId: run.check_suite_node_id } }
}
export function frame(value) {
  assert.equal(value.kind, "lotus-main-admission/v1"); assert.equal(value.publicationAuthorized, false)
  const bytes = Buffer.from(canonical(value)); assert.ok(bytes.length <= 32768)
  return PREFIX + bytes.toString("base64")
}
export async function executeMain(environment, event, root, reads) {
  eventIdentity(environment, event); checkout(root, environment.GITHUB_WORKFLOW_SHA)
  const before = runtime(environment, event, reads), { mode, ...release } = before.locator
  assert.equal(mode, "promotion")
  const facts = await verifyPromotion({ ...release, pullRequest: before.pullRequest, baseRevision: before.B,
    headRevision: before.F, snapshotRevision: before.M }, reads)
  assert.equal(facts.kind, "lotus-main-promotion-facts/v1"); assert.equal(facts.publicationAuthorized, false)
  same(runtime(environment, event, reads), before, "Main execution, PR or locator changed during verification")
  checkout(root, before.B)
  return frame({ schemaVersion: 1, kind: "lotus-main-admission/v1", publicationAuthorized: false,
    repository: { id: REPO_ID, fullName: REPOSITORY }, controlVersion: 1, locatorSha256: digest(before.locator),
    source: { revision: facts.source.revision, tree: facts.source.tree }, release: { version: release.version,
      runId: release.releaseRunId, completion: facts.completion }, promotion: facts.promotion, execution: before.execution })
}
// Separate one-time Ops component; it never emits a normal admission frame or
// grants publication/check authority. The CLI cannot select this export.
export function verifyLegacyBootstrap(input, reads) {
  exact(input, ["sourceRevision", "feature", "pullRequest", "headRevision", "snapshotRevision"])
  const selected = locator("<!-- lotus-main-locator/v1\n" + JSON.stringify({ mode: "bootstrap", sourceRevision: input.sourceRevision, feature: input.feature }) + "\n-->")
  const { get, ancestor } = publicReader(reads), D = selected.sourceRevision, F = sha(input.headRevision), M = sha(input.snapshotRevision)
  const current = () => { const repository = reads.request(""); repo(repository); assert.equal(repository.owner?.id, OWNER_ID); assert.equal(repository.default_branch, "main")
    const branch = get("branches/main"); assert.equal(branch.name, "main"); assert.equal(branch.commit?.sha, LEGACY_MAIN, "Bootstrap legacy Main moved") }
  current()
  const pr = get("pulls/" + id(input.pullRequest)); repo(pr.base.repo); repo(pr.head.repo)
  assert.equal(pr.number, input.pullRequest); assert.equal(pr.state, "open"); assert.equal(pr.merged, false); assert.equal(pr.draft, false); assert.equal(pr.mergeable, true)
  assert.equal(pr.base.ref, "main"); assert.equal(pr.base.sha, LEGACY_MAIN); assert.equal(pr.head.sha, F); assert.equal(pr.merge_commit_sha, M); same(locator(pr.body), selected)
  assert.match(pr.head.ref, /^[A-Za-z0-9_./-]{1,255}$/u)
  const dependencies = { request: get, artifactBytes: artifact => reads.binary("actions/artifacts/" + id(artifact) + "/zip") }
  const facts = verifyAcceptedDev({ source: D, ...input.feature }, dependencies)
  const commits = [LEGACY_MAIN, F, M].map(revision => { const value = get("git/commits/" + revision); assert.equal(value.sha, revision); return value })
  assert.equal(commits[0].tree.sha, LEGACY_TREE); same(commits[2].parents.map(parent => parent.sha), [LEGACY_MAIN, F]); ancestor(LEGACY_MAIN, F)
  const [base, controls, head, snapshot] = [LEGACY_TREE, facts.tree, commits[1].tree.sha, commits[2].tree.sha].map(tree => treeLeaves(get, tree))
  assert.ok(!base.has(MAIN_WORKFLOW) && !base.has("scripts/main-admission.mjs"), "Bootstrap is already installed")
  const expected = new Map(base)
  for (const name of MAIN_CONTROLS) { const entry = controls.get(name); assert.ok(entry && ["100644", "100755"].includes(entry.mode)); expected.set(name, entry) }
  const key = value => canonical([...value].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  assert.equal(key(head), key(expected), "Bootstrap must preserve the complete legacy product/locks with whole D controls")
  assert.equal(key(snapshot), key(head))
  const definition = publicReader(reads).blob(MAIN_WORKFLOW, D)
  assert.equal(definition.blob, controls.get(MAIN_WORKFLOW).sha); assert.equal(controls.get(MAIN_WORKFLOW).mode, "100644"); assert.equal(definition.sha256, MAIN_WORKFLOW_SHA256)
  const stable = value => { const copy = structuredClone(value); delete copy.observedDev; delete copy.currentDev; return copy }
  same(stable(verifyAcceptedDev({ source: D, ...input.feature }, dependencies)), stable(facts))
  const fresh = get("pulls/" + input.pullRequest)
  same(prKey(fresh), prKey(pr)); assert.equal(fresh.mergeable, true)
  same(locator(fresh.body), selected); current()
  return { schemaVersion: 1, kind: "lotus-legacy-main-bootstrap/v1", publicationAuthorized: false,
    source: { revision: D, tree: facts.tree }, base: { revision: LEGACY_MAIN, tree: LEGACY_TREE },
    headRevision: F, snapshotRevision: M, controlVersion: 1, controlPaths: MAIN_CONTROLS }
}
export async function main() {
  assert.equal(arguments.length, 0); assert.equal(process.argv.length, 2, "Main CLI accepts no argument or policy")
  const eventFile = process.env.GITHUB_EVENT_PATH, stat = lstatSync(eventFile)
  assert.ok(stat.isFile() && !stat.isSymbolicLink() && stat.size <= 1024 * 1024)
  const event = JSON.parse(readFileSync(eventFile)); eventIdentity(process.env, event)
  console.log(await executeMain(process.env, event, ROOT, createPublicReads()))
}
const invokedDirectly = () => {
  try { return process.argv[1] && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url)) }
  catch { return false } // Non-file entrypoints cannot select this module's CLI.
}
if (invokedDirectly()) main().catch(error => {
  console.error("Main admission stopped: " + error.message); process.exitCode = 1
})
