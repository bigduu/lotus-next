// Read-only public facts. Neither a payload nor a successful feature workflow
// grants Main authority: authenticate the reviewed C execution independently.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { admitFrozenDev, executionKey, PRODUCER, zipFiles } from "./frozen-dev-source.mjs"
import { assetName, inputs, registryIdentity, REPOSITORY, unseal } from "./release-npm-original.mjs"

export const WORKFLOW = ".github/workflows/publish-npm.yml"
export const PREFIX = "LOTUS_NPM_COMPLETION_V1 "
export const ACCEPTED_RELEASE_PRODUCERS = Object.freeze({})
export const CONTROLLER_HELPERS = Object.freeze([
  "scripts/release-npm-lifecycle.mjs", "scripts/release-npm-original.mjs", "scripts/frozen-dev-source.mjs",
  "scripts/artifact-manifest.mjs", "scripts/browser-shards.mjs", "scripts/verify-package.mjs",
  "scripts/bundle-budget.mjs", "scripts/package-policy.mjs", "package.json", "package-lock.json",
])
export const REQUIRED_CONTROLS = Object.freeze([...new Set([
  WORKFLOW, ".github/workflows/ci.yml", ".github/workflows/actor-native.yml", ".github/workflows/verify-published-npm.yml",
  "scripts/published-npm-admission.mjs", ...CONTROLLER_HELPERS.filter(name => name.startsWith("scripts/")), ...Object.keys(PRODUCER),
])])
const JOBS = { prepare: "Reserve frozen npm release", build: "Produce original npm archive", finalize: "Publish retained npm archive" }
const CORE = ["Build final dist once", "Pack and statically verify once", "Retain original npm archive"]
const RESERVE = "Reserve source and version", SELECT = "Select original npm build", RESTORE = "Restore original npm archive", PUBLISH = "Publish original npm archive"
const REPO_ID = 1281544268, OWNER_ID = 18681616
const hash = bytes => createHash("sha256").update(bytes).digest("hex")
const same = (a, b) => assert.deepEqual(a, b)
const keys = (value, names) => same(Object.keys(value ?? {}).sort(), [...names].sort())
const positive = value => { assert.ok(Number.isSafeInteger(value) && value > 0); return value }
const sha = value => { assert.match(value, /^[0-9a-f]{40}$/u); return value }
const time = value => { const number = Date.parse(value); assert.ok(Number.isFinite(number)); return number }
const fields = (value, names) => Object.fromEntries(names.map(name => [name, value[name]]))
const runKey = value => fields(value, ["id", "run_attempt", "workflow_id", "check_suite_id", "check_suite_node_id", "head_sha", "head_branch", "path", "name", "event", "status", "conclusion", "created_at", "updated_at"])
const jobKey = value => fields(value, ["id", "run_id", "run_attempt", "head_sha", "head_branch", "name", "status", "conclusion", "started_at", "completed_at", "steps"])
const releaseKey = value => fields(value, ["id", "tag_name", "target_commitish", "draft", "prerelease", "body", "created_at", "published_at", "immutable"])
const assetKey = value => fields(value, ["id", "name", "state", "size", "digest", "created_at"])
const prKey = value => ({ ...fields(value, ["number", "state", "draft", "merged", "merge_commit_sha"]),
  base: { ...fields(value.base, ["sha", "ref"]), repository: fields(value.base.repo, ["id", "full_name"]) },
  head: { ...fields(value.head, ["sha", "ref"]), repository: fields(value.head.repo, ["id", "full_name"]) } })
function repo(value) { assert.equal(value?.id, REPO_ID); assert.equal(value.full_name, REPOSITORY) }
function complete(value) { assert.equal(value.status, "completed"); assert.equal(value.conclusion, "success") }
function step(job, name) { const found = job.steps.filter(value => value.name === name); assert.equal(found.length, 1, "Missing/duplicate step: " + name); return found[0] }
function skipped(job) { return CORE.every(name => { const value = step(job, name); return value.status === "completed" && value.conclusion === "skipped" }) }
function boundedJSON(bytes, maximum = 32768) { assert.ok(Buffer.isBuffer(bytes) && bytes.length <= maximum); return JSON.parse(bytes.toString("utf8")) }

