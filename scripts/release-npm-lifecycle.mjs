// One reserved run/controller owns this output lifecycle. Data records are not
// Source or Main authority: every mutation re-enters the real source verifier.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { appendFileSync, existsSync, lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, URL } from "node:url"
import { admitFrozenDev, executionKey, requireController, requireProduct, zipFiles } from "./frozen-dev-source.mjs"
import { assetName, inputs, REPOSITORY, seal, unseal, verifyPackResult } from "./release-npm-original.mjs"

export const WORKFLOW = ".github/workflows/publish-npm.yml"
export const JOBS = Object.freeze({ prepare: "Reserve frozen npm release", build: "Produce original npm archive", finalize: "Publish retained npm archive" })
export const STEPS = Object.freeze({ reserve: "Reserve source and version", select: "Select original npm build", build: "Build final dist once", pack: "Pack and statically verify once", upload: "Retain original npm archive", restore: "Restore original npm archive", publish: "Publish original npm archive" })
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex")
const integer = (value) => { assert.ok(Number.isSafeInteger(value) && value > 0); return value }
const same = (left, right) => assert.deepEqual(left, right)
const timestamp = (value) => { const number = Date.parse(value); assert.ok(Number.isFinite(number)); return number }
const encode = (value) => {
  const bytes = Buffer.from(JSON.stringify(value))
  assert.ok(bytes.length <= 32768, "Bounded release record required")
  return bytes
}
const step = (job, name) => {
  const rows = job.steps.filter((value) => value.name === name)
  assert.equal(rows.length, 1, "Missing or ambiguous step: " + name)
  return rows[0]
}
const success = (value) => { assert.equal(value.status, "completed"); assert.equal(value.conclusion, "success") }
const skipped = (job, names) => names.every(name => {
  const value = step(job, name)
  integer(value.number)
  return value.status === "completed" && value.conclusion === "skipped"
})
const core = [STEPS.build, STEPS.pack, STEPS.upload]

function registryIdentity(record, original, expected, controller, runId, attempt, repository) {
  assert.ok(record && Buffer.isBuffer(record.archive)); same(record.archive, original.sealed.archive)
  const metadata = record.metadata, archive = original.sealed.proof.archive, slsa = "https://slsa.dev/provenance/v1"
  assert.equal(metadata.name, "@bigduu/lotus-next"); assert.equal(metadata.version, expected.version)
  assert.equal(metadata.dist.shasum, archive.shasum); assert.equal(metadata.dist.integrity, archive.integrity)
  const tar = new URL(metadata.dist.tarball)
  assert.equal(tar.origin, "https://registry.npmjs.org"); assert.ok(!tar.username && !tar.password && !tar.search && !tar.hash)
  assert.equal(decodeURIComponent(tar.pathname), "/@bigduu/lotus-next/-/lotus-next-" + expected.version + ".tgz")
  assert.equal(metadata.dist.attestations.provenance.predicateType, slsa)
  const matches = record.attestations.attestations.filter(value => value.predicateType === slsa)
  assert.equal(matches.length, 1)
  const envelope = matches[0].bundle.dsseEnvelope
  assert.equal(envelope.payloadType, "application/vnd.in-toto+json")
  assert.ok(typeof envelope.payload === "string" && envelope.payload.length <= 1024 * 1024)
  const payload = Buffer.from(envelope.payload, "base64"); assert.equal(payload.toString("base64"), envelope.payload)
  const statement = JSON.parse(payload)
  assert.equal(statement._type, "https://in-toto.io/Statement/v1"); assert.equal(statement.predicateType, slsa)
  same(statement.subject, [{ name: "pkg:npm/%40bigduu/lotus-next@" + expected.version,
    digest: { sha512: Buffer.from(archive.integrity.slice(7), "base64").toString("hex") } }])
  const build = statement.predicate.buildDefinition
  assert.equal(build.buildType, "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1")
  same(build.externalParameters.workflow, { ref: "refs/heads/main", repository: "https://github.com/" + REPOSITORY, path: WORKFLOW })
  assert.equal(build.internalParameters.github.event_name, "workflow_dispatch")
  assert.equal(build.internalParameters.github.repository_id, String(integer(repository.id)))
  assert.equal(build.internalParameters.github.repository_owner_id, String(integer(repository.owner.id)))
  same(build.resolvedDependencies, [{ uri: "git+https://github.com/" + REPOSITORY + "@refs/heads/main", digest: { gitCommit: controller } }])
  assert.equal(statement.predicate.runDetails.builder.id, "https://github.com/actions/runner/github-hosted")
  const invocationId = statement.predicate.runDetails.metadata.invocationId
  const prefix = "https://github.com/" + REPOSITORY + "/actions/runs/" + runId + "/attempts/"
  assert.ok(invocationId.startsWith(prefix)); const originAttempt = integer(Number(invocationId.slice(prefix.length)))
  assert.equal(invocationId, prefix + originAttempt); assert.ok(originAttempt <= attempt)
  return { sha256: archive.sha256, shasum: archive.shasum, integrity: archive.integrity, invocationId,
    publicationAttempt: originAttempt, workflowSha: controller, payloadSha256: hash(payload), cryptographicVerification: false }
}

