import assert from "node:assert/strict"
import { spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { deserialize } from "node:v8"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import {
  BROWSER_PINS, BROWSER_VERSION, ZIP_EXTRACTOR,
  assertBrowserVersion, assertConfigEquivalent, assertDownloadResponse,
  assertOriginalConfig, browserPlatform, deriveConfig, downloadPinnedArchive,
  extractPinnedArchive, fileSha256, verifyBrowserRecord, verifyFileIdentity,
  wrapperContents,
} from "./release-browser.mjs"

const sourceRoot = process.cwd()
const executablePath = "/tmp/publication-browser/extracted/chrome-headless-shell"
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
const roots = []
const temporary = () => {
  const root = realpathSync(mkdtempSync(path.join(tmpdir(), "lotus-browser-control-test-")))
  roots.push(root)
  return root
}
process.on("exit", () => { for (const root of roots) rmSync(root, { recursive: true, force: true }) })
const configs = new Map()
const originalConfig = (kind, ci, mode = "") => {
  const key = `${kind}:${ci}:${mode}`
  if (!configs.has(key)) {
    const filename = kind === "all-surface" ? "playwright.config.ts" : "playwright.real-bamboo.config.ts"
    const env = { ...process.env }
    delete env.CI
    delete env.LOTUS_REAL_ACCEPTANCE_MODE
    if (ci) env.CI = "true"
    if (mode) env.LOTUS_REAL_ACCEPTANCE_MODE = mode
    const result = spawnSync(process.execPath, ["--experimental-strip-types", "--input-type=module", "-e",
      `import config from ${JSON.stringify(pathToFileURL(path.join(sourceRoot, filename)).href)}; import { serialize } from 'node:v8'; process.stdout.write(serialize(config).toString('base64'))`,
    ], { env, encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    configs.set(key, deserialize(Buffer.from(result.stdout, "base64")))
  }
  return structuredClone(configs.get(key))
}
const optionsFor = (kind, ci = false, mode = "") => ({
  kind, sourceRoot, executablePath,
  env: { ...(ci ? { CI: "true" } : {}), ...(mode ? { LOTUS_REAL_ACCEPTANCE_MODE: mode } : {}) },
})

describe("original publication config equivalence", () => {
  for (const ci of [false, true]) {
    for (const [kind, mode] of [["all-surface", ""], ["real-bamboo", ""], ["real-bamboo", "local"], ["real-bamboo", "remote"]]) {
      it(`preserves ${kind}/${mode || "full"} with CI=${ci}`, () => {
        const original = originalConfig(kind, ci, mode)
        const before = structuredClone(original)
        const options = optionsFor(kind, ci, mode)
        const derived = deriveConfig(original, options)
        assertConfigEquivalent(original, derived, options)
        expect(original).toEqual(before)
        expect(derived.projects).toBe(original.projects)
        expect(derived.projects).toHaveLength(3)
        expect(derived.retries).toBe(kind === "all-surface" && ci ? 1 : 0)
        expect(derived.workers).toBe(kind === "all-surface" && !ci ? undefined : 1)
        expect(derived.testDir).toBe(path.join(sourceRoot, "e2e"))
        expect(derived.outputDir).toBe(path.resolve(sourceRoot, original.outputDir))
        expect(derived.reporter[1][1].outputFolder).toBe(path.resolve(sourceRoot, original.reporter[1][1].outputFolder))
        expect(derived.projects[0].use.userAgent).toContain("Chrome/151.0.7922.34")
        expect(derived.use.launchOptions).toEqual({ ...original.use.launchOptions, executablePath })
        if (kind === "real-bamboo") {
          expect(derived.globalSetup).toBe(path.join(sourceRoot, "e2e/support/realBambooRuntime.ts"))
          expect(derived.use.ignoreHTTPSErrors).toBe(mode === "remote")
          expect(derived.projects.map((project) => project.dependencies)).toEqual([
            undefined, ["real-bamboo-browser-tabs-chromium"], ["real-bamboo-desktop-chromium"],
          ])
        }
        // Reverse only the four path rebases and launchOptions addition. Every
        // remaining value must equal the actual original config object.
        const reversed = { ...derived, testDir: original.testDir, outputDir: original.outputDir,
          reporter: original.reporter, use: original.use,
          ...(original.globalSetup ? { globalSetup: original.globalSetup } : {}) }
        expect(reversed).toEqual(original)
      })
    }
  }

  it.each([
    ["dropped project", (c) => c.projects.pop()],
    ["dropped dependency", (c) => { c.projects[1].dependencies = [] }],
    ["retries", (c) => { c.retries = 1 }],
    ["workers", (c) => { c.workers = 2 }],
    ["timeout", (c) => { c.timeout += 1 }],
    ["expect timeout", (c) => { c.expect.timeout += 1 }],
    ["match", (c) => { c.testMatch = "subset.spec.ts" }],
    ["ignore", (c) => { c.projects[1].testIgnore = [] }],
    ["parallel", (c) => { c.fullyParallel = true }],
    ["project launch", (c) => { c.projects[0].use.launchOptions = {} }],
    ["project connect", (c) => { c.projects[0].use.connectOptions = { wsEndpoint: "ws://other" } }],
    ["channel", (c) => { c.use.channel = "chrome" }],
    ["lost remote resolver", (c) => { c.use.launchOptions.args = [] }],
    ["lost TLS", (c) => { c.use.ignoreHTTPSErrors = false }],
    ["project relative paths", (c) => { c.projects[0].testDir = "elsewhere" }],
    ["new setup", (c) => { c.globalTeardown = "./teardown.ts" }],
  ])("rejects original drift: %s", (_name, mutate) => {
    const config = originalConfig("real-bamboo", true, "remote")
    mutate(config)
    expect(() => assertOriginalConfig(config, optionsFor("real-bamboo", true, "remote"))).toThrow(/shape changed/)
  })

  it.each(["testDir", "outputDir", "globalSetup", "reporter", "resolver", "TLS", "projects"])("detects derived %s drift", (field) => {
    const original = originalConfig("real-bamboo", true, "remote")
    const options = optionsFor("real-bamboo", true, "remote")
    const derived = structuredClone(deriveConfig(original, options))
    if (field === "reporter") derived.reporter[1][1].outputFolder = "/tmp/wrong-report"
    else if (field === "resolver") derived.use.launchOptions.args = []
    else if (field === "TLS") derived.use.ignoreHTTPSErrors = false
    else if (field === "projects") derived.projects.pop()
    else derived[field] = "/tmp/wrong-source-path"
    expect(() => assertConfigEquivalent(original, derived, options)).toThrow()
  })

  it("requires absolute external executable selection and rejects unsupported modes", () => {
    const original = originalConfig("real-bamboo", false)
    expect(() => deriveConfig(original, { ...optionsFor("real-bamboo"), executablePath: "chrome" })).toThrow(/Absolute/)
    expect(() => deriveConfig(original, { ...optionsFor("real-bamboo"), executablePath: path.join(sourceRoot, ".browser/chrome") })).toThrow(/outside/)
    expect(() => deriveConfig(original, optionsFor("real-bamboo", false, "unexpected"))).toThrow(/Unsupported/)
  })

  it("loads the absolute original TS config in each child after that child's environment is set", () => {
    const wrapper = wrapperContents({ sourceRoot, browserRoot: "/tmp/release-browser", kind: "real-bamboo" })
    expect(wrapper).toContain(`import original from "${pathToFileURL(path.join(sourceRoot, "playwright.real-bamboo.config.ts")).href}"`)
    expect(wrapper).toContain("export default publicationConfig(original,")
    expect(wrapper).not.toMatch(/NODE_OPTIONS|NODE_PATH|serialize|mock|defineConfig/)
  })
})

describe("fixed browser provenance and fail-closed preparation", () => {
  it("pins both reviewed official archives and executable hashes", () => {
    expect(Object.keys(BROWSER_PINS)).toEqual(["linux64", "mac-arm64"])
    for (const pin of Object.values(BROWSER_PINS)) {
      expect(pin.version).toBe(BROWSER_VERSION)
      expect(pin.url).toBe(`https://storage.googleapis.com/chrome-for-testing-public/157.0.8090.0/${pin.platform}/chrome-headless-shell-${pin.platform}.zip`)
      expect(pin.archiveSha256).toMatch(/^[a-f0-9]{64}$/)
      expect(pin.executableSha256).toMatch(/^[a-f0-9]{64}$/)
    }
    expect(browserPlatform("linux", "x64")).toBe("linux64")
    expect(browserPlatform("darwin", "arm64")).toBe("mac-arm64")
    expect(() => browserPlatform("darwin", "x64")).toThrow(/No reviewed/)
    expect(() => browserPlatform("linux", "arm64")).toThrow(/No reviewed/)
  })
  const headers = (pin) => new Headers({
    "x-goog-generation": pin.storageGeneration, "content-length": String(pin.archiveBytes),
    "x-goog-stored-content-length": String(pin.archiveBytes),
  })
  it.each(["x-goog-generation", "content-length", "x-goog-stored-content-length", "content-encoding"])("rejects missing/wrong download %s", (header) => {
    const pin = BROWSER_PINS.linux64
    const good = headers(pin)
    assertDownloadResponse({ status: 200, headers: good }, pin)
    const bad = headers(pin)
    bad.set(header, "wrong")
    expect(() => assertDownloadResponse({ status: 200, headers: bad }, pin)).toThrow()
    if (header !== "content-encoding") {
      bad.delete(header)
      expect(() => assertDownloadResponse({ status: 200, headers: bad }, pin)).toThrow()
    }
    expect(() => assertDownloadResponse({ status: 302, headers: good }, pin)).toThrow(/200/)
  })
  it("checks HEAD then the actual GET, byte length and SHA before extraction", async () => {
    const body = Buffer.from("archive-fixture")
    const pin = { ...BROWSER_PINS.linux64, archiveBytes: body.length, archiveSha256: sha256(body) }
    const output = path.join(temporary(), "browser.zip")
    const calls = []
    await downloadPinnedArchive(pin, output, async (_url, options) => {
      calls.push(options)
      return new Response(options.method === "HEAD" ? null : body, { headers: headers(pin) })
    })
    expect(calls).toEqual([{ method: "HEAD", redirect: "error" }, { redirect: "error" }])
    expect(readFileSync(output)).toEqual(body)
    for (const failure of ["get-generation", "short-body", "hash"]) {
      const target = path.join(temporary(), "browser.zip")
      const badPin = { ...pin, ...(failure === "hash" ? { archiveSha256: "0".repeat(64) } : {}) }
      await expect(downloadPinnedArchive(badPin, target, async (_url, options) => {
        const h = headers(pin)
        if (!options.method && failure === "get-generation") h.set("x-goog-generation", "0")
        return new Response(options.method === "HEAD" ? null : failure === "short-body" ? "short" : body, { headers: h })
      })).rejects.toThrow()
    }
  })
  it("rejects missing/wrong/hash-mismatched or symlinked executable identities", () => {
    const root = temporary()
    const executable = path.join(root, "chrome")
    writeFileSync(executable, "browser-fixture")
    const bytes = Buffer.byteLength("browser-fixture")
    const hash = sha256("browser-fixture")
    expect(verifyFileIdentity(executable, bytes, hash)).toBe(executable)
    expect(fileSha256(executable)).toBe(hash)
    expect(() => verifyFileIdentity(executable, bytes, undefined)).toThrow(/Missing/)
    expect(() => verifyFileIdentity(executable, bytes, "0".repeat(64))).toThrow(/SHA-256/)
    expect(() => verifyFileIdentity(executable, bytes + 1, hash)).toThrow(/length/)
    expect(() => verifyFileIdentity(path.join(root, "missing"), bytes, hash)).toThrow()
    symlinkSync(executable, path.join(root, "link"))
    expect(() => verifyFileIdentity(path.join(root, "link"), bytes, hash)).toThrow(/regular/)
    expect(() => assertBrowserVersion("Chromium 151.0.7922.34")).toThrow(/version/)
    expect(() => assertBrowserVersion("Chromium 157.0.8090.0 modified")).toThrow(/version/)
    expect(assertBrowserVersion("Google Chrome for Testing 157.0.8090.0")).toContain(BROWSER_VERSION)
  })
  it.each(["sourceSha", "workflowSha", "runId", "runAttempt", "controlSha256", "executablePath", "archiveSha256", "executableSha256"])("rejects browser record %s drift before execution", (field) => {
    const expectedContext = { sourceRoot, sourceSha: "a".repeat(40), workflowSha: "b".repeat(40), runId: "1", runAttempt: "1", controlSha256: "c".repeat(64) }
    const browserRoot = temporary()
    const pin = BROWSER_PINS.linux64
    const record = { schemaVersion: 1, ...expectedContext, ...pin,
      executablePath: path.join(browserRoot, "extracted", pin.executableRelativePath), actualVersion: `Google Chrome for Testing ${BROWSER_VERSION}` }
    record[field] = "wrong"
    expect(() => verifyBrowserRecord({ record, expectedContext, browserRoot, platform: "linux64" })).toThrow(/identity mismatch/)
  })
  it("does not accept an absent browser record", () => {
    expect(() => verifyBrowserRecord({ record: undefined, expectedContext: {}, browserRoot: temporary(), platform: "linux64" })).toThrow()
  })

  const makeZip = (entries) => {
    const root = temporary()
    const archive = path.join(root, "fixture.zip")
    const result = spawnSync("python3", ["-c", `import json, stat, sys, zipfile\nwith zipfile.ZipFile(sys.argv[1], 'w') as z:\n for name, kind in json.loads(sys.argv[2]):\n  i=zipfile.ZipInfo(name)\n  i.external_attr=((stat.S_IFLNK if kind=='link' else stat.S_IFREG)|0o755)<<16\n  z.writestr(i, 'browser-fixture')`, archive, JSON.stringify(entries)], { encoding: "utf8" })
    assert.equal(result.status, 0, result.stderr)
    return { root, archive }
  }
  it("validates and extracts an inert archive without running any executable", () => {
    const { root, archive } = makeZip([["shell/chrome", "file"]])
    const pin = { archiveBytes: readFileSync(archive).length, archiveSha256: fileSha256(archive),
      executableRelativePath: "shell/chrome", executableBytes: 15, executableSha256: sha256("browser-fixture") }
    const executable = extractPinnedArchive(archive, path.join(root, "extracted"), pin)
    expect(readFileSync(executable, "utf8")).toBe("browser-fixture")
  })
  it.each([
    ["../escape", "file"], ["/absolute", "file"], ["shell/../escape", "file"],
    ["shell\\escape", "file"], ["shell/nested\\escape", "file"], ["other/chrome", "file"], ["shell/link", "link"],
    ["shell/chrome", "file"], ["shell/chrome/child", "file"],
  ])("rejects unsafe archive member %s before creating extraction output", (name, kind) => {
    const { root, archive } = makeZip([["shell/chrome", "file"], [name, kind]])
    const destination = path.join(root, "extracted")
    const result = spawnSync("python3", ["-c", ZIP_EXTRACTOR, archive, destination, "shell/chrome"], { encoding: "utf8" })
    expect(result.status).not.toBe(0)
    if (name === "shell/nested\\escape") expect(result.stderr).toContain("Unsafe ZIP name")
    expect(existsSync(destination)).toBe(false)
  })
})

describe("publication workflow controller boundary", () => {
  it("uses the trusted adapter in both Node jobs and all real Bamboo gates", () => {
    const workflow = readFileSync(path.join(sourceRoot, ".github/workflows/publish-npm.yml"), "utf8")
    const verify = workflow.slice(workflow.indexOf("  verify:"), workflow.indexOf("  real-bamboo:"))
    const real = workflow.slice(workflow.indexOf("  real-bamboo:"), workflow.indexOf("  publish:"))
    expect(verify).toContain("- 22\n          - 24")
    for (const job of [verify, real]) {
      expect(job.indexOf("scripts/release-browser.mjs")).toBeLessThan(job.indexOf("ref: ${{ needs.preflight.outputs.source_sha }}"))
      expect(job).toContain('test "$(git rev-parse HEAD)" = "${PUBLICATION_WORKFLOW_SHA}"')
      expect(job).toContain('prepare "${GITHUB_WORKSPACE}" "${RUNNER_TEMP}/release-browser"')
      expect(job).toContain("npx playwright install --with-deps chromium")
      expect(job).toContain("${{ runner.temp }}/release-browser/browser-identity.json")
      expect(job).not.toMatch(/NODE_OPTIONS|NODE_PATH/)
    }
    expect(verify).toContain('node node_modules/@playwright/test/cli.js test --config="${RUNNER_TEMP}/release-browser/all-surface.config.mjs"')
    expect(real).toContain('node node_modules/@playwright/test/cli.js test --config="${RUNNER_TEMP}/release-browser/real-bamboo.config.mjs"')
    expect(real).toContain('--publication-browser "${RUNNER_TEMP}/release-browser"')
    expect(real.indexOf("Verify the exact Bamboo round trip")).toBeLessThan(real.indexOf("Verify the release artifact on local and secure browser surfaces"))
    expect(real).not.toMatch(/--grep|--project|--no-deps/)
    expect(real.indexOf("Require unchanged source after both packed browser surfaces")).toBeLessThan(real.indexOf("Upload the accepted browser artifact identity"))
  })
})