export function completionFrame(log) {
  assert.ok(typeof log === "string" && Buffer.byteLength(log) <= 64 * 1024 * 1024)
  const lines = log.split(/\r?\n/u).filter(line => /^\d{4}-\d\d-\d\dT\S+Z /u.test(line) && line.slice(line.indexOf(" ") + 1).startsWith(PREFIX))
  assert.equal(lines.length, 1, "Missing/duplicate original completion frame")
  const encoded = lines[0].slice(lines[0].indexOf(PREFIX) + PREFIX.length)
  assert.match(encoded, /^[A-Za-z0-9+/]+={0,2}$/u); assert.ok(encoded.length <= 43692)
  const bytes = Buffer.from(encoded, "base64"); assert.equal(bytes.toString("base64"), encoded)
  const frame = boundedJSON(bytes)
  keys(frame, ["schemaVersion", "kind", "repository", "controllerRevision", "runId", "attempt", "jobId", "source", "version", "releaseId", "originalArtifactId", "originalAssetId", "completionAssetId", "completionDigest", "publicationAuthorized"])
  assert.equal(frame.schemaVersion, 1); assert.equal(frame.kind, "lotus-npm-completion-frame/v1"); assert.equal(frame.publicationAuthorized, false)
  return frame
}

function reader(reads) {
  for (const name of ["request", "binary", "checkSuite", "jobLog", "registry"]) assert.equal(typeof reads[name], "function", "Missing public read port: " + name)
  const get = endpoint => {
    const value = reads.request(endpoint)
    assert.ok(value && typeof value === "object" && !value.then && Buffer.byteLength(JSON.stringify(value)) <= 24 * 1024 * 1024, "Unknown/oversized synchronous API evidence")
    return structuredClone(value)
  }
  const pages = (endpoint, key) => {
    const rows = []; let total
    for (let page = 1; page <= 20; page++) {
      const reply = get(endpoint + (endpoint.includes("?") ? "&" : "?") + "per_page=100&page=" + page), values = key ? reply[key] : reply
      assert.ok(Array.isArray(values) && values.length <= 100)
      if (key) { assert.ok(Number.isSafeInteger(reply.total_count) && reply.total_count >= 0); total ??= reply.total_count; assert.equal(reply.total_count, total) }
      rows.push(...values); assert.equal(new Set(rows.map(item => positive(item.id))).size, rows.length)
      if (key && rows.length === total || !key && values.length < 100) return rows
      assert.equal(values.length, 100, "Truncated API evidence")
    }
    throw new Error("API evidence exceeds page bound")
  }
  const branch = name => { const value = get("branches/" + encodeURIComponent(name)); assert.equal(value.name, name); if (name === "main") assert.equal(value.protected, true); return sha(value.commit?.sha) }
  const ancestor = (base, head) => { const value = get("compare/" + sha(base) + "..." + sha(head)); assert.ok(["ahead", "identical"].includes(value.status)); assert.equal(value.base_commit?.sha, base); assert.equal(value.merge_base_commit?.sha, base) }
  const blob = (name, revision) => {
    const value = get("contents/" + name + "?ref=" + sha(revision))
    assert.equal(value.path, name); assert.equal(value.type, "file"); sha(value.sha)
    assert.ok(Number.isSafeInteger(value.size) && value.size >= 0 && value.size <= 16 * 1024 * 1024)
    const raw = value.encoding === "base64" ? value : get("git/blobs/" + value.sha)
    assert.equal(raw.sha, value.sha); assert.equal(raw.encoding, "base64")
    const encoded = raw.content.replaceAll(/\r?\n/gu, ""), bytes = Buffer.from(encoded, "base64")
    assert.equal(bytes.toString("base64"), encoded); assert.equal(bytes.length, value.size)
    assert.equal(createHash("sha1").update("blob " + bytes.length + "\0").update(bytes).digest("hex"), value.sha)
    return { blob: value.sha, sha256: hash(bytes), bytes }
  }
  return { get, pages, branch, ancestor, blob }
}
export function treeLeaves(get, revision) {
  const value = get("git/trees/" + sha(revision) + "?recursive=1")
  assert.equal(value.sha, revision); assert.equal(value.truncated, false); assert.ok(Array.isArray(value.tree) && value.tree.length <= 100000)
  const leaves = new Map()
  for (const item of value.tree) {
    assert.ok(typeof item.path === "string" && !item.path.startsWith("/") && item.path.split("/").every(part => part && part !== "." && part !== ".."))
    if (item.type === "tree") continue
    assert.ok(["blob", "commit"].includes(item.type) && ["100644", "100755", "120000", "160000"].includes(item.mode))
    assert.equal(item.type === "commit", item.mode === "160000"); assert.ok(!leaves.has(item.path)); sha(item.sha)
    leaves.set(item.path, { mode: item.mode, sha: item.sha })
  }
  return leaves
}
function selectJobs(latest, all, run, contract) {
  same(Object.keys(contract.requiredJobs).sort(), Object.values(JOBS).sort()); assert.equal(latest.length, 3)
  const labels = new Set()
  for (const job of all) {
    positive(job.id); positive(job.run_attempt); assert.ok(job.run_attempt <= run.run_attempt); assert.equal(job.run_id, run.id)
    assert.equal(job.head_sha, run.head_sha); assert.equal(job.head_branch, "main"); assert.ok(Object.values(JOBS).includes(job.name))
    assert.equal(job.status, "completed"); assert.ok(!labels.has(job.name + "/" + job.run_attempt)); labels.add(job.name + "/" + job.run_attempt)
    assert.ok(Array.isArray(job.steps))
  }
  return Object.values(JOBS).map(name => {
    const family = all.filter(job => job.name === name), matches = latest.filter(job => job.name === name); assert.equal(matches.length, 1)
    const logical = matches[0], newest = [...family].sort((a, b) => b.run_attempt - a.run_attempt)[0]; same(jobKey(logical), jobKey(newest)); complete(logical)
    const key = executionKey(logical); assert.ok(key, "Incomplete logical execution")
    const physical = family.filter(job => executionKey(job) === key).sort((a, b) => a.run_attempt - b.run_attempt)[0]
    assert.ok(physical && time(physical.started_at) >= time(run.created_at) && time(physical.completed_at) <= time(run.updated_at) + 1000)
    const required = contract.requiredJobs[name]; assert.ok(Array.isArray(required) && required.length)
    for (const selected of [logical, physical]) for (const name of required) complete(step(selected, name))
    return { logical, physical }
  })
}