export function createLifecycle({ expected, feature, controllerRoot, environment = process.env }, ports) {
  for (const name of ["read", "write", "upload", "binary", "registry"]) assert.equal(typeof ports[name], "function", "Missing lifecycle port: " + name)
  for (const name of ["request", "artifactBytes"]) assert.equal(typeof ports.source?.[name], "function", "Missing real Source verifier dependency: " + name)
  expected = structuredClone(inputs(expected)); feature = structuredClone(feature)
  same(Object.keys(feature).sort(), ["attempt", "pullRequest", "runId"])
  for (const value of Object.values(feature)) integer(value)
  const controller = requireController(environment, controllerRoot)
  for (const key of ["GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT"]) assert.match(environment[key], /^[1-9][0-9]*$/u)
  const runId = integer(Number(environment.GITHUB_RUN_ID)), attempt = integer(Number(environment.GITHUB_RUN_ATTEMPT))
  const tag = "lotus-next-v" + expected.version, completionName = "lotus-next-publication-" + expected.version + ".json"
  const read = (path) => { const value = ports.read(path); assert.notEqual(value, undefined, "Unknown GitHub state"); return value }
  const source = () => {
    assert.equal(requireController(environment, controllerRoot), controller)
    const value = admitFrozenDev({ source: expected.sourceRevision, ...feature }, ports.source)
    assert.equal(value.tree, expected.sourceTree)
    return value
  }
  const run = () => {
    const value = read("actions/runs/" + runId), workflow = read("actions/workflows/publish-npm.yml")
    assert.equal(value.id, runId); assert.equal(value.repository.full_name, REPOSITORY)
    assert.equal(value.head_repository.full_name, REPOSITORY); assert.equal(value.head_sha, controller)
    assert.equal(value.event, "workflow_dispatch"); assert.equal(value.path, WORKFLOW); assert.equal(value.head_branch, "main")
    assert.equal(value.workflow_id, integer(workflow.id)); assert.equal(workflow.path, WORKFLOW)
    assert.equal(value.run_attempt, attempt)
    assert.equal(value.status, "in_progress", "Publication controller is not currently running")
    assert.equal(value.conclusion, null)
    return value
  }
  const mutate = async (call, uncertain) => {
    source(); run() // A denied guard must never enter uncertain-write recovery.
    try { return await call() } catch (error) { if (!uncertain) throw error; return uncertain(error) }
  }
  const page = (endpoint, key) => {
    const rows = []; let total
    for (let number = 1; number <= 20; number++) {
      const reply = read(endpoint + (endpoint.includes("?") ? "&" : "?") + "per_page=100&page=" + number)
      const values = key ? reply?.[key] : reply
      assert.ok(Array.isArray(values) && values.length <= 100, "Incomplete API page")
      if (key) {
        assert.ok(Number.isSafeInteger(reply.total_count) && reply.total_count >= 0)
        total ??= reply.total_count; assert.equal(reply.total_count, total)
      }
      rows.push(...values)
      if (values.length < 100) {
        if (key) assert.equal(rows.length, total, "Truncated API evidence")
        assert.equal(new Set(rows.map((value) => integer(value.id))).size, rows.length)
        return rows
      }
    }
    throw new Error("Too many API pages")
  }
  const jobs = () => {
    run()
    const rows = page("actions/runs/" + runId + "/jobs?filter=all", "jobs")
    const labels = new Set()
    for (const job of rows) {
      assert.equal(job.run_id, runId); assert.equal(job.head_sha, controller)
      assert.ok(integer(job.run_attempt) <= attempt && Object.values(JOBS).includes(job.name))
      if (job.run_attempt < attempt) assert.equal(job.status, "completed", "Prior attempt is still running or unknown")
      assert.ok(!labels.has(job.name + "/" + job.run_attempt), "Duplicate logical job attempt")
      labels.add(job.name + "/" + job.run_attempt)
      assert.ok(Array.isArray(job.steps))
    }
    return rows
  }
  const currentJob = (name, rows = jobs()) => {
    assert.equal(JOBS[environment.GITHUB_JOB], name, "GITHUB_JOB does not own this lifecycle phase")
    const matches = rows.filter((job) => job.name === name && job.run_attempt === attempt)
    assert.equal(matches.length, 1); assert.equal(matches[0].status, "in_progress")
    assert.equal(matches[0].conclusion, null)
    timestamp(matches[0].started_at)
    return matches[0]
  }
  const annotation = (sha) => {
    const object = read("git/tags/" + sha)
    assert.equal(object.sha, sha); assert.equal(object.tag, tag)
    assert.equal(object.object.type, "commit"); assert.equal(object.object.sha, expected.sourceRevision)
    return object
  }
  const readTag = () => {
    const ref = read("git/ref/tags/" + tag)
    if (ref === null) return null
    assert.equal(ref.ref, "refs/tags/" + tag); assert.equal(ref.object.type, "tag")
    const object = annotation(ref.object.sha)
    return { ref, object }
  }
  const intent = (job) => ({ schemaVersion: 1, kind: "lotus-npm-reservation/v1", inputs: expected,
    controllerRevision: controller, runId, feature, origin: { jobId: job.id, attempt: job.run_attempt } })
  const owned = () => {
    const release = read("releases/tags/" + tag), ref = readTag()
    if (release === null) { assert.equal(ref, null, "Tag exists without an owned intent"); return null }
    integer(release.id); assert.ok(ref)
    const body = JSON.parse(release.body), origin = body.origin
    integer(origin?.jobId); assert.ok(integer(origin?.attempt) <= attempt)
    same(body, intent({ id: origin.jobId, run_attempt: origin.attempt }))
    assert.equal(release.tag_name, tag); assert.equal(release.prerelease, false)
    assert.equal(ref.object.message, encode(body).toString() + "\n")
    const owners = jobs().filter((job) => job.id === origin.jobId && job.name === JOBS.prepare && job.run_attempt === origin.attempt)
    assert.equal(owners.length, 1, "Reservation lacks its original API job")
    const owner = owners[0]
    if (owner.status !== "in_progress" || origin.attempt !== attempt) { success(owner); success(step(owner, STEPS.reserve)) }
    const created = timestamp(release.created_at)
    assert.ok(created >= timestamp(owner.started_at))
    if (owner.completed_at) assert.ok(created <= timestamp(owner.completed_at) + 1000)
    return { release, intent: body, tagObject: ref.object.sha }
  }
  const assets = (release) => {
    const rows = page("releases/" + release.id + "/assets")
    assert.ok(rows.length <= 2 && rows.every((asset) => [assetName(expected), completionName].includes(asset.name)), "Foreign release assets")
    assert.equal(new Set(rows.map((asset) => asset.name)).size, rows.length)
    return rows
  }
  const assetBytes = (asset, digest, size) => {
    assert.equal(asset.state, "uploaded"); assert.equal(asset.digest, digest); assert.equal(asset.size, size)
    const bytes = ports.binary("releases/assets/" + integer(asset.id))
    assert.ok(Buffer.isBuffer(bytes) && bytes.length === size && "sha256:" + hash(bytes) === digest, "Release asset readback differs")
    return bytes
  }
  const putAsset = async (release, name, bytes) => {
    assert.ok([assetName(expected), completionName].includes(name) && Buffer.isBuffer(bytes) && bytes.length > 0)
    assert.ok(bytes.length <= (name === completionName ? 32768 : 128 * 1024 * 1024))
    const digest = "sha256:" + hash(bytes)
    let asset = assets(release).find((value) => value.name === name)
    if (!asset) {
      let error
      await mutate(() => ports.upload(release.id, name, bytes), value => { error = value })
      asset = assets(release).find((value) => value.name === name)
      assert.ok(asset, "Unconfirmed asset upload: " + (error?.message ?? name))
    }
    same(assetBytes(asset, digest, bytes.length), bytes)
    return { id: asset.id, name, digest, size: bytes.length }
  }
  const producer = (rows, planning = false) => {
    const selected = rows.filter((job) => job.name === JOBS.build && !(planning && job.run_attempt === attempt))
    if (!selected.length) return null
    const logical = [...selected].sort((a, b) => b.run_attempt - a.run_attempt)[0]
    if (!planning) success(logical) // Finalization never hides the latest whole-job failure.
    const originals = selected.filter((job) => executionKey(job) !== null &&
      [STEPS.select, STEPS.build, STEPS.pack, STEPS.upload].every((name) => {
        const selected = step(job, name)
        return selected.status === "completed" && selected.conclusion === "success"
      }))
    if (!originals.length) {
      assert.ok(planning && selected.every(job => job.status === "completed" && job.conclusion === "failure" && skipped(job, core)),
        "No complete original build execution or conclusive pre-build failure")
      return null
    }
    const keys = new Set(originals.map(executionKey)); assert.equal(keys.size, 1, "More than one physical formal build")
    const physical = [...originals].sort((a, b) => a.run_attempt - b.run_attempt)[0]
    for (const job of selected) {
      if (executionKey(job) === executionKey(physical)) continue
      if (planning && job.status === "completed" && job.conclusion === "failure" && skipped(job, core)) continue
      success(job); success(step(job, STEPS.select)); success(step(job, STEPS.restore))
      assert.ok(skipped(job, core), "Restoration must not execute a compiler, packer or uploader")
      assert.ok(executionKey(job), "Incomplete restoration execution")
    }
    return { physical, logical, fingerprint: hash(executionKey(physical)) }
  }
  const original = (planning = false) => {
    const reservation = owned(); assert.ok(reservation, "Missing reservation")
    const selected = producer(jobs(), planning); assert.ok(selected, "Missing original build")
    const name = "lotus-next-original-" + runId + "-" + selected.physical.run_attempt
    const matches = page("actions/runs/" + runId + "/artifacts", "artifacts").filter((value) => value.name === name)
    assert.equal(matches.length, 1, "Missing or ambiguous successful original artifact")
    const artifact = matches[0]
    assert.equal(artifact.workflow_run.id, runId); assert.equal(artifact.workflow_run.head_sha, controller)
    assert.match(artifact.digest, /^sha256:[0-9a-f]{64}$/u)
    assert.ok(integer(artifact.size_in_bytes) <= 128 * 1024 * 1024)
    const time = timestamp(artifact.created_at)
    const upload = step(selected.physical, STEPS.upload)
    assert.ok(time >= timestamp(upload.started_at) && time <= timestamp(upload.completed_at) + 1000)
    const retained = assets(reservation.release).find((value) => value.name === assetName(expected))
    let bytes
    if (retained) bytes = assetBytes(retained, artifact.digest, artifact.size_in_bytes)
    else {
      assert.equal(artifact.expired, false, "Successful original expired without a retained copy")
      bytes = ports.binary("actions/artifacts/" + artifact.id + "/zip")
      assert.ok(Buffer.isBuffer(bytes) && bytes.length === artifact.size_in_bytes && "sha256:" + hash(bytes) === artifact.digest)
    }
    const files = zipFiles(bytes); same(Object.keys(files), ["original.zip"])
    const sealed = unseal(files["original.zip"], expected)
    same(sealed.proof.origin, { controllerRevision: controller, runId, attempt: selected.physical.run_attempt, jobId: selected.physical.id })
    return { ...reservation, ...selected, artifact, bytes, sealed, retained }
  }
  const reserve = async () => {
    source(); const job = currentJob(JOBS.prepare)
    const existing = owned()
    if (existing) return existing
    assert.equal(await ports.registry(expected, false), null, "Version is not proved unused")
    const body = intent(job)
    const object = await mutate(() => ports.write("POST", "git/tags", { tag, message: encode(body).toString() + "\n", object: expected.sourceRevision, type: "commit" }))
    assert.match(object?.sha, /^[0-9a-f]{40}$/u)
    assert.equal(annotation(object.sha).message, encode(body).toString() + "\n")
    // An unknown orphan tag-object response stops; no ref/Release is guessed.
    let refError
    await mutate(() => ports.write("POST", "git/refs", { ref: "refs/tags/" + tag, sha: object.sha }), error => { refError = error })
    const confirmed = readTag(); assert.ok(confirmed, "Unconfirmed tag reservation: " + (refError?.message ?? tag))
    assert.equal(confirmed.object.sha, object.sha); assert.equal(confirmed.object.message, encode(body).toString() + "\n")
    let releaseError
    await mutate(() => ports.write("POST", "releases", { tag_name: tag, target_commitish: expected.sourceRevision,
      name: "@bigduu/lotus-next@" + expected.version, body: encode(body).toString(), draft: true, prerelease: false }), error => { releaseError = error })
    const result = owned(); assert.ok(result, "Unconfirmed draft reservation: " + (releaseError?.message ?? tag))
    assert.equal(result.release.draft, true)
    return result
  }
  const planBuild = () => {
    source(); const reservation = owned(); assert.ok(reservation, "Missing reservation")
    const rows = jobs(), current = currentJob(JOBS.build, rows), selected = producer(rows, true)
    if (!selected) {
      assert.equal(assets(reservation.release).length, 0, "Existing retained output cannot be rebuilt")
      assert.ok(!page("actions/runs/" + runId + "/artifacts", "artifacts").some(value => value.name.startsWith("lotus-next-original-")),
        "Existing original output cannot be rebuilt")
      return { mode: "build", origin: { controllerRevision: controller, runId, attempt, jobId: current.id } }
    }
    const value = original(true)
    return { mode: "restore", origin: value.sealed.proof.origin, artifactId: value.artifact.id, digest: value.artifact.digest }
  }
  const retainOriginal = async () => {
    source(); currentJob(JOBS.finalize)
    const value = original(), asset = await putAsset(value.release, assetName(expected), value.bytes)
    return { ...value, asset, publicationAuthorized: false }
  }
  const publishRetained = async () => {
    source(); const finalizer = currentJob(JOBS.finalize)
    assert.equal(step(finalizer, STEPS.publish).status, "in_progress")
    assert.equal(step(finalizer, STEPS.publish).conclusion, null)
    const value = await retainOriginal()
    let registry = await ports.registry(expected, false)
    if (registry === null) {
      const old = jobs().filter(job => job.name === JOBS.finalize && job.id !== finalizer.id)
      assert.ok(old.every(job => skipped(job, [STEPS.publish])), "Unknown prior publication: read back the original version only")
      assert.equal(typeof ports.publish, "function", "Missing guarded npm publication port")
      let error
      await mutate(() => ports.publish(value.sealed.archive, expected), reason => { error = reason })
      registry = await ports.registry(expected, true)
      assert.ok(registry, "Unconfirmed npm publication: " + (error?.message ?? expected.version))
    }
    const identity = registryIdentity(registry, value, expected, controller, runId, attempt, run().repository)
    const publishers = jobs().filter(job => job.name === JOBS.finalize && job.run_attempt === identity.publicationAttempt)
    assert.equal(publishers.length, 1, "Provenance lacks its real publishing job")
    timestamp(step(publishers[0], STEPS.publish).started_at)
    const completion = { schemaVersion: 1, kind: "lotus-npm-completion/v1", inputs: expected, feature,
      controllerRevision: controller, runId, tag: { name: tag, object: value.tagObject }, releaseId: value.release.id,
      original: { artifact: { id: value.artifact.id, name: value.artifact.name, digest: value.artifact.digest, size: value.artifact.size_in_bytes },
        job: { id: value.physical.id, attempt: value.physical.run_attempt, fingerprint: value.fingerprint },
        asset: value.asset, archive: value.sealed.proof.archive }, registry: identity, publicationAuthorized: false }
    const completionAsset = await putAsset(value.release, completionName, encode(completion))
    if (value.release.draft) {
      let error
      await mutate(() => ports.write("PATCH", "releases/" + value.release.id, { draft: false }), reason => { error = reason })
      assert.equal(owned()?.release.draft, false, "Unconfirmed Release finalization: " + (error?.message ?? tag))
    }
    source(); run()
    const frame = { schemaVersion: 1, kind: "lotus-npm-completion-frame/v1", repository: REPOSITORY,
      controllerRevision: controller, runId, attempt, jobId: finalizer.id, source: expected.sourceRevision, version: expected.version,
      releaseId: value.release.id, originalArtifactId: value.artifact.id, originalAssetId: value.asset.id,
      completionAssetId: completionAsset.id, completionDigest: completionAsset.digest, publicationAuthorized: false }
    return { completion, frame: "LOTUS_NPM_COMPLETION_V1 " + encode(frame).toString("base64"), publicationAuthorized: false }
  }
  const restoreBuild = () => { currentJob(JOBS.build); return original(true) }
  return { reserve, planBuild, retainOriginal, readOriginal: original, restoreBuild, publishRetained,
    context: { expected, feature, controller, runId, attempt, tag, completionName },
    source, jobs, currentJob, owned }
}

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const registry = "https://registry.npmjs.org"
const transportEnv = (environment, github = false) => ({
  ...Object.fromEntries(["PATH", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL",
    ...(github ? ["GH_TOKEN"] : [])].filter(key => environment[key] !== undefined).map(key => [key, environment[key]])),
  GIT_CONFIG_GLOBAL: "/dev/null", GIT_CONFIG_NOSYSTEM: "1", GH_HOST: "github.com",
})
const exclusive = (name, bytes) => writeFileSync(name, bytes, { flag: "wx", mode: 0o600 })
const regular = (name) => { const value = lstatSync(name); assert.ok(value.isFile() && !value.isSymbolicLink()); return name }

