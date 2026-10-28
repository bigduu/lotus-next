// Read-only current-source verification. This record cannot authorize publication.
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import {
  BROWSER_PINS, assertBrowserVersion, assertLockedBrowserInputs, browserPlatform,
  deriveConfig, downloadPinnedArchive, extractPinnedArchive, fileSha256, verifyFileIdentity,
} from "./release-browser.mjs"

// Keep the PR adapter in this already-preserved helper: the historical
// publisher copies this file and release-browser.mjs outside its checkout.
// Adding a new module dependency here would break that unchanged copy closure.
const repository = "bigduu/lotus-next"
const sha = /^[0-9a-f]{40}$/u
const positive = /^[1-9][0-9]*$/u
const gitAt = (root) => (args) => execFileSync("git", ["--no-replace-objects", "-C", root, ...args], {
  encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
}).trim()

// This receipt describes the PR merge snapshot actually executed by feature CI.
// A later dev commit or release build keeps its own identity; neither is renamed
// to this snapshot merely because its source tree is identical.
export const featureSource = ({ root = process.cwd(), environment = process.env,
  event = JSON.parse(readFileSync(environment.GITHUB_EVENT_PATH, "utf8")), git = gitAt(root) } = {}) => {
  assert.equal(environment.GITHUB_ACTIONS, "true", "Feature admission requires its Actions context")
  assert.equal(environment.GITHUB_REPOSITORY, repository, "Unexpected feature repository")
  assert.equal(environment.GITHUB_EVENT_NAME, "pull_request", "Feature admission requires a pull request")
  const pr = event.pull_request
  assert.ok(pr && Number.isSafeInteger(pr.number) && pr.number > 0, "Missing feature PR identity")
  assert.equal(event.number, pr.number, "Feature PR identity differs")
  assert.equal(pr.base?.ref, "dev", "Feature tests must target dev")
  assert.equal(pr.base?.repo?.full_name, repository, "Unexpected feature target repository")
  assert.equal(environment.GITHUB_BASE_REF, "dev", "Feature base ref differs from the event")
  for (const value of [pr.base.sha, pr.head?.sha, environment.GITHUB_SHA, environment.FEATURE_WORKFLOW_SHA]) assert.match(value ?? "", sha)
  assert.match(pr.head?.repo?.full_name ?? "", /^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/u)
  assert.ok(typeof pr.head.ref === "string" && pr.head.ref.length > 0 && !/[\r\n]/u.test(pr.head.ref), "Missing feature head ref")
  assert.equal(environment.GITHUB_HEAD_REF, pr.head.ref, "Feature head ref differs from the event")
  const ref = `refs/pull/${pr.number}/merge`
  assert.equal(environment.GITHUB_REF, ref, "Feature tests must execute the actual merge snapshot")
  assert.equal(environment.GITHUB_WORKFLOW_REF, `${repository}/.github/workflows/ci.yml@${ref}`, "Unexpected feature workflow identity")
  assert.match(environment.GITHUB_RUN_ID ?? "", positive)
  assert.match(environment.GITHUB_RUN_ATTEMPT ?? "", positive)
  assert.equal(git(["rev-parse", "HEAD"]), environment.GITHUB_SHA, "Feature checkout is not the event merge snapshot")
  assert.equal(git(["status", "--porcelain", "--untracked-files=all"]), "", "Feature source must be clean")
  const parents = git(["show", "-s", "--format=%P", "HEAD"]).split(" ")
  assert.deepEqual(parents, [pr.base.sha, pr.head.sha], "Feature merge parents differ from the actual base/head")
  const tree = git(["rev-parse", "HEAD^{tree}"])
  assert.match(tree, sha)
  return {
    schemaVersion: 1, kind: "lotus-feature-source/v1", repository,
    pullRequest: pr.number, baseRef: "dev", baseSha: pr.base.sha,
    headRepository: pr.head.repo.full_name, headRef: pr.head.ref, headSha: pr.head.sha,
    testedSnapshot: environment.GITHUB_SHA, testedTree: tree,
    workflowRef: environment.GITHUB_WORKFLOW_REF, workflowSha: environment.FEATURE_WORKFLOW_SHA,
    runId: environment.GITHUB_RUN_ID, sourceRunAttempt: Number(environment.GITHUB_RUN_ATTEMPT),
  }
}


