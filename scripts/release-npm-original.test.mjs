import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"
import { buildArtifactManifest } from "./artifact-manifest.mjs"
import { archiveFiles, inspectArchive, inputs, origin, seal, unseal, verifyPackResult } from "./release-npm-original.mjs"

const expected = { repository: "bigduu/lotus-next", version: "2026.10.99",
  sourceRevision: "a".repeat(40), sourceTree: "b".repeat(40) }
const physical = { controllerRevision: "c".repeat(40), runId: 41, attempt: 1, jobId: 501 }
const digest = (bytes) => createHash("sha256").update(bytes).digest("hex")
const cleanEnv = () => Object.fromEntries(["PATH", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "TMPDIR"]
  .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]))
let root, packed, archive, manifest, entries

// Actual standard-library USTAR/gzip transport; no npm pack or product build.
function tar(values) {
  return execFileSync("python3", ["-I", "-c", String.raw`
import base64,io,json,sys,tarfile
values=json.loads(sys.stdin.buffer.read()); output=io.BytesIO()
with tarfile.open(fileobj=output,mode='w:gz',format=tarfile.USTAR_FORMAT) as archive:
    for value in values:
        entry=tarfile.TarInfo(value['name']); raw=base64.b64decode(value['bytes']); entry.size=len(raw)
        if value.get('type')=='symlink': entry.type=tarfile.SYMTYPE; entry.linkname='../../outside'; entry.size=0
        if value.get('type')=='directory': entry.type=tarfile.DIRTYPE; entry.size=0
        archive.addfile(entry,io.BytesIO(raw))
sys.stdout.buffer.write(output.getvalue())
`], { input: JSON.stringify(values.map((value) => ({ ...value, bytes: Buffer.from(value.bytes).toString("base64") }))), env: cleanEnv() })
}
const changed = (fn) => { const copy = entries.map((value) => ({ ...value, bytes: Buffer.from(value.bytes) })); fn(copy); return tar(copy) }

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), "lotus455-original-package-"))
  const dist = path.join(root, "dist")
  mkdirSync(path.join(dist, "assets"), { recursive: true })
  const record = (name, source, extra = {}) => ({ file: `assets/${name}-a1.js`, name, src: source, isDynamicEntry: true, ...extra })
  const assets = { "index.html": record("index", "index.html", { isEntry: true, isDynamicEntry: false,
    dynamicImports: ["src/Root.tsx", "src/components/app/ErrorBoundary.tsx"] }),
  "src/Root.tsx": record("Root", "src/Root.tsx", { dynamicImports: ["src/components/chat/Settings.tsx"] }),
  "src/components/app/ErrorBoundary.tsx": record("ErrorBoundary", "src/components/app/ErrorBoundary.tsx") }
  for (const [name, source] of [["ProjectWorkBoard", "src/components/app/ProjectWorkBoard.tsx"], ["BrowserPane", "src/components/app/BrowserPane.tsx"],
    ...["Settings", "StreamdownMarkdown", "StreamdownMermaid", "Markdown", "CodeBlock", "MermaidChart"].map(name => [name, `src/components/chat/${name}.tsx`]),
    ["renderPdf", "src/lib/export/renderPdf.tsx"]]) assets[source] = record(name, source)
  for (const name of ["vendor-streamdown", "vendor-streamdown-code", "vendor-markdown", "vendor-mermaid", "vendor-highlighter"]) {
    assets["_" + name + ".js"] = { file: `assets/${name}-a1.js`, name }
  }
  assets["src/components/chat/StreamdownMarkdown.tsx"].imports = ["_vendor-streamdown.js", "_vendor-markdown.js"]
  const chunks = Object.fromEntries(Object.values(assets).map(value => [value.file, { modules: [], packages: [] }]))
  chunks["assets/Settings-a1.js"] = { modules: ["src/components/chat/Settings.tsx", "src/components/chat/settings/SettingsMetrics.tsx",
    "src/components/chat/settings/SettingsPlugins.tsx", "src/services/metrics/MetricsService.ts", "src/services/plugin/PluginService.ts"],
  packages: ["@radix-ui/react-label", "@radix-ui/react-switch"] }
  writeFileSync(path.join(dist, "index.html"), '<script src="./assets/index-a1.js"></script>')
  writeFileSync(path.join(dist, "asset-manifest.json"), JSON.stringify(assets))
  writeFileSync(path.join(dist, "bundle-ownership.json"), JSON.stringify({ version: 2, chunks }))
  for (const value of Object.values(assets)) writeFileSync(path.join(dist, value.file), "export {}")
  manifest = buildArtifactManifest({ distDirectory: dist, packageVersion: expected.version,
    sourceRevision: expected.sourceRevision, sourceDirty: false })
  writeFileSync(path.join(dist, "lotus-next-manifest.json"), JSON.stringify(manifest, null, 2) + "\n")
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@bigduu/lotus-next", version: expected.version,
    files: ["dist"], scripts: { prepack: 'node -e "require(\'fs\').writeFileSync(\'unexpected-lifecycle\',\'executed\'); process.exit(77)"' } }))
  packed = JSON.parse(execFileSync("npm", ["pack", "--ignore-scripts", "--json", "--offline", "--audit=false", "--fund=false",
    "--cache=" + path.join(root, "npm-cache")], { cwd: root, encoding: "utf8", env: cleanEnv(), stdio: ["ignore", "pipe", "pipe"] }))[0]
  archive = readFileSync(path.join(root, packed.filename))
  entries = [...archiveFiles(archive)].map(([name, bytes]) => ({ name, bytes }))
  writeFileSync(path.join(root, "pack-result.json"), JSON.stringify([packed]))
}, 15000)
afterAll(() => { if (root) rmSync(root, { recursive: true, force: true }) })

