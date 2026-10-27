import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, realpathSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, it } from "vitest"
import { calculateResourcesSha256 } from "./artifact-manifest.mjs"
import { executionKey, PRODUCER } from "./frozen-dev-source.mjs"
import { archive as zip, fixture as sourceFixture, safeEnv } from "./frozen-dev-source.test-fixture.mjs"
import { assetName, registryIdentity, seal } from "./release-npm-original.mjs"
import { ACCEPTED_RELEASE_PRODUCERS, CONTROLLER_HELPERS, PREFIX, REQUIRED_CONTROLS, WORKFLOW, completionFrame, verifyPromotion, verifyPublishedNpm } from "./published-npm-admission.mjs"

const hash = bytes => createHash("sha256").update(bytes).digest("hex"), json = value => Buffer.from(JSON.stringify(value))
const repo = { id: 1281544268, full_name: "bigduu/lotus-next", owner: { id: 18681616 } }
const names = ["Reserve frozen npm release", "Produce original npm archive", "Publish retained npm archive"]
const core = ["Build final dist once", "Pack and statically verify once", "Retain original npm archive"]
const select = "Select original npm build", publish = "Publish original npm archive", reserve = "Reserve source and version", restore = "Restore original npm archive"
const clock = second => new Date(Date.parse("2026-10-27T02:00:00Z") + second * 1000).toISOString()
const gitEnv = { ...safeEnv, GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GIT_AUTHOR_DATE: "2026-10-26T12:00:00Z", GIT_COMMITTER_DATE: "2026-10-26T12:00:00Z" }
let root, A, F, M, S, T, C, H, PM, fullSourceMerge, copyHead, copyMerge, tagOid, tar, sourceFiles, controllerFiles, sourceTree, controllerTree, headTree
const commits = new Map(), trees = new Map(), blobs = new Map()
const git = (...args) => execFileSync("git", ["--no-replace-objects", "-C", root, ...args], { env: gitEnv, encoding: "utf8", stdio: ["pipe", "pipe", "pipe"] }).trim()
const object = (type, input) => execFileSync("git", ["-C", root, "hash-object", "-t", type, "-w", "--stdin"], { env: gitEnv, input, encoding: "utf8" }).trim()
function tree(files) {
  const entries = new Map()
  for (const [name, value] of files) {
    const parts = name.split("/"), leaf = parts.pop(); let directory = entries
    for (const part of parts) { if (!directory.has(part)) directory.set(part, new Map()); directory = directory.get(part) }
    directory.set(leaf, value)
  }
  const write = directory => {
    const lines = [...directory].map(([name, value]) => {
      if (value instanceof Map) return "040000 tree " + write(value) + "\t" + name + "\n"
      const mode = value.mode ?? "100644", oid = value.sha ?? object("blob", value.bytes)
      if (value.bytes) blobs.set(oid, value.bytes)
      return mode + " " + (mode === "160000" ? "commit" : "blob") + " " + oid + "\t" + name + "\n"
    }).sort().join("")
    return execFileSync("git", ["-C", root, "mktree"], { env: gitEnv, input: lines, encoding: "utf8" }).trim()
  }
  const sha = write(entries)
  const rows = git("ls-tree", "-r", sha).split("\n").map(line => { const match = /^(\d+) (blob|commit) ([0-9a-f]{40})\t(.+)$/u.exec(line); return { mode: match[1], type: match[2], sha: match[3], path: match[4] } })
  trees.set(sha, { sha, truncated: false, tree: rows }); return sha
}
function commit(tree, parents, message) {
  const sha = git("commit-tree", tree, ...parents.flatMap(parent => ["-p", parent]), "-m", message)
  commits.set(sha, { sha, tree: { sha: tree }, parents: parents.map(sha => ({ sha })) }); return sha
}
beforeAll(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "lotus456-public-git-")))
  git("init", "-q", "--initial-branch=main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid")
  git("config", "commit.gpgsign", "false"); git("config", "core.hooksPath", "/dev/null")
  sourceFiles = new Map(Object.keys(PRODUCER).map(name => [name, { bytes: readFileSync(path.resolve(name)) }]))
  sourceFiles.set("src/product.txt", { bytes: Buffer.from("base product\n") }); A = commit(tree(sourceFiles), [], "shared normal history")
  sourceFiles.set("src/product.txt", { bytes: Buffer.from("released stable product\n") })
  sourceFiles.set("vendor/module", { mode: "160000", sha: A }); sourceTree = tree(sourceFiles)
  F = commit(sourceTree, [A], "feature product"); M = commit(sourceTree, [A, F], "original tested merge"); S = commit(sourceTree, [A, F], "normal accepted dev merge"); T = sourceTree
  controllerFiles = new Map(sourceFiles)
  for (const name of new Set([...CONTROLLER_HELPERS, ...REQUIRED_CONTROLS])) controllerFiles.set(name, { bytes: readFileSync(path.resolve(name)) })
  controllerFiles.set(".github/workflows/ci.yml", { bytes: Buffer.concat([controllerFiles.get(".github/workflows/ci.yml").bytes, Buffer.from("\n# inert trusted Base Main-entry fixture\n")]) })
  controllerFiles.set("src/product.txt", { bytes: Buffer.from("old Main product\n") }); controllerTree = tree(controllerFiles); C = commit(controllerTree, [A], "trusted main controller")
  const headFiles = new Map(sourceFiles); for (const name of REQUIRED_CONTROLS) headFiles.set(name, controllerFiles.get(name))
  headTree = tree(headFiles); H = commit(headTree, [S], "promote actual S with complete Base controls"); PM = commit(headTree, [C, H], "actual Main PR merge snapshot")
  fullSourceMerge = commit(sourceTree, [C, S], "unsafe full S removes Main controls")
  copyHead = commit(headTree, [C], "same-tree copy without released S ancestry"); copyMerge = commit(headTree, [C, copyHead], "normal PR of an unsafe copy")
  const resources = ["asset-manifest.json", "bundle-ownership.json", "index.html"].map(path => ({ path, size: 2, sha256: hash(Buffer.from("{}")) }))
  const manifest = { schemaVersion: 1, packageName: repo.full_name.replace("bigduu/", "@bigduu/"), packageVersion: "2026.10.99", sourceRevision: S, sourceDirty: false,
    entrypoint: "index.html", resourcesSha256: calculateResourcesSha256(resources), resources }
  const files = { "package/package.json": json({ name: "@bigduu/lotus-next", version: manifest.packageVersion }), "package/dist/lotus-next-manifest.json": json(manifest),
    ...Object.fromEntries(resources.map(value => ["package/dist/" + value.path, Buffer.from("{}")])) }
  tar = execFileSync("python3", ["-I", "-c", "import base64,io,json,sys,tarfile\nout=io.BytesIO()\nwith tarfile.open(fileobj=out,mode='w:gz',format=tarfile.USTAR_FORMAT) as t:\n for name,value in json.load(sys.stdin).items():\n  raw=base64.b64decode(value); info=tarfile.TarInfo(name); info.size=len(raw); t.addfile(info,io.BytesIO(raw))\nsys.stdout.buffer.write(out.getvalue())"],
    { env: safeEnv, input: JSON.stringify(Object.fromEntries(Object.entries(files).map(([name, bytes]) => [name, bytes.toString("base64")]))) })
})
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }) })

