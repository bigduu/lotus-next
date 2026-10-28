import { readFileSync } from "node:fs"
import { describe, expect, it } from "vitest"
import { acceptanceJobNames, devFeatureJobNames, verifyDevAcceptance } from "./release-source.mjs"

const clone = value => JSON.parse(JSON.stringify(value))

describe("minimal publication requires complete pre-merge Dev feature evidence", () => {
  const workflow = readFileSync(".github/workflows/ci.yml", "utf8")
  const fixture = () => {
    const source = "d".repeat(40), head = "f".repeat(40), base = "b".repeat(40), snapshot = "a".repeat(40), tree = "c".repeat(40)
    const pr = { number: 450, state: "closed", merged: true, base: { ref: "dev", repo: { full_name: "bigduu/lotus-next" } },
      head: { sha: head, repo: { full_name: "bigduu/lotus-next" } }, merge_commit_sha: source, merged_at: "2026-10-27T12:00:00Z" }
    const run = { id: 10, run_attempt: 1, workflow_id: 1, path: ".github/workflows/ci.yml", event: "pull_request", head_sha: head,
      repository: { full_name: "bigduu/lotus-next" }, head_repository: { full_name: "bigduu/lotus-next" }, status: "completed", conclusion: "success" }
    const steps = { "Node 22": ["Verify Node 22 Unit compatibility"], "Node 24": ["Verify architecture, build, and package contents"],
      "Real Bamboo / Node 24": ["Verify a real chat round trip with the pinned published Bamboo", "Verify the current source artifact on local and secure browser surfaces"],
      "Native Actor acceptance / Native Actor / Node 24": ["Verify three negative controls and restored real Actor proof"] }
    for (const n of [1, 2, 3, 4]) steps[`Browser / Node 24 / shard ${n} of 4`] = ["Verify the all-surface browser shard"]
    const jobs = { total_count: 11, jobs: devFeatureJobNames(workflow).map(name => ({ name, run_id: 10, run_attempt: 1, head_sha: head, status: "completed", conclusion: "success",
      completed_at: "2026-10-27T11:00:00Z", steps: (steps[name] || []).map(name => ({ name, status: "completed", conclusion: "success" })) })) }
    const receipt = { schemaVersion: 1, kind: "lotus-feature-acceptance/v1", source: { repository: "bigduu/lotus-next", pullRequest: 450,
      baseRef: "dev", headSha: head, baseSha: base, runId: "10", sourceRunAttempt: 1, testedSnapshot: snapshot, testedTree: tree },
      gates: { source: "success", verify: "success", browser: "success", realBamboo: "success", nativeActor: "success" }, acceptanceRunAttempt: 1 }
    const merged = { sha: source, parents: [{ sha: base }, { sha: head }], tree: { sha: tree } }
    const tested = { ...clone(merged), sha: snapshot }
    return { source, pr, run, jobs, receipt, merged, tested }
  }
  const verify = x => verifyDevAcceptance(x.source, x.pr, x.run, x.jobs, x.receipt, x.merged, x.tested, 1, workflow)
  it("accepts the actual tested M and normally merged D without any Main candidate registration", () => {
    const x = fixture()
    expect(verify(x)).toEqual({ sourceTree: x.merged.tree.sha, testedSnapshot: x.tested.sha, featureRunAttempt: 1 })
  })
  it.each(["failure", "cancelled", "skipped"])("rejects every incomplete feature owner: %s", state => {
    for (let i = 0; i < 11; i++) { const x = fixture(); x.jobs.jobs[i].conclusion = state; expect(() => verify(x)).toThrow() }
  })
  it("rejects skipped runtime steps even if the enclosing job is green", () => {
    const x = fixture(); x.jobs.jobs.find(j => j.name === "Real Bamboo / Node 24").steps[1].conclusion = "skipped"
    expect(() => verify(x)).toThrow()
  })
  it("accepts successful earlier-attempt jobs when the final acceptance receipt matches its own attempt", () => {
    const x = fixture(); x.run.run_attempt = 2; x.receipt.acceptanceRunAttempt = 2
    x.jobs.jobs.find(job => job.name === "Feature acceptance").run_attempt = 2
    expect(() => verify(x)).not.toThrow()
  })
  it.each([
    ["foreign source", x => { x.pr.head.repo.full_name = "other/repo" }],
    ["Main instead of Dev", x => { x.pr.base.ref = "main" }],
    ["unmerged source", x => { x.pr.merged = false }],
    ["foreign run", x => { x.run.workflow_id = 2 }],
    ["manual diagnostic", x => { x.run.event = "workflow_dispatch" }],
    ["wrong run source", x => { x.run.head_sha = x.source }],
    ["job from another run", x => { x.jobs.jobs[0].run_id = 999 }],
    ["future job attempt", x => { x.jobs.jobs[0].run_attempt = 2 }],
    ["missing job attempt", x => { delete x.jobs.jobs[0].run_attempt }],
    ["fractional job attempt", x => { x.jobs.jobs[0].run_attempt = 0.5 }],
    ["acceptance job from another attempt", x => { x.run.run_attempt = 2; x.receipt.acceptanceRunAttempt = 2 }],
    ["fractional source attempt", x => { x.receipt.source.sourceRunAttempt = 0.5 }],
    ["fractional acceptance attempt", x => { x.receipt.acceptanceRunAttempt = 0.5 }],
    ["invalid tested snapshot", x => { x.receipt.source.testedSnapshot = "invalid" }],
    ["missing job", x => { x.jobs.jobs.pop() }],
    ["wrong tested tree", x => { x.tested.tree.sha = "e".repeat(40) }],
    ["rewritten Dev parents", x => { x.merged.parents.reverse() }],
    ["post-merge tests", x => { x.jobs.jobs[0].completed_at = "2026-10-27T13:00:00Z" }],
    ["partial runtime receipt", x => { x.receipt.gates.realBamboo = "skipped" }],
  ])("rejects %s", (_name, change) => { const x = fixture(); change(x); expect(() => verify(x)).toThrow() })
})


describe("historical publication boundary", () => {
  it("keeps new Dev receipts out of the existing historical parser", () => {
    const feature = readFileSync(".github/workflows/ci.yml", "utf8")
    const historical = readFileSync("scripts/fixtures/ci-sharded-main-v1.yml", "utf8")
    expect(() => acceptanceJobNames(feature)).toThrow(/Unknown acceptance workflow graph/)
    expect(() => devFeatureJobNames(historical)).toThrow()
  })
  it("rejects a feature graph with missing or duplicate matrix coverage", () => {
    const feature = readFileSync(".github/workflows/ci.yml", "utf8")
    expect(() => devFeatureJobNames(feature.replace("          - 4\n", "          - 3\n"))).toThrow()
  })
})
