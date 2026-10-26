// Temporary #453 observation only. Product M stays the original downloaded dist;
// harness H is the actual diagnostic commit. No publication/source receipt is made.
import assert from "node:assert/strict"
import { spawn, spawnSync } from "node:child_process"
import { createWriteStream, existsSync, mkdirSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { verifyArtifactManifest } from "./artifact-manifest.mjs"
import { assertBrowserVersion, assertLockedBrowserInputs, BROWSER_PINS, downloadPinnedArchive, extractPinnedArchive, fileSha256 } from "./release-browser.mjs"

const harness = realpathSync(path.resolve(path.dirname(fileURLToPath(import.meta.url)), ".."))
const original = Object.freeze({
  runId: "40375990335", runAttempt: 1, artifactId: "12674258055",
  artifactZipBytes: 4448033,
  artifactZipSha256: "e5470d12432685039fee91e17a74b4e77932b32fdd50c1cf4fb45634bfc5f763",
  sourceRevision: "2e496e7ecd36a452ad4dfa3c22eaa8a2113e6296",
  tree: "d99024d16f8ba9b47a01536332d1a740d46d290f",
  bambooRevision: "d6325a732c7669f94962f604e4ce98966e374d73",
  harnessBase: "ae53034cd4622a4b501c6fac196dd574936b6aac",
  preDiagnosticCiBlob: "2fdc99f0047355ff188241fe84c7a3235c451dc1",
})
const identity = Object.freeze({
  schemaVersion: 1, registry: "local-pack", packageName: "@bigduu/lotus-next",
  packageVersion: "0.0.0", sourceRevision: original.sourceRevision, sourceDirty: false,
  entrypoint: "index.html", npmShasum: "6ad05b3b41760d16d559450ab5b7bb2e5558230e",
  npmIntegrity: "sha512-KGAEW+nc51SVqwms5m4gWaFJrQnO+FFyD4GQfBc9abUEHlM+v//tmnEEITpxIKrBZ78MjTj074DlnvB8Ug7sqA==",
  manifestSha256: "e2a597bed0952badf2a521422067c33d3e6a9a32d429f3c369ad78a846d48730",
  resourcesSha256: "dbdcd5a0683558dcc15ab5645e893abc8299c853406be46c7516385cd7299dd4",
  resourceCount: 773,
})
const sourceHashes = Object.freeze({
  "e2e/real-bamboo-published-surfaces.spec.ts": "64e49c4e9f354bb8d0f69171c5aee8ba20332714455ad436b2ec3549d0c76293",
  "e2e/support/pageObservation.ts": "4de6882ea9e7c87ff2fbc1f03d2493fe94ae94c327cf481a93804523793618f2",
  "e2e/support/transientNavigation.ts": "e27c900fe9e1a51486601638b58464334c8362a0ddb17bb8c37179a1515456cd",
  "e2e/support/realBambooRuntime.ts": "de6f27bb1846c330c93c5efc2bf9a588e0acff18e80e7e2d938ecdf9142717d0",
  "scripts/release-browser.mjs": "94db6dd1b376c3071ee18b814f73a16399443dd8fea42d7034929ddcb1991023",
  "scripts/artifact-manifest.mjs": "40d938f64045b5e96571f50797e5e6f94e49a34f801a78e8cb1150705d8bba00",
  "package-lock.json": "5ae4258b87b365c5af925ff11295c429bf71d818cc77c7b7bb3caf966ffc2a36",
  "playwright.real-bamboo.config.ts": "037f378cbeaf62ff6d1d6fba5b8e2df6b7373ca3f8b3b23df8f578b3d5442c12",
})
// No inherited publisher/tunnel/provider credentials enter diagnostic children.
// Copy actual CI identities unchanged; never synthesize GITHUB_* identities.
const safeEnv = Object.fromEntries([
  "PATH", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "LANG", "LC_ALL", "SHELL",
  "DOCKER_HOST", "DOCKER_CONTEXT", "DOCKER_CERT_PATH", "DOCKER_TLS_VERIFY",
  "NODE_EXTRA_CA_CERTS", "HTTP_PROXY", "HTTPS_PROXY", "NO_PROXY", "CI", "RUNNER_TEMP",
  "PLAYWRIGHT_BROWSERS_PATH", "GITHUB_SHA", "GITHUB_RUN_ID", "GITHUB_RUN_ATTEMPT",
  "GITHUB_EVENT_NAME", "GITHUB_WORKFLOW_REF",
].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]))
const run = (command, args, env = safeEnv) => {
  const result = spawnSync(command, args, { env, cwd: harness, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })
  if (result.error) throw result.error
  assert.equal(result.status, 0, `${command} failed: ${result.stderr || result.signal || result.status}`)
  return result.stdout.trim()
}
const writeJson = (filename, value) => writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`, { flag: "wx" })

// The original ZIP is immutable and bounded before extraction. Only regular
// dist files and the original inventory are allowed; links/traversal are rejected.
export const verifyOriginalArtifact = (archive, destination) => {
  assert.equal(fileSha256(archive), original.artifactZipSha256, "Wrong original artifact ZIP")
  run("python3", ["-c", String.raw`
