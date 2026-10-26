// Read-only source evidence. This module cannot reserve, build or publish a release.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { lstatSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { assertResourcePath, calculateResourcesSha256 } from "./artifact-manifest.mjs"
import { verifyPartition } from "./browser-shards.mjs"

export const REPOSITORY = "bigduu/lotus-next"
export const FEATURE_WORKFLOW_ID = 347269362
const FEATURE_PATH = ".github/workflows/ci.yml"
const PUBLISH_PATH = ".github/workflows/publish-npm.yml"
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const SHA = /^[0-9a-f]{40}$/u
const DIGEST = /^sha256:[0-9a-f]{64}$/u
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const json = (bytes) => JSON.parse(bytes.toString("utf8"))
const id = (value) => {
  assert.match(String(value), /^[1-9][0-9]*$/u)
  assert.ok(Number.isSafeInteger(Number(value)), "Unsafe evidence ID")
  return Number(value)
}
const sha = (value) => { assert.match(value ?? "", SHA); return value }
const exact = (value, keys) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value))
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), "Unexpected evidence fields")
}
const childEnv = (env = process.env, github = false) => Object.fromEntries(
  ["PATH", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL",
    ...(github ? ["GH_TOKEN", "GH_HOST", "GH_CONFIG_DIR"] : [])]
    .filter((key) => env[key] !== undefined).map((key) => [key, env[key]]),
)
const git = (root, ...args) => execFileSync("git", ["--no-replace-objects", "-C", root, ...args], {
  encoding: "utf8", env: childEnv(), stdio: ["ignore", "pipe", "pipe"],
}).trim()

// Finite reviewed producer closure. A changed authority helper needs a reviewed
// new entry; historical source-only/runtime-skipped graphs are never a fallback.
export const PRODUCER = Object.freeze({
  [FEATURE_PATH]: "29325534f2de704967e21e9910757ece3adfe573",
  ".github/workflows/actor-native.yml": "7a81c06903c87400747d062c14761deb23ab4480",
  "scripts/feature-acceptance.mjs": "c64802120183deb44250619546fccf291fe4e1fd",
  "scripts/verification-browser.mjs": "0e8a3e4f76f079f9e24af4320be1a8690fbe51f5",
  "scripts/release-browser.mjs": "8667e62cf890740c12e851145b29b56714e8c6e0",
  "scripts/browser-shards.mjs": "d72d4bad66d2780119b0e3d977dde828f24f9bac",
  "scripts/artifact-manifest.mjs": "aeccd47414b61ba14ac4cf5d7ddd9dd8fccaf5cf",
})
export const PRODUCER_DIGEST = hash(JSON.stringify(PRODUCER))
const gates = new Map([
  ["Feature Source", ["Bind the exact feature base, head, snapshot and tree", "Preserve the run-bound feature source"]],
  ["Node 22", ["Verify Node 22 Unit compatibility"]],
  ["Node 24", ["Verify architecture, behavior, build, and package contents",
    "Verify the deterministic provider fixture", "Verify the complete four-shard browser inventory",
    "Share the verified exact-source artifact and inventory"]],
  ...[1, 2, 3, 4].map((shard) => ["Browser / Node 24 / shard " + shard + " of 4", [
    "Check exact artifact source and inventory", "Verify the all-surface browser shard",
    ...(shard === 1 ? ["Verify controlled Project Work component fixtures",
      "Verify Sprint planning and fixed-snapshot browser contracts",
      "Verify configuration sharing with the synthetic source harness"] : []),
    "Record this shard's actual outcome and inventory", "Upload the independent shard receipt",
  ]]),
  ["Browser acceptance", ["Require all Node lanes, shards, and original browser cases", "Upload the complete browser summary"]],
  ["Real Bamboo / Node 24", ["Check the exact artifact source and inventory", "Prepare the fixed verification browser",
    "Verify a real chat round trip with the pinned published Bamboo",
    "Verify the current source artifact on local and secure browser surfaces"]],
  ["Native Actor acceptance / Native Actor / Node 24", ["Verify and preserve the pristine artifact for both base controls",
    "Compile bounded base and observer-control fixtures", "Verify three negative controls and restored real Actor proof",
    "Upload native Actor evidence"]],
  ["Feature acceptance", ["Require every feature gate on the exact tested snapshot", "Preserve complete feature acceptance"]],
])
export const FEATURE_JOBS = [...gates.keys()]

