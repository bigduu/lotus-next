// Data-only original npm archive support. A self-described archive never grants
// Source, publication or Main authority; trusted controller code owns those gates.
import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { gunzipSync } from "node:zlib"
import {
  ARTIFACT_MANIFEST_FILE, LOTUS_NEXT_PACKAGE_NAME, assertPackageVersion,
  assertResourcePath, calculateResourcesSha256,
} from "./artifact-manifest.mjs"
import { findUnexpectedPackagePaths } from "./package-policy.mjs"

export const REPOSITORY = "bigduu/lotus-next"
export const KIND = "lotus-original-npm/v1"
export const MAX_ARCHIVE = 64 * 1024 * 1024
const MAX_PROOF = 64 * 1024
export const MAX_ZIP = MAX_ARCHIVE + MAX_PROOF + 1024
const SHA = /^[0-9a-f]{40}$/u
const HASH = /^[0-9a-f]{64}$/u
const digest = (bytes, algorithm = "sha256", encoding = "hex") => createHash(algorithm).update(bytes).digest(encoding)
const json = (bytes) => JSON.parse(bytes.toString("utf8"))
const exact = (value, keys) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value))
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort(), "Unexpected original-output fields")
}
const positive = (value) => assert.ok(Number.isSafeInteger(value) && value > 0, "Positive numeric identity required")

export function inputs(value) {
  exact(value, ["repository", "version", "sourceRevision", "sourceTree"])
  assert.equal(value.repository, REPOSITORY)
  assertPackageVersion(value.version)
  assert.ok(value.version !== "0.0.0" && value.version.length <= 96)
  for (const key of ["sourceRevision", "sourceTree"]) assert.match(value[key], SHA)
  return value
}
export function origin(value) {
  exact(value, ["controllerRevision", "runId", "attempt", "jobId"])
  assert.match(value.controllerRevision, SHA)
  for (const key of ["runId", "attempt", "jobId"]) positive(value[key])
  return value
}
export const assetName = (expected) => `lotus-next-original-${inputs(expected).version}.zip`

const tarString = (bytes) => {
  const end = bytes.indexOf(0), value = bytes.subarray(0, end < 0 ? bytes.length : end)
  if (end >= 0) assert.ok(bytes.subarray(end).every((byte) => byte === 0), "Malformed tar string padding")
  assert.ok(value.every((byte) => byte >= 32 && byte < 127), "Unsupported tar path encoding")
  return value.toString("ascii")
}
const tarNumber = (bytes) => {
  assert.ok(bytes.every((byte) => byte === 0 || byte === 32 || byte >= 48 && byte <= 55))
  const text = bytes.toString("ascii").replaceAll("\0", " ").trim()
  assert.match(text, /^[0-7]+$/u)
  const value = Number.parseInt(text, 8)
  assert.ok(Number.isSafeInteger(value) && value >= 0)
  return value
}
// Keep the historical fixed verifier untouched. This new data parser follows
// npm's regular USTAR format; links/extensions/devices never reach a filesystem.
export function archiveFiles(archive) {
  assert.ok(Buffer.isBuffer(archive) && archive.length > 0 && archive.length <= MAX_ARCHIVE)
  const bytes = gunzipSync(archive, { maxOutputLength: MAX_ARCHIVE })
  assert.equal(bytes.length % 512, 0)
  const files = new Map()
  let offset = 0
  while (offset + 512 <= bytes.length && bytes.subarray(offset, offset + 512).some((byte) => byte !== 0)) {
    const header = bytes.subarray(offset, offset + 512)
    assert.equal(header.subarray(257, 265).toString("ascii"), "ustar\0" + "00")
    assert.equal(tarNumber(header.subarray(148, 156)), [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0))
    assert.ok(header[156] === 48 || header[156] === 0, "Original package contains a non-regular entry")
    assert.equal(tarString(header.subarray(157, 257)), "", "Tar links are forbidden")
    const prefix = tarString(header.subarray(345, 500)), leaf = tarString(header.subarray(0, 100))
    const name = prefix ? `${prefix}/${leaf}` : leaf
    assert.ok(name.startsWith("package/") && !name.includes("\\") && !name.includes(":"))
    assert.ok(name.split("/").every((part) => part && part !== "." && part !== ".."), "Unsafe archive path")
    assert.ok(!files.has(name), "Duplicate archive path")
    for (const earlier of files.keys()) assert.ok(!name.startsWith(`${earlier}/`) && !earlier.startsWith(`${name}/`), "Conflicting archive paths")
    const size = tarNumber(header.subarray(124, 136)), end = offset + 512 + size
    const next = offset + 512 + Math.ceil(size / 512) * 512
    assert.ok(next <= bytes.length && bytes.subarray(end, next).every((byte) => byte === 0), "Truncated or invalid tar entry")
    files.set(name, Buffer.from(bytes.subarray(offset + 512, end)))
    offset = next
  }
  assert.ok(files.size > 0 && bytes.length - offset >= 1024 && bytes.subarray(offset).every((byte) => byte === 0), "Missing tar terminator")
  return files
}

