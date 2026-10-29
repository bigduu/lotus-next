import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { closeSync, constants, copyFileSync, lstatSync, mkdirSync, mkdtempSync, openSync, readFileSync, readSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { featureSource, verifyFeatureSource } from "./feature-acceptance.mjs"
import { assertSafeTarMembers, generateTlsIdentity, packAndVerifyCurrentArtifact,
  runAcceptanceMode, verifyExtractedCurrentArtifact } from "./published-real-bamboo-acceptance.mjs"

export const packageJobName = "Prepare real Bamboo test package"
export const packageStepName = "Pack the exact-source test artifact"
export const packageUploadStepName = "Upload the original test package"
export const packageArtifactName = "real-bamboo-test-package"

// A retry may create the test tarball only when the original job was skipped
// or its pack step is positively known not to have started. Missing Actions
// evidence is not permission to reconstruct potentially lost bytes.
export const assertPreviousPackagesUnstarted = ({ runId, attempt, headSha }, readAttempt) => {
  assert.ok(Number.isSafeInteger(runId) && runId > 0, "Invalid feature run")
  assert.ok(Number.isSafeInteger(attempt) && attempt > 0, "Invalid feature attempt")
  assert.match(headSha, /^[0-9a-f]{40}$/, "Invalid feature head")
  for (let prior = 1; prior < attempt; prior++) {
    const result = readAttempt(prior)
    assert.ok(Array.isArray(result?.jobs), "Missing prior feature jobs")
    assert.equal(result.total_count, result.jobs.length, "Incomplete prior feature jobs")
    const matches = result.jobs.filter(job => job.name === packageJobName)
    assert.equal(matches.length, 1, "Missing or ambiguous test package job")
    const [job] = matches
    for (const [key, value] of Object.entries({ run_id: runId, run_attempt: prior, head_sha: headSha, status: "completed" })) {
      assert.equal(job[key], value, `Unexpected prior package ${key}`)
    }
    assert.ok(Array.isArray(job.steps), "Missing prior package steps")
    if (job.conclusion === "skipped") {
      assert.equal(job.steps.length, 0, "Inconsistent skipped package job")
      continue
    }
    const steps = job.steps.filter(step => step.name === packageStepName)
    assert.equal(steps.length, 1, "Missing or ambiguous prior pack step")
    assert.equal(steps[0].status, "completed")
    assert.equal(steps[0].conclusion, "skipped", "Test package already started; retain the original bytes")
  }
}

export const validateFeatureArtifactMetadata = (artifact, { id, digest, source, producerAttempt, currentAttempt }, readAttempt) => {
  assert.ok(Number.isSafeInteger(id) && id > 0, "Invalid feature package artifact ID")
  assert.match(digest, /^[0-9a-f]{64}$/, "Missing original feature package digest")
  assert.ok(Number.isSafeInteger(producerAttempt) && producerAttempt > 0 && producerAttempt <= currentAttempt,
    "Invalid feature package producer attempt")
  assert.equal(artifact?.id, id)
  assert.equal(artifact.name, packageArtifactName)
  assert.equal(artifact.expired, false, "Original feature package expired")
  assert.ok(Number.isSafeInteger(artifact.size_in_bytes) && artifact.size_in_bytes > 0, "Empty feature package")
  assert.equal(artifact.digest, `sha256:${digest}`, "Feature package digest differs from the original upload")
  assert.equal(artifact.workflow_run?.id, Number(source.runId), "Feature package belongs to another run")
  assert.equal(artifact.workflow_run?.head_sha, source.headSha, "Feature package belongs to another PR head")
  const result = readAttempt(producerAttempt)
  assert.ok(Array.isArray(result?.jobs) && result.total_count === result.jobs.length, "Incomplete producer jobs")
  const jobs = result.jobs.filter(job => job.name === packageJobName)
  assert.equal(jobs.length, 1, "Missing or ambiguous package producer")
  const [job] = jobs
  for (const [key, value] of Object.entries({ run_id: Number(source.runId), run_attempt: producerAttempt,
    head_sha: source.headSha, status: "completed", conclusion: "success" })) assert.equal(job[key], value)
  assert.ok(Array.isArray(job.steps), "Missing producer steps")
  for (const name of [packageStepName, packageUploadStepName]) {
    const steps = job.steps.filter(step => step.name === name)
    assert.equal(steps.length, 1, `Missing or ambiguous producer step: ${name}`)
    assert.equal(steps[0].status, "completed")
    assert.equal(steps[0].conclusion, "success")
  }
}

export const extractVerifiedFeatureZip = (archive, directory, expectedDigest, version = packageVersion(), expectedSize) => {
  checkedFile(archive)
  assert(path.isAbsolute(directory), "Feature package destination must be absolute")
  assert.match(expectedDigest, /^[0-9a-f]{64}$/, "Missing original feature package digest")
  const stat = lstatSync(archive)
  assert(stat.size > 0, "Empty feature package archive")
  if (expectedSize !== undefined) assert.equal(stat.size, expectedSize, "Downloaded feature package size differs from the original")
  const hash = createHash("sha256"), buffer = Buffer.allocUnsafe(1024 * 1024)
  const descriptor = openSync(archive, "r")
  try {
    let bytes
    while ((bytes = readSync(descriptor, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, bytes))
  } finally { closeSync(descriptor) }
  const digest = hash.digest("hex")
  assert.equal(digest, expectedDigest, "Downloaded feature package ZIP differs from the original upload")
  const entries = execFileSync("unzip", ["-Z1", archive], { encoding: "utf8", maxBuffer: 1024 * 1024 }).trim().split("\n")
  assert.deepEqual(entries.sort(), [expectedFilename(version), receiptName].sort(), "Unexpected feature package ZIP members")
  mkdirSync(directory, { mode: 0o700 })
  execFileSync("unzip", ["-qq", archive, "-d", directory])
}

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
const receiptName = "feature-bamboo-package.json"
const packageVersion = () => JSON.parse(readFileSync(path.join(repositoryRoot, "package.json"), "utf8")).version
const expectedFilename = version => `bigduu-lotus-next-${version}.tgz`

const checkedFile = file => {
  assert(path.isAbsolute(file), "Feature package path must be absolute")
  const stat = lstatSync(file)
  assert(stat.isFile() && !stat.isSymbolicLink(), "Feature package input must be a regular file")
  assert.equal(realpathSync(file), path.resolve(file), "Feature package input must not traverse symlinks")
}

const sourceReceipt = () => {
  const source = featureSource()
  const filename = process.env.FEATURE_RECEIPT_PATH
  assert.ok(filename, "Missing feature source receipt")
  checkedFile(filename)
  return verifyFeatureSource(JSON.parse(readFileSync(filename, "utf8")), source)
}

export const validatePackageReceipt = (receipt, source, currentAttempt, version = packageVersion()) => {
  assert.deepEqual(Object.keys(receipt ?? {}).sort(), ["identity", "kind", "packRecord", "producerAttempt", "schemaVersion", "source"])
  assert.equal(receipt.schemaVersion, 1)
  assert.equal(receipt.kind, "lotus-feature-bamboo-package/v1")
  verifyFeatureSource(receipt.source, source)
  assert.ok(Number.isSafeInteger(receipt.producerAttempt) && receipt.producerAttempt >= receipt.source.sourceRunAttempt &&
    receipt.producerAttempt <= currentAttempt, "Invalid feature package producer attempt")
  assert.equal(receipt.packRecord?.filename, expectedFilename(version))
  assert.equal(receipt.identity?.sourceRevision, source.testedSnapshot)
  return receipt
}

const preparePackage = directory => {
  assert(path.isAbsolute(directory), "Feature package directory must be absolute")
  const source = sourceReceipt()
  const temporaryRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "lotus-feature-bamboo-pack-")))
  try {
    const artifact = packAndVerifyCurrentArtifact(temporaryRoot)
    assert.equal(artifact.identity.sourceRevision, source.testedSnapshot)
    mkdirSync(directory, { mode: 0o700 })
    const filename = expectedFilename(packageVersion())
    copyFileSync(artifact.tarballPath, path.join(directory, filename), constants.COPYFILE_EXCL)
    const producerAttempt = Number(process.env.GITHUB_RUN_ATTEMPT)
    assert.ok(Number.isSafeInteger(producerAttempt) && producerAttempt >= source.sourceRunAttempt)
    const receipt = { schemaVersion: 1, kind: "lotus-feature-bamboo-package/v1", source, producerAttempt,
      packRecord: artifact.packRecord, identity: artifact.identity }
    writeFileSync(path.join(directory, receiptName), JSON.stringify(receipt, null, 2) + "\n", { flag: "wx", mode: 0o600 })
    console.log(`Prepared the verified test package for snapshot ${source.testedSnapshot}`)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

export const verifyFeaturePackageContents = ({ directory, temporaryRoot, source, sourceDistRoot, expectedVersion,
  producerAttempt, currentAttempt }) => {
  assert(path.isAbsolute(directory) && path.isAbsolute(temporaryRoot) && path.isAbsolute(sourceDistRoot),
    "Feature input paths must be absolute")
  const receiptPath = path.join(directory, receiptName)
  checkedFile(receiptPath)
  const receipt = validatePackageReceipt(JSON.parse(readFileSync(receiptPath, "utf8")), source, currentAttempt, expectedVersion)
  assert.equal(receipt.producerAttempt, producerAttempt,
    "Feature package producer attempt differs from the admitted job")
  const tarballPath = path.join(directory, expectedFilename(expectedVersion))
  checkedFile(tarballPath)
  const listing = execFileSync("tar", ["-tzf", tarballPath], { encoding: "utf8", maxBuffer: 32 * 1024 * 1024 })
  assertSafeTarMembers(listing)
  const extractRoot = path.join(temporaryRoot, "extracted")
  mkdirSync(extractRoot, { mode: 0o700 })
  execFileSync("tar", ["-xzf", tarballPath, "-C", extractRoot])
  const artifact = verifyExtractedCurrentArtifact({ tarballPath, packageRoot: path.join(extractRoot, "package"),
    sourceDistRoot, expectedRevision: source.testedSnapshot, expectedVersion, packRecord: receipt.packRecord })
  assert.deepEqual(artifact.identity, receipt.identity, "Feature package identity differs from the original")
  return artifact
}

const runSurface = (mode, directory, browserDirectory) => {
  assert(["local", "remote"].includes(mode), "Invalid real Bamboo surface")
  assert(path.isAbsolute(directory) && path.isAbsolute(browserDirectory), "Feature input paths must be absolute")
  const source = sourceReceipt()
  const temporaryRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "lotus-feature-bamboo-surface-")))
  try {
    const artifact = verifyFeaturePackageContents({ directory, temporaryRoot, source,
      sourceDistRoot: path.join(repositoryRoot, "dist"), expectedVersion: packageVersion(),
      producerAttempt: Number(process.env.FEATURE_PACKAGE_PRODUCER_ATTEMPT), currentAttempt: Number(process.env.GITHUB_RUN_ATTEMPT) })
    const tls = mode === "remote" ? { ...generateTlsIdentity(temporaryRoot), hostname: "remote.lotus.test" } : null
    runAcceptanceMode({ mode, tls }, artifact, { kind: "verification", directory: browserDirectory })
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

const retrievePackage = directory => {
  const source = sourceReceipt()
  const id = Number(process.env.FEATURE_PACKAGE_ARTIFACT_ID)
  const digest = process.env.FEATURE_PACKAGE_ARTIFACT_DIGEST ?? ""
  const producerAttempt = Number(process.env.FEATURE_PACKAGE_PRODUCER_ATTEMPT)
  const readApi = route => JSON.parse(execFileSync("gh", ["api", route], { encoding: "utf8", maxBuffer: 1024 * 1024 }))
  const metadata = readApi(`repos/${source.repository}/actions/artifacts/${id}`)
  validateFeatureArtifactMetadata(metadata,
    { id, digest, source, producerAttempt, currentAttempt: Number(process.env.GITHUB_RUN_ATTEMPT) }, prior =>
      readApi(`repos/${source.repository}/actions/runs/${source.runId}/attempts/${prior}/jobs?per_page=100`))
  const temporaryRoot = realpathSync(mkdtempSync(path.join(tmpdir(), "lotus-feature-bamboo-download-")))
  try {
    const archive = path.join(temporaryRoot, "artifact.zip")
    const descriptor = openSync(archive, "wx", 0o600)
    try {
      execFileSync("gh", ["api", `repos/${source.repository}/actions/artifacts/${id}/zip`],
        { stdio: ["ignore", descriptor, "inherit"] })
    } finally { closeSync(descriptor) }
    extractVerifiedFeatureZip(archive, directory, digest, packageVersion(), metadata.size_in_bytes)
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

const main = () => {
  const [command, ...args] = process.argv.slice(2)
  if (command === "guard" && args.length === 0) {
    const source = featureSource()
    const runId = Number(source.runId)
    assertPreviousPackagesUnstarted({ runId, attempt: Number(process.env.GITHUB_RUN_ATTEMPT), headSha: source.headSha }, prior =>
      JSON.parse(execFileSync("gh", ["api", `repos/${source.repository}/actions/runs/${runId}/attempts/${prior}/jobs?per_page=100`],
        { encoding: "utf8", maxBuffer: 1024 * 1024 })))
    return
  }
  if (command === "retrieve" && args.length === 1) return retrievePackage(args[0])
  if (command === "prepare" && args.length === 1) return preparePackage(args[0])
  if (command === "surface" && args.length === 3) return runSurface(args[0], args[1], args[2])
  throw new Error("Usage: feature-bamboo-package.mjs guard | retrieve DIRECTORY | prepare DIRECTORY | surface local|remote DIRECTORY BROWSER")
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
