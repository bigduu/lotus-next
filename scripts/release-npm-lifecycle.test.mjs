import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, it } from "vitest"
import { calculateResourcesSha256 } from "./artifact-manifest.mjs"
import { controllerPorts, createLifecycle, JOBS, runPhase, STEPS, WORKFLOW } from "./release-npm-lifecycle.mjs"
import { seal, assetName, inspectArchive } from "./release-npm-original.mjs"
import { fixture, archive as outerZip, sha256, bytes, safeEnv, S, T } from "./frozen-dev-source.test-fixture.mjs"

const runId = 900, tagId = "d".repeat(40)
const expected = { repository: "bigduu/lotus-next", version: "2026.10.99", sourceRevision: S, sourceTree: T }
const feature = { pullRequest: 17, runId: 42, attempt: 1 }
const clock = (second) => "2026-10-27T01:00:" + String(second).padStart(2, "0") + "Z"
let root, controlRoot, controller, tarball
beforeAll(() => {
  root = realpathSync(mkdtempSync(path.join(tmpdir(), "lotus455-lifecycle-"))); controlRoot = path.join(root, "controller"); mkdirSync(controlRoot)
  const git = (...args) => execFileSync("git", ["-C", controlRoot, ...args], { env: safeEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
  git("init", "-q", "--initial-branch=main"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid")
  git("config", "commit.gpgsign", "false"); git("config", "core.hooksPath", "/dev/null")
  writeFileSync(path.join(controlRoot, "control"), "real clean controller\n"); git("add", "."); git("commit", "-qm", "controller"); controller = git("rev-parse", "HEAD")
  const resources = ["asset-manifest.json", "bundle-ownership.json", "index.html"].map(name => ({ path: name, size: 2, sha256: sha256(Buffer.from("{}")) }))
  const manifest = { schemaVersion: 1, packageName: "@bigduu/lotus-next", packageVersion: expected.version, sourceRevision: S,
    sourceDirty: false, entrypoint: "index.html", resourcesSha256: calculateResourcesSha256(resources), resources }
  const files = { "package/package.json": bytes({ name: "@bigduu/lotus-next", version: expected.version }),
    "package/dist/lotus-next-manifest.json": bytes(manifest), ...Object.fromEntries(resources.map(item => ["package/dist/" + item.path, Buffer.from("{}")])) }
  tarball = execFileSync("python3", ["-I", "-c", "import base64,io,json,sys,tarfile\nout=io.BytesIO()\nwith tarfile.open(fileobj=out,mode='w:gz',format=tarfile.USTAR_FORMAT) as t:\n for name,value in json.load(sys.stdin).items():\n  raw=base64.b64decode(value); info=tarfile.TarInfo(name); info.size=len(raw); t.addfile(info,io.BytesIO(raw))\nsys.stdout.buffer.write(out.getvalue())"],
  { env: safeEnv, input: JSON.stringify(Object.fromEntries(Object.entries(files).map(([name, value]) => [name, value.toString("base64")]))) })
})
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }) })