import pathlib, shutil, stat, sys, zipfile
archive, destination, expected_bytes = sys.argv[1:]
assert pathlib.Path(archive).stat().st_size == int(expected_bytes)
root = pathlib.Path(destination)
assert not root.exists()
with zipfile.ZipFile(archive) as bundle:
    entries = bundle.infolist()
    assert 0 < len(entries) < 2000
    names, files = set(), set()
    assert sum(entry.file_size for entry in entries) < 100000000
    for entry in entries:
        name = entry.filename.rstrip('/')
        parts, mode = name.split('/'), entry.external_attr >> 16
        assert name == entry.orig_filename.rstrip('/') and '\\' not in name and '\x00' not in name
        assert all(part not in ('', '.', '..') for part in parts)
        assert parts[0] == 'dist' or name == 'browser-inventory.json'
        assert stat.S_IFMT(mode) in (0, stat.S_IFREG, stat.S_IFDIR)
        assert name not in names and not entry.flag_bits & 1
        names.add(name)
        if not entry.is_dir(): files.add(name)
    for name in names:
        assert all(str(parent) not in files for parent in pathlib.PurePosixPath(name).parents)
    root.mkdir(mode=0o700)
    for entry in entries:
        target = root / entry.filename
        if entry.is_dir(): target.mkdir(parents=True, exist_ok=True)
        else:
            target.parent.mkdir(parents=True, exist_ok=True)
            with bundle.open(entry) as source, target.open('xb') as output: shutil.copyfileobj(source, output)
`, archive, destination, String(original.artifactZipBytes)])
  const distDirectory = path.join(destination, "dist")
  assert.equal(fileSha256(path.join(distDirectory, "lotus-next-manifest.json")), identity.manifestSha256)
  const manifest = verifyArtifactManifest({ distDirectory, expectedPackageName: identity.packageName,
    expectedPackageVersion: identity.packageVersion, expectedSourceRevision: identity.sourceRevision, expectedSourceDirty: false })
  assert.equal(manifest.resourcesSha256, identity.resourcesSha256)
  assert.equal(manifest.resources.length, identity.resourceCount)
  return distDirectory
}

export const writeObservationHarness = (root, executablePath) => {
  const evidence = path.join(root, "evidence")
  mkdirSync(path.join(root, "diagnostic-tests"))
  mkdirSync(evidence)
  const wrapper = `// Instrumentation only; the original acceptance module below is unchanged.