function registryRecord(sealed) {
  const digest = sealed.proof.archive, slsa = "https://slsa.dev/provenance/v1"
  const statement = { _type: "https://in-toto.io/Statement/v1", subject: [{ name: "pkg:npm/%40bigduu/lotus-next@2026.10.99", digest: { sha512: Buffer.from(digest.integrity.slice(7), "base64").toString("hex") } }], predicateType: slsa,
    predicate: { buildDefinition: { buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
      externalParameters: { workflow: { ref: "refs/heads/main", repository: "https://github.com/" + repo.full_name, path: WORKFLOW } },
      internalParameters: { github: { event_name: "workflow_dispatch", repository_id: String(repo.id), repository_owner_id: String(repo.owner.id) } },
      resolvedDependencies: [{ uri: "git+https://github.com/" + repo.full_name + "@refs/heads/main", digest: { gitCommit: C } }] },
    runDetails: { builder: { id: "https://github.com/actions/runner/github-hosted" }, metadata: { invocationId: "https://github.com/" + repo.full_name + "/actions/runs/900/attempts/1" } } } }
  return { archive: Buffer.from(tar), metadata: { name: "@bigduu/lotus-next", version: "2026.10.99", dist: { tarball: "https://registry.npmjs.org/@bigduu/lotus-next/-/lotus-next-2026.10.99.tgz", shasum: digest.shasum, integrity: digest.integrity, attestations: { provenance: { predicateType: slsa } } } },
    attestations: { attestations: [{ predicateType: slsa, bundle: { dsseEnvelope: { payloadType: "application/vnd.in-toto+json", payload: json(statement).toString("base64") } } }] } }
}
function fixture() {
  const feature = sourceFixture({ S, B: A, F, M, T }); feature.branch.commit.sha = S
  const input = { sourceRevision: S, version: "2026.10.99", feature: { pullRequest: 17, runId: 42, attempt: 1 }, releaseRunId: 900 }
  const expected = { repository: repo.full_name, version: input.version, sourceRevision: S, sourceTree: T }
  const job = (index, id, attempt, start, end, steps) => ({ id, name: names[index], run_id: 900, run_attempt: attempt, head_sha: C, head_branch: "main", status: "completed", conclusion: "success", started_at: clock(start), completed_at: clock(end),
    steps: steps.map(([name, first, last, conclusion = "success"], i) => ({ name, number: i + 1, status: "completed", conclusion, started_at: clock(first), completed_at: clock(last) })) })
  const jobs = [job(0, 1001, 1, 0, 8, [[reserve, 2, 3]]), job(1, 2001, 1, 10, 100, [[select, 12, 13], [core[0], 20, 40], [core[1], 50, 60], [core[2], 70, 80]]), job(2, 3001, 1, 120, 160, [[publish, 122, 150]])]
  const sealed = seal(tar, expected, { controllerRevision: C, runId: 900, attempt: 1, jobId: 2001 }), raw = zip({ "original.zip": sealed.bytes })
  const artifact = { id: 1501, name: "lotus-next-original-900-1", digest: "sha256:" + hash(raw), size_in_bytes: raw.length, expired: false, created_at: clock(75), workflow_run: { id: 900, head_sha: C } }
  const originalAsset = { id: 1800, name: assetName(expected), digest: artifact.digest, size: raw.length, state: "uploaded", created_at: clock(123) }
  const intent = { schemaVersion: 1, kind: "lotus-npm-reservation/v1", inputs: expected, controllerRevision: C, runId: 900, feature: input.feature, origin: { jobId: 1001, attempt: 1 } }
  const tagName = "lotus-next-v" + input.version
  tagOid = object("tag", "object " + S + "\ntype commit\ntag " + tagName + "\ntagger Fixture <fixture@example.invalid> 1793016000 +0000\n\n" + JSON.stringify(intent) + "\n")
  const record = registryRecord(sealed), registry = registryIdentity(record, { sealed: { proof: sealed.proof, archive: tar } }, expected, C, 900, 1, repo)
  const completion = { schemaVersion: 1, kind: "lotus-npm-completion/v1", inputs: expected, feature: input.feature, controllerRevision: C, runId: 900,
    tag: { name: tagName, object: tagOid }, releaseId: 1700,
    original: { artifact: { id: artifact.id, name: artifact.name, digest: artifact.digest, size: raw.length }, job: { id: 2001, attempt: 1, fingerprint: hash(Buffer.from(executionKey(jobs[1]))) },
      asset: { id: originalAsset.id, name: originalAsset.name, digest: originalAsset.digest, size: originalAsset.size }, archive: sealed.proof.archive }, registry, publicationAuthorized: false }
  const completionBytes = json(completion), completionAsset = { id: 1801, name: "lotus-next-publication-2026.10.99.json", digest: "sha256:" + hash(completionBytes), size: completionBytes.length, state: "uploaded", created_at: clock(140) }
  const frame = { schemaVersion: 1, kind: "lotus-npm-completion-frame/v1", repository: repo.full_name, controllerRevision: C, runId: 900, attempt: 1, jobId: 3001, source: S, version: input.version,
    releaseId: 1700, originalArtifactId: 1501, originalAssetId: 1800, completionAssetId: 1801, completionDigest: completionAsset.digest, publicationAuthorized: false }
  const state = { jobs, latest: structuredClone(jobs), artifacts: [artifact], assets: [originalAsset, completionAsset], frames: new Map([[3001, frame]]), record, completion, intent,
    data: new Map([["actions/artifacts/1501/zip", raw], ["releases/assets/1800", raw], ["releases/assets/1801", completionBytes]]),
    run: { id: 900, run_attempt: 1, workflow_id: 700, check_suite_id: 701, check_suite_node_id: "CS_release", name: "Publish retained frontend artifact", event: "workflow_dispatch", path: WORKFLOW, head_branch: "main", head_sha: C, repository: repo, head_repository: repo, status: "completed", conclusion: "success", created_at: clock(0), updated_at: clock(200) },
    suite: { databaseId: 701, repository: { databaseId: repo.id, nameWithOwner: repo.full_name }, app: { databaseId: 15368, slug: "github-actions" }, commit: { oid: C },
      workflowRun: { databaseId: 900, event: "workflow_dispatch", runAttempt: 1, workflow: { databaseId: 700, name: "Publish retained frontend artifact" }, file: { path: WORKFLOW, repositoryName: repo.full_name, repositoryFileUrl: "https://github.com/" + repo.full_name + "/blob/" + C + "/" + WORKFLOW } } },
    release: { id: 1700, tag_name: tagName, target_commitish: S, draft: false, prerelease: false, body: JSON.stringify(intent), created_at: "2026-10-26T12:00:00Z", published_at: clock(145) },
    ref: { ref: "refs/tags/" + tagName, object: { type: "tag", sha: tagOid } }, tag: { sha: tagOid, tag: tagName, object: { type: "commit", sha: S }, message: JSON.stringify(intent) + "\n" },
    main: { name: "main", protected: true, commit: { sha: C } }, pr: { number: 88, state: "open", draft: false, merged: false, merge_commit_sha: PM,
      base: { ref: "main", sha: C, repo }, head: { ref: "lotus-next/promotion", sha: H, repo } }, counts: new Map(), requests: [], change: () => {} }
  const content = (name, revision) => {
    const leaf = trees.get(commits.get(revision).tree.sha).tree.find(value => value.path === name); assert.ok(leaf)
    const bytes = blobs.get(leaf.sha); return { path: name, type: "file", sha: leaf.sha, size: bytes.length, encoding: "base64", content: bytes.toString("base64") }
  }
  const request = endpoint => {
    state.requests.push(endpoint); const count = (state.counts.get(endpoint) ?? 0) + 1; state.counts.set(endpoint, count)
    let value
    if (endpoint === "actions/runs/900") value = state.run
    else if (endpoint === "actions/workflows/700") value = { id: 700, path: WORKFLOW, state: "active" }
    else if (/^actions\/runs\/900\/jobs\?/u.test(endpoint)) { const rows = endpoint.includes("filter=latest") ? state.latest : state.jobs; value = { total_count: rows.length, jobs: rows } }
    else if (/^actions\/jobs\/\d+$/u.test(endpoint)) value = state.jobs.find(job => job.id === Number(endpoint.split("/").at(-1)))
    else if (/^actions\/runs\/900\/attempts\/\d+\/jobs/u.test(endpoint)) { const rows = state.jobs.filter(job => job.run_attempt === Number(endpoint.split("/")[4])); value = { total_count: rows.length, jobs: rows } }
    else if (endpoint.startsWith("actions/runs/900/artifacts?")) value = { total_count: state.artifacts.length, artifacts: state.artifacts }
    else if (endpoint === "releases/1700") value = state.release
    else if (endpoint.startsWith("releases/1700/assets?")) value = state.assets
    else if (endpoint.startsWith("git/ref/tags/")) value = state.ref
    else if (endpoint.startsWith("git/tags/")) value = state.tag
    else if (endpoint === "branches/main") value = state.main
    else if (endpoint === "pulls/88") value = state.pr
    else if (endpoint.startsWith("git/commits/")) value = commits.get(endpoint.slice(12))
    else if (endpoint.startsWith("git/trees/")) value = trees.get(endpoint.slice(10).split("?")[0])
    else if (endpoint.startsWith("compare/")) {
      const [base, head] = endpoint.slice(8).split("...")
      const ancestor = spawnSync("git", ["-C", root, "merge-base", "--is-ancestor", base, head], { env: gitEnv }).status === 0
      value = { status: ancestor ? base === head ? "identical" : "ahead" : "diverged", base_commit: { sha: base }, merge_base_commit: { sha: ancestor ? base : "0".repeat(40) } }
    } else {
      const match = /^contents\/(.+)\?ref=(.+)$/u.exec(endpoint)
      if (match && match[2] === C) value = content(match[1], C)
      else value = feature.request(endpoint)
    }
    assert.notEqual(value, undefined, "Unexpected fixture read: " + endpoint)
    value = structuredClone(value); state.change(endpoint, value, count); return value
  }
  const contract = { complete: true, workflowId: 700, workflowName: state.run.name, mainHistoryAnchor: A,
    helpers: Object.fromEntries(CONTROLLER_HELPERS.map(name => [name, hash(content(name, C) && blobs.get(content(name, C).sha))])),
    requiredJobs: { [names[0]]: [reserve], [names[1]]: [select], [names[2]]: [publish] } }
  const policy = { releaseProducers: { [hash(blobs.get(content(WORKFLOW, C).sha))]: contract } }
  const reads = { request, binary: endpoint => {
    if (state.data.has(endpoint)) return Buffer.from(state.data.get(endpoint))
    const match = /^actions\/artifacts\/(\d+)\/zip$/u.exec(endpoint), source = match && feature.archives[Number(match[1])]
    assert.ok(source, "Missing fixture binary: " + endpoint); return Buffer.from(source)
  }, registry: async () => state.record,
    checkSuite: () => structuredClone(state.suite), jobLog: id => clock(140) + " " + PREFIX + json(state.frames.get(id)).toString("base64") + "\n" }
  return { state, feature, reads, input, policy, contract, job, verify: () => verifyPublishedNpm(input, reads, policy),
    promote: () => verifyPromotion({ ...input, pullRequest: 88, baseRevision: C, headRevision: H, snapshotRevision: PM }, reads, policy) }
}