describe("final npm original bytes", () => {
  it("accepts one real npm pack without running the package lifecycle", () => {
    const observed = inspectArchive(archive, expected)
    expect(observed.filename).toBe(packed.filename)
    expect(observed.shasum).toBe(packed.shasum)
    expect(observed.integrity).toBe(packed.integrity)
    expect(observed.size).toBe(packed.size)
    expect(observed.resourcesSha256).toBe(manifest.resourcesSha256)
    expect(observed.resourceCount).toBe(20)
    expect(existsSync(path.join(root, "unexpected-lifecycle"))).toBe(false)
  })
  it("binds every actual pack identity and file-size entry to those same tgz bytes", () => {
    expect(verifyPackResult([packed], archive, expected).sha256).toBe(digest(archive))
    for (const key of ["filename", "size", "shasum", "integrity", "name", "version"]) {
      expect(() => verifyPackResult([{ ...packed, [key]: key === "size" ? 1 : "foreign" }], archive, expected)).toThrow()
    }
    expect(() => verifyPackResult([], archive, expected)).toThrow()
    expect(() => verifyPackResult([packed, packed], archive, expected)).toThrow()
    expect(() => verifyPackResult([{ ...packed, files: packed.files.slice(1) }], archive, expected)).toThrow()
    expect(() => verifyPackResult([{ ...packed, files: packed.files.map((file, index) => ({ ...file, size: index ? file.size : file.size + 1 })) }], archive, expected)).toThrow()
  })
  it("runs the trusted static checker against explicit S data and never executes S modules or another pack", () => {
    const bin = path.join(root, "bin"); mkdirSync(bin)
    writeFileSync(path.join(bin, "npm"), '#!/bin/sh\nprintf called > "$STATIC_PACK_SENTINEL"\nexit 77\n', { mode: 0o755 })
    for (const directory of ["scripts", "node_modules/pako"]) mkdirSync(path.join(root, directory), { recursive: true })
    writeFileSync(path.join(root, "scripts/verify-package.mjs"), 'throw new Error("candidate checker executed")')
    writeFileSync(path.join(root, "node_modules/pako/package.json"), JSON.stringify({ type: "module", exports: "./index.js" }))
    writeFileSync(path.join(root, "node_modules/pako/index.js"), 'throw new Error("candidate dependency executed")')
    const checker = path.resolve("scripts/verify-package.mjs"), sentinel = path.join(root, "extra-pack")
    const env = { ...cleanEnv(), PATH: bin + path.delimiter + process.env.PATH, STATIC_PACK_SENTINEL: sentinel,
      LOTUS_NEXT_EXPECTED_SOURCE_REVISION: expected.sourceRevision, LOTUS_NEXT_EXPECTED_SOURCE_DIRTY: "false" }
    const run = (args) => spawnSync(process.execPath, [checker, ...args], { env, encoding: "utf8" })
    const result = run(["--source-root", root, "--pack-result", path.join(root, "pack-result.json")])
    expect(result.status, result.stderr).toBe(0)
    expect(result.stdout).toContain("@bigduu/lotus-next@2026.10.99")
    for (const args of [["--source-root", "relative"], ["--unexpected", root], ["--pack-result"],
      ["--source-root", root, "--source-root", root], ["--source-root", root, "--pack-result", path.join(root, "missing.json")]]) {
      expect(run(args).status).not.toBe(0)
    }
    expect(existsSync(sentinel)).toBe(false)
  })
  it("transports the original tgz byte-for-byte through a real ZIP and returns data only", () => {
    const retained = seal(archive, expected, physical), restored = unseal(retained.bytes, expected)
    assert.deepEqual(restored.archive, archive)
    assert.deepEqual(restored.proof, retained.proof)
    expect(restored.publicationAuthorized).toBe(false)
    expect(restored.proof.origin.jobId).toBe(501)
    expect(restored.proof.archive.sha256).toBe(digest(archive))
    // Physical provenance remains the original even when a caller is attempt2.
    expect(restored.proof.origin.attempt).toBe(1)
  })
  it.each(["version", "sourceRevision", "sourceTree"])("rejects foreign %s on restore", (key) => {
    const retained = seal(archive, expected, physical)
    expect(() => unseal(retained.bytes, { ...expected, [key]: key === "version" ? "2026.10.98" : "d".repeat(40) })).toThrow()
  })
  it.each([
    ["version", "0.0.0"], ["version", "1.2"], ["sourceRevision", "main"], ["sourceTree", "x".repeat(40)],
    ["repository", "foreign/lotus-next"], ["unknown", true],
  ])("rejects malformed source identity %s=%s", (key, value) => {
    expect(() => inputs({ ...expected, [key]: value })).toThrow()
  })
  it.each([
    ["controllerRevision", "main"], ["runId", 0], ["attempt", 0], ["jobId", "501"], ["unknown", true],
  ])("rejects malformed physical provenance %s=%s", (key, value) => {
    expect(() => origin({ ...physical, [key]: value })).toThrow()
  })
  it.each(["foreign-version", "foreign-source", "dirty", "extra-resource", "missing-resource", "resource-bytes", "inventory-digest", "metadata-source"])(
    "rejects %s in the actual tgz", (fault) => {
      const bytes = changed((files) => {
        const selected = files.find((value) => value.name.endsWith("/lotus-next-manifest.json"))
        const value = JSON.parse(selected.bytes)
        if (fault === "foreign-version") value.packageVersion = "2026.10.98"
        if (fault === "foreign-source") value.sourceRevision = "d".repeat(40)
        if (fault === "dirty") value.sourceDirty = true
        if (fault === "inventory-digest") value.resourcesSha256 = "0".repeat(64)
        if (fault === "extra-resource") files.push({ name: "package/dist/extra.js", bytes: Buffer.from("extra") })
        if (fault === "missing-resource") files.splice(files.findIndex((entry) => entry.name === "package/dist/assets/index-a1.js"), 1)
        if (fault === "resource-bytes") files.find((entry) => entry.name === "package/dist/assets/index-a1.js").bytes = Buffer.from("changed")
        if (fault === "metadata-source") files.push({ name: "package/src/private.ts", bytes: Buffer.from("unpublished source") })
        selected.bytes = Buffer.from(JSON.stringify(value))
      })
      expect(() => inspectArchive(bytes, expected)).toThrow()
    },
  )
  it.each(["duplicate", "traversal", "symlink", "directory", "ancestor", "colon", "backslash"])("rejects unsafe tar %s", (fault) => {
    const bytes = changed((files) => {
      if (fault === "duplicate") files.push(files[0])
      if (fault === "traversal") files[0].name = "package/../outside"
      if (fault === "symlink") files[0].type = "symlink"
      if (fault === "directory") files[0].type = "directory"
      if (fault === "ancestor") files.push({ name: "package/dist", bytes: Buffer.from("conflict") })
      if (fault === "colon") files[0].name = "package/dist/C:drive"
      if (fault === "backslash") files[0].name = "package/dist/\\escape"
    })
    expect(() => archiveFiles(bytes)).toThrow()
  })
  it("bounds empty entry count before resource verification or extraction", () => {
    const bytes = tar(Array.from({ length: 10033 }, (_, index) => ({ name: `package/dist/empty-${index}.js`, bytes: Buffer.alloc(0) })))
    expect(() => archiveFiles(bytes)).toThrow(/entry count/u)
  })
  it("rejects corrupt ZIP and compressed/extra entries rather than rebuilding", () => {
    const retained = seal(archive, expected, physical)
    const broken = Buffer.from(retained.bytes)
    broken[55] ^= 1
    expect(() => unseal(broken, expected)).toThrow()
    for (const fault of ["extra", "compression", "symlink"]) {
      const zip = execFileSync("python3", ["-I", "-c", String.raw`
import io,stat,sys,zipfile
raw=sys.stdin.buffer.read(); mode=sys.argv[1]; output=io.BytesIO()
with zipfile.ZipFile(io.BytesIO(raw)) as old, zipfile.ZipFile(output,'w') as new:
    for entry in old.infolist():
        contents=old.read(entry)
        if mode=='compression': entry.compress_type=zipfile.ZIP_DEFLATED
        if mode=='symlink': entry.external_attr=(stat.S_IFLNK|0o777)<<16
        new.writestr(entry,contents)
    if mode=='extra': new.writestr('foreign.txt',b'foreign')
sys.stdout.buffer.write(output.getvalue())
`, fault], { input: retained.bytes, env: cleanEnv() })
      expect(() => unseal(zip, expected)).toThrow()
    }
  })
})
