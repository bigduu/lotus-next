import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path"
import { fileURLToPath } from "node:url"
import { gunzipSync } from "node:zlib"
import { acceptedIdentityFromArtifact, assertAcceptedIdentity, verifyFinalPackAgainstAccepted } from "./release-acceptance-identity.mjs"
import { resolveReleaseRequest, verifyCandidateBackendPins, verifyCommittedAcceptance, verifySourceReceipt } from "./release-source.mjs"

const repository = "bigduu/lotus-next"
const version = "2026.10.12"
const sourceSha = "d8b0eb6cad98ec53afe8dc4f6aeaa35ef050ec9f"
const sourceTree = "116eff816bc810e65e254d8051b0641a47e27cd1"
const tagObjectSha = "059e718f234acd7911f6a5822f5d43cf1e423f1e"
const controller = "c50e0805a83c5e1cbcd6b37a07ca8646c23d2f9e"
const runId = 38228276879
const publishJobId = 114758355794
const publishPath = ".github/workflows/publish-npm.yml"
const workflowPath = ".github/workflows/verify-published-npm.yml"
const recordPath = `.github/release-recoveries/${version}.json`
const recordSha256 = "08489f5e33a69f713944a78db57ec822bb0e232d218caad5c5a7eaac43510c57"
const packageName = "@bigduu/lotus-next"
const registry = "https://registry.npmjs.org"
const tarballUrl = `${registry}/@bigduu/lotus-next/-/lotus-next-${version}.tgz`
const attestationsUrl = `${registry}/-/npm/v1/attestations/@bigduu%2flotus-next@${version}`
const slsa = "https://slsa.dev/provenance/v1"
const sha = /^[0-9a-f]{40}$/
const digest = (bytes, algorithm = "sha256", encoding = "hex") => createHash(algorithm).update(bytes).digest(encoding)
const jsonBytes = (value) => `${JSON.stringify(value, null, 2)}\n`
const pick = (value, keys) => Object.fromEntries(keys.map((key) => [key, value[key]]))
const only = (values, description) => {
  assert.equal(values.length, 1, `Expected exactly one ${description}`)
  return values[0]
}
const rawDocument = (record, name) => {
  const raw = record.rawEvidence[name]
  assert.equal(digest(raw.utf8), raw.sha256, `Original ${name} bytes changed`)
  return JSON.parse(raw.utf8)
}