function sample(attempt = 1) {
  const source = fixture(), state = { ref: null, tag: null, release: null, assets: [], binary: new Map(), writes: [], artifacts: [], jobs: [], registry: null, publishes: 0 }
  const environment = { GITHUB_REPOSITORY: expected.repository, GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
    GITHUB_WORKFLOW_REF: expected.repository + "/" + WORKFLOW + "@refs/heads/main", GITHUB_WORKFLOW_SHA: controller, GITHUB_SHA: controller,
    GITHUB_RUN_ID: String(runId), GITHUB_RUN_ATTEMPT: String(attempt), GITHUB_JOB: "prepare" }
  const job = (name, id, runAttempt = attempt) => ({ name, id, run_id: runId, head_sha: controller, run_attempt: runAttempt,
    status: "in_progress", conclusion: null, started_at: clock(0), completed_at: null,
    steps: [{ name: STEPS.reserve, number: 1, status: "in_progress", conclusion: null, started_at: clock(1), completed_at: null }] })
  const prepared = job(JOBS.prepare, 1001)
  state.jobs.push(prepared)
  const ports = { source: source.dependencies,
    read: (endpoint) => {
      if (endpoint === "actions/runs/" + runId) return { id: runId, repository: { full_name: expected.repository, id: 1281544268, owner: { id: 18681616 } }, head_repository: { full_name: expected.repository },
        event: "workflow_dispatch", path: WORKFLOW, head_branch: "main", head_sha: controller, workflow_id: 300, status: "in_progress", conclusion: null, run_attempt: Number(environment.GITHUB_RUN_ATTEMPT) }
      if (endpoint === "actions/workflows/publish-npm.yml") return { id: 300, path: WORKFLOW }
      if (endpoint === "actions/runs/900/jobs?filter=all&per_page=100&page=1") return { total_count: state.jobs.length, jobs: structuredClone(state.jobs) }
      if (endpoint === "actions/runs/900/artifacts?per_page=100&page=1") return { total_count: state.artifacts.length, artifacts: structuredClone(state.artifacts) }
      if (endpoint === "git/ref/tags/lotus-next-v2026.10.99") return structuredClone(state.ref)
      if (endpoint === "git/tags/" + tagId) return structuredClone(state.tag)
      if (endpoint === "releases/tags/lotus-next-v2026.10.99") return structuredClone(state.release)
      if (endpoint === "releases/700/assets?per_page=100&page=1") return structuredClone(state.assets)
      throw new Error("Unexpected release read: " + endpoint)
    },
    write: (method, endpoint, body) => {
      state.writes.push({ method, endpoint, body: structuredClone(body) })
      if (method === "POST" && endpoint === "git/tags") return state.tag = { sha: tagId, tag: body.tag, message: body.message, object: { sha: body.object, type: body.type } }
      if (method === "POST" && endpoint === "git/refs") return state.ref = { ref: body.ref, object: { sha: body.sha, type: "tag" } }
      if (method === "POST" && endpoint === "releases") return state.release = { ...body, id: 700, created_at: clock(2) }
      if (method === "PATCH" && endpoint === "releases/700") return Object.assign(state.release, body)
      throw new Error("Unexpected release write")
    },
    upload: (release, name, data) => {
      assert.equal(release, 700); state.writes.push({ upload: name })
      const item = { id: 800 + state.assets.length, name, size: data.length, digest: "sha256:" + sha256(data), state: "uploaded" }
      state.assets.push(item); state.binary.set("releases/assets/" + item.id, Buffer.from(data)); return item
    },
    binary: (endpoint) => { const data = state.binary.get(endpoint); assert.ok(data, "Missing remote bytes"); return Buffer.from(data) },
    registry: () => state.registry,
    publish: (data) => { state.publishes += 1; assert.deepEqual(data, tarball); state.registry = registryRecord(data, Number(environment.GITHUB_RUN_ATTEMPT)) },
  }
  const context = { expected, feature, controlRoot, controllerRoot: controlRoot, environment }
  const lifecycle = () => createLifecycle(context, ports)
  const finish = (value, names, start = 0, end = 3) => {
    Object.assign(value, { status: "completed", conclusion: "success", started_at: clock(start), completed_at: clock(end),
      steps: names.map((name, index) => ({ name, number: index + 1, status: "completed", conclusion: "success", started_at: clock(start + index * 2), completed_at: clock(start + index * 2 + 1) })) })
    return value
  }
  const beginBuild = () => { finish(prepared, [STEPS.reserve]); environment.GITHUB_JOB = "build"; const build = job(JOBS.build, 2001); state.jobs.push(build); return build }
  const built = async () => {
    await lifecycle().reserve(); const build = beginBuild()
    finish(build, [STEPS.select, STEPS.build, STEPS.pack, STEPS.upload], 4, 20)
    const inner = seal(tarball, expected, { controllerRevision: controller, runId, attempt, jobId: build.id })
    const raw = outerZip({ "original.zip": inner.bytes }), artifact = { id: 501, name: "lotus-next-original-900-" + attempt,
      digest: "sha256:" + sha256(raw), size_in_bytes: raw.length, expired: false, created_at: clock(11), workflow_run: { id: runId, head_sha: controller } }
    state.artifacts.push(artifact); state.binary.set("actions/artifacts/501/zip", raw)
    const finalizer = job(JOBS.finalize, 3001)
    finalizer.started_at = clock(21)
    finalizer.steps = [{ name: STEPS.publish, number: 1, status: "in_progress", conclusion: null, started_at: clock(21), completed_at: null }]
    state.jobs.push(finalizer); environment.GITHUB_JOB = "finalize"
    return { build, artifact, raw, finalizer }
  }
  return { source, state, ports, context, environment, lifecycle, prepared, job, finish, beginBuild, built }
}

