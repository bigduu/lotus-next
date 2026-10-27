import { describe, expect, it } from "vitest"
import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import { runInNewContext } from "node:vm"
import { reportCases, verifyPartition, summarizeShards } from "./browser-shards.mjs"
import { acceptanceJobNames } from "./release-source.mjs"

const clone = (value) => JSON.parse(JSON.stringify(value))
const context = { sourceSha: "a".repeat(40), runId: "123", runAttempt: 1, verifyResult: "success", browserResult: "success" }
const inventory = {
  sourceSha: context.sourceSha,
  projects: ["desktop-chromium", "tablet-chromium", "phone-chromium"],
  tests: ["a", "b", "c", "d"], shards: [["a"], ["b"], ["c"], ["d"]],
}
const fixtures = () => [22, 24].flatMap((node) => inventory.shards.map((ids, index) => ({
  schemaVersion: 1, sourceSha: context.sourceSha, runId: context.runId, runAttempt: 1,
  node, shard: index + 1, status: "success", inventory: clone(inventory),
  cases: ids.map((id) => ({ id, outcome: index === 3 ? "skipped" : "expected" })),
  startedAt: `2026-10-25T00:0${index}:00Z`, durationMs: 120_000,
})))

describe("browser shard inventory", () => {
  it("retains every project and original test identity, including skipped cases", () => {
    const report = { errors: [], suites: [{ suites: [{ specs: [{ id: "case", tests: [{ projectName: "desktop-chromium", status: "expected" }, { projectName: "phone-chromium", status: "skipped" }] }] }] }] }
    expect(reportCases(report)).toEqual([{ id: "case/desktop-chromium", outcome: "expected" }, { id: "case/phone-chromium", outcome: "skipped" }])
    expect(() => reportCases({ ...report, errors: [{ message: "collection failed" }] })).toThrow()
    expect(() => reportCases({ errors: [], suites: [] })).toThrow()
    expect(() => reportCases({ ...report, suites: [...report.suites, ...report.suites] })).toThrow(/Duplicate/)
  })
  it("requires the exact original inventory once across four nonempty shards", () => {
    expect(() => verifyPartition(inventory.tests, inventory.shards)).not.toThrow()
    for (const parts of [[[], ["b"], ["c"], ["d"]], [["a"], ["a", "b"], ["c"], ["d"]], [["a"], ["b"], ["c"], ["other"]], inventory.shards.slice(1)]) {
      expect(() => verifyPartition(inventory.tests, parts)).toThrow()
    }
  })
})

describe("fail-closed browser aggregate", () => {
  it("reports actual browser wall and runner time with the retained skip counts", () => {
    const summary = summarizeShards(fixtures(), context)
    expect(summary.lanes).toEqual([22, 24].map((node) => ({ node, cases: 4, expected: 3, flaky: 0, skipped: 1, browserWallMs: 300_000, browserRunnerMs: 480_000 })))
  })
  it.each(["failure", "cancelled", "skipped", "timed_out"])("rejects a %s shard despite a successful aggregate dependency", (status) => {
    const receipts = fixtures(); receipts[6].status = status
    expect(() => summarizeShards(receipts, context)).toThrow()
  })
  it.each(["verifyResult", "browserResult"])("requires a successful %s", (field) => {
    for (const result of ["failure", "cancelled", "skipped", undefined]) expect(() => summarizeShards(fixtures(), { ...context, [field]: result })).toThrow()
  })
  it.each([
    ["missing shard", (receipts) => receipts.pop()],
    ["duplicate shard", (receipts) => receipts.push(clone(receipts[0]))],
    ["wrong source", (receipts) => { receipts[0].sourceSha = "b".repeat(40) }],
    ["wrong run", (receipts) => { receipts[0].runId = "124" }],
    ["future attempt", (receipts) => { receipts[0].runAttempt = 2 }],
    ["unknown node", (receipts) => { receipts[0].node = 26 }],
    ["unknown shard", (receipts) => { receipts[0].shard = 5 }],
    ["missing case", (receipts) => { receipts[0].cases = [] }],
    ["duplicated case", (receipts) => { receipts[0].cases.push(receipts[0].cases[0]) }],
    ["unexpected result", (receipts) => { receipts[0].cases[0].outcome = "unexpected" }],
    ["interrupted result", (receipts) => { receipts[0].cases[0].outcome = "interrupted" }],
    ["different inventory", (receipts) => { receipts[0].inventory.tests[0] = "other" }],
    ["lost phone surface", (receipts) => { for (const receipt of receipts) receipt.inventory.projects.pop() }],
    ["unreadable report", (receipts) => { receipts[0].error = "missing report" }],
    ["invalid timing", (receipts) => { receipts[0].durationMs = 0 }],
  ])("rejects %s", (_label, mutate) => {
    const receipts = fixtures(); mutate(receipts)
    expect(() => summarizeShards(receipts, context)).toThrow()
  })
  it("accepts a single failed-shard rerun with unchanged successful siblings", () => {
    const receipts = fixtures()
    receipts[2].status = "failure"
    const retry = { ...clone(receipts[2]), runAttempt: 2, status: "success" }
    const result = summarizeShards([...receipts, retry], { ...context, runAttempt: 2 })
    expect(result.shards.filter((shard) => shard.runAttempt === 2)).toEqual([expect.objectContaining({ node: 22, shard: 3 })])
    retry.status = "failure"
    expect(() => summarizeShards([...receipts, retry], { ...context, runAttempt: 2 })).toThrow()
  })
})

