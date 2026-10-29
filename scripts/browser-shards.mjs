import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { appendFileSync, existsSync, readFileSync, readdirSync, writeFileSync } from "node:fs"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

export const browserNodes = [24]
export const shardCount = 4
const projects = ["desktop-chromium", "tablet-chromium", "phone-chromium"]
const sorted = (values) => [...values].sort()
const json = (path) => JSON.parse(readFileSync(path, "utf8"))
const write = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n")

export const reportCases = (report) => {
  assert.deepEqual(report.errors, [], "Playwright reported collection or runtime errors")
  const cases = []
  const visit = (suite) => {
    for (const spec of suite.specs ?? []) for (const test of spec.tests) {
      assert.ok(spec.id && projects.includes(test.projectName), "Unknown browser case identity")
      cases.push({ id: `${spec.id}/${test.projectName}`, outcome: test.status })
    }
    for (const child of suite.suites ?? []) visit(child)
  }
  for (const suite of report.suites) visit(suite)
  assert.ok(cases.length > 0, "Empty browser inventory")
  assert.equal(new Set(cases.map((test) => test.id)).size, cases.length, "Duplicate browser case")
  return cases
}

export const verifyPartition = (inventory, partitions) => {
  assert.equal(partitions.length, shardCount)
  assert.ok(partitions.every((part) => part.length > 0), "Empty browser shard")
  const union = partitions.flat()
  assert.equal(new Set(union).size, union.length, "Browser case occurs in multiple shards")
  assert.deepEqual(sorted(union), sorted(inventory), "Shards must cover exactly the original browser inventory")
}

export const summarizeShards = (receipts, { sourceSha, runId, runAttempt, verifyResult, browserResult }) => {
  assert.equal(verifyResult, "success", "Unit compatibility and canonical Node 24 verification must succeed")
  assert.equal(browserResult, "success", "Every browser shard must succeed")
  const latest = new Map()
  const attempts = new Set()
  for (const receipt of receipts) {
    assert.equal(receipt.schemaVersion, 2, "Feature browser receipts require the single-producer contract")
    assert.equal(receipt.sourceSha, sourceSha, "Browser shard source differs")
    assert.equal(receipt.runId, runId, "Browser shard run differs")
    assert.ok(Number.isSafeInteger(receipt.runAttempt) && receipt.runAttempt > 0 && receipt.runAttempt <= runAttempt)
    assert.ok(browserNodes.includes(receipt.node) && Number.isInteger(receipt.shard) && receipt.shard >= 1 && receipt.shard <= shardCount)
    const key = `${receipt.node}/${receipt.shard}`
    assert.ok(!attempts.has(`${key}/${receipt.runAttempt}`), "Duplicate browser shard attempt")
    attempts.add(`${key}/${receipt.runAttempt}`)
    if (!latest.has(key) || latest.get(key).runAttempt < receipt.runAttempt) latest.set(key, receipt)
  }
  assert.equal(latest.size, browserNodes.length * shardCount, "Missing browser shard")
  const shards = [...latest.values()].sort((a, b) => a.node - b.node || a.shard - b.shard)
  const inventory = shards[0].inventory
  assert.equal(inventory.schemaVersion, 2)
  assert.equal(inventory.producerNode, 24, "Feature browsers must consume the canonical Node 24 build")
  assert.deepEqual(inventory.projects, projects)
  verifyPartition(inventory.tests, inventory.shards)
  for (const receipt of shards) {
    assert.equal(receipt.status, "success", `Node ${receipt.node} shard ${receipt.shard} failed or was cancelled`)
    assert.equal(receipt.error, undefined, "Browser report could not be read")
    assert.deepEqual(receipt.inventory, inventory, "Browser shards used different inventories")
    assert.deepEqual(sorted(receipt.cases.map((test) => test.id)), sorted(inventory.shards[receipt.shard - 1]), "Shard omitted or duplicated browser cases")
    assert.ok(receipt.cases.every((test) => ["expected", "flaky", "skipped"].includes(test.outcome)), "Unaccepted browser result")
    assert.ok(Number.isFinite(receipt.durationMs) && receipt.durationMs > 0)
    assert.ok(Number.isFinite(Date.parse(receipt.startedAt)))
  }
  const lanes = browserNodes.map((node) => {
    const parts = shards.filter((receipt) => receipt.node === node)
    const start = Math.min(...parts.map((part) => Date.parse(part.startedAt)))
    const end = Math.max(...parts.map((part) => Date.parse(part.startedAt) + part.durationMs))
    const counts = { expected: 0, flaky: 0, skipped: 0 }
    for (const test of parts.flatMap((part) => part.cases)) counts[test.outcome]++
    return { node, cases: inventory.tests.length, ...counts, browserWallMs: end - start, browserRunnerMs: parts.reduce((sum, part) => sum + part.durationMs, 0) }
  })
  return { schemaVersion: 2, sourceSha, runId, runAttempt, lanes, shards: shards.map(({ node, shard, runAttempt, startedAt, durationMs }) => ({ node, shard, runAttempt, startedAt, durationMs })) }
}