// These are transport ports, not an alternate authority. The CLI below always
// enters createLifecycle; only its fresh real Source guard may call a write port.
export function controllerPorts({ environment = process.env, output, execute = spawnSync, fetchImpl = fetch }) {
  assert.ok(path.isAbsolute(output))
  mkdirSync(output, { recursive: true, mode: 0o700 })
  const command = (program, args, options = {}) => {
    const result = execute(program, args, { env: transportEnv(environment), maxBuffer: 128 * 1024 * 1024, ...options })
    assert.ok(!result.error, "Could not start " + program)
    return result
  }
  const github = (method, endpoint, body, binary = false, upload = false) => {
    const target = upload ? "https://uploads.github.com/repos/" + REPOSITORY + "/" + endpoint : "repos/" + REPOSITORY + "/" + endpoint
    const args = ["api", target, "--method", method, ...(binary ? ["--allow-escape-sequences"] : ["--include"]),
      "-H", "Accept: " + (binary ? "application/octet-stream" : "application/vnd.github+json"),
      ...(body !== undefined ? ["--input", "-", "-H", "Content-Type: " + (upload ? "application/octet-stream" : "application/json")] : [])]
    const result = command("gh", args, { env: transportEnv(environment, true), input: body === undefined ? undefined : Buffer.isBuffer(body) ? body : encode(body) })
    if (binary) { assert.equal(result.status, 0, "GitHub binary read failed"); return Buffer.from(result.stdout) }
    const text = Buffer.from(result.stdout).toString("utf8"), split = /\r?\n\r?\n/u.exec(text)
    assert.ok(split, "Missing official HTTP response status")
    const header = text.slice(0, split.index), match = /^HTTP\/[0-9.]+ ([0-9]{3})(?:\s|$)/u.exec(header)
    assert.ok(match, "Unknown GitHub HTTP response")
    const status = Number(match[1])
    if (status === 404 && method === "GET") return null
    assert.ok(result.status === 0 && status >= 200 && status < 300, "GitHub operation failed: " + method + " " + endpoint)
    return JSON.parse(text.slice(split.index + split[0].length))
  }
  const read = endpoint => github("GET", endpoint)
  const binary = endpoint => github("GET", endpoint, undefined, true)
  const npmEnv = (publication = false) => {
    const home = path.join(output, "npm-home"), config = path.join(output, publication ? "publish.npmrc" : "empty.npmrc"), global = path.join(output, "global.npmrc")
    mkdirSync(home, { recursive: true, mode: 0o700 })
    for (const name of [config, global]) if (!existsSync(name)) exclusive(name, publication && name === config && environment.NODE_AUTH_TOKEN
      ? "//registry.npmjs.org/:_authToken=${NODE_AUTH_TOKEN}\n" : "")
    return { ...transportEnv(environment), HOME: home, USERPROFILE: home, CI: "true", NPM_CONFIG_USERCONFIG: config,
      NPM_CONFIG_GLOBALCONFIG: global, NPM_CONFIG_REGISTRY: registry, NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false",
      ...(publication ? Object.fromEntries(["NODE_AUTH_TOKEN", "ACTIONS_ID_TOKEN_REQUEST_URL", "ACTIONS_ID_TOKEN_REQUEST_TOKEN"]
        .filter(key => environment[key] !== undefined).map(key => [key, environment[key]])) : {}) }
  }
  const npm = (args, cwd, publication = false, extra = {}) => {
    const result = command(process.platform === "win32" ? "npm.cmd" : "npm", args, { cwd, env: { ...npmEnv(publication), ...extra }, encoding: "utf8" })
    assert.equal(result.status, 0, "npm command failed: " + args[0])
    return result.stdout
  }
  const publicBytes = async (url, missing = false) => {
    const response = await fetchImpl(url, { redirect: "error", signal: AbortSignal.timeout(30000) })
    if (missing && response.status === 404) return null
    assert.equal(response.status, 200, "Registry read was not successful")
    const chunks = []; let size = 0
    for await (const chunk of response.body) { size += chunk.length; assert.ok(size <= 64 * 1024 * 1024); chunks.push(chunk) }
    return Buffer.concat(chunks)
  }
  const registryRead = async (expected, wait) => {
    const identity = "/@bigduu%2flotus-next/" + encodeURIComponent(expected.version)
    for (let tries = 0; tries < (wait ? 6 : 1); tries++) {
      const bytes = await publicBytes(registry + identity, true)
      if (bytes !== null) {
        const metadata = JSON.parse(bytes), url = registry + "/@bigduu/lotus-next/-/lotus-next-" + expected.version + ".tgz"
        assert.equal(metadata.dist.tarball, url)
        const attestations = registry + "/-/npm/v1/attestations/@bigduu%2flotus-next@" + expected.version
        assert.equal(metadata.dist.attestations.url, attestations)
        return { metadata, archive: await publicBytes(url), attestations: JSON.parse(await publicBytes(attestations)) }
      }
      if (tries + 1 < (wait ? 6 : 1)) await new Promise(resolve => setTimeout(resolve, 3000))
    }
    return null
  }
  return { read, binary, source: { request: read, artifactBytes: id => binary("actions/artifacts/" + integer(id) + "/zip") },
    write: (method, endpoint, body) => github(method, endpoint, body),
    upload: (id, name, bytes) => github("POST", "releases/" + integer(id) + "/assets?name=" + encodeURIComponent(name), bytes, false, true),
    registry: registryRead, npm,
    publish: (bytes, expected) => {
      assert.equal(environment.GITHUB_JOB, "finalize", "Only the actual finalizer may invoke npm publish")
      const filename = path.join(output, "bigduu-lotus-next-" + expected.version + ".tgz")
      exclusive(filename, bytes)
      return npm(["publish", filename, "--ignore-scripts", "--provenance", "--access", "public", "--registry=" + registry], output, true)
    } }
}