// Bounded to one already-published release. No generic exception to publisher gates.
export const verifyRecoveryRecord = (record, candidateBytes, acceptanceBytes) => {
  assert.equal(record.schemaVersion, 1)
  assert.equal(record.kind, "reviewed-original-publication-evidence")
  assert.equal(record.repository, repository)
  assert.equal(record.version, version)
  const receipt = rawDocument(record, "sourceReceipt")
  assert.equal(receipt.workflowSha, controller)
  assert.equal(receipt.runId, String(runId))
  assert.equal(receipt.runAttempt, "1")
  assert.equal(receipt.sourceSha, sourceSha)
  assert.equal(receipt.sourceTree, sourceTree)
  assert.equal(receipt.tagObjectSha, tagObjectSha)
  assert.equal(receipt.candidateRecordSha256, "303d6867ba697c9c6cfd1d88b0f6633b5a81e66bc65185c5de11a5f05468481e")
  assert.equal(digest(candidateBytes), receipt.candidateRecordSha256)
  verifySourceReceipt(receipt, {
    DEFAULT_BRANCH: "main", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: repository,
    GITHUB_WORKFLOW_REF: `${repository}/${publishPath}@refs/heads/main`, GITHUB_SHA: controller,
    GITHUB_RUN_ID: String(runId), GITHUB_RUN_ATTEMPT: "1",
    LOTUS_NEXT_EXPECTED_SOURCE_REVISION: sourceSha, LOTUS_NEXT_RELEASE_VERSION: version,
  }, sourceSha)
  const candidate = resolveReleaseRequest(JSON.parse(candidateBytes), { version, sourceRef: receipt.sourceRef, expectedSourceSha: sourceSha })
  for (const key of ["sourceRef", "sourceSha", "sourceTree", "bambooSha", "tagObjectSha", "acceptanceRunId", "acceptanceReceiptSha256", "productPullRequest", "productMergeSha", "reviewEvidence"]) {
    assert.deepEqual(receipt[key], candidate[key], `Original source receipt ${key} differs from accepted candidate`)
  }
  verifyCommittedAcceptance(candidate, acceptanceBytes)
  const accepted = assertAcceptedIdentity(rawDocument(record, "acceptedIdentity"))
  assert.equal(accepted.sourceRevision, sourceSha)
  assert.equal(accepted.packageVersion, version)
  const pack = record.originalFinalPack
  assert.equal(pack.npmShasum, "0ec6edfbe6830cfde9efd9545f72a73dad996381")
  assert.equal(pack.npmIntegrity, "sha512-UWLteg5Bz7l8NERxisfubipMQPZ0oezIDLh1C+Df9kZFFhICYhmH6evX3C6cdPQAxvGdk9gGqeSBNjin3RTDoQ==")
  assert.equal(record.independentlyObservedRegistry.tarballSha256, "12056e280279ce7d3b75b3f552e0c4c973d571a4559e0b3bdfb3ea1d55afb404")
  assert.equal(pack.fileCount, 715)
  assert.equal(record.independentlyObservedRegistry.unpackedSize, 18011311)
  for (const name of ["localArtifact", "httpsArtifact"]) {
    const artifact = rawDocument(record, name)
    assert.deepEqual(acceptedIdentityFromArtifact(artifact), accepted)
    assert.equal(artifact.npmShasum, pack.npmShasum)
    assert.equal(artifact.npmIntegrity, pack.npmIntegrity)
    assert.equal(record.rawEvidence[name].artifactId, 11739895603)
  }
  assert.equal(record.rawEvidence.sourceReceipt.artifactId, 11737635941)
  assert.equal(record.rawEvidence.acceptedIdentity.artifactId, 11739895591)
  assert.equal(record.publishLog.sha256, "e48a3bc7653ea885151d6319b1eb80ffcefae05172dab456af988bf0940b7dfd")
  const excerpts = record.publishLog.excerpts.map((line) => line.text).join("\n")
  for (const text of [`EXPECTED_INTEGRITY: ${pack.npmIntegrity}`, `EXPECTED_SHASUM: ${pack.npmShasum}`, `+ ${packageName}@${version}`, "npm error code ETARGET", `No matching version found for ${packageName}@${version}.`]) assert.ok(excerpts.includes(text))
  return { candidate, sourceReceipt: receipt, acceptedIdentity: accepted }
}

const verifyOriginalRun = (run) => {
  assert.equal(run.id, runId)
  assert.equal(run.run_attempt, 1, "Original publication must remain attempt 1")
  assert.equal(run.head_sha, controller)
  assert.equal(run.head_branch, "main")
  assert.equal(run.path, publishPath)
  assert.equal(run.event, "workflow_dispatch")
  assert.equal(run.status, "completed")
  assert.equal(run.conclusion, "failure")
  assert.equal(run.html_url, `https://github.com/${repository}/actions/runs/${runId}`)
}