export async function verifyPublishedNpm(input, reads, policy = {}) {
  keys(input, ["sourceRevision", "version", "feature", "releaseRunId"]); sha(input.sourceRevision); positive(input.releaseRunId)
  keys(input.feature, ["pullRequest", "runId", "attempt"]); Object.values(input.feature).forEach(positive)
  const registry = policy.releaseProducers ?? ACCEPTED_RELEASE_PRODUCERS
  assert.ok(Object.keys(registry).length, "No accepted complete release producer; public proof is inactive")
  const { get, pages, branch, ancestor, blob } = reader(reads), B = branch("main"), run = get("actions/runs/" + input.releaseRunId)
  assert.equal(run.id, input.releaseRunId); positive(run.run_attempt); assert.ok(run.run_attempt <= 20); repo(run.repository); repo(run.head_repository)
  assert.equal(run.repository.owner.id, OWNER_ID); complete(run); assert.equal(run.event, "workflow_dispatch"); assert.equal(run.head_branch, "main"); assert.equal(run.path, WORKFLOW)
  const C = sha(run.head_sha); ancestor(C, B)
  const official = structuredClone(reads.checkSuite(run.check_suite_node_id)); assert.equal(official.databaseId, positive(run.check_suite_id))
  same(official.repository, { databaseId: REPO_ID, nameWithOwner: REPOSITORY }); same(official.app, { databaseId: 15368, slug: "github-actions" }); assert.equal(official.commit.oid, C)
  same(official.workflowRun, { databaseId: run.id, event: "workflow_dispatch", runAttempt: run.run_attempt,
    workflow: { databaseId: run.workflow_id, name: run.name }, file: { path: WORKFLOW, repositoryName: REPOSITORY, repositoryFileUrl: "https://github.com/" + REPOSITORY + "/blob/" + C + "/" + WORKFLOW } })
  const definition = blob(WORKFLOW, C), contract = registry[definition.sha256]
  assert.equal(contract?.complete, true, "Unknown/incomplete release producer"); assert.equal(contract.workflowId, run.workflow_id); assert.equal(contract.workflowName, run.name)
  const anchor = sha(contract.mainHistoryAnchor); ancestor(anchor, C); ancestor(anchor, input.sourceRevision)
  const workflow = get("actions/workflows/" + run.workflow_id); assert.equal(workflow.id, run.workflow_id); assert.equal(workflow.path, WORKFLOW); assert.equal(workflow.state, "active")
  const controller = get("git/commits/" + C); assert.equal(controller.sha, C); const controlTree = treeLeaves(get, controller.tree.sha)
  for (const name of CONTROLLER_HELPERS) assert.match(contract.helpers?.[name] ?? "", /^[0-9a-f]{64}$/u)
  for (const [name, checksum] of Object.entries(contract.helpers)) {
    assert.ok(/^[A-Za-z0-9_./-]+$/u.test(name) && !name.split("/").includes("..")); const value = blob(name, C)
    assert.equal(value.sha256, checksum, "Unreviewed C helper: " + name); assert.ok(["100644", "100755"].includes(controlTree.get(name)?.mode)); assert.equal(controlTree.get(name).sha, value.blob)
  }
  assert.equal(controlTree.get(WORKFLOW)?.sha, definition.blob); assert.equal(controlTree.get(WORKFLOW)?.mode, "100644")
  const sourceReads = { request: get, artifactBytes: id => reads.binary("actions/artifacts/" + positive(id) + "/zip") }
  const facts = admitFrozenDev({ source: input.sourceRevision, ...input.feature }, sourceReads)
  const expected = inputs({ repository: REPOSITORY, version: input.version, sourceRevision: facts.source, sourceTree: facts.tree })
  const latest = pages("actions/runs/" + run.id + "/jobs?filter=latest", "jobs"), all = pages("actions/runs/" + run.id + "/jobs?filter=all", "jobs")
  const selected = selectJobs(latest, all, run, contract), attempts = new Map()
  const physicalJob = job => {
    same(jobKey(get("actions/jobs/" + job.id)), jobKey(job))
    if (!attempts.has(job.run_attempt)) attempts.set(job.run_attempt, pages("actions/runs/" + run.id + "/attempts/" + job.run_attempt + "/jobs", "jobs"))
    const matches = attempts.get(job.run_attempt).filter(value => value.id === job.id); assert.equal(matches.length, 1); same(jobKey(matches[0]), jobKey(job))
  }
  selected.forEach(({ physical }) => physicalJob(physical))
  const finalizer = selected.find(job => job.physical.name === JOBS.finalize).physical; complete(step(finalizer, PUBLISH))
  const frame = completionFrame(reads.jobLog(finalizer.id))
  for (const [key, value] of Object.entries({ repository: REPOSITORY, controllerRevision: C, runId: run.id, attempt: finalizer.run_attempt, jobId: finalizer.id, source: facts.source, version: input.version })) assert.equal(frame[key], value)
  const release = get("releases/" + positive(frame.releaseId)), tagName = "lotus-next-v" + expected.version
  assert.equal(release.id, frame.releaseId); assert.equal(release.tag_name, tagName); assert.equal(release.target_commitish, facts.source); assert.equal(release.draft, false); assert.equal(release.prerelease, false)
  const ref = get("git/ref/tags/" + tagName); assert.equal(ref.ref, "refs/tags/" + tagName); assert.equal(ref.object.type, "tag"); sha(ref.object.sha)
  const tag = get("git/tags/" + ref.object.sha); assert.equal(tag.sha, ref.object.sha); assert.equal(tag.tag, tagName); assert.equal(tag.object.type, "commit"); assert.equal(tag.object.sha, facts.source)
  const intent = boundedJSON(Buffer.from(release.body)), origin = intent.origin
  keys(origin, ["jobId", "attempt"]); positive(origin.jobId); positive(origin.attempt)
  same(intent, { schemaVersion: 1, kind: "lotus-npm-reservation/v1", inputs: expected, controllerRevision: C, runId: run.id, feature: input.feature, origin })
  assert.equal(tag.message, JSON.stringify(intent) + "\n")
  const preparation = all.filter(job => job.id === origin.jobId && job.run_attempt === origin.attempt && job.name === JOBS.prepare)
  assert.equal(preparation.length, 1); complete(preparation[0]); complete(step(preparation[0], RESERVE)); physicalJob(preparation[0])
  const originals = all.filter(job => job.name === JOBS.build && executionKey(job) && [SELECT, ...CORE].every(name => step(job, name).conclusion === "success"))
  assert.ok(originals.length, "No complete original build"); assert.equal(new Set(originals.map(executionKey)).size, 1, "Repeated formal build")
  const original = [...originals].sort((a, b) => a.run_attempt - b.run_attempt)[0]; physicalJob(original)
  for (const job of all.filter(job => job.name === JOBS.build)) if (executionKey(job) !== executionKey(original)) {
    assert.ok(skipped(job), "Unknown/repeated compiler or packer execution")
    if (job.conclusion === "success") { complete(step(job, SELECT)); complete(step(job, RESTORE)) } else assert.equal(job.conclusion, "failure")
  }
  const artifacts = pages("actions/runs/" + run.id + "/artifacts", "artifacts"), name = "lotus-next-original-" + run.id + "-" + original.run_attempt
  const matches = artifacts.filter(value => value.id === frame.originalArtifactId && value.name === name); assert.equal(matches.length, 1)
  assert.equal(artifacts.filter(value => value.name === name).length, 1)
  const artifact = matches[0], upload = step(original, CORE[2]); assert.equal(artifact.workflow_run.id, run.id); assert.equal(artifact.workflow_run.head_sha, C)
  assert.equal(typeof artifact.expired, "boolean")
  assert.match(artifact.digest, /^sha256:[0-9a-f]{64}$/u); positive(artifact.size_in_bytes); assert.ok(artifact.size_in_bytes <= 128 * 1024 * 1024)
  assert.ok(time(artifact.created_at) >= time(upload.started_at) && time(artifact.created_at) <= time(upload.completed_at) + 1000)
  const assets = pages("releases/" + release.id + "/assets"); assert.equal(assets.length, 2); assert.equal(new Set(assets.map(item => item.name)).size, 2)
  const readAsset = (id, name, digest, size, maximum) => {
    const matches = assets.filter(value => value.id === positive(id) && value.name === name); assert.equal(matches.length, 1)
    const asset = matches[0]; assert.equal(asset.state, "uploaded"); assert.match(asset.digest, /^sha256:[0-9a-f]{64}$/u)
    assert.ok(positive(asset.size) <= maximum); if (digest !== undefined) assert.equal(asset.digest, digest); if (size !== undefined) assert.equal(asset.size, size)
    const bytes = reads.binary("releases/assets/" + id); assert.ok(Buffer.isBuffer(bytes)); assert.equal(bytes.length, asset.size); assert.equal("sha256:" + hash(bytes), asset.digest)
    return { asset, bytes }
  }
  const retained = readAsset(frame.originalAssetId, assetName(expected), artifact.digest, artifact.size_in_bytes, 128 * 1024 * 1024)
  if (!artifact.expired) same(reads.binary("actions/artifacts/" + artifact.id + "/zip"), retained.bytes)
  else assert.equal(artifact.expired, true) // Retained raw bytes still need surviving official artifact metadata.
  const files = zipFiles(retained.bytes); same(Object.keys(files), ["original.zip"]); const sealed = unseal(files["original.zip"], expected)
  same(sealed.proof.origin, { controllerRevision: C, runId: run.id, attempt: original.run_attempt, jobId: original.id })
  const completionAsset = readAsset(frame.completionAssetId, "lotus-next-publication-" + expected.version + ".json", frame.completionDigest, undefined, 32768)
  const completion = boundedJSON(completionAsset.bytes)
  const observed = registryIdentity(await reads.registry(expected), { sealed }, expected, C, run.id, run.run_attempt, run.repository)
  same(completion, { schemaVersion: 1, kind: "lotus-npm-completion/v1", inputs: expected, feature: input.feature,
    controllerRevision: C, runId: run.id, tag: { name: tagName, object: ref.object.sha }, releaseId: release.id,
    original: { artifact: { ...fields(artifact, ["id", "name", "digest"]), size: artifact.size_in_bytes }, job: { id: original.id, attempt: original.run_attempt, fingerprint: hash(Buffer.from(executionKey(original))) },
      asset: { id: retained.asset.id, name: retained.asset.name, digest: retained.asset.digest, size: retained.asset.size }, archive: sealed.proof.archive },
    registry: observed, publicationAuthorized: false })
  const publishers = all.filter(job => job.name === JOBS.finalize && job.run_attempt === observed.publicationAttempt)
  assert.equal(publishers.length, 1); const published = step(publishers[0], PUBLISH)
  assert.equal(published.status, "completed"); assert.ok(["success", "failure", "cancelled", "timed_out"].includes(published.conclusion))
  assert.ok(time(published.started_at) >= time(publishers[0].started_at) && time(published.started_at) <= time(publishers[0].completed_at)); physicalJob(publishers[0])
  same(runKey(get("actions/runs/" + run.id)), runKey(run)); same(reads.checkSuite(run.check_suite_node_id), official)
  same(selectJobs(pages("actions/runs/" + run.id + "/jobs?filter=latest", "jobs"), pages("actions/runs/" + run.id + "/jobs?filter=all", "jobs"), run, contract), selected)
  same(releaseKey(get("releases/" + release.id)), releaseKey(release)); same(get("git/ref/tags/" + tagName), ref); same(get("git/tags/" + ref.object.sha), tag)
  same(pages("releases/" + release.id + "/assets").map(assetKey), assets.map(assetKey))
  const fresh = admitFrozenDev({ source: input.sourceRevision, ...input.feature }, sourceReads)
  const stable = value => { const copy = structuredClone(value); delete copy.observedDev; delete copy.currentDev; return copy }; same(stable(fresh), stable(facts))
  const mainAfter = branch("main"); ancestor(B, mainAfter)
  return { schemaVersion: 1, kind: "lotus-published-npm-facts/v1", publicationAuthorized: false,
    source: { revision: facts.source, tree: facts.tree, feature: input.feature }, controller: { revision: C, runId: run.id, attempt: finalizer.run_attempt, jobId: finalizer.id },
    release: { id: release.id, tag: tagName, version: expected.version }, original: completion.original, completion: { assetId: completionAsset.asset.id, sha256: hash(completionAsset.bytes) },
    registry: observed, mainObservedBefore: B, mainObservedAfter: mainAfter }
}