const sourceSha = () => execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim()
const readInventory = () => {
  const inventory = json("browser-inventory.json")
  assert.equal(inventory.schemaVersion, 2)
  assert.equal(inventory.producerNode, 24)
  const manifest = json("dist/lotus-next-manifest.json")
  assert.equal(inventory.sourceSha, sourceSha())
  assert.equal(manifest.sourceRevision, inventory.sourceSha)
  assert.equal(manifest.sourceDirty, false, "CI must test a clean exact-source artifact")
  verifyPartition(inventory.tests, inventory.shards)
  return inventory
}
const receiptFiles = (directory) => readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
  const path = join(directory, entry.name)
  return entry.isDirectory() ? receiptFiles(path) : entry.name === "browser-shard.json" ? [path] : []
})

const main = () => {
  const command = process.argv[2]
  if (command === "inventory") {
    assert.equal(Number(process.versions.node.split(".")[0]), 24, "Only Node 24 produces the feature browser artifact")
    const list = (shard) => JSON.parse(execFileSync(process.execPath, ["node_modules/@playwright/test/cli.js", "test", "--list", "--reporter=json", ...(shard ? [`--shard=${shard}/${shardCount}`] : [])], { env: { ...process.env, CI: "true" }, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 }))
    const full = list()
    assert.deepEqual(full.config.projects.map((project) => project.name), projects)
    const tests = reportCases(full).map((test) => test.id)
    const shards = Array.from({ length: shardCount }, (_, index) => reportCases(list(index + 1)).map((test) => test.id))
    verifyPartition(tests, shards)
    write("browser-inventory.json", { schemaVersion: 2, producerNode: 24, sourceSha: sourceSha(), projects, tests, shards })
    console.log(`${tests.length} cases partitioned exactly once: ${shards.map((shard) => shard.length).join(" / ")}`)
  } else if (command === "check-source") {
    readInventory()
  } else if (command === "receipt") {
    const receipt = { schemaVersion: 2, sourceSha: sourceSha(), runId: process.env.GITHUB_RUN_ID, runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), node: Number(process.versions.node.split(".")[0]), shard: Number(process.env.BROWSER_SHARD), status: process.env.SHARD_STATUS }
    try {
      receipt.inventory = readInventory()
      const report = json("browser-results.json")
      receipt.cases = reportCases(report)
      receipt.startedAt = report.stats.startTime
      receipt.durationMs = report.stats.duration
    } catch (error) {
      receipt.error = error.message
    }
    write("browser-shard.json", receipt)
  } else if (command === "summarize") {
    const summary = summarizeShards(receiptFiles("browser-receipts").map(json), { sourceSha: sourceSha(), runId: process.env.GITHUB_RUN_ID, runAttempt: Number(process.env.GITHUB_RUN_ATTEMPT), verifyResult: process.env.VERIFY_RESULT, browserResult: process.env.BROWSER_RESULT })
    write("browser-summary.json", summary)
    const minutes = (ms) => (ms / 60_000).toFixed(2)
    const markdown = ["## Browser acceptance", "", `Source: \`${summary.sourceSha}\`; run ${summary.runId}, attempt ${summary.runAttempt}.`, "", "| Node | Cases | Passed | Flaky | Skipped | Browser wall minutes | Browser runner minutes |", "| --- | ---: | ---: | ---: | ---: | ---: | ---: |", ...summary.lanes.map((lane) => `| ${lane.node} | ${lane.cases} | ${lane.expected} | ${lane.flaky} | ${lane.skipped} | ${minutes(lane.browserWallMs)} | ${minutes(lane.browserRunnerMs)} |`), "", "Browser timings include the all-surface Playwright invocations. Full job/workflow times and setup/auxiliary-suite runner cost must be measured from the Actions jobs API after completion.", "", "Rerun a failed shard with `gh api --method POST repos/bigduu/lotus-next/actions/jobs/JOB_ID/rerun`. GitHub also reruns dependent jobs, including this aggregate; successful unrelated shards retain their original receipts.", ""].join("\n")
    console.log(markdown)
    if (process.env.GITHUB_STEP_SUMMARY) appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown)
  } else {
    throw new Error(`Unknown browser-shards command: ${command}`)
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) {
    console.error(error.message)
    if (process.env.GITHUB_STEP_SUMMARY && existsSync(resolve(".git"))) appendFileSync(process.env.GITHUB_STEP_SUMMARY, `Browser acceptance failed: ${error.message}\n`)
    process.exitCode = 1
  }
}