function api(endpoint, binary = false) {
  const result = spawnSync("gh", ["api", "repos/" + REPOSITORY + "/" + endpoint,
    "--method", "GET", ...(binary ? ["--allow-escape-sequences"] : [])], {
    env: childEnv(process.env, true), encoding: binary ? null : "utf8", maxBuffer: 128 * 1024 * 1024,
  })
  assert.equal(result.status, 0, "GitHub read failed: " + endpoint)
  return binary ? result.stdout : JSON.parse(result.stdout)
}
function pages(endpoint, key, request) {
  const rows = []
  for (let page = 1; ; page++) {
    const response = request(endpoint + (endpoint.includes("?") ? "&" : "?") + "per_page=100&page=" + page)
    assert.ok(Array.isArray(response?.[key]), "Incomplete paginated evidence")
    rows.push(...response[key])
    if (response[key].length < 100) {
      assert.equal(response.total_count, rows.length, "Truncated evidence")
      return rows
    }
  }
}
function passed(job, required) {
  assert.equal(job.status, "completed")
  assert.equal(job.conclusion, "success", "Unsuccessful feature job: " + job.name)
  for (const name of required) {
    const steps = job.steps.filter((step) => step.name === name)
    assert.equal(steps.length, 1, "Missing or ambiguous selected step: " + name)
    assert.equal(steps[0].status, "completed")
    assert.equal(steps[0].conclusion, "success", "Unsuccessful selected step: " + name)
  }
}
export function executionKey(job) {
  if (job.status !== "completed" || job.conclusion !== "success" || !job.steps?.length) return null
  const start = Date.parse(job.started_at), end = Date.parse(job.completed_at)
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end) return null
  const numbers = new Set(), steps = []
  for (const step of job.steps) {
    if (!Number.isSafeInteger(step.number) || step.number <= 0 || numbers.has(step.number) ||
        typeof step.name !== "string" || !step.name || step.status !== "completed" ||
        !["success", "skipped", "neutral"].includes(step.conclusion)) return null
    numbers.add(step.number)
    if (!(step.conclusion === "skipped" && step.started_at === null && step.completed_at === null)) {
      const first = Date.parse(step.started_at), last = Date.parse(step.completed_at)
      if (!Number.isFinite(first) || !Number.isFinite(last) || first < start || last > end || first > last) return null
    }
    steps.push({ number: step.number, name: step.name, status: step.status, conclusion: step.conclusion,
      started_at: step.started_at, completed_at: step.completed_at })
  }
  return JSON.stringify({ started_at: job.started_at, completed_at: job.completed_at, steps })
}
export function selectJobs(rows, runId, attempt, head, mergedAt) {
  assert.equal(new Set(rows.map((job) => job.id)).size, rows.length, "Duplicate job evidence")
  for (const job of rows) {
    id(job.id); assert.equal(job.run_id, runId); assert.equal(job.head_sha, head)
    assert.equal(job.run_attempt, id(job.run_attempt)); assert.ok(job.run_attempt <= attempt)
    assert.ok(gates.has(job.name), "Foreign feature job")
  }
  return FEATURE_JOBS.map((name) => {
    const matches = rows.filter((job) => job.name === name)
    assert.ok(matches.length, "Missing feature job: " + name)
    assert.equal(new Set(matches.map((job) => job.run_attempt)).size, matches.length, "Ambiguous job attempt")
    const logical = [...matches].sort((left, right) => right.run_attempt - left.run_attempt)[0]
    passed(logical, gates.get(name))
    const key = executionKey(logical)
    assert.notEqual(key, null, "Complete successful execution times required")
    const physical = matches.filter((job) => executionKey(job) === key)
      .sort((left, right) => left.run_attempt - right.run_attempt)[0]
    passed(physical, gates.get(name))
    assert.ok(Date.parse(physical.completed_at) <= Date.parse(mergedAt), "Feature execution finished after admission")
    return { physical, logical, fingerprint: hash(key) }
  })
}
function devHead(branch) {
  assert.equal(branch?.protected, true, "Dev must be protected")
  const status = branch.protection?.required_status_checks
  assert.equal(status?.enforcement_level, "everyone", "Dev administrators must follow admission")
  assert.ok(status.contexts.includes("Feature acceptance"))
  assert.ok(status.checks.some((check) => check.context === "Feature acceptance" && check.app_id === 15368))
  return sha(branch.commit?.sha)
}
function association(run, pr) {
  assert.ok(Array.isArray(run.pull_requests), "Unknown PR association state")
  if (run.pull_requests.length === 0) return
  assert.equal(run.pull_requests.length, 1, "Ambiguous feature association")
  const item = run.pull_requests[0]
  assert.equal(item.number, pr.number)
  assert.equal(item.base.ref, "dev")
  assert.equal(item.base.sha, pr.base.sha)
  assert.equal(item.head.sha, pr.head.sha)
}
function requireRun(run, pr, runId, attempt) {
  assert.equal(run?.id, runId); assert.equal(run.repository.full_name, REPOSITORY)
  assert.equal(run.head_repository.full_name, pr.head.repo.full_name)
  assert.equal(run.event, "pull_request"); assert.equal(run.path, FEATURE_PATH)
  assert.equal(run.workflow_id, FEATURE_WORKFLOW_ID); assert.equal(run.head_sha, pr.head.sha)
  assert.equal(run.head_branch, pr.head.ref)
  assert.equal(run.run_attempt, attempt); assert.equal(run.status, "completed"); assert.equal(run.conclusion, "success")
  id(run.check_suite_id); association(run, pr)
}