export function inspectArchive(archive, expected) {
  inputs(expected)
  const files = archiveFiles(archive)
  assert.deepEqual(findUnexpectedPackagePaths([...files.keys()].map((name) => name.slice("package/".length))), [])
  const packageJson = json(files.get("package/package.json"))
  assert.equal(packageJson.name, LOTUS_NEXT_PACKAGE_NAME)
  assert.equal(packageJson.version, expected.version)
  const manifestBytes = files.get(`package/dist/${ARTIFACT_MANIFEST_FILE}`), manifest = json(manifestBytes)
  exact(manifest, ["schemaVersion", "packageName", "packageVersion", "sourceRevision", "sourceDirty", "entrypoint", "resourcesSha256", "resources"])
  assert.equal(manifest.schemaVersion, 1)
  assert.equal(manifest.packageName, LOTUS_NEXT_PACKAGE_NAME)
  assert.equal(manifest.packageVersion, expected.version)
  assert.equal(manifest.sourceRevision, expected.sourceRevision)
  assert.equal(manifest.sourceDirty, false)
  assert.equal(manifest.entrypoint, "index.html")
  assert.match(manifest.resourcesSha256, HASH)
  assert.ok(Array.isArray(manifest.resources) && manifest.resources.length > 0 && manifest.resources.length <= 10000)
  const paths = []
  for (const resource of manifest.resources) {
    exact(resource, ["path", "size", "sha256"])
    assertResourcePath(resource.path)
    assert.ok(Number.isSafeInteger(resource.size) && resource.size >= 0)
    assert.match(resource.sha256, HASH)
    const bytes = files.get(`package/dist/${resource.path}`)
    assert.ok(bytes && bytes.length === resource.size && digest(bytes) === resource.sha256, "Original resource differs")
    paths.push(resource.path)
  }
  assert.equal(new Set(paths).size, paths.length)
  assert.deepEqual(paths, [...paths].sort(), "Resource order differs")
  assert.equal(calculateResourcesSha256(manifest.resources), manifest.resourcesSha256)
  assert.deepEqual([...files.keys()].filter((name) => name.startsWith("package/dist/") && name !== `package/dist/${ARTIFACT_MANIFEST_FILE}`)
    .map((name) => name.slice("package/dist/".length)).sort(), paths, "Original resource inventory differs")
  assert.ok(paths.includes("index.html") && paths.includes("asset-manifest.json") && paths.includes("bundle-ownership.json"))
  return { filename: `bigduu-lotus-next-${expected.version}.tgz`, size: archive.length,
    sha256: digest(archive), shasum: digest(archive, "sha1"), integrity: `sha512-${digest(archive, "sha512", "base64")}`,
    manifestSha256: digest(manifestBytes), resourcesSha256: manifest.resourcesSha256, resourceCount: paths.length }
}

