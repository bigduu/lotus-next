import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  chmodSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  assertPackageVersion,
  assertSourceRevision,
  verifyArtifactManifest,
} from "./artifact-manifest.mjs"
import { writeAcceptedIdentity } from "./release-acceptance-identity.mjs"

export const PUBLISHED_ARTIFACT_IDENTITY = Object.freeze({
  schemaVersion: 1,
  registry: "https://registry.npmjs.org/",
  packageName: "@bigduu/lotus-next",
  packageVersion: "2026.9.14",
  sourceRevision: "ae17b50574ccd86395cbc226b50c9fb2f0f51e0f",
  sourceDirty: false,
  entrypoint: "index.html",
  npmShasum: "33e6857ff855c29a14062a460dc88da7b0e9a4e1",
  npmIntegrity:
    "sha512-0elftRZ1eO/oa9RN9AgjkViCmeKbh87YQ+GbTIIeOS2IYYx8A0v9IZf4w2YemxdgR+mfstmc8FnoZYTRQrEbgA==",
  manifestSha256:
    "363cb4f4c763dec5f9337b95f85e1f7ba59ab8f3485e275ec13c10302ffac6c8",
  resourcesSha256:
    "4e5d67386d6fbef15fc8aaf84238356e86ab470fab5680c33e3d0c28860a7f2d",
  resourceCount: 34,
})

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
)
const playwrightCli = path.join(
  repositoryRoot,
  "node_modules",
  "@playwright",
  "test",
  "cli.js",
)
const commandBufferBytes = 32 * 1024 * 1024
const remoteHostname = "remote.lotus.test"
const localPackOrigin = "local-pack"

const isRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value)

const sha = (algorithm, contents) =>
  createHash(algorithm).update(contents).digest(algorithm === "sha512" ? "base64" : "hex")

const fileDigest = (algorithm, filePath) =>
  sha(algorithm, readFileSync(filePath))

const commandFailure = (command, arguments_, result) => {
  const detail = [result.stdout, result.stderr]
    .filter((value) => typeof value === "string" && value.trim())
    .join("\n")
    .trim()
  return new Error(
    `${command} ${arguments_.join(" ")} failed with ${result.signal ?? `exit ${result.status}`}${detail ? `:\n${detail}` : ""}`,
  )
}

const runCaptured = (command, arguments_, options = {}) => {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    encoding: "utf8",
    maxBuffer: commandBufferBytes,
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw commandFailure(command, arguments_, result)
  return { stdout: result.stdout ?? "", stderr: result.stderr ?? "" }
}

const runInherited = (command, arguments_, options = {}) => {
  const result = spawnSync(command, arguments_, {
    cwd: repositoryRoot,
    stdio: "inherit",
    ...options,
  })
  if (result.error) throw result.error
  if (result.status !== 0) throw commandFailure(command, arguments_, result)
}

const npmInvocation = (arguments_) => {
  const npmExecPath = process.env.npm_execpath?.trim()
  return npmExecPath
    ? runCaptured(process.execPath, [npmExecPath, ...arguments_])
    : runCaptured(process.platform === "win32" ? "npm.cmd" : "npm", arguments_)
}

export const assertPublishedArtifactIdentity = (identity) => {
  if (!isRecord(identity)) {
    throw new Error("Published artifact identity must be an object.")
  }
  const expectedEntries = Object.entries(PUBLISHED_ARTIFACT_IDENTITY)
  const actualKeys = Object.keys(identity)
  const expectedKeys = expectedEntries.map(([key]) => key)
  if (
    actualKeys.length !== expectedKeys.length ||
    actualKeys.some((key, index) => key !== expectedKeys[index])
  ) {
    throw new Error(
      `Published artifact identity must contain exactly: ${expectedKeys.join(", ")}.`,
    )
  }
  for (const [key, expected] of expectedEntries) {
    if (identity[key] !== expected) {
      throw new Error(
        `Published artifact ${key} ${JSON.stringify(identity[key])} does not match ${JSON.stringify(expected)}.`,
      )
    }
  }
  return identity
}