import { test } from ${JSON.stringify(path.join(harness, "node_modules/@playwright/test/index.mjs"))};
import { appendFileSync } from "node:fs";
import ${JSON.stringify(path.join(harness, "e2e/real-bamboo-published-surfaces.spec.ts"))};
const output = ${JSON.stringify(path.join(evidence, "events.jsonl"))};
const url = (value: string) => { const u = new URL(value); if (!["http:", "https:", "ws:", "wss:"].includes(u.protocol)) return u.protocol + "<redacted>"; u.username = ""; u.password = ""; u.search = ""; u.hash = ""; return u.href; };
const write = (event: string, fields = {}) => appendFileSync(output, JSON.stringify({ event, wallTime: Date.now(), monotonicTime: performance.now(), ...fields }) + "\\n");
let restore = () => {};
test.beforeEach(async ({ browser }) => {
  let contextId = 0, pageId = 0, requestId = 0;
  const identities = new WeakMap();
  const identity = (request) => { if (!identities.has(request)) identities.set(request, ++requestId); return identities.get(request); };
  const original = browser.newContext;
  browser.newContext = async (options) => {
    const context = await original.call(browser, options), contextOrdinal = ++contextId;
    write("context-created", { contextOrdinal, viewport: options?.viewport });
    context.on("close", () => write("context-closed", { contextOrdinal }));
    const createPage = context.newPage.bind(context);
    context.newPage = async () => {
      const page = await createPage(), pageOrdinal = ++pageId;
      page.on("request", request => write("pw-request", { contextOrdinal, pageOrdinal, objectId: identity(request), url: url(request.url()), method: request.method(), type: request.resourceType(), navigation: request.isNavigationRequest() }));
      page.on("requestfinished", request => write("pw-finished", { contextOrdinal, pageOrdinal, objectId: identity(request), url: url(request.url()) }));
      page.on("requestfailed", request => write("pw-failed", { contextOrdinal, pageOrdinal, objectId: identity(request), url: url(request.url()), failure: request.failure() }));
      page.on("response", response => write("pw-response", { contextOrdinal, pageOrdinal, objectId: identity(response.request()), url: url(response.url()), status: response.status() }));
      page.on("framenavigated", frame => write("pw-navigated", { contextOrdinal, pageOrdinal, url: url(frame.url()), mainFrame: frame === page.mainFrame() }));
      page.on("crash", () => write("pw-crash", { contextOrdinal, pageOrdinal }));
      const session = await context.newCDPSession(page);
      session.on("Network.requestWillBeSent", e => write("cdp-request", { contextOrdinal, pageOrdinal, requestId: e.requestId, loaderId: e.loaderId, frameId: e.frameId, url: url(e.request.url), method: e.request.method, type: e.type, timestamp: e.timestamp, requestWallTime: e.wallTime, initiator: e.initiator.type, redirectStatus: e.redirectResponse?.status }));
      session.on("Network.responseReceived", e => write("cdp-response", { contextOrdinal, pageOrdinal, requestId: e.requestId, loaderId: e.loaderId, status: e.response.status, timestamp: e.timestamp, fromDiskCache: e.response.fromDiskCache, fromServiceWorker: e.response.fromServiceWorker }));
      session.on("Network.loadingFinished", e => write("cdp-finished", { contextOrdinal, pageOrdinal, requestId: e.requestId, timestamp: e.timestamp, encodedDataLength: e.encodedDataLength }));
      session.on("Network.loadingFailed", e => write("cdp-failed", { contextOrdinal, pageOrdinal, requestId: e.requestId, timestamp: e.timestamp, type: e.type, errorText: e.errorText, canceled: e.canceled, blockedReason: e.blockedReason }));
      await session.send("Network.enable");
      write("cdp-observation-ready", { contextOrdinal, pageOrdinal });
      return page;
    };
    return context;
  };
  restore = () => { browser.newContext = original; };
});
test.afterEach(async () => { restore(); write("test-retired"); });
`
  writeFileSync(path.join(root, "diagnostic-tests/original.spec.ts"), wrapper, { flag: "wx" })
  const config = path.join(root, "original-local.config.ts")
  writeFileSync(config, `// Diagnostic H observes immutable artifact M; never an acceptance receipt.