describe("read-only completed npm/public Main proof", () => {
  it("authenticates actual C, real Source454, original ZIP/tgz and registry without producer factories", async () => {
    const f = fixture(), result = await f.verify()
    assert.equal(result.publicationAuthorized, false); assert.equal(result.source.revision, S); assert.notEqual(C, S)
    assert.equal(result.original.job.id, 2001); assert.equal(result.registry.cryptographicVerification, false)
    assert.equal(result.registry.workflowSha, C); assert.equal(f.state.release.created_at, "2026-10-26T12:00:00Z")
  })
  it("keeps the public release registry empty and fails before any API access", async () => {
    const f = fixture(); assert.deepEqual(ACCEPTED_RELEASE_PRODUCERS, {})
    await assert.rejects(() => verifyPublishedNpm(f.input, f.reads), /inactive/); assert.equal(f.state.requests.length, 0)
  })
  for (const [name, mutate] of [
    ["foreign repository", f => { f.state.run.repository = { ...repo, id: 1 } }],
    ["failed whole release", f => { f.state.run.conclusion = "failure" }],
    ["non-dispatch event", f => { f.state.run.event = "push" }],
    ["foreign executed workflow", f => { f.state.suite.workflowRun.file.repositoryFileUrl = "https://github.com/" + repo.full_name + "/blob/" + S + "/" + WORKFLOW }],
    ["wrong Actions app", f => { f.state.suite.app.databaseId = 1 }],
    ["unreviewed producer", f => { f.contract.complete = false }],
    ["incomplete helper closure", f => { delete f.contract.helpers[CONTROLLER_HELPERS[0]] }],
    ["helper digest drift", f => { f.contract.helpers[CONTROLLER_HELPERS[0]] = "0".repeat(64) }],
    ["feature not merged", f => { f.feature.pr.merged = false }],
    ["moving frozen cut", f => { f.feature.frozen = C }],
    ["failed latest job", f => { f.state.latest[1].conclusion = "failure" }],
    ["missing latest owner", f => { f.state.latest.pop() }],
    ["duplicate job attempt", f => { f.state.jobs.push({ ...f.state.jobs[1], id: 9999 }) }],
    ["foreign completion job", f => { f.state.frames.get(3001).jobId = 9999 }],
    ["missing original artifact", f => { f.state.artifacts = [] }],
    ["wrong artifact digest", f => { f.state.artifacts[0].digest = "sha256:" + "0".repeat(64) }],
    ["foreign artifact controller", f => { f.state.artifacts[0].workflow_run.head_sha = S }],
    ["artifact outside upload", f => { f.state.artifacts[0].created_at = clock(5) }],
    ["missing retained original", f => { f.state.assets.shift() }],
    ["replaced retained ID", f => { f.state.assets[0].id = 9999 }],
    ["original bytes drift", f => { f.state.data.set("releases/assets/1800", Buffer.from("foreign")) }],
    ["registry original bytes drift", f => { f.state.record.archive = Buffer.from("foreign") }],
    ["registry digest drift", f => { f.state.record.metadata.dist.shasum = "0".repeat(40) }],
    ["retargeted tag", f => { f.state.tag.object.sha = C }],
  ]) it("rejects " + name, async () => { const f = fixture(); mutate(f); await assert.rejects(f.verify()) })
  it("uses immutable old physical finalizer/frame identities after copied-success reruns", async () => {
    const f = fixture(), before = f.reads.jobLog(3001); f.state.run.run_attempt = 2; f.state.suite.workflowRun.runAttempt = 2
    const copies = f.state.jobs.map(job => ({ ...structuredClone(job), id: job.id + 10000, run_attempt: 2 })); f.state.jobs.push(...copies); f.state.latest = copies
    const result = await f.verify(); assert.equal(result.controller.jobId, 3001); assert.equal(result.controller.attempt, 1)
    assert.equal(result.original.job.id, 2001); assert.equal(f.reads.jobLog(3001), before)
  })
  it("separates a real restore/new finalizer from the original builder and earlier failed npm job", async () => {
    const f = fixture(), frame = structuredClone(f.state.frames.get(3001))
    f.state.jobs[2].conclusion = "failure"; f.state.jobs[2].steps[0].conclusion = "failure"; f.state.frames.delete(3001)
    const next = [f.job(0, 11001, 2, 210, 218, [[reserve, 212, 213]]),
      f.job(1, 12001, 2, 220, 310, [[select, 222, 223], ...core.map(name => [name, 225, 225, "skipped"]), [restore, 280, 300]]),
      f.job(2, 13001, 2, 400, 460, [[publish, 402, 450]])]
    f.state.jobs.push(...next); f.state.latest = structuredClone(next); f.state.run.run_attempt = 2
    f.state.run.updated_at = clock(500); f.state.suite.workflowRun.runAttempt = 2
    Object.assign(frame, { attempt: 2, jobId: 13001 }); f.state.frames.set(13001, frame)
    f.state.assets[1].created_at = clock(440); f.state.release.published_at = clock(445)
    const result = await f.verify()
    assert.equal(result.controller.jobId, 13001); assert.equal(result.controller.attempt, 2)
    assert.equal(result.original.job.id, 2001); assert.equal(result.original.job.attempt, 1)
    assert.equal(result.registry.publicationAttempt, 1); assert.equal(f.state.jobs[2].conclusion, "failure")
  })
  it("permits retained raw ZIP recovery after expiry only with original official artifact metadata", async () => {
    const f = fixture(); f.state.artifacts[0].expired = true; f.state.data.delete("actions/artifacts/1501/zip")
    assert.equal((await f.verify()).original.artifact.id, 1501)
    f.state.artifacts = []; await assert.rejects(f.verify())
  })
  for (const key of ["release", "tag", "assets", "jobs", "main", "source"]) it("rejects mutable " + key + " drift at final readback", async () => {
    const f = fixture(); f.state.change = (endpoint, value, count) => {
      if (key === "release" && endpoint === "releases/1700" && count > 1) value.draft = true
      if (key === "tag" && endpoint.startsWith("git/ref/tags/") && count > 1) value.object.sha = C
      if (key === "assets" && endpoint.startsWith("releases/1700/assets?") && count > 1) value.pop()
      if (key === "jobs" && endpoint.includes("900/jobs?filter=latest") && count > 1) value.jobs[0].conclusion = "failure"
      if (key === "main" && endpoint === "branches/main" && count > 1) value.commit.sha = S
      if (key === "source" && endpoint === "releases/1700") f.feature.pr.merged = false
    }; await assert.rejects(f.verify())
  })
  it("ignores incidental Release/asset download counts while preserving exact identity and bytes", async () => {
    const f = fixture(); f.state.change = (endpoint, value, count) => {
      if (endpoint === "releases/1700") value.assets = [{ download_count: count }]
      if (endpoint.startsWith("releases/1700/assets?")) for (const asset of value) asset.download_count = count
    }; assert.equal((await f.verify()).source.revision, S)
  })
  it("admits normal actual-S ancestry and complete trusted Base controls with real Git leaf/mode/gitlinks", async () => {
    const f = fixture(), result = await f.promote(); assert.equal(result.promotion.snapshotRevision, PM); assert.equal(result.promotion.controlMode, "complete-trusted-base")
  })
  it("Main459 forbids caller-selected control paths even when the extra path is absent", async () => {
    const f = fixture()
    await assert.rejects(() => verifyPromotion({ ...f.input, pullRequest: 88, baseRevision: C,
      headRevision: H, snapshotRevision: PM }, f.reads,
    { ...f.policy, controlPaths: [...REQUIRED_CONTROLS, "docs/absent-product.md"] }), /Caller-selected control paths/)
  })
  for (const fault of ["product", "mode", "gitlink", "partial-controls", "control-symlink", "truncated", "same-tree-no-S", "wrong-parents"]) it("rejects promotion " + fault, async () => {
    const f = fixture()
    if (fault === "same-tree-no-S") {
      f.state.pr.head.sha = copyHead; f.state.pr.merge_commit_sha = copyMerge
      await assert.rejects(() => verifyPromotion({ ...f.input, pullRequest: 88, baseRevision: C, headRevision: copyHead, snapshotRevision: copyMerge }, f.reads, f.policy)); return
    }
    f.state.change = (endpoint, value) => {
      if (endpoint === "git/trees/" + headTree + "?recursive=1") {
        if (fault === "product") value.tree.find(item => item.path === "src/product.txt").sha = A
        if (fault === "mode") value.tree.find(item => item.path === "src/product.txt").mode = "100755"
        if (fault === "gitlink") value.tree.find(item => item.path === "vendor/module").sha = C
        if (fault === "partial-controls") value.tree.find(item => item.path === ".github/workflows/ci.yml").sha = A
        if (fault === "truncated") value.truncated = true
      }
      if (fault === "control-symlink" && endpoint === "git/trees/" + controllerTree + "?recursive=1") value.tree.find(item => item.path === ".github/workflows/ci.yml").mode = "120000"
      if (fault === "wrong-parents" && endpoint === "git/commits/" + PM) value.parents.reverse()
    }; await assert.rejects(f.promote())
  })
  it("rejects an old full S tree that would remove installed Main controls", async () => {
    const f = fixture(); f.state.pr.head.sha = S; f.state.pr.merge_commit_sha = fullSourceMerge
    await assert.rejects(() => verifyPromotion({ ...f.input, pullRequest: 88, baseRevision: C, headRevision: S, snapshotRevision: fullSourceMerge }, f.reads, f.policy), /trusted Base controls/)
  })
  it("rejects duplicate/noncanonical or authority-bearing completion frames", () => {
    const f = fixture(), log = f.reads.jobLog(3001); assert.throws(() => completionFrame(log + log))
    assert.throws(() => completionFrame(log.trimEnd() + "=\n"))
    f.state.frames.get(3001).publicationAuthorized = true; assert.throws(() => completionFrame(f.reads.jobLog(3001)))
  })
  for (const fault of ["main protection", "C ancestry", "source expiry", "page count", "C helper mode", "provenance C", "completion digest"]) it("additional public proof rejects " + fault, async () => {
    const f = fixture()
    if (fault === "main protection") f.state.main.protected = false
    if (fault === "source expiry") f.feature.artifacts[0].expired = true
    if (fault === "completion digest") f.state.frames.get(3001).completionDigest = "sha256:" + "0".repeat(64)
    if (fault === "provenance C") {
      const envelope = f.state.record.attestations.attestations[0].bundle.dsseEnvelope, body = JSON.parse(Buffer.from(envelope.payload, "base64"))
      body.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = S; envelope.payload = json(body).toString("base64")
    }
    f.state.change = (endpoint, value) => {
      if (fault === "C ancestry" && endpoint === "compare/" + C + "..." + C) value.status = "diverged"
      if (fault === "page count" && endpoint.startsWith("actions/runs/900/jobs?filter=latest")) delete value.total_count
      if (fault === "C helper mode" && endpoint === "git/trees/" + controllerTree + "?recursive=1") value.tree.find(item => item.path === CONTROLLER_HELPERS[0]).mode = "120000"
    }
    await assert.rejects(f.verify())
  })
})
