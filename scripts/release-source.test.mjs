import { describe, expect, it } from "vitest"
import { createHash } from "node:crypto"
import { readFileSync } from "node:fs"
import { resolveReleaseRequest, verifyAcceptanceEvidence, verifySourceReceipt, verifyCommittedAcceptance } from "./release-source.mjs"

const sourceSha = "5242eaf1d6e8cd8d437e8a4dcb82c63d00af82f1"
const candidate = {
  sourceRef: "refs/tags/lotus-next-v2026.10.8", sourceSha,
  sourceTree: "7c8866f30563022b4ceec7ce6515f99040835196",
  bambooSha: "0a7589586da0e5c60895e3222ece487415b7a9df",
  acceptanceReceiptSha256: "1".repeat(64), tagObjectSha: "1".repeat(40), acceptanceRunId: 37750101665, productPullRequest: 282,
  productMergeSha: "87a2a83eed98a93aed5caa49a6b0c79337bb3ee0",
  reviewEvidence: ["https://github.com/bigduu/lotus-next/pull/282#issuecomment-6055995084"],
}
const document = { schemaVersion: 1, candidates: { "2026.10.8": candidate } }
const request = { version: "2026.10.8", sourceRef: candidate.sourceRef, expectedSourceSha: sourceSha }
const clone = (value) => JSON.parse(JSON.stringify(value))
const workflowSha = "690b0f1b0cc0f21984b5f2574ec932ef526aac9f"
const workflowRef = "bigduu/lotus-next/.github/workflows/publish-npm.yml@refs/heads/main"
const receipt = {
  schemaVersion: 1, repository: "bigduu/lotus-next", version: request.version,
  sourceRef: candidate.sourceRef, sourceSha, sourceTree: candidate.sourceTree,
  workflowSha, workflowRef, tagObjectSha: "1".repeat(40), runId: "123", runAttempt: "1",
}
const environment = {
  DEFAULT_BRANCH: "main", GITHUB_REF: "refs/heads/main", GITHUB_REPOSITORY: "bigduu/lotus-next",
  GITHUB_WORKFLOW_REF: workflowRef, GITHUB_SHA: workflowSha, GITHUB_RUN_ID: "123", GITHUB_RUN_ATTEMPT: "1",
  LOTUS_NEXT_EXPECTED_SOURCE_REVISION: sourceSha, LOTUS_NEXT_RELEASE_VERSION: request.version,
}

describe("accepted immutable release source", () => {
  it("verifies real reviewed historical acceptance bytes and rejects tampering", () => {
    const accepted = JSON.parse(readFileSync(".github/release-candidates.json", "utf8")).candidates["2026.10.8"]
    const bytes = readFileSync(".github/release-acceptance/2026.10.8.json")
    const actual = verifyCommittedAcceptance(accepted, bytes)
    expect(actual.run.head_sha).toBe(accepted.sourceSha)
    expect(actual.jobs.jobs.every((job) => job.conclusion === "success")).toBe(true)
    expect(() => verifyCommittedAcceptance(accepted, Buffer.concat([bytes, Buffer.from(" ")]))).toThrow()
    const altered = { ...actual, run: { ...actual.run, head_sha: workflowSha } }
    const alteredBytes = Buffer.from(JSON.stringify(altered))
    expect(() => verifyCommittedAcceptance({ ...accepted, acceptanceReceiptSha256: createHash("sha256").update(alteredBytes).digest("hex") }, alteredBytes)).toThrow()
  })
  it("selects only the committed reviewed candidate", () => {
    expect(resolveReleaseRequest(document, request)).toEqual(candidate)
  })
  it.each([
    { version: "2026.10.9" }, { expectedSourceSha: "2".repeat(40) },
    { sourceRef: "refs/heads/main" }, { sourceRef: candidate.sourceRef + "\nsource_sha=poison" },
    { sourceRef: "refs/tags/../main" }, { expectedSourceSha: "main" },
  ])("rejects an unaccepted or unsafe dispatch request %j", (change) => {
    expect(() => resolveReleaseRequest(document, { ...request, ...change })).toThrow()
  })
  it("rejects a moving branch in the accepted candidate record", () => {
    const invalid = clone(document)
    invalid.candidates[request.version].sourceRef = "refs/heads/release/2026.10.8"
    expect(() => resolveReleaseRequest(invalid, { ...request, sourceRef: invalid.candidates[request.version].sourceRef })).toThrow()
  })
  it("requires completed actual gates and the normally merged exact product source", () => {
    const run = { id: candidate.acceptanceRunId, path: ".github/workflows/ci.yml", event: "workflow_dispatch", head_sha: sourceSha, status: "completed", conclusion: "success" }
    const jobs = { total_count: 3, jobs: ["Node 22", "Node 24", "Real Bamboo / Node 22"].map((name) => ({ name, head_sha: sourceSha, status: "completed", conclusion: "success" })) }
    const pr = { number: 282, merged: true, head: { sha: sourceSha }, merge_commit_sha: candidate.productMergeSha }
    expect(() => verifyAcceptanceEvidence(candidate, run, jobs, pr)).not.toThrow()
    expect(() => verifyAcceptanceEvidence(candidate, { ...run, path: run.path + "@release/2026.10.8", head_branch: "release/2026.10.8" }, jobs, pr)).not.toThrow()
    expect(() => verifyAcceptanceEvidence(candidate, { ...run, path: ".github/workflows/other.yml@main", head_branch: "main" }, jobs, pr)).toThrow()
    expect(() => verifyAcceptanceEvidence(candidate, { ...run, path: run.path + "@wrong", head_branch: "release/2026.10.8" }, jobs, pr)).toThrow()
    for (const conclusion of ["skipped", "failure", "cancelled"]) {
      const skipped = clone(jobs)
      skipped.jobs[2].conclusion = conclusion
      expect(() => verifyAcceptanceEvidence(candidate, run, skipped, pr)).toThrow()
    }
    expect(() => verifyAcceptanceEvidence(candidate, { ...run, head_sha: workflowSha }, jobs, pr)).toThrow()
    expect(() => verifyAcceptanceEvidence(candidate, run, { ...jobs, total_count: 4 }, pr)).toThrow()
    expect(() => verifyAcceptanceEvidence(candidate, run, jobs, { ...pr, merged: false })).toThrow()
  })
  it("keeps workflow and source identities distinct in one run-bound receipt", () => {
    expect(verifySourceReceipt(receipt, environment, sourceSha)).toEqual(receipt)
    expect(workflowSha).not.toBe(sourceSha)
  })
  it.each([
    { GITHUB_REF: "refs/tags/lotus-next-v2026.10.8" }, { GITHUB_SHA: sourceSha },
    { GITHUB_RUN_ID: "124" }, { GITHUB_RUN_ATTEMPT: "2" },
    { LOTUS_NEXT_EXPECTED_SOURCE_REVISION: workflowSha },
    { LOTUS_NEXT_RELEASE_VERSION: "2026.10.9" }, { GITHUB_REPOSITORY: "other/lotus-next" },
  ])("rejects copied or altered publication authority %j", (change) => {
    expect(() => verifySourceReceipt(receipt, { ...environment, ...change }, sourceSha)).toThrow()
  })
  it("rejects a different source checkout even with a valid workflow receipt", () => {
    expect(() => verifySourceReceipt(receipt, environment, workflowSha)).toThrow()
  })
})