export async function runPhase(command, { expected, feature, controllerRoot = ROOT, environment = process.env, output }, ports) {
  const phase = { reserve: "prepare", select: "build", install: "build", build: "build", pack: "build", restore: "build", finalize: "finalize" }[command]
  assert.ok(phase, "Unknown publication phase"); assert.equal(environment.GITHUB_JOB, phase, "GITHUB_JOB does not own CLI phase")
  const lifecycle = createLifecycle({ expected, feature, controllerRoot, environment }, ports)
  const emit = (key, value) => { assert.ok(!String(value).includes("\n")); if (environment.GITHUB_OUTPUT) appendFileSync(environment.GITHUB_OUTPUT, key + "=" + value + "\n") }
  if (command === "reserve") { const value = await lifecycle.reserve(); emit("source_tree", value.intent.inputs.sourceTree); return value }
  if (command === "select") { const plan = lifecycle.planBuild(); emit("mode", plan.mode); return plan }
  if (command === "restore") return { origin: lifecycle.restoreBuild().sealed.proof.origin, publicationAuthorized: false }
  if (command === "finalize") return lifecycle.publishRetained()
  const plan = lifecycle.planBuild(); assert.equal(plan.mode, "build", "Successful originals must be restored")
  const sourceRoot = environment.SOURCE_ROOT
  const git = (...args) => {
    const result = spawnSync("git", ["--no-replace-objects", "-C", sourceRoot, ...args], { encoding: "utf8", env: transportEnv(environment) })
    assert.equal(result.status, 0); return result.stdout.trim()
  }
  assert.ok(path.isAbsolute(sourceRoot) && realpathSync(sourceRoot) !== realpathSync(controllerRoot))
  const product = JSON.parse(git("show", expected.sourceRevision + ":package.json")), packagePath = path.join(sourceRoot, "package.json")
  const metadata = { LOTUS_NEXT_RELEASE_VERSION: expected.version, LOTUS_NEXT_SOURCE_REVISION: expected.sourceRevision,
    LOTUS_NEXT_EXPECTED_SOURCE_REVISION: expected.sourceRevision, LOTUS_NEXT_SOURCE_DIRTY: "false", LOTUS_NEXT_EXPECTED_SOURCE_DIRTY: "false" }
  if (command === "install" || command === "build") {
    assert.equal(requireProduct(expected.sourceRevision, sourceRoot).tree, expected.sourceTree)
    if (command === "install") {
      ports.npm(["ci", "--ignore-scripts"], controllerRoot); ports.npm(["ci", "--ignore-scripts"], sourceRoot)
      requireController(environment, controllerRoot); requireProduct(expected.sourceRevision, sourceRoot)
      return { installed: true }
    }
    assert.equal(product.version, "0.0.0"); regular(packagePath)
    writeFileSync(packagePath, JSON.stringify({ ...product, version: expected.version }, null, 2) + "\n")
    ports.npm(["--ignore-scripts", "run", "build"], sourceRoot, false, metadata)
    requireController(environment, controllerRoot)
    return { built: true }
  }
  assert.equal(command, "pack")
  assert.equal(git("rev-parse", "HEAD"), expected.sourceRevision); regular(packagePath)
  same(JSON.parse(readFileSync(packagePath)), { ...product, version: expected.version })
  assert.equal(git("diff", "--name-only"), "package.json"); assert.equal(git("diff", "--cached", "--name-only"), "")
  assert.equal(git("ls-files", "--others", "--exclude-standard"), "")
  const packed = ports.npm(["pack", "--ignore-scripts", "--json", "--pack-destination", output], sourceRoot, false, metadata)
  const packResult = path.join(output, "pack-result.json"); exclusive(packResult, packed)
  const filename = path.join(output, "bigduu-lotus-next-" + expected.version + ".tgz"), archive = readFileSync(regular(filename))
  verifyPackResult(JSON.parse(packed), archive, expected)
  const result = spawnSync(process.execPath, [path.join(controllerRoot, "scripts/verify-package.mjs"), "--pack-result", packResult, "--source-root", sourceRoot],
    { cwd: controllerRoot, env: { ...transportEnv(environment), ...metadata }, encoding: "utf8" })
  assert.equal(result.status, 0, "Trusted static package verification failed")
  requireController(environment, controllerRoot)
  exclusive(path.join(output, "original.zip"), seal(archive, expected, plan.origin).bytes)
  return { origin: plan.origin, publicationAuthorized: false }
}