export const verifyOriginalPublication = (record, run, attempt, jobs, artifacts, now = new Date()) => {
  verifyOriginalRun(record.originalRun)
  verifyOriginalRun(run)
  verifyOriginalRun(attempt)
  assert.equal(jobs.total_count, jobs.jobs.length, "Original jobs response is truncated")
  assert.equal(jobs.total_count, 5)
  const jobKeys = ["id", "run_id", "run_attempt", "head_sha", "head_branch", "name", "status", "conclusion"]
  const stepKeys = ["number", "name", "status", "conclusion"]
  assert.equal(record.originalJobs.total_count, 5)
  assert.equal(record.originalJobs.jobs.length, 5)
  const names = ["Validate publication request", "Node 22 release artifact", "Node 24 release artifact", "Real Bamboo / Node 22 release artifact", "Pack, publish, and verify registry artifact"]
  for (const name of names) {
    const job = only(jobs.jobs.filter((entry) => entry.name === name), name)
    const original = only(record.originalJobs.jobs.filter((entry) => entry.name === name), `recorded ${name}`)
    assert.deepEqual(pick(job, jobKeys), pick(original, jobKeys))
    assert.equal(job.run_id, runId)
    assert.equal(job.run_attempt, 1)
    assert.equal(job.head_sha, controller)
    assert.equal(job.head_branch, "main")
    assert.equal(job.status, "completed")
    assert.equal(job.conclusion, name === names[4] ? "failure" : "success")
    assert.deepEqual(job.steps.map((step) => pick(step, stepKeys)), original.steps)
    assert.equal(new Set(job.steps.map((step) => step.name)).size, job.steps.length, "Ambiguous original step names")
    assert.equal(new Set(job.steps.map((step) => step.number)).size, job.steps.length, "Ambiguous original step numbers")
    for (const step of job.steps) assert.equal(step.status, "completed")
    if (name !== names[4]) {
      for (const step of job.steps) assert.equal(step.conclusion, "success", `Original gate failed or skipped: ${step.name}`)
    }
  }
  const publish = jobs.jobs.find((job) => job.name === names[4])
  assert.equal(publish.id, publishJobId)
  for (let number = 1; number <= 20; number++) {
    const step = only(publish.steps.filter((entry) => entry.number === number), `publication step ${number}`)
    assert.equal(step.conclusion, number < 17 ? "success" : number === 17 ? "failure" : "skipped")
  }
  assert.equal(publish.steps.find((step) => step.number === 15).name, "Publish the exact verified tarball with provenance")
  assert.equal(publish.steps.find((step) => step.number === 17).name, "Download and verify the registry copy")
  assert.equal(publish.steps.filter((step) => step.conclusion === "failure").length, 1)
  assert.equal(artifacts.total_count, artifacts.artifacts.length, "Original artifacts response is truncated")
  assert.equal(artifacts.total_count, 8)
  assert.equal(new Set(artifacts.artifacts.map((artifact) => artifact.id)).size, artifacts.total_count)
  assert.equal(new Set(artifacts.artifacts.map((artifact) => artifact.name)).size, artifacts.total_count)
  assert.ok(artifacts.artifacts.every((artifact) => !["publication-source-receipt", "publication-recovery-receipt"].includes(artifact.name)), "Original failed run cannot already carry a publication receipt")
  assert.equal(record.artifacts.length, 3)
  for (const expected of record.artifacts) {
    const artifact = only(artifacts.artifacts.filter((entry) => entry.id === expected.id && entry.name === expected.name), `artifact ${expected.name}`)
    assert.equal(artifact.expired, false)
    assert.ok(Date.parse(artifact.expires_at) > new Date(now).getTime(), "Original artifact has expired")
    for (const key of ["id", "name", "digest", "size_in_bytes", "created_at", "expires_at", "workflow_run"]) assert.deepEqual(artifact[key], expected[key])
    assert.equal(artifact.workflow_run.id, runId)
    assert.equal(artifact.workflow_run.head_sha, controller)
    assert.equal(artifact.workflow_run.head_branch, "main")
  }
  return {
    runId: String(runId), runAttempt: "1", workflowRef: `${repository}/${publishPath}@refs/heads/main`,
    workflowSha: controller, conclusion: "failure", jobId: String(publishJobId),
    publishStep: pick(publish.steps.find((step) => step.number === 15), ["number", "name", "conclusion"]),
    failureStep: { ...pick(publish.steps.find((step) => step.number === 17), ["number", "name", "conclusion"]), errorCode: "ETARGET" },
  }
}

