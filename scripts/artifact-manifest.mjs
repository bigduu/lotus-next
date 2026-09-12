import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"

export const ARTIFACT_MANIFEST_FILE = "lotus-next-manifest.json"
export const ARTIFACT_MANIFEST_SCHEMA_VERSION = 1
export const LOTUS_NEXT_PACKAGE_NAME = "@bigduu/lotus-next"

const manifestKeys = [
  "schemaVersion",
  "packageName",
  "packageVersion",
  "sourceRevision",
  "sourceDirty",
  "entrypoint",
  "resourcesSha256",
  "resources",
]
const resourceKeys = ["path", "size", "sha256"]
const strictSemver =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*)(?:\.(?:0|[1-9]\d*|\d*[A-Za-z-][0-9A-Za-z-]*))*))?(?:\+([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?$/
const revisionPattern = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/
const sha256Pattern = /^[0-9a-f]{64}$/
const containsControlCharacter = (value) => /\p{Cc}/u.test(value)

const sha256 = (value) => createHash("sha256").update(value).digest("hex")

const assertExactKeys = (value, expected, label) => {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  const actual = Object.keys(value)
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw new Error(`${label} must contain exactly: ${expected.join(", ")}.`)
  }
}

export const assertPackageVersion = (version) => {
  if (typeof version !== "string" || !strictSemver.test(version)) {
    throw new Error(`Package version ${JSON.stringify(version)} is not strict SemVer.`)
  }
  return version
}

export const assertSourceRevision = (revision) => {
  if (typeof revision !== "string" || !revisionPattern.test(revision)) {
    throw new Error("Source revision must be a lowercase 40- or 64-character Git object ID.")
  }
  return revision
}

export const assertResourcePath = (resourcePath) => {
  if (
    typeof resourcePath !== "string" ||
    resourcePath.length === 0 ||
    resourcePath !== resourcePath.normalize("NFC") ||
    resourcePath.startsWith("/") ||
    resourcePath.includes("\\") ||
    containsControlCharacter(resourcePath)
  ) {
    throw new Error(`Unsafe artifact resource path: ${JSON.stringify(resourcePath)}.`)
  }

  const segments = resourcePath.split("/")
  if (
    segments.some((segment) => segment.length === 0 || segment === "." || segment === "..") ||
    path.posix.normalize(resourcePath) !== resourcePath
  ) {
    throw new Error(`Unsafe artifact resource path: ${JSON.stringify(resourcePath)}.`)
  }
  if (resourcePath === ARTIFACT_MANIFEST_FILE) {
    throw new Error("The universal artifact manifest must not list itself as a resource.")
  }
  return resourcePath
}

const assertRegularFile = (filePath, label) => {
  const metadata = lstatSync(filePath)
  if (metadata.isSymbolicLink() || !metadata.isFile()) {
    throw new Error(`${label} must be a regular file and must not be a symbolic link.`)
  }
  return metadata
}

const assertArtifactDirectory = (distDirectory) => {
  const metadata = lstatSync(distDirectory)
  if (metadata.isSymbolicLink() || !metadata.isDirectory()) {
    throw new Error("Artifact dist root must be a directory and must not be a symbolic link.")
  }
}

const listResourcePaths = (distDirectory) => {
  assertArtifactDirectory(distDirectory)
  const resources = []

  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) =>
      left.name.localeCompare(right.name),
    )) {
      const relativePath = prefix ? `${prefix}/${entry.name}` : entry.name
      const absolutePath = path.join(directory, entry.name)
      if (relativePath === ARTIFACT_MANIFEST_FILE) continue
      assertResourcePath(relativePath)

      if (entry.isSymbolicLink()) {
        throw new Error(`Artifact resource ${relativePath} must not be a symbolic link.`)
      }
      if (entry.isDirectory()) {
        visit(absolutePath, relativePath)
      } else if (entry.isFile()) {
        resources.push(relativePath)
      } else {
        throw new Error(`Artifact resource ${relativePath} is not a regular file.`)
      }
    }
  }

  visit(distDirectory, "")
  return resources.sort()
}