async function main() {
  const [command, ...rest] = process.argv.slice(2); assert.equal(rest.length, 0)
  const environment = process.env, output = environment.RELEASE_OUTPUT_DIR ?? path.join(environment.RUNNER_TEMP,
    "lotus-npm-" + environment.GITHUB_RUN_ID + "-" + environment.GITHUB_RUN_ATTEMPT + "-" + environment.GITHUB_JOB)
  assert.ok(path.isAbsolute(output))
  const feature = Object.fromEntries([["pullRequest", "FEATURE_PULL_REQUEST"], ["runId", "FEATURE_RUN_ID"], ["attempt", "FEATURE_RUN_ATTEMPT"]]
    .map(([key, name]) => { assert.match(environment[name], /^[1-9][0-9]*$/u); return [key, integer(Number(environment[name]))] }))
  requireController(environment)
  const ports = controllerPorts({ environment, output })
  const proof = admitFrozenDev({ source: environment.EXPECTED_SOURCE_SHA, ...feature }, ports.source)
  if (environment.EXPECTED_SOURCE_TREE) assert.equal(proof.tree, environment.EXPECTED_SOURCE_TREE)
  const expected = inputs({ repository: REPOSITORY, version: environment.LOTUS_NEXT_RELEASE_VERSION,
    sourceRevision: environment.EXPECTED_SOURCE_SHA, sourceTree: proof.tree })
  const value = await runPhase(command, { expected, feature, environment, output }, ports)
  if (value?.frame) console.log(value.frame)
}
if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(error => { console.error("Original npm release: " + error.message); process.exitCode = 1 })
}