export const verifyRecoveryContext = (environment, git) => {
  assert.equal(environment.GITHUB_REPOSITORY, repository)
  assert.equal(environment.DEFAULT_BRANCH, "main")
  assert.equal(environment.GITHUB_EVENT_NAME, "workflow_dispatch")
  assert.equal(environment.GITHUB_REF, "refs/heads/main")
  assert.equal(environment.GITHUB_WORKFLOW_REF, `${repository}/${workflowPath}@refs/heads/main`)
  assert.match(environment.GITHUB_SHA, sha)
  assert.equal(environment.GITHUB_WORKFLOW_SHA, environment.GITHUB_SHA)
  assert.match(environment.GITHUB_RUN_ID, /^[1-9]\d*$/)
  assert.notEqual(environment.GITHUB_RUN_ID, String(runId))
  assert.match(environment.GITHUB_RUN_ATTEMPT, /^[1-9]\d*$/)
  assert.equal(git(["rev-parse", "HEAD^{commit}"]), environment.GITHUB_SHA)
  assert.equal(git(["status", "--porcelain", "--untracked-files=all"]), "")
  assert.equal(git(["ls-remote", "--exit-code", "origin", "refs/heads/main"]), `${environment.GITHUB_SHA}\trefs/heads/main`)
  const changed = git(["diff", "--name-only", controller, "HEAD"]).split("\n").filter(Boolean)
  const allowed = [workflowPath, "scripts/verify-published-npm.mjs", "scripts/verify-published-npm.test.mjs", recordPath]
  assert.ok(changed.length > 0 && changed.every((path) => allowed.includes(path)), "Recovery must not change original source, publisher or acceptance controls")
}

export const verifyRegistryMetadata = (metadata, record) => {
  assert.equal(metadata.name, packageName)
  assert.equal(metadata.version, version)
  assert.equal(metadata.dist.tarball, tarballUrl)
  assert.equal(metadata.dist.shasum, record.originalFinalPack.npmShasum)
  assert.equal(metadata.dist.integrity, record.originalFinalPack.npmIntegrity)
  assert.equal(metadata.dist.fileCount, record.originalFinalPack.fileCount)
  assert.equal(metadata.dist.unpackedSize, record.independentlyObservedRegistry.unpackedSize)
  assert.equal(metadata.dist.attestations.provenance.predicateType, slsa)
  assert.equal(metadata.dist.attestations.url, attestationsUrl)
  return metadata.dist
}

export const verifyRegistryBytes = (bytes, record) => {
  assert.equal(digest(bytes, "sha1"), record.originalFinalPack.npmShasum, "Registry tarball SHA-1 mismatch")
  assert.equal(`sha512-${digest(bytes, "sha512", "base64")}`, record.originalFinalPack.npmIntegrity, "Registry tarball SHA-512 mismatch")
  assert.equal(digest(bytes), record.independentlyObservedRegistry.tarballSha256, "Registry tarball SHA-256 mismatch")
}