// Temporary protection bridge. #450 replaces these assertions with full
// feature/source admission, including automatic Real Bamboo and native Actor.
describe("temporary dev Feature acceptance", () => {
  const ci = readFileSync(".github/workflows/ci.yml", "utf8")
  const marker = "\n  feature-acceptance:\n"
  const bridge = () => {
    expect(ci.indexOf(marker)).toBeGreaterThan(0)
    return ci.slice(ci.indexOf(marker))
  }
  const run = (verify, browser) => {
    const match = bridge().match(/        run: \|\n([\s\S]+)/u)
    expect(match).not.toBeNull()
    return spawnSync("bash", ["-c", match[1].replace(/^          /gmu, "")], {
      env: { PATH: process.env.PATH, VERIFY_RESULT: verify, BROWSER_RESULT: browser }, encoding: "utf8",
    })
  }
  it("retains all original jobs and adds a real required check only for dev PRs", () => {
    const block = bridge()
    expect(ci.slice(0, ci.indexOf(marker))).toBe(readFileSync("scripts/fixtures/ci-sharded-main-v1.yml", "utf8"))
    expect(ci).toContain("on:\n  pull_request:")
    expect(block).toContain("    name: Feature acceptance\n")
    expect(block).toContain("    needs: [verify, browser-summary]\n")
    expect(block).toContain("VERIFY_RESULT: ${{ needs.verify.result }}")
    expect(block).toContain("BROWSER_RESULT: ${{ needs.browser-summary.result }}")
    expect(block).not.toMatch(/continue-on-error:|uses:|GITHUB_OUTPUT|SOURCE_RECEIPT_PATH/u)
    const expression = block.match(/^    if: \$\{\{ (.+) \}\}$/mu)?.[1]
    expect(expression).toBe("always() && github.event_name == 'pull_request' && github.base_ref == 'dev'")
    for (const [event_name, base_ref, selected] of [["pull_request", "dev", true], ["pull_request", "main", false],
      ["workflow_dispatch", "", false], ["push", "dev", false]]) {
      expect(runInNewContext(expression, { always: () => true, github: { event_name, base_ref } })).toBe(selected)
    }
    expect(run("success", "success").status).toBe(0)
  })
  it.each(["failure", "cancelled", "skipped", "timed_out", "", undefined])("rejects dependency result %j", result => {
    expect(run(result, "success").status).not.toBe(0)
    expect(run("success", result).status).not.toBe(0)
  })
  it("does not make the transitional graph eligible for historical publication", () => {
    expect(() => acceptanceJobNames(ci)).toThrow(/Unknown acceptance workflow graph/u)
  })
})
