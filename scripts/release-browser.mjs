// Publication controls only. The accepted source, Playwright 1.62.1, original
// device descriptors (Chrome/151 UA), tests and Bamboo's inner browser stay fixed.
import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { closeSync, createWriteStream, lstatSync, mkdirSync, openSync, readFileSync, readSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { fileURLToPath, pathToFileURL } from "node:url"

export const ACCEPTED_SOURCE_SHA = "ad9ab8ffb9502fa538c9f36e112dfd4b1a1e8801"
export const BROWSER_VERSION = "157.0.8090.0"
export const BROWSER_PINS = Object.freeze(Object.fromEntries(Object.entries({
  linux64: {
    storageGeneration: "1791347145686020", archiveBytes: 126644064,
    archiveSha256: "d9ddf607a28eb5e16a26fd42d92d86e05660f1913277221537e3cc5bc128ba61",
    executableBytes: 209173840,
    executableSha256: "13753fd7dbfd20c125558f924b7f6e613aa16d5dba749fede48863b21bd446ff",
  },
  "mac-arm64": {
    storageGeneration: "1791348856605143", archiveBytes: 104463222,
    archiveSha256: "c069aff36f553d6a1ed974c90c02b675f4e8de1c6539e11499d7750e04df0331",
    executableBytes: 178166576,
    executableSha256: "4d5d635f89be213225e91ba99056a40fe1d6b59ece797fccb79965c67c290cd3",
  },
}).map(([platform, pin]) => [platform, Object.freeze({
  ...pin, platform, version: BROWSER_VERSION,
  url: `https://storage.googleapis.com/chrome-for-testing-public/${BROWSER_VERSION}/${platform}/chrome-headless-shell-${platform}.zip`,
  executableRelativePath: `chrome-headless-shell-${platform}/chrome-headless-shell`,
})])))

const originals = Object.freeze({
  "all-surface": { filename: "playwright.config.ts", sha256: "650932c2497d01ea26e310e4cb1509e6735582fe2c4a19a48ce7cd455ab25e4b" },
  "real-bamboo": { filename: "playwright.real-bamboo.config.ts", sha256: "037f378cbeaf62ff6d1d6fba5b8e2df6b7373ca3f8b3b23df8f578b3d5442c12" },
})
// SHA-256 of canonical original config objects, evaluated with the locked runner.
// Undefined values are retained. This guards every project, dependency, device,
// match/ignore, retry, worker, timeout, TLS and launch setting, not a subset.
const configDigests = Object.freeze({
  "all-surface:false:": "7fab35a01c7d0933d882301bdb149d01065ac42ce86fcf26910c79f40af79f16",
  "all-surface:true:": "56891657a660792092a93b3fc970a0486de2303f3f54abf4f352597bc120eb59",
  "real-bamboo:false:": "c592525a5e8b91921c9798af0d2c4b5183b168ec787ff27171a81b159d1f8aec",
  "real-bamboo:false:local": "b5d144bb4febbb9d363ee7d689a021b29fae10810aa926903cd5a7c6c8fc6f71",
  "real-bamboo:false:remote": "6142963c3e60162ef789ce6ee21cd05c2269a8737697aee3594356a0509a6e56",
  "real-bamboo:true:": "761ae3cb471e38be4ed35a2fde7309455f0d7f1a0ba1df2332692250cf1af29f",
  "real-bamboo:true:local": "a563614c5c3695612afc56dbc5ffde7ed35f7b84c91b47ef647f62675718ee69",
  "real-bamboo:true:remote": "1501b65ee2b1f02ec996b351a9dfc30d52aef622a18a9ac3e9880821940e4825",
})
const helperPath = fileURLToPath(import.meta.url)
const canonical = (value) => value === undefined ? { $undefined: true }
  : Array.isArray(value) ? value.map(canonical)
    : value !== null && typeof value === "object"
      ? Object.fromEntries(Object.keys(value).sort().map((key) => [key, canonical(value[key])])) : value
const digest = (value) => createHash("sha256").update(value).digest("hex")

export const fileSha256 = (filename) => {
  const fd = openSync(filename, "r")
  const hash = createHash("sha256")
  const buffer = Buffer.alloc(1024 * 1024)
  try {
    let size
    while ((size = readSync(fd, buffer, 0, buffer.length, null)) > 0) hash.update(buffer.subarray(0, size))
    return hash.digest("hex")
  } finally { closeSync(fd) }
}

const regularFile = (filename) => {
  const stat = lstatSync(filename)
  assert(stat.isFile() && !stat.isSymbolicLink(), `Expected a regular file: ${filename}`)
  assert.equal(realpathSync(filename), path.resolve(filename), "Symlinked file paths are unsupported")
  return stat
}
export const verifyFileIdentity = (filename, bytes, sha256) => {
  assert(Number.isSafeInteger(bytes) && bytes > 0 && /^[a-f0-9]{64}$/u.test(sha256), "Missing pinned file identity")
  assert.equal(regularFile(filename).size, bytes, "Pinned file length mismatch")
  assert.equal(fileSha256(filename), sha256, "Pinned file SHA-256 mismatch")
  return filename
}
export const browserPlatform = (platform = process.platform, arch = process.arch) => {
  if (platform === "linux" && arch === "x64") return "linux64"
  if (platform === "darwin" && arch === "arm64") return "mac-arm64"
  throw new Error(`No reviewed publication browser for ${platform}/${arch}`)
}
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${command} failed: ${result.stderr || result.signal || result.status}`)
  return result.stdout.trim()
}
const outsideSource = (directory, sourceRoot) => {
  assert(path.isAbsolute(directory) && path.isAbsolute(sourceRoot), "Absolute paths required")
  const relative = path.relative(sourceRoot, directory)
  assert(relative === ".." || relative.startsWith(`..${path.sep}`), "Browser controls must stay outside the source checkout")
}
const context = (sourceRoot, browserRoot, env = process.env) => {
  assert.equal(realpathSync(sourceRoot), sourceRoot, "Source root must be canonical")
  assert(env.RUNNER_TEMP && /^[a-f0-9]{40}$/u.test(env.PUBLICATION_WORKFLOW_SHA ?? ""), "Missing publication workflow identity")
  assert.equal(env.GITHUB_SHA, env.PUBLICATION_WORKFLOW_SHA, "Workflow identity mismatch")
  assert.equal(env.LOTUS_NEXT_EXPECTED_SOURCE_REVISION, ACCEPTED_SOURCE_SHA, "Unexpected accepted source")
  assert(/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID ?? "") && /^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ATTEMPT ?? ""), "Missing run identity")
  const runnerTemp = realpathSync(env.RUNNER_TEMP)
  assert.equal(browserRoot, path.join(runnerTemp, "release-browser"), "Unexpected publication browser directory")
  assert.equal(helperPath, path.join(runnerTemp, "release-control", "release-browser.mjs"), "Use the preserved workflow control helper")
  outsideSource(browserRoot, sourceRoot)
  outsideSource(helperPath, sourceRoot)
  assert.equal(run("git", ["-C", sourceRoot, "rev-parse", "HEAD"]), ACCEPTED_SOURCE_SHA, "Source checkout drift")
  for (const original of Object.values(originals)) {
    regularFile(path.join(sourceRoot, original.filename))
    assert.equal(fileSha256(path.join(sourceRoot, original.filename)), original.sha256, "Original config bytes changed")
  }
  for (const name of ["@playwright/test", "playwright", "playwright-core"]) {
    assert.equal(JSON.parse(readFileSync(path.join(sourceRoot, "node_modules", name, "package.json"))).version, "1.62.1", "Use the original locked Playwright")
  }
  return { sourceRoot, sourceSha: ACCEPTED_SOURCE_SHA, workflowSha: env.PUBLICATION_WORKFLOW_SHA,
    runId: env.GITHUB_RUN_ID, runAttempt: env.GITHUB_RUN_ATTEMPT, controlSha256: fileSha256(helperPath) }
}

export const assertDownloadResponse = (response, pin) => {
  assert.equal(response.status, 200, "Browser download requires HTTP 200")
  assert.equal(response.headers.get("x-goog-generation"), pin.storageGeneration, "Browser storage generation mismatch")
  assert.equal(response.headers.get("content-length"), String(pin.archiveBytes), "Browser content length mismatch")
  assert.equal(response.headers.get("x-goog-stored-content-length"), String(pin.archiveBytes), "Browser stored length mismatch")
  assert([null, "identity"].includes(response.headers.get("content-encoding")), "Encoded browser response is unsupported")
}
export const downloadPinnedArchive = async (pin, archivePath, request = fetch) => {
  const head = await request(pin.url, { method: "HEAD", redirect: "error" })
  assertDownloadResponse(head, pin)
  const response = await request(pin.url, { redirect: "error" })
  assertDownloadResponse(response, pin)
  assert(response.body, "Missing browser archive body")
  let bytes = 0
  const hash = createHash("sha256")
  await pipeline(Readable.fromWeb(response.body), new Transform({
    transform(chunk, _encoding, callback) {
      bytes += chunk.length
      if (bytes > pin.archiveBytes) return callback(new Error("Browser archive exceeds pinned length"))
      hash.update(chunk)
      callback(null, chunk)
    },
  }), createWriteStream(archivePath, { flags: "wx", mode: 0o600 }))
  assert.equal(bytes, pin.archiveBytes, "Browser downloaded length mismatch")
  assert.equal(hash.digest("hex"), pin.archiveSha256, "Browser archive SHA-256 mismatch")
}

// Validate the complete inventory before writing anything; reject links, special
// files, traversal, duplicate names and file/directory conflicts. Python's stdlib
// handles ZIP CRC checks. No shell, external dependency, or archive install hook.
export const ZIP_EXTRACTOR = String.raw`
import os, pathlib, shutil, stat, sys, zipfile
archive, destination, executable = sys.argv[1:]
root = pathlib.Path(destination)
assert not root.exists(), "Extraction destination already exists"
with zipfile.ZipFile(archive) as bundle:
    members = bundle.infolist()
    assert 0 < len(members) < 10000, "Unexpected ZIP inventory"
    names = set()
    files = set()
    total = 0
    prefix = executable.split('/')[0]
    for entry in members:
        name = entry.filename.rstrip('/')
        parts = name.split('/')
        mode = entry.external_attr >> 16
        assert name and name == entry.orig_filename.rstrip('/'), "Invalid ZIP name"
        assert '\\' not in name and '\x00' not in name, "Unsafe ZIP name"
        assert all(part not in ('', '.', '..') for part in parts), "Unsafe ZIP path"
        assert parts[0] == prefix and len(parts) > 1, "Unexpected ZIP root"
        assert name not in names, "Duplicate ZIP path"
        assert stat.S_IFMT(mode) in (stat.S_IFREG, stat.S_IFDIR), "Unsafe ZIP file type"
        assert bool(stat.S_ISDIR(mode)) == entry.is_dir(), "ZIP type mismatch"
        assert not (entry.flag_bits & 1), "Encrypted ZIP entry"
        names.add(name)
        if not entry.is_dir(): files.add(name)
        total += entry.file_size
    assert executable in files and total < 1000000000, "Unexpected ZIP contents"
    for name in names:
        assert all(str(parent) not in files for parent in pathlib.PurePosixPath(name).parents), "ZIP path conflict"
    root.mkdir(mode=0o700)
    for entry in members:
        target = root / entry.filename
        if entry.is_dir():
            target.mkdir(parents=True, exist_ok=True, mode=0o700)
        else:
            target.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
            with bundle.open(entry) as source, target.open('xb') as output:
                shutil.copyfileobj(source, output)
            target.chmod(0o755 if entry.external_attr >> 16 & 0o111 else 0o644)
`
export const extractPinnedArchive = (archivePath, destination, pin) => {
  verifyFileIdentity(archivePath, pin.archiveBytes, pin.archiveSha256)
  run("python3", ["-c", ZIP_EXTRACTOR, archivePath, destination, pin.executableRelativePath])
  return verifyFileIdentity(path.join(destination, pin.executableRelativePath), pin.executableBytes, pin.executableSha256)
}
export const assertBrowserVersion = (version) => {
  assert(/^(?:Google Chrome for Testing|Chromium|Chrome Headless Shell|HeadlessChrome) 157\.0\.8090\.0$/u.test(version), "Unexpected actual browser version")
  return version
}

export const assertOriginalConfig = (original, { kind, env = process.env }) => {
  const mode = kind === "real-bamboo" ? (env.LOTUS_REAL_ACCEPTANCE_MODE?.trim() ?? "") : ""
  const expected = configDigests[`${kind}:${Boolean(env.CI)}:${mode}`]
  assert(expected, "Unsupported original config mode")
  assert.equal(digest(JSON.stringify(canonical(original))), expected, "Original Playwright config shape changed")
}
export const deriveConfig = (original, { kind, sourceRoot, executablePath, env = process.env }) => {
  assertOriginalConfig(original, { kind, env })
  assert(path.isAbsolute(sourceRoot) && path.isAbsolute(executablePath), "Absolute config and executable paths required")
  outsideSource(executablePath, sourceRoot)
  return {
    ...original,
    testDir: path.resolve(sourceRoot, original.testDir),
    outputDir: path.resolve(sourceRoot, original.outputDir),
    ...(original.globalSetup ? { globalSetup: path.resolve(sourceRoot, original.globalSetup) } : {}),
    reporter: original.reporter.map(([name, options]) => name === "html"
      ? [name, { ...options, outputFolder: path.resolve(sourceRoot, options.outputFolder) }] : [name, ...(options ? [options] : [])]),
    use: { ...original.use, launchOptions: { ...original.use.launchOptions, executablePath } },
  }
}
export const assertConfigEquivalent = (original, derived, options) => {
  assert.deepEqual(derived, deriveConfig(original, options), "Publication config changed more than paths and browser selection")
}
export const wrapperContents = ({ sourceRoot, browserRoot, kind }) => {
  assert(originals[kind], "Unknown original config")
  return `import original from ${JSON.stringify(pathToFileURL(path.join(sourceRoot, originals[kind].filename)).href)}\n` +
    `import { publicationConfig } from ${JSON.stringify(pathToFileURL(helperPath).href)}\n` +
    `export default publicationConfig(original, ${JSON.stringify({ sourceRoot, browserRoot, kind })})\n`
}
export const verifyBrowserRecord = ({ record, expectedContext, browserRoot, platform = browserPlatform() }) => {
  const pin = BROWSER_PINS[platform]
  assert(pin, "Unsupported browser platform")
  const executablePath = path.join(browserRoot, "extracted", pin.executableRelativePath)
  assert.deepEqual(record, { schemaVersion: 1, ...expectedContext, ...pin,
    executablePath, actualVersion: assertBrowserVersion(record?.actualVersion) }, "Browser record identity mismatch")
  verifyFileIdentity(executablePath, pin.executableBytes, pin.executableSha256)
  return executablePath
}
export const publicationConfigPath = ({ sourceRoot, browserRoot, kind, env = process.env }) => {
  const expectedContext = context(sourceRoot, browserRoot, env)
  const recordPath = path.join(browserRoot, "browser-identity.json")
  regularFile(recordPath)
  const record = JSON.parse(readFileSync(recordPath, "utf8"))
  verifyBrowserRecord({ record, expectedContext, browserRoot })
  const filename = path.join(browserRoot, `${kind}.config.mjs`)
  regularFile(filename)
  assert.equal(readFileSync(filename, "utf8"), wrapperContents({ sourceRoot, browserRoot, kind }), "Publication wrapper changed")
  return filename
}
export const publicationConfig = (original, options) => {
  publicationConfigPath(options)
  const pin = BROWSER_PINS[browserPlatform()]
  return deriveConfig(original, { ...options, executablePath: path.join(options.browserRoot, "extracted", pin.executableRelativePath) })
}
export const preparePublicationBrowser = async (sourceRoot, browserRoot) => {
  const expectedContext = context(sourceRoot, browserRoot)
  const pin = BROWSER_PINS[browserPlatform()]
  mkdirSync(browserRoot, { mode: 0o700 }) // Existing state is an error, never a cache/fallback.
  assert.equal(realpathSync(browserRoot), browserRoot, "Browser root must be canonical")
  const archivePath = path.join(browserRoot, "browser.zip")
  await downloadPinnedArchive(pin, archivePath)
  const executablePath = extractPinnedArchive(archivePath, path.join(browserRoot, "extracted"), pin)
  const actualVersion = assertBrowserVersion(run(executablePath, ["--version"]))
  const record = { schemaVersion: 1, ...expectedContext, ...pin, executablePath, actualVersion }
  writeFileSync(path.join(browserRoot, "browser-identity.json"), JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 })
  for (const kind of Object.keys(originals)) {
    writeFileSync(path.join(browserRoot, `${kind}.config.mjs`), wrapperContents({ sourceRoot, browserRoot, kind }), { flag: "wx", mode: 0o600 })
  }
  process.stdout.write(`Verified outer browser (original device UA remains unchanged): ${JSON.stringify(record)}\n`)
}
if (process.argv[1] && path.resolve(process.argv[1]) === helperPath) {
  try {
    assert(process.argv.length === 5 && process.argv[2] === "prepare", "Usage: release-browser.mjs prepare SOURCE_ROOT BROWSER_ROOT")
    await preparePublicationBrowser(realpathSync(process.argv[3]), path.resolve(process.argv[4]))
  } catch (error) {
    process.stderr.write(`${error.message}\n`)
    process.exitCode = 1
  }
}
