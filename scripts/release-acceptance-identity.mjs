import { createHash } from "node:crypto"
import { lstatSync, readFileSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

import {
  ARTIFACT_MANIFEST_FILE,
  LOTUS_NEXT_PACKAGE_NAME,
  assertPackageVersion,
  assertSourceRevision,
  verifyArtifactManifest,
} from "./artifact-manifest.mjs"

export const ACCEPTED_IDENTITY_KEYS = [
  "sourceRevision",
  "packageVersion",
  "manifestSha256",
  "resourcesSha256",
  "resourceCount",
]

const sha256Pattern = /^[0-9a-f]{64}$/
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

export const assertAcceptedIdentity = (identity) => {
  if (
    typeof identity !== "object" ||
    identity === null ||
    Array.isArray(identity) ||
    Object.keys(identity).join(",") !== ACCEPTED_IDENTITY_KEYS.join(",")
  ) {
    throw new Error(`Accepted browser identity must contain exactly: ${ACCEPTED_IDENTITY_KEYS.join(", ")}.`)
  }
  assertSourceRevision(identity.sourceRevision)
  assertPackageVersion(identity.packageVersion)
  if (!sha256Pattern.test(identity.manifestSha256) || !sha256Pattern.test(identity.resourcesSha256)) {
    throw new Error("Accepted browser manifest and resource digests must be SHA-256 values.")
  }
  if (!Number.isSafeInteger(identity.resourceCount) || identity.resourceCount < 1) {
    throw new Error("Accepted browser resource count must be a positive safe integer.")
  }
  return identity
}

export const acceptedIdentityFromArtifact = (artifactIdentity) => {
  if (
    artifactIdentity?.registry !== "local-pack" ||
    artifactIdentity.packageName !== LOTUS_NEXT_PACKAGE_NAME ||
    artifactIdentity.sourceDirty !== false ||
    artifactIdentity.entrypoint !== "index.html"
  ) {
    throw new Error("Only a clean, current-source Lotus Next pack can become the browser acceptance identity.")
  }
  return assertAcceptedIdentity({
    sourceRevision: artifactIdentity.sourceRevision,
    packageVersion: artifactIdentity.packageVersion,
    manifestSha256: artifactIdentity.manifestSha256,
    resourcesSha256: artifactIdentity.resourcesSha256,
    resourceCount: artifactIdentity.resourceCount,
  })
}

export const writeAcceptedIdentity = (filePath, artifactIdentity) => {
  const accepted = acceptedIdentityFromArtifact(artifactIdentity)
  const parent = lstatSync(path.dirname(filePath))
  if (parent.isSymbolicLink() || !parent.isDirectory()) {
    throw new Error("Accepted browser identity parent must be a real directory.")
  }
  writeFileSync(filePath, `${JSON.stringify(accepted, null, 2)}\n`, {
    flag: "wx",
    mode: 0o600,
  })
  return accepted
}

const readAcceptedIdentity = (filePath) => {
  const metadata = lstatSync(filePath)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error("Accepted browser identity must be a regular file.")
  }
  const source = readFileSync(filePath, "utf8")
  const accepted = assertAcceptedIdentity(JSON.parse(source))
  if (source !== `${JSON.stringify(accepted, null, 2)}\n`) {
    throw new Error("Accepted browser identity must be canonical JSON.")
  }
  return accepted
}

export const verifyFinalPackAgainstAccepted = ({
  acceptedPath,
  distDirectory,
  expectedRevision,
  expectedVersion,
}) => {
  assertSourceRevision(expectedRevision)
  assertPackageVersion(expectedVersion)
  const accepted = readAcceptedIdentity(acceptedPath)
  if (accepted.sourceRevision !== expectedRevision || accepted.packageVersion !== expectedVersion) {
    throw new Error("Accepted browser identity belongs to a different source revision or package version.")
  }
  const manifest = verifyArtifactManifest({
    distDirectory,
    expectedPackageName: LOTUS_NEXT_PACKAGE_NAME,
    expectedPackageVersion: expectedVersion,
    expectedSourceRevision: expectedRevision,
    expectedSourceDirty: false,
  })
  const actual = assertAcceptedIdentity({
    sourceRevision: manifest.sourceRevision,
    packageVersion: manifest.packageVersion,
    manifestSha256: sha256(readFileSync(path.join(distDirectory, ARTIFACT_MANIFEST_FILE))),
    resourcesSha256: manifest.resourcesSha256,
    resourceCount: manifest.resources.length,
  })
  for (const key of ACCEPTED_IDENTITY_KEYS) {
    if (actual[key] !== accepted[key]) {
      throw new Error(`Final npm tarball ${key} differs from the real-Bamboo accepted browser artifact.`)
    }
  }
  return actual
}

const runCli = () => {
  const [command, ...rawArguments] = process.argv.slice(2)
  if (command !== "verify" || rawArguments.length !== 8) {
    throw new Error("Usage: release-acceptance-identity.mjs verify --accepted FILE --dist DIR --expected-version VERSION --expected-revision SHA")
  }
  const arguments_ = new Map()
  for (let index = 0; index < rawArguments.length; index += 2) {
    const name = rawArguments[index]
    const value = rawArguments[index + 1]
    if (!name?.startsWith("--") || !value || arguments_.has(name)) {
      throw new Error("Invalid accepted browser identity verification arguments.")
    }
    arguments_.set(name, value)
  }
  const keys = ["--accepted", "--dist", "--expected-version", "--expected-revision"]
  if (keys.some((key) => !arguments_.has(key)) || arguments_.size !== keys.length) {
    throw new Error("Accepted browser identity verification arguments are incomplete.")
  }
  const verified = verifyFinalPackAgainstAccepted({
    acceptedPath: arguments_.get("--accepted"),
    distDirectory: arguments_.get("--dist"),
    expectedVersion: arguments_.get("--expected-version"),
    expectedRevision: arguments_.get("--expected-revision"),
  })
  process.stdout.write(`Final npm tarball matches both real-Bamboo browser surfaces: ${JSON.stringify(verified)}\n`)
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