// Python's standard ZIP reader verifies CRC and bounds before reading members.
// Nothing is extracted or executed; only flat in-memory bytes cross this boundary.
export function zipFiles(bytes) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length <= 128 * 1024 * 1024)
  const program = [
    "import base64,io,json,stat,sys,zipfile",
    "archive=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read()))",
    "files={}; total=0; seen=set()",
    "for item in archive.infolist():",
    " name=item.filename",
    " assert name and not name.startswith('/') and '\\\\' not in name and ':' not in name",
    " assert all(p not in ('','.','..') for p in name.rstrip('/').split('/'))",
    " assert not any(ord(c)<32 or ord(c)==127 for c in name)",
    " assert name not in seen; seen.add(name)",
    " assert not stat.S_ISLNK(item.external_attr>>16)",
    " assert len(seen)<=10000 and 0<=item.file_size<=64*1024*1024",
    " total+=item.file_size; assert total<=128*1024*1024",
    " if not item.is_dir(): files[name]=base64.b64encode(archive.read(item)).decode('ascii')",
    "print(json.dumps(files,separators=(',',':')))",
  ].join("\n")
  const result = spawnSync("python3", ["-c", program], {
    env: childEnv(), input: bytes, encoding: "utf8", maxBuffer: 192 * 1024 * 1024,
  })
  assert.equal(result.status, 0, "Invalid bounded artifact ZIP")
  return Object.fromEntries(Object.entries(JSON.parse(result.stdout)).map(([name, value]) => [name, Buffer.from(value, "base64")]))
}
function originalArtifact(all, name, runId, head, job, read) {
  const matches = all.filter((item) => item.name === name)
  assert.equal(matches.length, 1, "Missing or ambiguous original artifact: " + name)
  const artifact = matches[0]
  id(artifact.id); assert.equal(artifact.expired, false); assert.match(artifact.digest ?? "", DIGEST)
  assert.equal(artifact.workflow_run.id, runId); assert.equal(artifact.workflow_run.head_sha, head)
  assert.ok(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0)
  const created = Date.parse(artifact.created_at)
  assert.ok(Number.isFinite(created) && created >= Date.parse(job.started_at) &&
    created <= Date.parse(job.completed_at) + 1000, "Artifact is not from the original execution")
  const bytes = read(artifact.id)
  assert.equal(bytes.length, artifact.size_in_bytes)
  assert.equal("sha256:" + hash(bytes), artifact.digest, "Original artifact digest differs")
  return { artifact, files: zipFiles(bytes) }
}
export function verifyDist(files, snapshot) {
  const manifest = json(files["dist/lotus-next-manifest.json"])
  exact(manifest, ["schemaVersion", "packageName", "packageVersion", "sourceRevision", "sourceDirty", "entrypoint", "resourcesSha256", "resources"])
  assert.equal(manifest.schemaVersion, 1); assert.equal(manifest.packageName, "@bigduu/lotus-next")
  assert.equal(manifest.packageVersion, "0.0.0"); assert.equal(manifest.sourceRevision, snapshot)
  assert.equal(manifest.sourceDirty, false); assert.equal(manifest.entrypoint, "index.html")
  assert.ok(Array.isArray(manifest.resources) && manifest.resources.length > 0)
  const names = manifest.resources.map((resource) => {
    exact(resource, ["path", "size", "sha256"]); assertResourcePath(resource.path)
    assert.ok(Number.isSafeInteger(resource.size) && resource.size >= 0)
    assert.match(resource.sha256, /^[0-9a-f]{64}$/u)
    const bytes = files["dist/" + resource.path]
    assert.ok(Buffer.isBuffer(bytes), "Missing dist resource")
    assert.equal(bytes.length, resource.size); assert.equal(hash(bytes), resource.sha256)
    return resource.path
  })
  assert.equal(new Set(names).size, names.length); assert.deepEqual(names, [...names].sort())
  assert.ok(names.includes("index.html")); assert.equal(manifest.resourcesSha256, calculateResourcesSha256(manifest.resources))
  assert.deepEqual(Object.keys(files).sort(), ["browser-inventory.json", "dist/lotus-next-manifest.json",
    ...names.map((name) => "dist/" + name)].sort(), "Foreign or omitted canonical dist entries")
  const inventory = json(files["browser-inventory.json"])
  assert.equal(inventory.schemaVersion, 2); assert.equal(inventory.producerNode, 24); assert.equal(inventory.sourceSha, snapshot)
  assert.deepEqual(inventory.projects, ["desktop-chromium", "tablet-chromium", "phone-chromium"])
  assert.equal(inventory.shards.length, 4); verifyPartition(inventory.tests, inventory.shards)
  return { manifestSha256: hash(files["dist/lotus-next-manifest.json"]), resourcesSha256: manifest.resourcesSha256,
    resources: names.length, cases: inventory.tests.length, inventorySha256: hash(files["browser-inventory.json"]) }
}

