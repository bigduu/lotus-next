import { describe, expect, it } from "vitest"
import { reportCases, verifyPartition, summarizeShards } from "./browser-shards.mjs"

const clone = (value) => JSON.parse(JSON.stringify(value))
const context = { sourceSha: "a".repeat(40), runId: "123", runAttempt: 1, verifyResult: "success", browserResult: "success" }
const inventory = {
  schemaVersion: 2, producerNode: 24,
  sourceSha: context.sourceSha,
  projects: ["desktop-chromium", "tablet-chromium", "phone-chromium"],
  tests: ["a", "b", "c", "d"], shards: [["a"], ["b"], ["c"], ["d"]],
}
const fixtures = () => [24].flatMap((node) => inventory.shards.map((ids, index) => ({
  schemaVersion: 2, sourceSha: context.sourceSha, runId: context.runId, runAttempt: 1,
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
    expect(summary.lanes).toEqual([24].map((node) => ({ node, cases: 4, expected: 3, flaky: 0, skipped: 1, browserWallMs: 300_000, browserRunnerMs: 480_000 })))
  })
  it.each(["failure", "cancelled", "skipped", "timed_out"])("rejects a %s shard despite a successful aggregate dependency", (status) => {
    const receipts = fixtures(); receipts[2].status = status
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
  it("rejects historical receipts and any extra browser lane without dropping original cases", () => {
    const receipts = fixtures()
    expect(receipts).toHaveLength(4)
    expect(() => summarizeShards(receipts.map((receipt) => ({ ...receipt, schemaVersion: 1 })), context)).toThrow(/single-producer/)
    expect(() => summarizeShards([...receipts, ...receipts.map((receipt) => ({ ...receipt, node: 22 }))], context)).toThrow()
    const wrongProducer = fixtures()
    for (const receipt of wrongProducer) receipt.inventory.producerNode = 22
    expect(() => summarizeShards(wrongProducer, context)).toThrow(/canonical Node 24/)
  })
  it("accepts a single failed-shard rerun with unchanged successful siblings", () => {
    const receipts = fixtures()
    receipts[2].status = "failure"
    const retry = { ...clone(receipts[2]), runAttempt: 2, status: "success" }
    const result = summarizeShards([...receipts, retry], { ...context, runAttempt: 2 })
    expect(result.shards.filter((shard) => shard.runAttempt === 2)).toEqual([expect.objectContaining({ node: 24, shard: 3 })])
    retry.status = "failure"
    expect(() => summarizeShards([...receipts, retry], { ...context, runAttempt: 2 })).toThrow()
  })
})