const helperPath = fileURLToPath(import.meta.url)
const run = (command, args) => {
  const result = spawnSync(command, args, { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 })
  if (result.error) throw result.error
  assert.equal(result.status, 0, result.stderr || `${command} failed`)
  return result.stdout.trim()
}
const regularFile = (filename) => {
  const stat = lstatSync(filename)
  assert(stat.isFile() && !stat.isSymbolicLink(), "Verification input must be a regular file")
  assert.equal(realpathSync(filename), path.resolve(filename), "Symlinked verification input")
}
export const verificationContext = (sourceRoot, browserRoot, env = process.env) => {
  assert.equal(realpathSync(sourceRoot), sourceRoot, "Canonical verification source required")
  assert.equal(helperPath, path.join(sourceRoot, "scripts", "verification-browser.mjs"), "Use the checked-out verification helper")
  assert(path.isAbsolute(browserRoot) && path.basename(browserRoot) === "verification-browser", "Unexpected verification directory")
  assert.equal(realpathSync(path.dirname(browserRoot)), path.dirname(browserRoot), "Canonical verification parent required")
  const relative = path.relative(sourceRoot, browserRoot)
  assert(relative === ".." || relative.startsWith(`..${path.sep}`), "Verification browser must stay outside source")
  assert(!env.PUBLICATION_WORKFLOW_SHA && !env.LOTUS_NEXT_RELEASE_SOURCE_RECEIPT && !env.LOTUS_NEXT_ACCEPTANCE_SOURCE_DIR,
    "Verification browser cannot replace publication controls")
  const sourceSha = run("git", ["-C", sourceRoot, "rev-parse", "HEAD"])
  assert(/^[a-f0-9]{40}$/u.test(sourceSha), "Missing verification source")
  assert.equal(run("git", ["-C", sourceRoot, "status", "--porcelain", "--untracked-files=all"]), "", "Verification source must be clean")
  assert.equal(JSON.parse(readFileSync(path.join(sourceRoot, "package.json"))).version, "0.0.0", "Verification cannot accept a publication version")
  assertLockedBrowserInputs(sourceRoot)
  const github = env.GITHUB_ACTIONS === "true"
  let feature
  if (github) {
    assert.equal(env.GITHUB_REPOSITORY, "bigduu/lotus-next")
    if (env.GITHUB_EVENT_NAME === "pull_request") {
      feature = featureSource({ root: sourceRoot, environment: env })
    } else {
      // Historical manual verification remains distinct from feature admission.
      assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch")
      assert.match(env.GITHUB_REF ?? "", /^refs\/heads\/\S+$/u)
      assert.equal(env.GITHUB_WORKFLOW_REF, `bigduu/lotus-next/.github/workflows/ci.yml@${env.GITHUB_REF}`)
    }
    assert.equal(env.GITHUB_SHA, sourceSha, "Verification checkout drift")
    assert(/^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ID ?? "") && /^[1-9][0-9]*$/u.test(env.GITHUB_RUN_ATTEMPT ?? ""), "Missing verification run identity")
    assert.equal(browserRoot, path.join(realpathSync(env.RUNNER_TEMP), "verification-browser"))
  } else {
    assert(!env.CI && !env.GITHUB_SHA, "Incomplete verification workflow identity")
  }
  return {
    purpose: "current-source-verification", sourceRoot, sourceSha,
    runId: github ? env.GITHUB_RUN_ID : null, runAttempt: github ? env.GITHUB_RUN_ATTEMPT : null,
    workflowRef: github ? env.GITHUB_WORKFLOW_REF : null,
    ...(feature ? { featureSource: feature } : {}),
    helperSha256: fileSha256(helperPath),
    browserControlSha256: fileSha256(path.join(path.dirname(helperPath), "release-browser.mjs")),
  }
}
export const verificationRecord = (context, browserRoot, platform = browserPlatform()) => {
  const pin = BROWSER_PINS[platform]
  assert(pin, "Unsupported verification browser platform")
  return { schemaVersion: 1, ...context, ...pin,
    executablePath: path.join(browserRoot, "extracted", pin.executableRelativePath), actualVersion: pin.version }
}
export const assertVerificationRecord = (record, expected) => assert.deepEqual(record, expected, "Verification browser identity drift")
const wrapperContents = (sourceRoot, browserRoot) =>
  `import original from ${JSON.stringify(pathToFileURL(path.join(sourceRoot, "playwright.real-bamboo.config.ts")).href)}\n` +
  `import { verificationConfig } from ${JSON.stringify(pathToFileURL(helperPath).href)}\n` +
  `export default verificationConfig(original, ${JSON.stringify({ sourceRoot, browserRoot })})\n`