export function proof(value, expected) {
  exact(value, ["schemaVersion", "kind", "inputs", "origin", "archive"])
  assert.equal(value.schemaVersion, 1)
  assert.equal(value.kind, KIND)
  assert.deepEqual(inputs(value.inputs), inputs(expected))
  origin(value.origin)
  const archive = value.archive
  exact(archive, ["filename", "size", "sha256", "shasum", "integrity", "manifestSha256", "resourcesSha256", "resourceCount"])
  assert.equal(archive.filename, `bigduu-lotus-next-${expected.version}.tgz`)
  positive(archive.size)
  assert.ok(archive.size <= MAX_ARCHIVE)
  for (const key of ["sha256", "manifestSha256", "resourcesSha256"]) assert.match(archive[key], HASH)
  assert.match(archive.shasum, SHA)
  assert.match(archive.integrity, /^sha512-[A-Za-z0-9+/]{86}==$/u)
  positive(archive.resourceCount)
  assert.ok(archive.resourceCount <= 10000)
  return value
}

const ZIP_PROGRAM = String.raw`
import io,json,stat,struct,sys,zipfile
mode=sys.argv[1]; raw=sys.stdin.buffer.read(64*1024*1024+65536+1025)
assert len(raw)<=64*1024*1024+65536+1024
if mode=='pack':
    size=struct.unpack('<I',raw[:4])[0]; assert 0<size<=65536
    proof,archive=raw[4:4+size],raw[4+size:]; assert 0<len(archive)<=64*1024*1024
    json.loads(proof); output=io.BytesIO()
    with zipfile.ZipFile(output,'w',compression=zipfile.ZIP_STORED) as z:
        for name,data in [('original.json',proof),('package.tgz',archive)]:
            item=zipfile.ZipInfo(name); item.create_system=3; item.external_attr=(stat.S_IFREG|0o644)<<16
            z.writestr(item,data)
    sys.stdout.buffer.write(output.getvalue())
else:
    assert mode=='unpack'
    with zipfile.ZipFile(io.BytesIO(raw)) as z:
        entries=z.infolist(); assert sorted(i.filename for i in entries)==['original.json','package.tgz']
        for item in entries:
            assert item.create_system==3 and stat.S_ISREG(item.external_attr>>16)
            assert not item.flag_bits&1 and item.compress_type==zipfile.ZIP_STORED
            assert 0<item.file_size<=(65536 if item.filename=='original.json' else 64*1024*1024)
        proof=z.read('original.json'); archive=z.read('package.tgz')
        sys.stdout.buffer.write(struct.pack('<I',len(proof))+proof+archive)
`
function zip(mode, bytes) {
  const result = spawnSync("python3", ["-I", "-c", ZIP_PROGRAM, mode], { input: bytes, maxBuffer: MAX_ZIP,
    timeout: 30000, env: Object.fromEntries(["PATH", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "TMPDIR"]
      .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]])) })
  assert.ok(!result.error && result.status === 0, "Invalid original archive transport")
  return result.stdout
}
export function seal(archive, expected, physicalOrigin) {
  const value = { schemaVersion: 1, kind: KIND, inputs: structuredClone(inputs(expected)),
    origin: structuredClone(origin(physicalOrigin)), archive: inspectArchive(archive, expected) }
  proof(value, expected)
  const jsonBytes = Buffer.from(JSON.stringify(value)), length = Buffer.alloc(4)
  assert.ok(jsonBytes.length <= MAX_PROOF)
  length.writeUInt32LE(jsonBytes.length)
  return { bytes: zip("pack", Buffer.concat([length, jsonBytes, archive])), proof: value }
}
export function unseal(bytes, expected) {
  assert.ok(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= MAX_ZIP)
  const decoded = zip("unpack", bytes), size = decoded.readUInt32LE(0)
  assert.ok(size > 0 && size <= MAX_PROOF && decoded.length > size + 4)
  const jsonBytes = decoded.subarray(4, size + 4), value = proof(json(jsonBytes), expected)
  assert.equal(jsonBytes.toString("utf8"), JSON.stringify(value))
  const archive = Buffer.from(decoded.subarray(size + 4))
  assert.deepEqual(inspectArchive(archive, expected), value.archive, "Sealed original archive differs")
  return { proof: value, archive, publicationAuthorized: false }
}