export const assertSafeTarMembers = (listing) => {
  if (typeof listing !== "string" || listing.length === 0) {
    throw new Error("Registry tarball member listing is empty.")
  }
  const members = listing.split(/\r?\n/u).filter(Boolean)
  for (const member of members) {
    const normalizedMember = member.endsWith("/") ? member.slice(0, -1) : member
    if (
      normalizedMember.length === 0 ||
      normalizedMember.includes("\\") ||
      normalizedMember.includes("\0") ||
      path.posix.isAbsolute(normalizedMember) ||
      path.posix.normalize(normalizedMember) !== normalizedMember ||
      !normalizedMember.startsWith("package/")
    ) {
      throw new Error(`Unsafe registry tarball member: ${JSON.stringify(member)}.`)
    }
  }
  for (const required of [
    "package/dist/index.html",
    "package/dist/lotus-next-manifest.json",
    "package/package.json",
  ]) {
    if (!members.includes(required)) {
      throw new Error(`Registry tarball is missing ${required}.`)
    }
  }
  return members
}

const parsePackRecord = (stdout) => {
  let parsed
  try {
    parsed = JSON.parse(stdout)
  } catch (error) {
    throw new Error(
      `npm pack did not return JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (!Array.isArray(parsed) || parsed.length !== 1 || !isRecord(parsed[0])) {
    throw new Error("npm pack must return exactly one package record.")
  }
  return parsed[0]
}

const parsePackResult = (stdout) => {
  const record = parsePackRecord(stdout)
  const expectedFilename = "bigduu-lotus-next-2026.9.14.tgz"
  if (
    record.filename !== expectedFilename ||
    record.shasum !== PUBLISHED_ARTIFACT_IDENTITY.npmShasum ||
    record.integrity !== PUBLISHED_ARTIFACT_IDENTITY.npmIntegrity
  ) {
    throw new Error("npm pack metadata does not match the committed artifact identity.")
  }
  return expectedFilename
}

export const acceptanceArtifactMode = (arguments_) => {
  if (arguments_.length === 0) return "published"
  if (arguments_.length === 1 && arguments_[0] === "--current-source") {
    return "current-source"
  }
  if (
    arguments_.length === 3 &&
    arguments_[0] === "--current-source" &&
    arguments_[1] === "--accepted-identity" &&
    arguments_[2]?.trim()
  ) {
    return "current-source"
  }
  throw new Error("Usage: published-real-bamboo-acceptance.mjs [--current-source [--accepted-identity FILE]]")
}

export const verifyExtractedPublishedArtifact = ({ tarballPath, packageRoot }) => {
  const tarballStat = lstatSync(tarballPath)
  const packageRootStat = lstatSync(packageRoot)
  if (tarballStat.isSymbolicLink() || !tarballStat.isFile()) {
    throw new Error("Registry tarball must be a regular file.")
  }
  if (packageRootStat.isSymbolicLink() || !packageRootStat.isDirectory()) {
    throw new Error("Extracted registry package root must be a directory.")
  }

  const distRoot = path.join(packageRoot, "dist")
  const manifestPath = path.join(distRoot, "lotus-next-manifest.json")
  const packageDocument = JSON.parse(
    readFileSync(path.join(packageRoot, "package.json"), "utf8"),
  )
  const manifest = verifyArtifactManifest({
    distDirectory: distRoot,
    expectedPackageName: PUBLISHED_ARTIFACT_IDENTITY.packageName,
    expectedPackageVersion: PUBLISHED_ARTIFACT_IDENTITY.packageVersion,
    expectedSourceRevision: PUBLISHED_ARTIFACT_IDENTITY.sourceRevision,
    expectedSourceDirty: PUBLISHED_ARTIFACT_IDENTITY.sourceDirty,
  })
  const identity = {
    schemaVersion: 1,
    registry: PUBLISHED_ARTIFACT_IDENTITY.registry,
    packageName: packageDocument.name,
    packageVersion: packageDocument.version,
    sourceRevision: manifest.sourceRevision,
    sourceDirty: manifest.sourceDirty,
    entrypoint: manifest.entrypoint,
    npmShasum: fileDigest("sha1", tarballPath),
    npmIntegrity: `sha512-${fileDigest("sha512", tarballPath)}`,
    manifestSha256: fileDigest("sha256", manifestPath),
    resourcesSha256: manifest.resourcesSha256,
    resourceCount: manifest.resources.length,
  }
  assertPublishedArtifactIdentity(identity)
  return { distRoot, identity }
}

export const verifyExtractedCurrentArtifact = ({
  tarballPath,
  packageRoot,
  sourceDistRoot,
  expectedRevision,
  expectedVersion,
  packRecord,
}) => {
  assertSourceRevision(expectedRevision)
  assertPackageVersion(expectedVersion)
  const expectedFilename = `bigduu-lotus-next-${expectedVersion}.tgz`
  const tarballStat = lstatSync(tarballPath)
  const packageRootStat = lstatSync(packageRoot)
  if (tarballStat.isSymbolicLink() || !tarballStat.isFile()) {
    throw new Error("Current-source tarball must be a regular file.")
  }
  if (packageRootStat.isSymbolicLink() || !packageRootStat.isDirectory()) {
    throw new Error("Extracted current-source package root must be a real directory.")
  }

  const npmShasum = fileDigest("sha1", tarballPath)
  const npmIntegrity = `sha512-${fileDigest("sha512", tarballPath)}`
  if (
    !isRecord(packRecord) ||
    packRecord.name !== PUBLISHED_ARTIFACT_IDENTITY.packageName ||
    packRecord.version !== expectedVersion ||
    packRecord.filename !== expectedFilename ||
    packRecord.shasum !== npmShasum ||
    packRecord.integrity !== npmIntegrity
  ) {
    throw new Error("Current-source npm pack metadata does not match the exact local tarball.")
  }

  const packagePath = path.join(packageRoot, "package.json")
  const packageStat = lstatSync(packagePath)
  if (packageStat.isSymbolicLink() || !packageStat.isFile()) {
    throw new Error("Current-source package.json must be a regular file.")
  }
  const packageDocument = JSON.parse(readFileSync(packagePath, "utf8"))
  if (
    packageDocument.name !== PUBLISHED_ARTIFACT_IDENTITY.packageName ||
    packageDocument.version !== expectedVersion
  ) {
    throw new Error("Extracted current-source package identity does not match the source build.")
  }

  const expectedArtifact = {
    expectedPackageName: PUBLISHED_ARTIFACT_IDENTITY.packageName,
    expectedPackageVersion: expectedVersion,
    expectedSourceRevision: expectedRevision,
    expectedSourceDirty: false,
  }
  const sourceManifest = verifyArtifactManifest({
    distDirectory: sourceDistRoot,
    ...expectedArtifact,
  })
  const distRoot = path.join(packageRoot, "dist")
  const manifest = verifyArtifactManifest({
    distDirectory: distRoot,
    ...expectedArtifact,
  })
  const sourceManifestPath = path.join(sourceDistRoot, "lotus-next-manifest.json")
  const manifestPath = path.join(distRoot, "lotus-next-manifest.json")
  const manifestSha256 = fileDigest("sha256", manifestPath)
  if (
    fileDigest("sha256", sourceManifestPath) !== manifestSha256 ||
    sourceManifest.resourcesSha256 !== manifest.resourcesSha256
  ) {
    throw new Error("Packed current-source resources do not match the verified build.")
  }

  const identity = {
    schemaVersion: 1,
    registry: localPackOrigin,
    packageName: packageDocument.name,
    packageVersion: packageDocument.version,
    sourceRevision: manifest.sourceRevision,
    sourceDirty: manifest.sourceDirty,
    entrypoint: manifest.entrypoint,
    npmShasum,
    npmIntegrity,
    manifestSha256,
    resourcesSha256: manifest.resourcesSha256,
    resourceCount: manifest.resources.length,
  }
  if (
    Object.keys(identity).join(",") !==
    Object.keys(PUBLISHED_ARTIFACT_IDENTITY).join(",")
  ) {
    throw new Error("Current-source identity fields differ from the runtime contract.")
  }
  return { distRoot, identity }
}

export const acceptanceRunPlan = ({ certificatePath, keyPath }) => [
  { mode: "local", tls: null },
  {
    mode: "remote",
    tls: { certificatePath, keyPath, hostname: remoteHostname },
  },
]

const downloadAndVerifyArtifact = (temporaryRoot) => {
  const cacheRoot = path.join(temporaryRoot, "npm-cache")
  mkdirSync(cacheRoot, { mode: 0o700 })
  const packageSpec = `${PUBLISHED_ARTIFACT_IDENTITY.packageName}@${PUBLISHED_ARTIFACT_IDENTITY.packageVersion}`
  const { stdout } = npmInvocation([
    "pack",
    packageSpec,
    "--json",
    "--ignore-scripts",
    "--prefer-online",
    `--cache=${cacheRoot}`,
    `--registry=${PUBLISHED_ARTIFACT_IDENTITY.registry}`,
    `--pack-destination=${temporaryRoot}`,
  ])
  const filename = parsePackResult(stdout)
  const tarballPath = path.join(temporaryRoot, filename)
  const { stdout: listing } = runCaptured("tar", ["-tzf", tarballPath])
  assertSafeTarMembers(listing)
  const extractRoot = path.join(temporaryRoot, "registry")
  mkdirSync(extractRoot, { mode: 0o700 })
  runCaptured("tar", ["-xzf", tarballPath, "-C", extractRoot])
  return verifyExtractedPublishedArtifact({
    tarballPath,
    packageRoot: path.join(extractRoot, "package"),
  })
}

export const packAndVerifyCurrentArtifact = (temporaryRoot) => {
  const expectedRevision = runCaptured("git", ["rev-parse", "HEAD^{commit}"]).stdout.trim()
  if (process.env.GITHUB_SHA && expectedRevision !== process.env.GITHUB_SHA) {
    throw new Error("Current-source checkout does not match the workflow head SHA.")
  }
  const packageDocument = JSON.parse(
    readFileSync(path.join(repositoryRoot, "package.json"), "utf8"),
  )
  const expectedVersion = assertPackageVersion(packageDocument.version)
  const sourceDistRoot = path.join(repositoryRoot, "dist")
  verifyArtifactManifest({
    distDirectory: sourceDistRoot,
    expectedPackageName: PUBLISHED_ARTIFACT_IDENTITY.packageName,
    expectedPackageVersion: expectedVersion,
    expectedSourceRevision: expectedRevision,
    expectedSourceDirty: false,
  })

  const { stdout } = npmInvocation([
    "pack",
    "--json",
    "--ignore-scripts",
    `--pack-destination=${temporaryRoot}`,
  ])
  const packRecord = parsePackRecord(stdout)
  const expectedFilename = `bigduu-lotus-next-${expectedVersion}.tgz`
  if (packRecord.filename !== expectedFilename) {
    throw new Error("Current-source npm pack returned a different tarball filename.")
  }
  const tarballPath = path.join(temporaryRoot, expectedFilename)
  const { stdout: listing } = runCaptured("tar", ["-tzf", tarballPath])
  assertSafeTarMembers(listing)
  const extractRoot = path.join(temporaryRoot, "current-source")
  mkdirSync(extractRoot, { mode: 0o700 })
  runCaptured("tar", ["-xzf", tarballPath, "-C", extractRoot])
  return verifyExtractedCurrentArtifact({
    tarballPath,
    packageRoot: path.join(extractRoot, "package"),
    sourceDistRoot,
    expectedRevision,
    expectedVersion,
    packRecord,
  })
}

const generateTlsIdentity = (temporaryRoot) => {
  const tlsRoot = path.join(temporaryRoot, "tls")
  const certificatePath = path.join(tlsRoot, "remote.lotus.test.crt")
  const keyPath = path.join(tlsRoot, "remote.lotus.test.key")
  mkdirSync(tlsRoot, { mode: 0o700 })
  runCaptured("openssl", [
    "req",
    "-x509",
    "-newkey",
    "rsa:2048",
    "-sha256",
    "-days",
    "1",
    "-nodes",
    "-keyout",
    keyPath,
    "-out",
    certificatePath,
    "-subj",
    `/CN=${remoteHostname}`,
    "-addext",
    `subjectAltName=DNS:${remoteHostname},IP:127.0.0.1`,
    "-addext",
    "basicConstraints=critical,CA:TRUE",
  ])
  chmodSync(certificatePath, 0o600)
  chmodSync(keyPath, 0o600)
  return { certificatePath, keyPath }
}

const runAcceptanceMode = ({ mode, tls }, artifact) => {
  const environment = {
    ...process.env,
    LOTUS_REAL_ACCEPTANCE_MODE: mode,
    LOTUS_REAL_ARTIFACT_DIR: artifact.distRoot,
    LOTUS_REAL_ARTIFACT_IDENTITY: JSON.stringify(artifact.identity),
  }
  delete environment.LOTUS_REAL_BAMBOO_TLS_CERT
  delete environment.LOTUS_REAL_BAMBOO_TLS_KEY
  if (tls) {
    environment.LOTUS_REAL_BAMBOO_TLS_CERT = tls.certificatePath
    environment.LOTUS_REAL_BAMBOO_TLS_KEY = tls.keyPath
    environment.LOTUS_REAL_REMOTE_HOSTNAME = tls.hostname
    environment.NODE_EXTRA_CA_CERTS = tls.certificatePath
  } else {
    delete environment.LOTUS_REAL_REMOTE_HOSTNAME
  }

  process.stdout.write(
    `Running ${mode} real-Bamboo acceptance for ${artifact.identity.packageName}@${artifact.identity.packageVersion}.\n`,
  )
  runInherited(
    process.execPath,
    [
      playwrightCli,
      "test",
      "--config=playwright.real-bamboo.config.ts",
      "--grep",
      "verified artifact browser surfaces",
    ],
    { env: environment },
  )
}

const main = () => {
  const arguments_ = process.argv.slice(2)
  const artifactMode = acceptanceArtifactMode(arguments_)
  if (!process.env.BAMBOO_E2E_SOURCE_DIR?.trim()) {
    throw new Error(
      "Set BAMBOO_E2E_SOURCE_DIR to the clean exact Bamboo checkout required by the real-runtime harness.",
    )
  }
  const temporaryRoot = mkdtempSync(
    path.join(tmpdir(), `lotus-next-${artifactMode}-acceptance-`),
  )
  chmodSync(temporaryRoot, 0o700)
  try {
    const artifact = artifactMode === "current-source"
      ? packAndVerifyCurrentArtifact(temporaryRoot)
      : downloadAndVerifyArtifact(temporaryRoot)
    process.stdout.write(
      `Verified ${artifactMode} artifact ${JSON.stringify(artifact.identity)}.\n`,
    )
    const tls = generateTlsIdentity(temporaryRoot)
    for (const mode of acceptanceRunPlan(tls)) {
      runAcceptanceMode(mode, artifact)
    }
    if (arguments_.length === 3) {
      const accepted = writeAcceptedIdentity(arguments_[2], artifact.identity)
      process.stdout.write(`Recorded successful local and secure browser acceptance: ${JSON.stringify(accepted)}.\n`)
    }
  } finally {
    rmSync(temporaryRoot, { recursive: true, force: true })
  }
}

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  try {
    main()
  } catch (error) {
    process.stderr.write(
      `${error instanceof Error ? error.message : String(error)}\n`,
    )
    process.exitCode = 1
  }
}
