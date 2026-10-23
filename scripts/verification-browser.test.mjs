import { execFileSync } from "node:child_process"
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import { BROWSER_PINS } from "./release-browser.mjs"
import { assertVerificationRecord, verificationRecord } from "./verification-browser.mjs"
import { acceptanceArguments, acceptanceConfigArgument, runAcceptanceSurfaces } from "./published-real-bamboo-acceptance.mjs"

const context = {
  purpose: "current-source-verification", sourceRoot: "/tmp/source", sourceSha: "a".repeat(40),
  runId: "123", runAttempt: "1", workflowRef: "bigduu/lotus-next/.github/workflows/ci.yml@refs/heads/test",
  helperSha256: "b".repeat(64), browserControlSha256: "c".repeat(64),
}
const root = "/tmp/verification-browser"
const temporaryRoots = []
process.on("exit", () => { for (const directory of temporaryRoots) rmSync(directory, { recursive: true, force: true }) })
const fixture = async (version = "0.0.0") => {
  const parent = realpathSync(mkdtempSync(path.join(tmpdir(), "lotus-verification-browser-")))
  temporaryRoots.push(parent)
  const source = path.join(parent, "source"), browser = path.join(parent, "verification-browser")
  mkdirSync(path.join(source, "scripts"), { recursive: true })
  for (const name of ["release-browser.mjs", "verification-browser.mjs"]) copyFileSync(`scripts/${name}`, path.join(source, "scripts", name))
  for (const name of ["playwright.config.ts", "playwright.real-bamboo.config.ts"]) copyFileSync(name, path.join(source, name))
  writeFileSync(path.join(source, "package.json"), JSON.stringify({ version }))
  for (const name of ["@playwright/test", "playwright", "playwright-core"]) {
    const directory = path.join(source, "node_modules", name)
    mkdirSync(directory, { recursive: true }); writeFileSync(path.join(directory, "package.json"), JSON.stringify({ version: "1.62.1" }))
  }
  const git = (...args) => execFileSync("git", ["-C", source, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
  git("init", "-q"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid")
  git("add", "--all"); git("-c", "core.hooksPath=/dev/null", "-c", "commit.gpgSign=false", "commit", "-qm", "fixture")
  const module = await import(pathToFileURL(path.join(source, "scripts", "verification-browser.mjs")))
  const env = { CI: "true", GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "bigduu/lotus-next", GITHUB_EVENT_NAME: "workflow_dispatch",
    GITHUB_REF: "refs/heads/test", GITHUB_WORKFLOW_REF: "bigduu/lotus-next/.github/workflows/ci.yml@refs/heads/test",
    GITHUB_SHA: git("rev-parse", "HEAD"), GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "2", RUNNER_TEMP: parent }
  return { source, browser, module, env }
}
let sharedFixture
const shared = () => sharedFixture ??= fixture()
describe("current-source verification browser", () => {
  it("binds the clean checkout and actual CI run without borrowing publication authority", async () => {
    const f = await shared(), record = f.module.verificationContext(f.source, f.browser, f.env)
    expect(record).toMatchObject({ purpose: "current-source-verification", sourceSha: f.env.GITHUB_SHA, runId: "123", runAttempt: "2" })
    expect(f.module.verificationContext(f.source, f.browser, {}).runId).toBe(null)
  })
  it.each([
    { GITHUB_SHA: "a".repeat(40) }, { GITHUB_REPOSITORY: "other/repo" }, { GITHUB_EVENT_NAME: "push" },
    { GITHUB_WORKFLOW_REF: "bigduu/lotus-next/.github/workflows/publish-npm.yml@refs/heads/test" },
    { GITHUB_REF: "refs/tags/test" }, { GITHUB_RUN_ID: "0" }, { GITHUB_RUN_ATTEMPT: "0" },
    { PUBLICATION_WORKFLOW_SHA: "a".repeat(40) }, { LOTUS_NEXT_RELEASE_SOURCE_RECEIPT: "/tmp/receipt" },
    { LOTUS_NEXT_ACCEPTANCE_SOURCE_DIR: "/tmp/source" }, { GITHUB_ACTIONS: "false" },
  ])("rejects CI identity or publication context drift %j", async (change) => {
    const f = await shared()
    expect(() => f.module.verificationContext(f.source, f.browser, { ...f.env, ...change })).toThrow()
  })
  it("rejects a versioned source and never accepts dirty or foreign helper input", async () => {
    const versioned = await fixture("2026.10.23")
    expect(() => versioned.module.verificationContext(versioned.source, versioned.browser, {})).toThrow(/publication version/)
    const f = await fixture(); writeFileSync(path.join(f.source, "unexpected.txt"), "dirty")
    expect(() => f.module.verificationContext(f.source, f.browser, {})).toThrow(/clean/)
    const clean = await shared()
    const { verificationContext } = await import("./verification-browser.mjs")
    expect(() => verificationContext(clean.source, clean.browser, {})).toThrow(/checked-out/)
  })
  it("reuses the fixed publication binary identity while retaining separate source/run purpose", () => {
    const record = verificationRecord(context, root, "linux64")
    expect(record).toEqual({ schemaVersion: 1, ...context, ...BROWSER_PINS.linux64,
      executablePath: root + "/extracted/" + BROWSER_PINS.linux64.executableRelativePath,
      actualVersion: BROWSER_PINS.linux64.version })
    expect(() => assertVerificationRecord(structuredClone(record), record)).not.toThrow()
  })
  it.each(["purpose", "sourceRoot", "sourceSha", "runId", "runAttempt", "workflowRef", "helperSha256", "browserControlSha256", "executablePath", "executableSha256", "version", "actualVersion"])("rejects %s identity drift", (key) => {
    const expected = verificationRecord(context, root, "linux64")
    expect(() => assertVerificationRecord({ ...expected, [key]: "different" }, expected)).toThrow()
  })
  it("rejects publication records and additional unvalidated fields", () => {
    const record = verificationRecord(context, root, "linux64")
    expect(() => assertVerificationRecord({ ...record, purpose: "publication" }, record)).toThrow()
    expect(() => assertVerificationRecord({ ...record, extra: true }, record)).toThrow()
    expect(() => verificationRecord(context, root, "unknown")).toThrow()
  })
  it("requires explicit current-source selection and forbids accepted identity or mixed browser controls", () => {
    expect(acceptanceArguments(["--current-source", "--verification-browser", root])).toEqual({
      artifactMode: "current-source", browserRoot: { kind: "verification", directory: root },
    })
    for (const args of [
      ["--verification-browser", root],
      ["--current-source", "--accepted-identity", "/tmp/identity", "--verification-browser", root],
      ["--current-source", "--publication-browser", "/tmp/release-browser", "--verification-browser", root],
      ["--current-source", "--verification-browser", "relative"],
    ]) expect(() => acceptanceArguments(args)).toThrow()
    expect(() => acceptanceConfigArgument({ kind: "verification", directory: root, extra: true })).toThrow()
  })
  it.each(["identity", "version"])("cannot produce publication acceptance via %s", (kind) => {
    let ran = false
    expect(() => runAcceptanceSurfaces({
      tls: {}, artifact: { identity: { packageVersion: kind === "version" ? "2026.10.23" : "0.0.0" } },
      browserRoot: { kind: "verification", directory: root },
      ...(kind === "identity" ? { acceptedIdentityPath: "/tmp/not-written.json" } : {}),
    }, () => { ran = true })).toThrow(/cannot write a publication/)
    expect(ran).toBe(false)
  })
  it("wires the exact browser into full and both packed topologies while preserving publication controls", () => {
    const ci = readFileSync(".github/workflows/ci.yml", "utf8")
    expect(ci).toContain('node scripts/verification-browser.mjs prepare "${GITHUB_WORKSPACE}" "${RUNNER_TEMP}/verification-browser"')
    expect(ci).toContain('node node_modules/@playwright/test/cli.js test --config="${RUNNER_TEMP}/verification-browser/real-bamboo.config.mjs"')
    expect(ci).toContain('--current-source --verification-browser "${RUNNER_TEMP}/verification-browser"')
    expect(ci).toContain("name: real-bamboo-verification-browser")
    const publication = readFileSync(".github/workflows/publish-npm.yml", "utf8")
    expect(publication).toContain('scripts/verification-browser.mjs "${RUNNER_TEMP}/release-control/"')
    expect(publication).toContain('--current-source --accepted-identity "${ACCEPTED_IDENTITY_PATH}" --publication-browser "${RUNNER_TEMP}/release-browser"')
    expect(publication).not.toContain("--verification-browser")
  })
})