export async function verifyPromotion(input, reads, policy = {}) {
  keys(input, ["sourceRevision", "version", "feature", "releaseRunId", "pullRequest", "baseRevision", "headRevision", "snapshotRevision"])
  const { get, branch, ancestor } = reader(reads), B = sha(input.baseRevision), F = sha(input.headRevision), M = sha(input.snapshotRevision)
  const pr = get("pulls/" + positive(input.pullRequest)); assert.equal(pr.number, input.pullRequest); assert.equal(pr.state, "open"); assert.equal(pr.draft, false)
  repo(pr.base.repo); repo(pr.head.repo); assert.equal(pr.base.ref, "main"); assert.equal(pr.base.sha, B); assert.equal(pr.head.sha, F); assert.equal(pr.merge_commit_sha, M); assert.equal(branch("main"), B)
  const facts = await verifyPublishedNpm(fields(input, ["sourceRevision", "version", "feature", "releaseRunId"]), reads, policy); ancestor(facts.source.revision, F)
  const commits = [B, F, M].map(value => { const result = get("git/commits/" + value); assert.equal(result.sha, value); return result })
  same(commits[2].parents.map(value => value.sha), [B, F])
  const [released, base, head, snapshot] = [facts.source.tree, ...commits.map(value => value.tree.sha)].map(value => treeLeaves(get, value))
  const paths = policy.controlPaths; assert.ok(Array.isArray(paths) && paths.length && paths.length <= 128 && new Set(paths).size === paths.length)
  for (const name of REQUIRED_CONTROLS) { assert.ok(paths.includes(name), "Incomplete trusted Main control closure"); assert.ok(base.has(name), "Missing trusted Base control") }
  const expected = new Map(released)
  for (const name of paths) {
    assert.ok(name === "AGENTS.md" || /^(scripts|docs|\.github\/workflows)\/[A-Za-z0-9_./-]+$/u.test(name) && !name.split("/").includes(".."))
    if (base.has(name)) { assert.ok(["100644", "100755"].includes(base.get(name).mode), "Control must be an ordinary Base blob"); expected.set(name, base.get(name)) } else expected.delete(name)
  }
  const key = value => JSON.stringify([...value].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0))
  assert.equal(key(head), key(expected), "Promotion must preserve S product and whole trusted Base controls"); assert.equal(key(snapshot), key(head))
  same(prKey(get("pulls/" + pr.number)), prKey(pr)); assert.equal(branch("main"), B)
  return { ...facts, kind: "lotus-main-promotion-facts/v1", promotion: { pullRequest: pr.number, baseRevision: B, headRevision: F,
    snapshotRevision: M, snapshotTree: commits[2].tree.sha, controlMode: key(head) === key(released) ? "released-source" : "complete-trusted-base" } }
}