import original from ${JSON.stringify(path.join(harness, "playwright.real-bamboo.config.ts"))};
export default {
  ...original,
  testDir: ${JSON.stringify(path.join(root, "diagnostic-tests"))}, testMatch: "original.spec.ts",
  outputDir: ${JSON.stringify(path.join(evidence, "results"))},
  globalSetup: ${JSON.stringify(path.join(harness, "e2e/support/realBambooRuntime.ts"))},
  reporter: [["line"], ["json", { outputFile: ${JSON.stringify(path.join(evidence, "report.json"))} }]],
  use: { ...original.use, launchOptions: { ...original.use.launchOptions,
    executablePath: ${JSON.stringify(executablePath)},
    args: ["--log-net-log=" + ${JSON.stringify(path.join(evidence, "netlog.json"))}, "--net-log-capture-mode=Default"] } },
  projects: [{ name: "real-bamboo-desktop-chromium", use: original.projects[1].use }],
};
`, { flag: "wx" })
  return { config, evidence }
}

const diagnostic = async ([archive, bambooSource, output]) => {
  assert.equal(process.platform, "linux", "This diagnostic is specifically the original Linux path")
  assert.equal(process.arch, "x64")
  assert.equal(process.versions.node.split(".")[0], "24")
  assert(archive && bambooSource && output, "Expected original ZIP, clean Bamboo source and new output directory")
  const root = path.join(realpathSync(path.dirname(output)), path.basename(output))
  assert(!existsSync(root), "Never overwrite prior diagnostic evidence")
  mkdirSync(root, { mode: 0o700 })
  mkdirSync(path.join(root, "tmp"), { mode: 0o700 })
  assertLockedBrowserInputs(harness)
  for (const [name, expected] of Object.entries(sourceHashes)) assert.equal(fileSha256(path.join(harness, name)), expected, `Original source changed: ${name}`)
  const harnessSha = run("git", ["rev-parse", "HEAD"])
  assert.equal(process.env.GITHUB_SHA, harnessSha, "Actual diagnostic checkout differs from its workflow identity")
  assert.equal(process.env.GITHUB_EVENT_NAME, "workflow_dispatch", "This is manual diagnostic evidence only")
  const distDirectory = verifyOriginalArtifact(realpathSync(archive), path.join(root, "original-browser-input"))
  const pin = BROWSER_PINS.linux64
  const browserArchive = path.join(root, "chrome-157.zip")
  await downloadPinnedArchive(pin, browserArchive)
  const executablePath = extractPinnedArchive(browserArchive, path.join(root, "browser"), pin)
  const actualVersion = assertBrowserVersion(run(executablePath, ["--version"]))
  const { config, evidence } = writeObservationHarness(root, executablePath)
  writeJson(path.join(evidence, "diagnostic-identity.json"), {
    purpose: "diagnostic-only; not feature/source/release acceptance", harnessSha,
    harnessTree: run("git", ["rev-parse", "HEAD^{tree}"]), original, artifactIdentity: identity,
    browser: { ...pin, actualVersion }, sourceHashes,
    actualRun: { event: process.env.GITHUB_EVENT_NAME, id: process.env.GITHUB_RUN_ID, attempt: process.env.GITHUB_RUN_ATTEMPT,
      workflowRef: process.env.GITHUB_WORKFLOW_REF },
    startedAt: new Date().toISOString(), wallTime: Date.now(), monotonicTime: performance.now(),
    instrumentationSha256: fileSha256(fileURLToPath(import.meta.url)),
    configSha256: fileSha256(config), wrapperSha256: fileSha256(path.join(root, "diagnostic-tests/original.spec.ts")),
  })
  const monitors = [
    ["docker", ["events", "--filter", "type=network", "--format", "{{json .}}"], "docker-network.jsonl"],
    ["ip", ["-ts", "monitor", "link", "address", "route"], "host-network.log"],
  ].map(([command, args, filename]) => {
    const log = createWriteStream(path.join(evidence, filename), { flags: "wx" })
    const child = spawn(command, args, { env: safeEnv, stdio: ["ignore", "pipe", "pipe"] })
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false })
    child.on("error", error => log.write(`Observation failed: ${error.message}\n`))
    const ready = new Promise((resolve, reject) => { child.once("spawn", resolve); child.once("error", reject) })
    const closed = new Promise(resolve => child.once("close", (code, signal) => { log.end(); resolve({ code, signal }) }))
    return { command, child, ready, closed }
  })
  let exitCode = 1
  const monitorOutcomes = []
  try {
    await Promise.all(monitors.map(monitor => monitor.ready))
    const env = { ...safeEnv, TMPDIR: path.join(root, "tmp"), GIT_OPTIONAL_LOCKS: "0",
      LOTUS_REAL_ACCEPTANCE_MODE: "local", LOTUS_REAL_ARTIFACT_DIR: distDirectory,
      LOTUS_REAL_ARTIFACT_IDENTITY: JSON.stringify(identity), BAMBOO_E2E_SOURCE_DIR: realpathSync(bambooSource) }
    const child = spawn(process.execPath, [path.join(harness, "node_modules/@playwright/test/cli.js"), "test",
      `--config=${config}`, "--grep", "standalone local real Bamboo"], { cwd: harness, env, stdio: "inherit" })
    exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => resolve(code ?? 1)) })
  } finally {
    for (const { command, child, closed } of monitors) {
      const stoppedByHarness = child.exitCode === null && child.signalCode === null
      if (stoppedByHarness) child.kill("SIGTERM")
      monitorOutcomes.push({ command, stoppedByHarness, ...await closed })
    }
    writeJson(path.join(evidence, "diagnostic-outcome.json"), { purpose: "diagnostic-only", exitCode,
      monitorOutcomes,
      finishedAt: new Date().toISOString(), wallTime: Date.now(), monotonicTime: performance.now() })
  }
  process.exitCode = exitCode || (monitorOutcomes.some(outcome => !outcome.stoppedByHarness) ? 1 : 0)
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === "--sanitized-worker") await diagnostic(process.argv.slice(3))
  else {
    // The pinned browser helper launches its own verifier children. Run the
    // complete operation under a safe environment rather than mutating globals.
    const child = spawn(process.execPath, [fileURLToPath(import.meta.url), "--sanitized-worker", ...process.argv.slice(2)],
      { env: safeEnv, cwd: harness, stdio: "inherit" })
    process.exitCode = await new Promise((resolve, reject) => { child.on("error", reject); child.on("exit", code => resolve(code ?? 1)) })
  }
}