function registryRecord(data = tarball, attempt = 1) {
  const archive = inspectArchive(data, expected), slsa = "https://slsa.dev/provenance/v1"
  const statement = { _type: "https://in-toto.io/Statement/v1", predicateType: slsa,
    subject: [{ name: "pkg:npm/%40bigduu/lotus-next@" + expected.version, digest: { sha512: Buffer.from(archive.integrity.slice(7), "base64").toString("hex") } }],
    predicate: { buildDefinition: { buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
      externalParameters: { workflow: { ref: "refs/heads/main", repository: "https://github.com/" + expected.repository, path: WORKFLOW } },
      internalParameters: { github: { event_name: "workflow_dispatch", repository_id: "1281544268", repository_owner_id: "18681616" } },
      resolvedDependencies: [{ uri: "git+https://github.com/" + expected.repository + "@refs/heads/main", digest: { gitCommit: controller } }] },
    runDetails: { builder: { id: "https://github.com/actions/runner/github-hosted" }, metadata: { invocationId: "https://github.com/" + expected.repository + "/actions/runs/900/attempts/" + attempt } } } }
  return { archive: Buffer.from(data), metadata: { name: "@bigduu/lotus-next", version: expected.version,
    dist: { tarball: "https://registry.npmjs.org/@bigduu/lotus-next/-/lotus-next-" + expected.version + ".tgz", shasum: archive.shasum,
      integrity: archive.integrity, attestations: { provenance: { predicateType: slsa } } } },
  attestations: { attestations: [{ predicateType: slsa, bundle: { dsseEnvelope: { payloadType: "application/vnd.in-toto+json", payload: bytes(statement).toString("base64") } } }] } }
}

const beforeBuildFailure = (job) => Object.assign(job, { status: "completed", conclusion: "failure", started_at: clock(4), completed_at: clock(7),
  steps: [STEPS.select, "Install locked controller dependencies", STEPS.build, STEPS.pack, STEPS.upload].map((name, index) => ({
    name, number: index + 1, status: "completed", conclusion: index === 0 ? "success" : index === 1 ? "failure" : "skipped",
    // GitHub also represents skipped steps with non-null zero-duration placeholders.
    started_at: clock(index < 2 ? 4 + index : 7), completed_at: clock(index < 2 ? 5 + index : 7),
  })) })