// Decode and bind the actual SLSA payload. This deliberately makes no claim of
// certificate, signature, transparency-log, or cryptographic verification.
export const verifyProvenance = (attestations, record) => {
  assert.ok(Array.isArray(attestations.attestations))
  const attestation = only(attestations.attestations.filter((value) => value.predicateType === slsa), "SLSA provenance")
  const envelope = attestation.bundle.dsseEnvelope
  assert.equal(envelope.payloadType, "application/vnd.in-toto+json")
  assert.match(envelope.payload, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  const bytes = Buffer.from(envelope.payload, "base64")
  const statement = JSON.parse(bytes)
  assert.equal(statement._type, "https://in-toto.io/Statement/v1")
  assert.equal(statement.predicateType, slsa)
  assert.deepEqual(statement.subject, [{ name: `pkg:npm/%40bigduu/lotus-next@${version}`, digest: { sha512: Buffer.from(record.originalFinalPack.npmIntegrity.slice(7), "base64").toString("hex") } }])
  const build = statement.predicate.buildDefinition
  assert.equal(build.buildType, "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1")
  assert.deepEqual(build.externalParameters.workflow, { ref: "refs/heads/main", repository: `https://github.com/${repository}`, path: publishPath })
  assert.equal(build.internalParameters.github.event_name, "workflow_dispatch")
  assert.equal(build.internalParameters.github.repository_id, "1281544268")
  assert.equal(build.internalParameters.github.repository_owner_id, "18681616")
  assert.deepEqual(build.resolvedDependencies, [{ uri: `git+https://github.com/${repository}@refs/heads/main`, digest: { gitCommit: controller } }])
  assert.equal(statement.predicate.runDetails.builder.id, "https://github.com/actions/runner/github-hosted")
  const invocationId = `https://github.com/${repository}/actions/runs/${runId}/attempts/1`
  assert.equal(statement.predicate.runDetails.metadata.invocationId, invocationId)
  return { predicateType: slsa, invocationId, workflowSha: controller, payloadSha256: digest(bytes), cryptographicVerification: false }
}

const tarString = (bytes) => {
  const end = bytes.indexOf(0)
  if (end >= 0) assert.ok(bytes.subarray(end).every((byte) => byte === 0), "Malformed tar string padding")
  const value = bytes.subarray(0, end < 0 ? bytes.length : end)
  assert.ok(value.every((byte) => byte >= 32 && byte < 127), "Non-ASCII tar path")
  return value.toString("ascii")
}
const tarOctal = (bytes) => {
  assert.ok(bytes.every((byte) => byte === 0 || byte === 32 || (byte >= 48 && byte <= 55)), "Invalid tar numeric encoding")
  const value = bytes.toString("ascii").split(String.fromCharCode(0)).join(" ").trim()
  assert.match(value, /^[0-7]+$/, "Invalid tar numeric field")
  const number = Number.parseInt(value, 8)
  assert.ok(Number.isSafeInteger(number) && number >= 0)
  return number
}

// npm's original archive contains only regular USTAR files. Reject extensions,
// links, devices and directories rather than delegating untrusted paths to tar.
export const inspectTar = (bytes) => {
  assert.ok(Buffer.isBuffer(bytes))
  assert.ok(bytes.length <= 50 * 1024 * 1024 && bytes.length % 512 === 0)
  const files = []
  const seen = new Set()
  let offset = 0
  while (offset + 512 <= bytes.length && bytes.subarray(offset, offset + 512).some((byte) => byte !== 0)) {
    const header = bytes.subarray(offset, offset + 512)
    assert.equal(header.subarray(257, 265).toString("ascii"), "ustar\u000000")
    const checksum = [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0)
    assert.equal(tarOctal(header.subarray(148, 156)), checksum, "Invalid tar header checksum")
    assert.ok(header[156] === 48 || header[156] === 0, "Unsafe tar entry type")
    assert.equal(tarString(header.subarray(157, 257)), "", "Tar link target is forbidden")
    const prefix = tarString(header.subarray(345, 500))
    const leaf = tarString(header.subarray(0, 100))
    const name = prefix ? `${prefix}/${leaf}` : leaf
    assert.ok(name.startsWith("package/") && !name.includes("\\") && !name.includes(":"), "Unsafe tar path")
    assert.ok(name.split("/").every((part) => part !== "" && part !== "." && part !== ".."), "Unsafe tar path component")
    assert.ok(!seen.has(name), "Duplicate tar path")
    for (const earlier of seen) assert.ok(!name.startsWith(`${earlier}/`) && !earlier.startsWith(`${name}/`), "Conflicting tar paths")
    seen.add(name)
    const size = tarOctal(header.subarray(124, 136))
    const end = offset + 512 + size
    const next = offset + 512 + Math.ceil(size / 512) * 512
    assert.ok(next <= bytes.length, "Truncated tar entry")
    assert.ok(bytes.subarray(end, next).every((byte) => byte === 0), "Nonzero tar entry padding")
    files.push({ name, bytes: bytes.subarray(offset + 512, end) })
    offset = next
  }
  assert.ok(files.length > 0)
  assert.ok(bytes.length - offset >= 1024 && bytes.subarray(offset).every((byte) => byte === 0), "Missing or invalid tar terminator")
  return files
}

export const extractSafeTar = (bytes, destination) => {
  assert.equal(existsSync(destination), false, "Extraction destination must not exist")
  const files = inspectTar(gunzipSync(bytes, { maxOutputLength: 50 * 1024 * 1024 }))
  mkdirSync(destination, { recursive: false })
  for (const file of files) {
    const target = join(destination, file.name)
    mkdirSync(dirname(target), { recursive: true })
    writeFileSync(target, file.bytes, { flag: "wx", mode: 0o600 })
  }
  return files
}

export const verifyNpmPackResult = (packed, metadata, bytes) => {
  assert.ok(Array.isArray(packed))
  assert.equal(packed.length, 1)
  const result = packed[0]
  assert.equal(result.id, `${packageName}@${version}`)
  assert.equal(result.name, packageName)
  assert.equal(result.version, version)
  assert.equal(result.filename, `bigduu-lotus-next-${version}.tgz`)
  assert.equal(result.shasum, metadata.dist.shasum)
  assert.equal(result.shasum, digest(bytes, "sha1"))
  assert.equal(result.integrity, metadata.dist.integrity)
  assert.equal(result.integrity, `sha512-${digest(bytes, "sha512", "base64")}`)
  assert.equal(result.size, bytes.length)
  assert.equal(result.entryCount, metadata.dist.fileCount)
  assert.equal(result.unpackedSize, metadata.dist.unpackedSize)
  assert.deepEqual(result.bundled, [])
  const files = inspectTar(gunzipSync(bytes, { maxOutputLength: 50 * 1024 * 1024 }))
  const actual = files.map((file) => ({ path: file.name.slice("package/".length), size: file.bytes.length })).sort((a, b) => a.path.localeCompare(b.path))
  const reported = result.files.map((file) => pick(file, ["path", "size"])).sort((a, b) => a.path.localeCompare(b.path))
  assert.equal(files.length, result.entryCount)
  assert.equal(files.reduce((size, file) => size + file.bytes.length, 0), result.unpackedSize)
  assert.deepEqual(reported, actual, "npm pack inventory differs from the actual archive")
}

export const verifyRegistryPackage = (bytes, metadata, attestations, record, destination) => {
  verifyRegistryMetadata(metadata, record)
  verifyRegistryBytes(bytes, record)
  const provenance = verifyProvenance(attestations, record)
  const files = extractSafeTar(bytes, destination)
  assert.equal(files.length, record.originalFinalPack.fileCount)
  assert.equal(files.reduce((size, file) => size + file.bytes.length, 0), record.independentlyObservedRegistry.unpackedSize)
  const allowedRoot = ["package/LICENSE", "package/README.md", "package/README.zh-CN.md", "package/package.json"]
  assert.ok(files.every((file) => allowedRoot.includes(file.name) || file.name.startsWith("package/dist/")), "Unexpected package file")
  for (const name of allowedRoot) assert.ok(files.some((file) => file.name === name), `Missing package file ${name}`)
  const manifest = JSON.parse(readFileSync(join(destination, "package/package.json")))
  assert.equal(manifest.name, packageName)
  assert.equal(manifest.version, version)
  const acceptedPath = join(destination, "accepted-identity.json")
  writeFileSync(acceptedPath, record.rawEvidence.acceptedIdentity.utf8, { flag: "wx" })
  const accepted = verifyFinalPackAgainstAccepted({ acceptedPath, distDirectory: join(destination, "package/dist"), expectedRevision: sourceSha, expectedVersion: version })
  return { packageName, packageVersion: version, sourceRevision: sourceSha, sourceDirty: false,
    npmShasum: record.originalFinalPack.npmShasum, npmIntegrity: record.originalFinalPack.npmIntegrity,
    tarballSha256: digest(bytes), tarballUrl, manifestSha256: accepted.manifestSha256,
    resourcesSha256: accepted.resourcesSha256, resourceCount: accepted.resourceCount, fileCount: files.length, provenance }
}

export const createRecoveryReceipt = ({ record, recordBytes, environment, registryIdentity, evidence, originalPublication, verifiedAt }) => ({
  schemaVersion: 2, kind: "registry-verification-recovery", repository, version,
  sourceReceipt: rawDocument(record, "sourceReceipt"), originalPublication,
  verification: { workflowRef: environment.GITHUB_WORKFLOW_REF, workflowSha: environment.GITHUB_SHA,
    runId: environment.GITHUB_RUN_ID, runAttempt: environment.GITHUB_RUN_ATTEMPT,
    headRef: environment.GITHUB_REF, event: environment.GITHUB_EVENT_NAME,
    verifiedAt, operation: "read-only-registry-verification" },
  registryIdentity,
  evidence: { recordSha256: digest(recordBytes),
    originalArtifacts: record.artifacts.map((artifact) => pick(artifact, ["id", "name", "digest"])),
    sourceReceiptSha256: record.rawEvidence.sourceReceipt.sha256, acceptedIdentitySha256: record.rawEvidence.acceptedIdentity.sha256,
    localArtifactSha256: record.rawEvidence.localArtifact.sha256, httpsArtifactSha256: record.rawEvidence.httpsArtifact.sha256,
    publishLogSha256: record.publishLog.sha256, ...evidence },
})

// Public unauthenticated GET only; no GITHUB_TOKEN/actions:read or archive download.
const readPublicJson = async (url, fetchImpl) => {
  const response = await fetchImpl(url, { method: "GET", redirect: "error", headers: { accept: "application/json" }, signal: AbortSignal.timeout(30000) })
  assert.equal(response.status, 200, `Public evidence GET failed: ${url}`)
  assert.ok(!response.headers.get("link")?.includes('rel="next"'), "Public evidence response is paginated/truncated")
  const bytes = Buffer.from(await response.arrayBuffer())
  assert.ok(bytes.length > 0 && bytes.length <= 4 * 1024 * 1024, "Public evidence exceeds bounded response size")
  return { value: JSON.parse(bytes), sha256: digest(bytes) }
}

export const verifyPublishedNpm = async ({ environment = process.env, cwd = process.cwd(), fetchImpl = fetch, exec = execFileSync, now = () => new Date() } = {}) => {
  const git = (args) => exec("git", args, { cwd, encoding: "utf8", timeout: 60000 }).trim()
  verifyRecoveryContext(environment, git)
  assert.ok(isAbsolute(environment.RUNNER_TEMP))
  const output = resolve(environment.RECOVERY_RECEIPT_PATH)
  const outputRelative = relative(resolve(environment.RUNNER_TEMP), output)
  assert.ok(outputRelative && !outputRelative.startsWith(`..${sep}`) && outputRelative !== ".." && !isAbsolute(outputRelative))
  assert.equal(existsSync(output), false, "Recovery receipt must not preexist")
  const recordBytes = readFileSync(join(cwd, recordPath))
  assert.equal(digest(recordBytes), recordSha256, "Reviewed recovery evidence changed")
  const record = JSON.parse(recordBytes)
  const { candidate } = verifyRecoveryRecord(record, readFileSync(join(cwd, ".github/release-candidates.json")), readFileSync(join(cwd, `.github/release-acceptance/${version}.json`)))
  git(["fetch", "--no-tags", "origin", candidate.sourceRef])
  assert.equal(git(["cat-file", "-t", "FETCH_HEAD"]), "tag")
  assert.equal(git(["rev-parse", "FETCH_HEAD"]), candidate.tagObjectSha)
  assert.equal(git(["rev-parse", "FETCH_HEAD^{commit}"]), candidate.sourceSha)
  assert.equal(git(["rev-parse", `${candidate.sourceSha}^{tree}`]), candidate.sourceTree)
  git(["fetch", "--no-tags", "origin", candidate.productMergeSha])
  assert.equal(git(["rev-parse", `${candidate.productMergeSha}^{tree}`]), candidate.sourceTree)
  verifyCandidateBackendPins(candidate, {
    ci: git(["show", `${sourceSha}:.github/workflows/ci.yml`]), publication: git(["show", `${sourceSha}:${publishPath}`]),
    runtime: git(["show", `${sourceSha}:e2e/support/realBambooRuntime.ts`]), acceptanceTest: git(["show", `${sourceSha}:scripts/published-real-bamboo-acceptance.test.mjs`]),
  })
  const api = `https://api.github.com/repos/${repository}/actions/runs/${runId}`
  const [run, attempt, jobs, artifacts] = await Promise.all([api, `${api}/attempts/1`, `${api}/attempts/1/jobs?per_page=100`, `${api}/artifacts?per_page=100`].map((url) => readPublicJson(url, fetchImpl)))
  const originalPublication = verifyOriginalPublication(record, run.value, attempt.value, jobs.value, artifacts.value, now())
  const metadata = await readPublicJson(`${registry}/@bigduu%2flotus-next/${version}`, fetchImpl)
  verifyRegistryMetadata(metadata.value, record)
  const attestations = await readPublicJson(attestationsUrl, fetchImpl)
  verifyProvenance(attestations.value, record)
  const directory = mkdtempSync(join(environment.RUNNER_TEMP, "lotus-registry-recovery-"))
  const cache = join(directory, "empty-cache")
  const download = join(directory, "download")
  mkdirSync(download)
  const npmEnvironment = Object.fromEntries(Object.entries(environment).filter(([key]) => !/token|secret|password|auth|^npm_config_|^node_options$/i.test(key)))
  const emptyConfig = join(directory, "empty-user-npmrc")
  const emptyGlobalConfig = join(directory, "empty-global-npmrc")
  writeFileSync(emptyConfig, "", { flag: "wx" })
  writeFileSync(emptyGlobalConfig, "", { flag: "wx" })
  assert.equal(existsSync(cache), false, "Registry cache must be initially absent")
  Object.assign(npmEnvironment, { NPM_CONFIG_USERCONFIG: emptyConfig, NPM_CONFIG_GLOBALCONFIG: emptyGlobalConfig, NPM_CONFIG_IGNORE_SCRIPTS: "true", NPM_CONFIG_AUDIT: "false", NPM_CONFIG_FUND: "false" })
  const packed = JSON.parse(exec("npm", ["pack", `${packageName}@${version}`, "--ignore-scripts", "--prefer-online", `--cache=${cache}`, `--registry=${registry}/`, "--pack-destination", download, "--json"], { cwd: directory, env: npmEnvironment, encoding: "utf8", timeout: 180000, maxBuffer: 8 * 1024 * 1024 }))
  assert.equal(packed.length, 1)
  assert.equal(packed[0].filename, record.originalFinalPack.filename)
  assert.deepEqual(readdirSync(download), [record.originalFinalPack.filename])
  const bytes = readFileSync(join(download, record.originalFinalPack.filename))
  verifyRegistryBytes(bytes, record)
  verifyNpmPackResult(packed, metadata.value, bytes)
  const registryIdentity = verifyRegistryPackage(bytes, metadata.value, attestations.value, record, join(directory, "extracted"))
  // Recheck mutable remote pointers and controller cleanliness immediately before writing.
  assert.equal(git(["ls-remote", "--exit-code", "origin", candidate.sourceRef, `${candidate.sourceRef}^{}`]), `${candidate.tagObjectSha}\t${candidate.sourceRef}\n${candidate.sourceSha}\t${candidate.sourceRef}^{}`)
  verifyRecoveryContext(environment, git)
  const receipt = createRecoveryReceipt({ record, recordBytes, environment, registryIdentity, originalPublication, verifiedAt: now().toISOString(), evidence: {
    runResponseSha256: run.sha256, attemptResponseSha256: attempt.sha256, jobsResponseSha256: jobs.sha256,
    artifactsResponseSha256: artifacts.sha256, registryMetadataSha256: metadata.sha256, attestationsSha256: attestations.sha256,
  } })
  writeFileSync(output, jsonBytes(receipt), { flag: "wx" })
  return receipt
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  verifyPublishedNpm().then((receipt) => console.log(`Verified existing ${packageName}@${version}; original publisher remains failure; receipt for verifier run ${receipt.verification.runId}/${receipt.verification.runAttempt}`)).catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