export const verificationConfigPath = (sourceRoot, browserRoot, env = process.env) => {
  const expected = verificationRecord(verificationContext(sourceRoot, browserRoot, env), browserRoot)
  const identity = path.join(browserRoot, "browser-identity.json")
  regularFile(identity)
  assertVerificationRecord(JSON.parse(readFileSync(identity)), expected)
  verifyFileIdentity(expected.executablePath, expected.executableBytes, expected.executableSha256)
  const configPath = path.join(browserRoot, "real-bamboo.config.mjs")
  regularFile(configPath)
  assert.equal(readFileSync(configPath, "utf8"), wrapperContents(sourceRoot, browserRoot), "Verification wrapper drift")
  return configPath
}
export const verificationConfig = (original, options) => {
  verificationConfigPath(options.sourceRoot, options.browserRoot)
  const pin = BROWSER_PINS[browserPlatform()]
  return deriveConfig(original, { ...options, kind: "real-bamboo",
    executablePath: path.join(options.browserRoot, "extracted", pin.executableRelativePath) })
}
export const prepareVerificationBrowser = async (sourceRoot, browserRoot) => {
  const context = verificationContext(sourceRoot, browserRoot)
  const pin = BROWSER_PINS[browserPlatform()]
  mkdirSync(browserRoot, { mode: 0o700 })
  assert.equal(realpathSync(browserRoot), browserRoot)
  const archivePath = path.join(browserRoot, "browser.zip")
  await downloadPinnedArchive(pin, archivePath)
  const executablePath = extractPinnedArchive(archivePath, path.join(browserRoot, "extracted"), pin)
  assertBrowserVersion(run(executablePath, ["--version"]))
  const record = verificationRecord(context, browserRoot)
  writeFileSync(path.join(browserRoot, "browser-identity.json"), JSON.stringify(record, null, 2) + "\n", { flag: "wx", mode: 0o600 })
  writeFileSync(path.join(browserRoot, "real-bamboo.config.mjs"), wrapperContents(sourceRoot, browserRoot), { flag: "wx", mode: 0o600 })
  process.stdout.write(`Verified current-source outer browser: ${JSON.stringify(record)}\n`)
}
if (process.argv[1] && path.resolve(process.argv[1]) === helperPath) {
  try {
    assert(process.argv.length === 5 && process.argv[2] === "prepare", "Usage: verification-browser.mjs prepare SOURCE_ROOT BROWSER_ROOT")
    await prepareVerificationBrowser(realpathSync(process.argv[3]), path.resolve(process.argv[4]))
  } catch (error) { process.stderr.write(`${error.message}\n`); process.exitCode = 1 }
}