describe("single frozen npm original lifecycle with the real Source454 verifier", () => {
  it("requires the real source verifier dependencies rather than an approving callback or raw token fallback", () => {
    const f = sample(); f.ports.guard = () => true; f.ports.registryToken = "synthetic-token"
    for (const source of [undefined, {}, { request: () => true }]) {
      f.ports.source = source; assert.throws(f.lifecycle, /Missing real Source/)
    }
    assert.equal(f.state.writes.length, 0)
  })
  it("reserves one explicit version and plans the only initial build from actual API job identity", async () => {
    const f = sample(); const reserved = await f.lifecycle().reserve()
    assert.equal(reserved.intent.runId, runId); assert.equal(reserved.intent.origin.jobId, 1001)
    assert.deepEqual(f.state.writes.map(value => value.endpoint), ["git/tags", "git/refs", "releases"])
    f.beginBuild(); const plan = f.lifecycle().planBuild()
    assert.equal(plan.mode, "build"); assert.deepEqual(plan.origin, { controllerRevision: controller, runId, attempt: 1, jobId: 2001 })
  })
  it("rechecks the actual frozen source before every write and stops at the first changed ref", async () => {
    const f = sample(), original = f.ports.write
    f.ports.write = (...args) => { const result = original(...args); f.source.frozen = "f".repeat(40); return result }
    await assert.rejects(() => f.lifecycle().reserve(), /Frozen cut/)
    assert.equal(f.state.writes.length, 1)
  })
  it("reads back the new tag object before creating a public ref", async () => {
    const f = sample(), write = f.ports.write
    f.ports.write = (...args) => { const value = write(...args); f.state.tag.object.sha = "a".repeat(40); return value }
    await assert.rejects(() => f.lifecycle().reserve()); assert.equal(f.state.writes.length, 1); assert.equal(f.state.ref, null)
  })
  it("refuses unknown or contradictory live API identities before any mutation", async () => {
    for (const fault of ["run", "job", "id"]) {
      const f = sample(), read = f.ports.read
      f.ports.read = endpoint => {
        const result = read(endpoint)
        if (fault === "run" && endpoint === "actions/runs/900") result.status = "unknown"
        if (endpoint.includes("jobs?")) {
          if (fault === "job") result.jobs[0].conclusion = "failure"
          if (fault === "id") result.jobs[0].id = "1001"
        }
        return result
      }
      await assert.rejects(() => f.lifecycle().reserve()); assert.equal(f.state.writes.length, 0)
    }
  })
  it("retains the official outer ZIP byte for byte and verifies its private Release readback", async () => {
    const f = sample(), original = await f.built(), value = await f.lifecycle().retainOriginal()
    assert.equal(value.publicationAuthorized, false); assert.deepEqual(value.bytes, original.raw)
    assert.equal(value.asset.digest, original.artifact.digest); assert.equal(value.sealed.proof.origin.jobId, 2001)
    assert.deepEqual(value.sealed.archive, tarball)
    const writes = f.state.writes.length
    assert.deepEqual((await f.lifecycle().retainOriginal()).bytes, original.raw); assert.equal(f.state.writes.length, writes)
  })
  it("recovers an uncertain asset upload only by exact original readback", async () => {
    const f = sample(); await f.built(); const upload = f.ports.upload
    f.ports.upload = (...args) => { upload(...args); throw new Error("original upload response lost") }
    assert.equal((await f.lifecycle().retainOriginal()).asset.id, 800)
  })
  it("never treats a denied Source guard as an uncertain remote write", async () => {
    const f = sample(), value = await f.built(), read = f.ports.read; let assetReads = 0
    f.ports.read = endpoint => {
      const result = read(endpoint)
      if (endpoint.includes("releases/700/assets?")) {
        assetReads += 1
        if (assetReads === 2) f.source.frozen = "f".repeat(40)
        if (assetReads > 2) {
          f.state.binary.set("releases/assets/800", value.raw)
          return [{ id: 800, name: assetName(expected), state: "uploaded", digest: value.artifact.digest, size: value.raw.length }]
        }
      }
      return result
    }
    const writes = f.state.writes.length
    await assert.rejects(() => f.lifecycle().retainOriginal(), /Frozen cut/)
    assert.equal(assetReads, 2); assert.equal(f.state.writes.length, writes)
  })
  it("reuses the earliest real execution after GitHub copies success to a different job ID/attempt", async () => {
    const f = sample(), original = await f.built(); await f.lifecycle().retainOriginal()
    f.finish(original.finalizer, [STEPS.publish], 21, 25)
    f.environment.GITHUB_RUN_ATTEMPT = "2"
    for (const item of [f.prepared, original.build]) f.state.jobs.push({ ...structuredClone(item), id: item.id + 10000, run_attempt: 2 })
    f.state.jobs.push(f.job(JOBS.finalize, 3002, 2))
    const value = f.lifecycle().readOriginal()
    assert.equal(value.physical.id, 2001); assert.equal(value.logical.id, 12001); assert.equal(value.sealed.proof.origin.attempt, 1)
  })
  it("selects originals before a full-workflow rerun can enter any compiler or packer", async () => {
    const f = sample(), original = await f.built(); await f.lifecycle().retainOriginal()
    f.finish(original.finalizer, [STEPS.publish], 21, 25); original.finalizer.conclusion = "failure"
    f.environment.GITHUB_RUN_ATTEMPT = "2"; f.environment.GITHUB_JOB = "build"
    const prep = f.finish(f.job(JOBS.prepare, 1002, 2), [STEPS.reserve])
    f.state.jobs.push(prep, f.job(JOBS.build, 2002, 2))
    assert.equal(f.lifecycle().planBuild().mode, "restore")
    assert.equal(f.lifecycle().restoreBuild().sealed.proof.origin.jobId, original.build.id)
  })
  for (const [label, mutate] of [
    ["foreign run", f => { f.context.environment = { ...f.environment, GITHUB_RUN_ID: "901" } }],
    ["foreign controller", f => { f.context.environment = { ...f.environment, GITHUB_WORKFLOW_SHA: "a".repeat(40) } }],
    ["foreign reservation job", f => { const body = JSON.parse(f.state.release.body); body.origin.jobId = 999; f.state.release.body = JSON.stringify(body); f.state.tag.message = JSON.stringify(body) + "\n" }],
    ["missing artifact", f => { f.state.artifacts = [] }], ["expired without retained bytes", f => { f.state.artifacts[0].expired = true }],
    ["wrong digest", f => { f.state.artifacts[0].digest = "sha256:" + "0".repeat(64) }],
    ["wrong physical time", f => { f.state.artifacts[0].created_at = clock(3) }],
    ["failed original job", (f, value) => { value.build.conclusion = "failure" }],
    ["failed selected step", (f, value) => { value.build.steps[1].conclusion = "failure" }],
    ["duplicate selected step", (f, value) => { value.build.steps.push({ ...value.build.steps[1], number: 99 }) }],
  ]) it("stops without writing or rebuilding on " + label, async () => {
    const f = sample(), value = await f.built(); mutate(f, value); const count = f.state.writes.length
    assert.throws(() => f.lifecycle().readOriginal()); assert.equal(f.state.writes.length, count)
  })
  it("does not search past a newer logical failure for an old successful build", async () => {
    const f = sample(), value = await f.built(); f.environment.GITHUB_RUN_ATTEMPT = "2"
    f.state.jobs.push({ ...structuredClone(value.build), id: 2002, run_attempt: 2, conclusion: "failure" })
    assert.throws(() => f.lifecycle().readOriginal())
  })
  it("rejects truncated/duplicated API pages and in-progress original execution", async () => {
    for (const fault of ["total", "duplicate", "pending"]) {
      const f = sample(), value = await f.built(), read = f.ports.read
      f.ports.read = endpoint => {
        const result = read(endpoint)
        if (endpoint.includes("jobs?")) {
          if (fault === "total") result.total_count += 1
          if (fault === "duplicate") { result.jobs.push(result.jobs[0]); result.total_count += 1 }
          if (fault === "pending") value.build.status = result.jobs[1].status = "in_progress"
        }
        return result
      }
      assert.throws(() => f.lifecycle().readOriginal())
    }
  })
  it("never replaces a missing successful ZIP with a new build, even on the original run", async () => {
    const f = sample(), value = await f.built(); f.finish(value.finalizer, [STEPS.publish], 21, 25); value.finalizer.conclusion = "failure"
    f.state.binary.delete("actions/artifacts/501/zip")
    f.environment.GITHUB_RUN_ATTEMPT = "2"; f.environment.GITHUB_JOB = "build"; f.state.jobs.push(f.finish(f.job(JOBS.prepare, 1002, 2), [STEPS.reserve]), f.job(JOBS.build, 2002, 2))
    assert.throws(() => f.lifecycle().planBuild(), /Missing remote bytes/)
  })
  it("uses a retained copy after raw Actions download expires only while its official metadata still authenticates the same bytes", async () => {
    const f = sample(), value = await f.built(); await f.lifecycle().retainOriginal()
    value.artifact.expired = true; f.state.binary.delete("actions/artifacts/501/zip")
    assert.deepEqual(f.lifecycle().readOriginal().bytes, value.raw)
    f.state.binary.set("releases/assets/800", Buffer.from("changed")); assert.throws(() => f.lifecycle().readOriginal())
    assert.equal(f.state.assets[0].name, assetName(expected))
  })
  it("publishes only retained bytes and emits one bounded completion frame with original IDs", async () => {
    const f = sample(); await f.built()
    const result = await f.lifecycle().publishRetained()
    assert.equal(f.state.publishes, 1); assert.equal(f.state.release.draft, false)
    assert.equal(f.state.assets.length, 2); assert.equal(result.publicationAuthorized, false)
    assert.equal(result.completion.registry.workflowSha, controller); assert.notEqual(controller, S)
    assert.equal(result.completion.registry.cryptographicVerification, false)
    assert.ok(result.frame.length < 32768 && result.frame.startsWith("LOTUS_NPM_COMPLETION_V1 "))
    const frame = JSON.parse(Buffer.from(result.frame.split(" ")[1], "base64"))
    assert.equal(frame.jobId, 3001); assert.equal(frame.originalArtifactId, 501); assert.equal(frame.originalAssetId, 800)
    assert.equal(frame.completionAssetId, 801); assert.equal(frame.completionDigest, f.state.assets[1].digest)
  })
  it("recovers a lost npm response using the registry rather than a second publish", async () => {
    const f = sample(); await f.built(); const publish = f.ports.publish
    f.ports.publish = (...args) => { publish(...args); throw new Error("npm response lost") }
    await f.lifecycle().publishRetained(); assert.equal(f.state.publishes, 1)
  })
  it("reuses completion on a finalizer retry without publish or asset overwrite", async () => {
    const f = sample(), value = await f.built(), first = await f.lifecycle().publishRetained()
    f.finish(value.finalizer, [STEPS.publish], 21, 25); value.finalizer.conclusion = "failure"
    f.environment.GITHUB_RUN_ATTEMPT = "2"
    const next = f.job(JOBS.finalize, 3002, 2)
    next.steps = [{ name: STEPS.publish, number: 1, status: "in_progress", conclusion: null, started_at: clock(26), completed_at: null }]
    f.state.jobs.push(next); const count = f.state.writes.length
    const second = await f.lifecycle().publishRetained()
    assert.equal(f.state.publishes, 1); assert.equal(f.state.writes.length, count)
    assert.deepEqual(second.completion, first.completion); assert.notEqual(second.frame, first.frame)
  }, 15000)
  it("rechecks Source even when completion reuse requires no remote writes", async () => {
    const f = sample(); await f.built(); await f.lifecycle().publishRetained(); const binary = f.ports.binary, count = f.state.writes.length
    f.ports.binary = endpoint => { const data = binary(endpoint); if (endpoint === "releases/assets/801") f.source.frozen = "f".repeat(40); return data }
    await assert.rejects(() => f.lifecycle().publishRetained(), /Frozen cut/); assert.equal(f.state.writes.length, count)
  }, 15000)
  it("refuses an unknown previous npm outcome when the exact registry version is still missing", async () => {
    const f = sample(), value = await f.built(); await f.lifecycle().retainOriginal()
    f.finish(value.finalizer, [STEPS.publish], 21, 25); value.finalizer.conclusion = "failure"
    f.environment.GITHUB_RUN_ATTEMPT = "2"
    const next = f.job(JOBS.finalize, 3002, 2); next.steps[0].name = STEPS.publish; f.state.jobs.push(next)
    await assert.rejects(() => f.lifecycle().publishRetained(), /Unknown prior publication/)
    assert.equal(f.state.publishes, 0)
  })
  it("does not send npm bytes after the source changes during original retention", async () => {
    const f = sample(); await f.built(); const upload = f.ports.upload
    f.ports.upload = (...args) => { const result = upload(...args); f.source.frozen = "f".repeat(40); return result }
    await assert.rejects(() => f.lifecycle().publishRetained(), /Frozen cut/); assert.equal(f.state.publishes, 0)
    assert.equal(f.state.assets.length, 1)
  })
  for (const [label, mutate] of [
    ["registry bytes", record => { record.archive = Buffer.from("foreign") }],
    ["metadata digest", record => { record.metadata.dist.integrity = "foreign" }],
    ["foreign tar URL", record => { record.metadata.dist.tarball = "https://example.invalid/foreign.tgz" }],
    ["foreign workflow C", record => { const envelope = record.attestations.attestations[0].bundle.dsseEnvelope, statement = JSON.parse(Buffer.from(envelope.payload, "base64"));
      statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = S; envelope.payload = bytes(statement).toString("base64") }],
  ]) it("refuses " + label + " without treating data as Main authority", async () => {
    const f = sample(); await f.built(); f.state.registry = registryRecord(); mutate(f.state.registry)
    await assert.rejects(() => f.lifecycle().publishRetained()); assert.equal(f.state.publishes, 0); assert.equal(f.state.release.draft, true)
  })
  it("planning retries only the first build after known pre-build infra failure with complete skipped core records", async () => {
    const f = sample(); await f.lifecycle().reserve(); const failed = beforeBuildFailure(f.beginBuild())
    f.environment.GITHUB_RUN_ATTEMPT = "2"
    f.state.jobs.push(f.finish(f.job(JOBS.prepare, 1002, 2), [STEPS.reserve]), f.job(JOBS.build, 2002, 2))
    assert.equal(f.lifecycle().planBuild().mode, "build")
    for (const index of [2, 3, 4]) for (const state of ["missing", "pending", "failure", "success"]) {
      const original = structuredClone(failed.steps)
      if (state === "missing") failed.steps.splice(index, 1)
      else { failed.steps[index].conclusion = state; if (state === "pending") failed.steps[index].status = "in_progress" }
      assert.throws(() => f.lifecycle().planBuild(), state); failed.steps = original
    }
    f.state.artifacts.push({ id: 502, name: "lotus-next-original-900-1" })
    assert.throws(() => f.lifecycle().planBuild(), /Existing original/)
    f.state.artifacts = []; f.state.assets.push({ id: 800, name: assetName(expected) })
    assert.throws(() => f.lifecycle().planBuild(), /Existing retained/)
  })
  it("planning restores an existing successful original across a later selector failure and never returns build", async () => {
    const f = sample(), value = await f.built(); await f.lifecycle().retainOriginal()
    f.finish(value.finalizer, [STEPS.publish], 21, 25); value.finalizer.conclusion = "failure"
    const failed = beforeBuildFailure(f.job(JOBS.build, 2002, 2)); failed.steps[0].conclusion = "failure"
    f.state.jobs.push(f.finish(f.job(JOBS.prepare, 1002, 2), [STEPS.reserve]), failed,
      f.finish(f.job(JOBS.prepare, 1003, 3), [STEPS.reserve]), f.job(JOBS.build, 2003, 3))
    f.environment.GITHUB_RUN_ATTEMPT = "3"; f.environment.GITHUB_JOB = "build"
    assert.equal(f.lifecycle().planBuild().mode, "restore")
    assert.equal(f.lifecycle().restoreBuild().physical.id, value.build.id)
    assert.throws(() => f.lifecycle().readOriginal(), "finalizer still requires the latest whole job to succeed")
    failed.steps[2].conclusion = "failure"
    assert.throws(() => f.lifecycle().planBuild(), "an actual later build failure must remain visible")
    failed.steps[2].conclusion = "skipped"
    f.state.artifacts = []; assert.throws(() => f.lifecycle().planBuild(), "missing original must never fall back to build")
  })
  it("accepts skipped publish placeholders as proof no previous publish executed", async () => {
    const f = sample(), value = await f.built(); await f.lifecycle().retainOriginal()
    f.finish(value.finalizer, [STEPS.publish], 21, 25); value.finalizer.conclusion = "failure"
    Object.assign(value.finalizer.steps[0], { conclusion: "skipped", started_at: clock(25), completed_at: clock(25) })
    f.environment.GITHUB_RUN_ATTEMPT = "2"
    const next = f.job(JOBS.finalize, 3002, 2); next.steps[0].name = STEPS.publish; f.state.jobs.push(next)
    const originalSteps = structuredClone(value.finalizer.steps)
    for (const state of ["missing", "pending", "failure", "success"]) {
      value.finalizer.steps = structuredClone(originalSteps)
      if (state === "missing") value.finalizer.steps = []
      else { value.finalizer.steps[0].conclusion = state; if (state === "pending") value.finalizer.steps[0].status = "in_progress" }
      await assert.rejects(() => f.lifecycle().publishRetained()); assert.equal(f.state.publishes, 0)
    }
    value.finalizer.steps = originalSteps
    await f.lifecycle().publishRetained(); assert.equal(f.state.publishes, 1)
  })
  it("never borrows an active API job from another GITHUB_JOB phase to authorize a write", async () => {
    const f = sample(); await f.built(); f.environment.GITHUB_JOB = "build"
    const writes = f.state.writes.length
    await assert.rejects(() => f.lifecycle().retainOriginal(), /GITHUB_JOB|phase/)
    assert.equal(f.state.writes.length, writes)
  })
  it("CLI phase routing uses the real controller and Source454 guard before each write", async () => {
    const f = sample(), write = f.ports.write, output = mkdtempSync(path.join(root, "phase-"))
    f.ports.write = (...args) => { const result = write(...args); f.source.frozen = "f".repeat(40); return result }
    await assert.rejects(() => runPhase("reserve", { ...f.context, output }, f.ports), /Frozen cut/)
    assert.equal(f.state.writes.length, 1)
    for (const command of ["build", "pack", "install", "restore", "select", "finalize"]) {
      await assert.rejects(() => runPhase(command, { ...f.context, output }, f.ports), /GITHUB_JOB/)
    }
    assert.equal(f.state.writes.length, 1)
  })
  it("uses standard gh HTTP status and raw input/output ports without repacking original ZIP bytes", () => {
    const output = mkdtempSync(path.join(root, "gh-wire-")), calls = []
    const ports = controllerPorts({ output, environment: { ...safeEnv, GH_TOKEN: "fixture-github-credential", NODE_OPTIONS: "untrusted" },
      execute: (program, args, options) => {
        calls.push({ program, args, options })
        if (args.includes("--allow-escape-sequences")) return { status: 0, stdout: tarball }
        const missing = args[1].endsWith("/missing")
        return { status: missing ? 1 : 0, stdout: Buffer.from("HTTP/2.0 " + (missing ? "404 Not Found" : "201 Created") + "\r\nContent-Type: application/json\r\n\r\n" + JSON.stringify(missing ? { message: "Not Found" } : { id: 8 })) }
      } })
    assert.equal(ports.read("missing"), null)
    assert.deepEqual(ports.upload(700, "original.zip", tarball), { id: 8 })
    assert.deepEqual(ports.binary("actions/artifacts/501/zip"), tarball)
    assert.equal(calls[1].program, "gh"); assert.ok(calls[1].args[1].startsWith("https://uploads.github.com/repos/bigduu/lotus-next/releases/700/assets?name="))
    assert.deepEqual(calls[1].options.input, tarball); assert.ok(calls[1].args.includes("--input"))
    assert.equal(calls[1].options.env.GH_TOKEN, "fixture-github-credential"); assert.equal(calls[1].options.env.NODE_OPTIONS, undefined)
    assert.ok(calls[2].args.includes("Accept: application/octet-stream"))
  })
  it("the standard npm port isolates config and credentials and publishes only the exact original tgz", () => {
    const output = mkdtempSync(path.join(root, "npm-wire-")), calls = []
    const environment = { ...safeEnv, GITHUB_JOB: "finalize", NODE_AUTH_TOKEN: "fixture-npm-credential", GH_TOKEN: "fixture-github-credential",
      ACTIONS_ID_TOKEN_REQUEST_URL: "https://fixture.invalid/oidc", ACTIONS_ID_TOKEN_REQUEST_TOKEN: "fixture-oidc-credential",
      GITHUB_RUNTIME_TOKEN: "forbidden", NODE_OPTIONS: "--require forbidden", NODE_PATH: "/forbidden", GIT_DIR: "/forbidden", NPM_CONFIG_USERCONFIG: "/forbidden" }
    const ports = controllerPorts({ output, environment, execute: (program, args, options) => { calls.push({ program, args, options }); return { status: 0, stdout: "{}" } } })
    ports.npm(["ci", "--ignore-scripts"], controlRoot)
    for (const key of ["GH_TOKEN", "NODE_AUTH_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_TOKEN", "GITHUB_RUNTIME_TOKEN", "NODE_OPTIONS", "NODE_PATH", "GIT_DIR"])
      assert.equal(calls[0].options.env[key], undefined, key)
    ports.publish(tarball, expected)
    const call = calls[1]
    assert.deepEqual(call.args, ["publish", path.join(output, "bigduu-lotus-next-2026.10.99.tgz"), "--ignore-scripts", "--provenance", "--access", "public", "--registry=https://registry.npmjs.org"])
    assert.deepEqual(readFileSync(call.args[1]), tarball); assert.equal(call.options.cwd, output)
    assert.equal(call.options.env.NODE_AUTH_TOKEN, environment.NODE_AUTH_TOKEN)
    assert.equal(call.options.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN, environment.ACTIONS_ID_TOKEN_REQUEST_TOKEN)
    for (const key of ["GH_TOKEN", "GITHUB_RUNTIME_TOKEN", "NODE_OPTIONS", "NODE_PATH", "GIT_DIR"]) assert.equal(call.options.env[key], undefined)
    assert.equal(readFileSync(call.options.env.NPM_CONFIG_USERCONFIG, "utf8"), "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n")
    assert.equal(readFileSync(call.options.env.NPM_CONFIG_GLOBALCONFIG, "utf8"), "")
    environment.GITHUB_JOB = "build"; assert.throws(() => ports.publish(tarball, expected), /finalizer/)
    assert.equal(calls.length, 2)
  })
  it("reads the exact registry metadata, archive and provenance endpoints with no credentialed redirect", async () => {
    const output = mkdtempSync(path.join(root, "registry-wire-")), record = registryRecord(), calls = []
    record.metadata.dist.attestations.url = "https://registry.npmjs.org/-/npm/v1/attestations/@bigduu%2flotus-next@2026.10.99"
    const ports = controllerPorts({ output, environment: safeEnv, fetchImpl: async (url, options) => {
      calls.push({ url, options })
      const bytes = url.endsWith(".tgz") ? tarball : url.includes("/attestations/") ? Buffer.from(JSON.stringify(record.attestations)) : Buffer.from(JSON.stringify(record.metadata))
      return { status: 200, body: [bytes] }
    } })
    assert.deepEqual(await ports.registry(expected, false), record)
    assert.equal(calls.length, 3); assert.equal(calls[0].url, "https://registry.npmjs.org/@bigduu%2flotus-next/2026.10.99")
    for (const call of calls) { assert.equal(call.options.redirect, "error"); assert.equal(call.options.headers, undefined) }
  })
})