const resourceRecord = (distDirectory, resourcePath) => {
  assertResourcePath(resourcePath)
  const absolutePath = path.join(distDirectory, ...resourcePath.split("/"))
  const metadata = assertRegularFile(absolutePath, `Artifact resource ${resourcePath}`)
  const contents = readFileSync(absolutePath)
  if (metadata.size !== contents.byteLength) {
    throw new Error(`Artifact resource ${resourcePath} changed while it was being read.`)
  }
  return {
    path: resourcePath,
    size: contents.byteLength,
    sha256: sha256(contents),
  }
}

export const calculateResourcesSha256 = (resources) =>
  sha256(
    resources
      .map((resource) => `${resource.path}\0${resource.size}\0${resource.sha256}\n`)
      .join(""),
  )

const readPackageIdentity = (packageJsonPath) => {
  let document
  try {
    document = JSON.parse(readFileSync(packageJsonPath, "utf8"))
  } catch (error) {
    throw new Error(
      `Could not read package identity from ${packageJsonPath}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  if (document.name !== LOTUS_NEXT_PACKAGE_NAME) {
    throw new Error(`Package name must be exactly ${LOTUS_NEXT_PACKAGE_NAME}.`)
  }
  return {
    packageName: document.name,
    packageVersion: assertPackageVersion(document.version),
  }
}

const readGitIdentity = (repositoryDirectory) => {
  const runGit = (arguments_) =>
    execFileSync("git", arguments_, {
      cwd: repositoryDirectory,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim()

  const revision = assertSourceRevision(runGit(["rev-parse", "HEAD"]))
  const status = runGit(["status", "--porcelain", "--untracked-files=normal"])
  return { revision, dirty: status.length > 0 }
}

const resolveSourceIdentity = (repositoryDirectory, environment) => {
  const gitIdentity = readGitIdentity(repositoryDirectory)
  const revision = environment.LOTUS_NEXT_SOURCE_REVISION
    ? assertSourceRevision(environment.LOTUS_NEXT_SOURCE_REVISION)
    : gitIdentity.revision
  if (revision !== gitIdentity.revision) {
    throw new Error(
      `Requested source revision ${revision} does not match checked-out HEAD ${gitIdentity.revision}.`,
    )
  }

  let dirty = gitIdentity.dirty
  if (environment.LOTUS_NEXT_SOURCE_DIRTY !== undefined) {
    if (!new Set(["true", "false"]).has(environment.LOTUS_NEXT_SOURCE_DIRTY)) {
      throw new Error("LOTUS_NEXT_SOURCE_DIRTY must be exactly true or false when provided.")
    }
    dirty = environment.LOTUS_NEXT_SOURCE_DIRTY === "true"
  }
  return { revision, dirty }
}

export const buildArtifactManifest = ({
  distDirectory,
  packageName = LOTUS_NEXT_PACKAGE_NAME,
  packageVersion,
  sourceRevision,
  sourceDirty,
}) => {
  if (packageName !== LOTUS_NEXT_PACKAGE_NAME) {
    throw new Error(`Package name must be exactly ${LOTUS_NEXT_PACKAGE_NAME}.`)
  }
  assertPackageVersion(packageVersion)
  assertSourceRevision(sourceRevision)
  if (typeof sourceDirty !== "boolean") {
    throw new Error("sourceDirty must be a boolean.")
  }

  const existingManifestPath = path.join(distDirectory, ARTIFACT_MANIFEST_FILE)
  if (existsSync(existingManifestPath)) {
    assertRegularFile(existingManifestPath, "Existing universal artifact manifest")
  }

  const resourcePaths = listResourcePaths(distDirectory)
  if (!resourcePaths.includes("index.html")) {
    throw new Error("Artifact entrypoint index.html is missing.")
  }
  const resources = resourcePaths.map((resourcePath) =>
    resourceRecord(distDirectory, resourcePath),
  )
  return {
    schemaVersion: ARTIFACT_MANIFEST_SCHEMA_VERSION,
    packageName,
    packageVersion,
    sourceRevision,
    sourceDirty,
    entrypoint: "index.html",
    resourcesSha256: calculateResourcesSha256(resources),
    resources,
  }
}

export const writeArtifactManifest = ({
  distDirectory,
  packageJsonPath,
  repositoryDirectory,
  environment = process.env,
}) => {
  const packageIdentity = readPackageIdentity(packageJsonPath)
  const sourceIdentity = resolveSourceIdentity(repositoryDirectory, environment)
  const manifest = buildArtifactManifest({
    distDirectory,
    ...packageIdentity,
    sourceRevision: sourceIdentity.revision,
    sourceDirty: sourceIdentity.dirty,
  })
  const manifestPath = path.join(distDirectory, ARTIFACT_MANIFEST_FILE)
  if (existsSync(manifestPath)) {
    assertRegularFile(manifestPath, "Existing universal artifact manifest")
  }
  writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "w",
    mode: 0o644,
  })
  return manifest
}

const parseManifest = (manifestPath) => {
  assertRegularFile(manifestPath, "Universal artifact manifest")
  const source = readFileSync(manifestPath, "utf8")
  let manifest
  try {
    manifest = JSON.parse(source)
  } catch (error) {
    throw new Error(
      `Universal artifact manifest is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const canonical = `${JSON.stringify(manifest, null, 2)}\n`
  if (source !== canonical) {
    throw new Error("Universal artifact manifest is not in its exact canonical JSON form.")
  }
  return manifest
}

export const verifyArtifactManifest = ({
  distDirectory,
  expectedPackageName,
  expectedPackageVersion,
  expectedSourceRevision,
  expectedSourceDirty,
}) => {
  const manifestPath = path.join(distDirectory, ARTIFACT_MANIFEST_FILE)
  const manifest = parseManifest(manifestPath)
  assertExactKeys(manifest, manifestKeys, "Universal artifact manifest")

  if (manifest.schemaVersion !== ARTIFACT_MANIFEST_SCHEMA_VERSION) {
    throw new Error(
      `Unsupported universal artifact manifest schema ${JSON.stringify(manifest.schemaVersion)}.`,
    )
  }
  if (manifest.packageName !== LOTUS_NEXT_PACKAGE_NAME) {
    throw new Error(`Artifact package name must be exactly ${LOTUS_NEXT_PACKAGE_NAME}.`)
  }
  assertPackageVersion(manifest.packageVersion)
  assertSourceRevision(manifest.sourceRevision)
  if (typeof manifest.sourceDirty !== "boolean") {
    throw new Error("Artifact sourceDirty must be a boolean.")
  }
  if (manifest.entrypoint !== "index.html") {
    throw new Error("Artifact entrypoint must be exactly index.html.")
  }
  if (!sha256Pattern.test(manifest.resourcesSha256)) {
    throw new Error("Artifact resourcesSha256 must be a lowercase SHA-256 digest.")
  }
  if (!Array.isArray(manifest.resources) || manifest.resources.length === 0) {
    throw new Error("Artifact resources must be a non-empty array.")
  }

  let previousPath
  for (const [index, resource] of manifest.resources.entries()) {
    assertExactKeys(resource, resourceKeys, `Artifact resource ${index}`)
    assertResourcePath(resource.path)
    if (previousPath !== undefined && resource.path <= previousPath) {
      throw new Error("Artifact resource paths must be unique and strictly sorted.")
    }
    if (!Number.isSafeInteger(resource.size) || resource.size < 0) {
      throw new Error(`Artifact resource ${resource.path} has an invalid byte size.`)
    }
    if (!sha256Pattern.test(resource.sha256)) {
      throw new Error(`Artifact resource ${resource.path} has an invalid SHA-256 digest.`)
    }
    previousPath = resource.path
  }
  if (!manifest.resources.some((resource) => resource.path === manifest.entrypoint)) {
    throw new Error("Artifact resources do not contain the declared entrypoint.")
  }
  if (calculateResourcesSha256(manifest.resources) !== manifest.resourcesSha256) {
    throw new Error("Artifact combined resource digest does not match its resource records.")
  }

  const actualPaths = listResourcePaths(distDirectory)
  const declaredPaths = manifest.resources.map((resource) => resource.path)
  if (
    actualPaths.length !== declaredPaths.length ||
    actualPaths.some((resourcePath, index) => resourcePath !== declaredPaths[index])
  ) {
    const missing = declaredPaths.filter((resourcePath) => !actualPaths.includes(resourcePath))
    const unlisted = actualPaths.filter((resourcePath) => !declaredPaths.includes(resourcePath))
    throw new Error(
      `Artifact resource inventory mismatch (missing: ${missing.join(", ") || "none"}; unlisted: ${unlisted.join(", ") || "none"}).`,
    )
  }

  for (const [index, resourcePath] of actualPaths.entries()) {
    const actual = resourceRecord(distDirectory, resourcePath)
    const declared = manifest.resources[index]
    if (actual.size !== declared.size || actual.sha256 !== declared.sha256) {
      throw new Error(`Artifact resource ${resourcePath} does not match its declared size and digest.`)
    }
  }

  const expectedValues = [
    ["package name", manifest.packageName, expectedPackageName],
    ["package version", manifest.packageVersion, expectedPackageVersion],
    ["source revision", manifest.sourceRevision, expectedSourceRevision],
    ["source dirty state", manifest.sourceDirty, expectedSourceDirty],
  ]
  for (const [label, actual, expected] of expectedValues) {
    if (expected !== undefined && actual !== expected) {
      throw new Error(`Artifact ${label} ${JSON.stringify(actual)} does not match expected ${JSON.stringify(expected)}.`)
    }
  }
  return manifest
}

const parseArguments = (arguments_) => {
  const values = new Map()
  for (let index = 0; index < arguments_.length; index += 2) {
    const name = arguments_[index]
    const value = arguments_[index + 1]
    if (!name?.startsWith("--") || value === undefined || values.has(name)) {
      throw new Error(`Invalid or duplicate command argument ${JSON.stringify(name)}.`)
    }
    values.set(name, value)
  }
  return values
}

const runCli = () => {
  const repositoryDirectory = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..")
  const [command, ...rawArguments] = process.argv.slice(2)
  const arguments_ = parseArguments(rawArguments)
  const allowedArguments =
    command === "generate"
      ? new Set(["--dist"])
      : new Set([
          "--dist",
          "--expected-name",
          "--expected-version",
          "--expected-revision",
          "--expected-dirty",
        ])
  for (const argumentName of arguments_.keys()) {
    if (!allowedArguments.has(argumentName)) {
      throw new Error(`Unsupported ${command ?? "unknown"} argument ${argumentName}.`)
    }
  }
  const distDirectory = path.resolve(
    repositoryDirectory,
    arguments_.get("--dist") ?? "dist",
  )

  if (command === "generate") {
    const manifest = writeArtifactManifest({
      distDirectory,
      packageJsonPath: path.join(repositoryDirectory, "package.json"),
      repositoryDirectory,
    })
    process.stdout.write(
      `Generated ${ARTIFACT_MANIFEST_FILE} for ${manifest.packageName}@${manifest.packageVersion} (${manifest.resources.length} resources, ${manifest.resourcesSha256}).\n`,
    )
    return
  }
  if (command === "verify") {
    const expectedDirty = arguments_.get("--expected-dirty")
    if (expectedDirty !== undefined && !new Set(["true", "false"]).has(expectedDirty)) {
      throw new Error("--expected-dirty must be exactly true or false.")
    }
    const manifest = verifyArtifactManifest({
      distDirectory,
      expectedPackageName: arguments_.get("--expected-name"),
      expectedPackageVersion: arguments_.get("--expected-version"),
      expectedSourceRevision: arguments_.get("--expected-revision"),
      expectedSourceDirty:
        expectedDirty === undefined ? undefined : expectedDirty === "true",
    })
    process.stdout.write(
      `Verified ${manifest.packageName}@${manifest.packageVersion} from ${manifest.sourceRevision} (${manifest.resources.length} resources, ${manifest.resourcesSha256}).\n`,
    )
    return
  }
  throw new Error("Usage: artifact-manifest.mjs generate|verify [--dist path] [expected identity options].")
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    runCli()
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`)
    process.exitCode = 1
  }
}