export function verifyAcceptedDev({ source, pullRequest, runId, attempt }, {
  request = api, artifactBytes = (artifactId) => api("actions/artifacts/" + artifactId + "/zip", true),
} = {}) {
  sha(source); pullRequest = id(pullRequest); runId = id(runId); attempt = id(attempt)
  const pr = request("pulls/" + pullRequest)
  assert.equal(pr?.number, pullRequest); assert.equal(pr.merged, true, "Feature merge is not confirmed")
  assert.equal(pr.state, "closed"); assert.equal(pr.base.ref, "dev")
  assert.equal(pr.base.repo.full_name, REPOSITORY); assert.equal(pr.merge_commit_sha, source)
  assert.ok(Number.isFinite(Date.parse(pr.merged_at)), "Missing merge time")
  const base = sha(pr.base.sha), head = sha(pr.head.sha)
  const accepted = request("git/commits/" + source), tree = sha(accepted.tree.sha)
  assert.deepEqual(accepted.parents.map((parent) => parent.sha), [base, head], "Require normal dev merge parents")
  const observedDev = devHead(request("branches/dev"))
  assert.equal(request("compare/" + source + "..." + observedDev)?.merge_base_commit?.sha, source)
  const run = request("actions/runs/" + runId); requireRun(run, pr, runId, attempt)
  const suite = request("check-suites/" + run.check_suite_id)
  assert.equal(suite.id, run.check_suite_id); assert.equal(suite.app.id, 15368)
  assert.equal(suite.head_sha, head); assert.equal(suite.status, "completed"); assert.equal(suite.conclusion, "success")
  const selected = selectJobs(pages("actions/runs/" + runId + "/jobs?filter=all", "jobs", request),
    runId, attempt, head, pr.merged_at)
  const owner = (name) => selected.find((item) => item.physical.name === name).physical
  const artifacts = pages("actions/runs/" + runId + "/artifacts", "artifacts", request)
  assert.equal(new Set(artifacts.map((item) => item.id)).size, artifacts.length)
  const original = (name, job) => originalArtifact(artifacts, name, runId, head, owner(job), artifactBytes)
  const context = original("feature-source", "Feature Source")
  assert.deepEqual(Object.keys(context.files), ["feature-source.json"])
  const receipt = json(context.files["feature-source.json"])
  exact(receipt, ["schemaVersion", "kind", "repository", "pullRequest", "baseRef", "baseSha", "headRepository", "headRef", "headSha",
    "testedSnapshot", "testedTree", "workflowRef", "workflowSha", "runId", "sourceRunAttempt"])
  const snapshot = sha(receipt.testedSnapshot)
  assert.deepEqual(receipt, { schemaVersion: 1, kind: "lotus-feature-source/v1", repository: REPOSITORY,
    pullRequest, baseRef: "dev", baseSha: base, headRepository: pr.head.repo.full_name, headRef: pr.head.ref, headSha: head,
    testedSnapshot: snapshot, testedTree: tree, workflowRef: REPOSITORY + "/" + FEATURE_PATH + "@refs/pull/" + pullRequest + "/merge",
    workflowSha: snapshot, runId: String(runId), sourceRunAttempt: owner("Feature Source").run_attempt })
  const tested = request("git/commits/" + snapshot)
  assert.deepEqual(tested.parents.map((parent) => parent.sha), [base, head]); assert.equal(tested.tree.sha, tree)
  for (const [file, blob] of Object.entries(PRODUCER)) {
    assert.equal(request("contents/" + file + "?ref=" + snapshot)?.sha, blob, "Unreviewed feature producer: " + file)
  }
  const acceptedArtifact = original("feature-acceptance", "Feature acceptance")
  assert.deepEqual(Object.keys(acceptedArtifact.files), ["feature-acceptance.json"])
  const acceptance = json(acceptedArtifact.files["feature-acceptance.json"])
  assert.deepEqual(acceptance, { schemaVersion: 1, kind: "lotus-feature-acceptance/v1", source: receipt,
    gates: { source: "success", verify: "success", browser: "success", realBamboo: "success", nativeActor: "success" },
    acceptanceRunAttempt: owner("Feature acceptance").run_attempt })
  const dist = original("browser-input-node-24", "Node 24"), distProof = verifyDist(dist.files, snapshot)
  const fresh = request("pulls/" + pullRequest)
  for (const key of ["number", "merged", "state", "merge_commit_sha", "merged_at"]) assert.equal(fresh[key], pr[key])
  for (const side of ["base", "head"]) {
    assert.equal(fresh[side].sha, pr[side].sha); assert.equal(fresh[side].ref, pr[side].ref)
    assert.equal(fresh[side].repo.full_name, pr[side].repo.full_name)
  }
  requireRun(request("actions/runs/" + runId), pr, runId, attempt)
  const latestJobs = selectJobs(pages("actions/runs/" + runId + "/jobs?filter=all", "jobs", request), runId, attempt, head, pr.merged_at)
  assert.deepEqual(latestJobs, selected, "Feature jobs changed during verification")
  const currentDev = devHead(request("branches/dev"))
  if (currentDev !== observedDev) {
    const advance = request("compare/" + observedDev + "..." + currentDev)
    assert.equal(advance.status, "ahead"); assert.equal(advance.behind_by, 0); assert.equal(advance.merge_base_commit.sha, observedDev)
  }
  return { schemaVersion: 1, kind: "lotus-accepted-dev/v1", repository: REPOSITORY, source, tree,
    pullRequest, base, head, snapshot, runId, attempt, observedDev, currentDev, workflowId: FEATURE_WORKFLOW_ID,
    checkSuiteId: run.check_suite_id, producerDigest: PRODUCER_DIGEST,
    jobs: selected.map(({ physical, logical, fingerprint }) => ({ id: physical.id, name: physical.name,
      attempt: physical.run_attempt, logical: { id: logical.id, attempt: logical.run_attempt }, fingerprint })),
    artifacts: [context, acceptedArtifact, dist].map(({ artifact }) => ({
      id: artifact.id, name: artifact.name, digest: artifact.digest, size: artifact.size_in_bytes,
    })), dist: distProof }
}
export function admitFrozenDev(input, dependencies = {}) {
  const request = dependencies.request ?? api
  const ref = "git/ref/heads/release/" + sha(input.source)
  assert.equal(request(ref)?.object?.sha, input.source, "Frozen cut differs")
  const proof = verifyAcceptedDev(input, dependencies)
  assert.equal(request(ref)?.object?.sha, input.source, "Frozen cut changed")
  return proof
}
export function requireController(environment = process.env, root = ROOT, executeGit = git) {
  assert.equal(environment.GITHUB_REPOSITORY, REPOSITORY); assert.equal(environment.GITHUB_EVENT_NAME, "workflow_dispatch")
  assert.equal(environment.GITHUB_REF, "refs/heads/main")
  assert.equal(environment.GITHUB_WORKFLOW_REF, REPOSITORY + "/" + PUBLISH_PATH + "@refs/heads/main")
  const controller = sha(environment.GITHUB_WORKFLOW_SHA)
  assert.equal(environment.GITHUB_SHA, controller)
  assert.equal(executeGit(root, "rev-parse", "HEAD"), controller)
  assert.equal(executeGit(root, "status", "--porcelain", "--untracked-files=all"), "")
  return controller
}
export function requireProduct(source, root, executeGit = git) {
  sha(source); assert.ok(path.isAbsolute(root) && lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink())
  assert.notEqual(realpathSync(root), realpathSync(ROOT), "Use a separate explicit product checkout")
  assert.equal(executeGit(root, "rev-parse", "HEAD"), source)
  assert.equal(executeGit(root, "status", "--porcelain", "--untracked-files=all"), "")
  const product = JSON.parse(executeGit(root, "show", source + ":package.json"))
  assert.equal(product.name, "@bigduu/lotus-next"); assert.equal(product.version, "0.0.0")
  return { tree: sha(executeGit(root, "rev-parse", "HEAD^{tree}")),
    packageLockBlob: sha(executeGit(root, "rev-parse", source + ":package-lock.json")) }
}
function main() {
  const [command, output] = process.argv.slice(2)
  assert.equal(command, "admit"); assert.ok(output, "An exclusive source-proof output path is required")
  const controller = requireController()
  const source = sha(process.env.EXPECTED_SOURCE_SHA)
  const proof = admitFrozenDev({ source, pullRequest: process.env.FEATURE_PULL_REQUEST,
    runId: process.env.FEATURE_RUN_ID, attempt: process.env.FEATURE_RUN_ATTEMPT })
  const product = requireProduct(source, process.env.SOURCE_ROOT)
  assert.equal(product.tree, proof.tree)
  writeFileSync(output, JSON.stringify({ ...proof, controller, product }, null, 2) + "\n", { flag: "wx" })
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error("Frozen dev source: " + error.message); process.exitCode = 1 }
}
