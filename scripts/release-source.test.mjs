import { describe, expect, it } from "vitest"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { resolveReleaseRequest, verifyAcceptanceEvidence, verifySourceReceipt, verifyCommittedAcceptance, verifyCandidateBackendPins } from "./release-source.mjs"

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

describe("candidate Bamboo source bindings", () => {
  const files = {
    ci: readFileSync(".github/workflows/ci.yml", "utf8"),
    publication: readFileSync(".github/workflows/publish-npm.yml", "utf8"),
    runtime: readFileSync("e2e/support/realBambooRuntime.ts", "utf8"),
    acceptanceTest: readFileSync("scripts/published-real-bamboo-acceptance.test.mjs", "utf8"),
  }
  const bambooSha = files.runtime.match(/export const REAL_BAMBOO_REVISION = "([0-9a-f]{40})";/)[1]
  const currentCandidate = { ...candidate, bambooSha }
  const dynamicBinding = "${{ needs.preflight.outputs.bamboo_sha }}"
  const replaceBinding = (source, value) => source.replace(/BAMBOO_E2E_REVISION: [^\r\n]+/, `BAMBOO_E2E_REVISION: ${value}`)

  it("accepts the actual receipt-bound publication workflow with its paired source pins", () => {
    expect(() => verifyCandidateBackendPins(currentCandidate, files)).not.toThrow()
  })
  it("retains historical candidates whose publication workflow pins the accepted SHA literally", () => {
    const historical = Object.fromEntries(Object.entries(files).map(([key, source]) => [key, source.replaceAll(bambooSha, candidate.bambooSha)]))
    historical.publication = replaceBinding(historical.publication, candidate.bambooSha)
    expect(() => verifyCandidateBackendPins(candidate, historical)).not.toThrow()
  })
  it("runs preflight against immutable candidate files and writes their Bamboo authority into the receipt and outputs", () => {
    const root = realpathSync(mkdtempSync(join(tmpdir(), "lotus-source-preflight-")))
    const repo = join(root, "repo")
    mkdirSync(repo)
    const git = (...args) => execFileSync("git", args, { cwd: repo, encoding: "utf8" }).trim()
    const write = (path, source) => {
      const target = join(repo, path)
      mkdirSync(dirname(target), { recursive: true })
      writeFileSync(target, source)
    }
    try {
      git("init", "--quiet", "--initial-branch=main")
      git("config", "user.name", "Lotus preflight test")
      git("config", "user.email", "preflight@example.invalid")
      for (const path of ["scripts/release-source.mjs", ".github/workflows/ci.yml", ".github/workflows/publish-npm.yml", "e2e/support/realBambooRuntime.ts", "scripts/published-real-bamboo-acceptance.test.mjs"]) {
        write(path, readFileSync(resolve(path)))
      }
      git("add", ".")
      git("commit", "--quiet", "-m", "Candidate source")
      const sourceSha = git("rev-parse", "HEAD")
      const sourceTree = git("rev-parse", "HEAD^{tree}")
      git("tag", "-a", candidate.sourceRef.replace("refs/tags/", ""), "-m", "Accepted candidate")
      const tagObjectSha = git("rev-parse", candidate.sourceRef)
      git("commit", "--quiet", "--allow-empty", "-m", "Merged product")
      const productMergeSha = git("rev-parse", "HEAD")
      const acceptance = {
        schemaVersion: 1, repository: "bigduu/lotus-next",
        run: { id: candidate.acceptanceRunId, path: ".github/workflows/ci.yml", event: "workflow_dispatch", head_sha: sourceSha, status: "completed", conclusion: "success" },
        jobs: { total_count: 3, jobs: ["Node 22", "Node 24", "Real Bamboo / Node 22"].map((name) => ({ name, head_sha: sourceSha, status: "completed", conclusion: "success" })) },
        pullRequest: { number: candidate.productPullRequest, merged: true, head: { sha: sourceSha }, merge_commit_sha: productMergeSha },
      }
      const acceptanceBytes = JSON.stringify(acceptance)
      const accepted = { ...currentCandidate, sourceSha, sourceTree, tagObjectSha, productMergeSha, acceptanceReceiptSha256: createHash("sha256").update(acceptanceBytes).digest("hex") }
      write(".github/release-candidates.json", JSON.stringify({ schemaVersion: 1, candidates: { [request.version]: accepted } }))
      write(`.github/release-acceptance/${request.version}.json`, acceptanceBytes)
      // Publication controls can advance independently; their local CI pin must
      // never replace the already accepted candidate's backend source authority.
      write(".github/workflows/ci.yml", replaceBinding(files.ci, "a".repeat(40)))
      git("add", ".")
      git("commit", "--quiet", "-m", "Reviewed publication controls")
      const workflowSha = git("rev-parse", "HEAD")
      git("remote", "add", "origin", repo)
      const receiptPath = join(root, "receipt.json")
      const outputPath = join(root, "outputs")
      execFileSync(process.execPath, [join(repo, "scripts/release-source.mjs")], {
        cwd: repo,
        env: { ...process.env, ...environment, GITHUB_SHA: workflowSha, EXPECTED_WORKFLOW_SHA: workflowSha, SOURCE_REF_INPUT: accepted.sourceRef, EXPECTED_SOURCE_SHA_INPUT: sourceSha, SOURCE_RECEIPT_PATH: receiptPath, GITHUB_OUTPUT: outputPath },
        timeout: 10_000,
      })
      expect(sourceSha).not.toBe(workflowSha)
      expect(JSON.parse(readFileSync(receiptPath, "utf8"))).toMatchObject({ sourceSha, sourceTree, workflowSha, bambooSha, tagObjectSha })
      expect(readFileSync(outputPath, "utf8")).toContain(`bamboo_sha=${bambooSha}\n`)
      expect(git("status", "--porcelain", "--untracked-files=all")).toBe("")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
  it.each(["ci", "publication", "runtime", "acceptanceTest"])("rejects a missing %s source binding", (file) => {
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, [file]: "" })).toThrow()
  })
  it.each(["ci", "publication", "runtime", "acceptanceTest"])("rejects a mismatched %s pin despite the other matching bindings", (file) => {
    const source = file === "publication" ? replaceBinding(files[file], workflowSha) : files[file].replaceAll(bambooSha, workflowSha)
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, [file]: source })).toThrow()
  })
  it("requires CI to pin the literal accepted revision even when publication uses the preflight output", () => {
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, ci: replaceBinding(files.ci, dynamicBinding) })).toThrow()
  })
  it.each([
    ["dispatch input", (source) => source.replace("steps.source.outputs.bamboo_sha", "inputs.bamboo_sha")],
    ["moving ref", (source) => source.replace("${{ steps.source.outputs.bamboo_sha }}", "main")],
    ["unrelated step output", (source) => source.replace("steps.source.outputs.bamboo_sha", "steps.other.outputs.bamboo_sha")],
    ["commented output mapping", (source) => source.replace("      bamboo_sha:", "      # bamboo_sha:")],
    ["duplicate output mapping", (source) => source.replace("      bamboo_sha:", "      bamboo_sha: main\n      bamboo_sha:")],
    ["another job's environment", (source) => source.replace("  real-bamboo:", "  other-runtime:")],
    ["missing preflight dependency", (source) => source.replace("    needs: [preflight, verify]", "    needs: verify")],
    ["another environment level", (source) => source.replace(`      BAMBOO_E2E_REVISION: ${dynamicBinding}`, `          BAMBOO_E2E_REVISION: ${dynamicBinding}`)],
    ["wrong source step", (source) => source.replace("        id: source", "        id: other")],
    ["duplicate source step ID", (source) => source.replace("        id: source", "        id: source\n        id: other")],
    ["commented source invocation", (source) => source.replace("        run: node scripts/release-source.mjs", "        # run: node scripts/release-source.mjs\n        run: echo bamboo_sha=main")],
    ["invocation in another step", (source) => source.replace("        run: node scripts/release-source.mjs", "      - name: Unrelated step\n        run: node scripts/release-source.mjs")],
  ])("rejects a dynamic binding wired to %s", (_name, alter) => {
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication: alter(files.publication) })).toThrow()
  })
  it.each([
    ["moving checkout ref", (source) => source.replace("ref: ${{ env.BAMBOO_E2E_REVISION }}", "ref: main")],
    ["different checkout revision", (source) => source.replace("ref: ${{ env.BAMBOO_E2E_REVISION }}", `ref: ${workflowSha}`)],
    ["unrelated checkout output", (source) => source.replace("ref: ${{ env.BAMBOO_E2E_REVISION }}", "ref: ${{ needs.preflight.outputs.source_sha }}")],
    ["other checkout repository", (source) => source.replace("repository: bigduu/Bamboo-agent", "repository: other/backend")],
    ["commented checkout ref", (source) => source.replace("          ref: ${{ env.BAMBOO_E2E_REVISION }}", "          # ref: ${{ env.BAMBOO_E2E_REVISION }}\n          ref: main")],
    ["duplicate checkout ref", (source) => source.replace("          ref: ${{ env.BAMBOO_E2E_REVISION }}", "          ref: ${{ env.BAMBOO_E2E_REVISION }}\n          ref: main")],
    ["different checkout destination", (source) => source.replace("          path: .e2e-bamboo", "          path: other-backend")],
    ["duplicate checkout destination", (source) => source.replace("          path: .e2e-bamboo", "          path: .e2e-bamboo\n          path: other-backend")],
  ])("rejects a dynamic binding consumed by %s", (_name, alter) => {
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication: alter(files.publication) })).toThrow()
  })
  it.each([
    ["flow-style step env", "      - name: Check out the paired Bamboo revision\n        env: { BAMBOO_E2E_REVISION: main }"],
    ["env-first flow style", "      - env: { BAMBOO_E2E_REVISION: main }\n        name: Check out the paired Bamboo revision"],
    ["block step env", "      - name: Check out the paired Bamboo revision\n        env:\n          'BAMBOO_E2E_REVISION': main"],
    ["env-first block style", "      - env:\n          'BAMBOO_E2E_REVISION': main\n        name: Check out the paired Bamboo revision"],
    ["quoted env key", "      - name: Check out the paired Bamboo revision\n        'env': { BAMBOO_E2E_REVISION: main }"],
    ["merged step env", "      - name: Check out the paired Bamboo revision\n        <<: { env: { BAMBOO_E2E_REVISION: main } }"],
  ])("rejects a paired checkout with %s", (_name, header) => {
    const publication = files.publication.replace("      - name: Check out the paired Bamboo revision", header)
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication })).toThrow()
  })
  it.each([
    ["duplicate flow-style with", (source) => source.replace("          path: .e2e-bamboo", "          path: .e2e-bamboo\n        with: { ref: main }")],
    ["quoted ref override", (source) => source.replace("          ref: ${{ env.BAMBOO_E2E_REVISION }}", "          ref: ${{ env.BAMBOO_E2E_REVISION }}\n          'ref': main")],
  ])("rejects a paired checkout with %s", (_name, alter) => {
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication: alter(files.publication) })).toThrow()
  })
  it("allows commented environment examples without treating them as checkout declarations", () => {
    const publication = files.publication.replace("      - name: Check out the paired Bamboo revision", "      - name: Check out the paired Bamboo revision\n        # env: { BAMBOO_E2E_REVISION: main }")
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication })).not.toThrow()
  })
  it.each([
    ["working directory", "        working-directory: shim"],
    ["shell", "        shell: node {0}"],
    ["flow env", "        env: { SOURCE_REF_INPUT: main }"],
    ["merged execution context", "        <<: { working-directory: shim }"],
    ["quoted working directory", "        'working-directory': shim"],
    ["continue on error", "        continue-on-error: true"],
  ])("rejects a source authority step with %s", (_name, extra) => {
    const publication = files.publication.replace("        id: source", `        id: source\n${extra}`)
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication })).toThrow()
  })
  it.each(["SOURCE_REF_INPUT", "EXPECTED_SOURCE_SHA_INPUT", "EXPECTED_WORKFLOW_SHA", "SOURCE_RECEIPT_PATH"])("rejects altered source authority input %s", (key) => {
    const publication = files.publication.replace(new RegExp(`^          ${key}:.*$`, "m"), `          ${key}: main`)
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication })).toThrow()
  })
  it.each([
    ["workflow block", (source) => `defaults:\n  run:\n    working-directory: shim\n${source}`],
    ["workflow flow", (source) => `defaults: { run: { shell: 'node {0}' } }\n${source}`],
    ["workflow quoted", (source) => `'defaults': { run: { working-directory: shim } }\n${source}`],
    ["workflow merge", (source) => `<<: { defaults: { run: { working-directory: shim } } }\n${source}`],
    ["preflight block", (source) => source.replace("  preflight:", "  preflight:\n    defaults:\n      run:\n        working-directory: shim")],
    ["preflight flow", (source) => source.replace("  preflight:", "  preflight:\n    defaults: { run: { shell: 'node {0}' } }")],
    ["preflight quoted", (source) => source.replace("  preflight:", "  preflight:\n    'defaults': { run: { working-directory: shim } }")],
    ["preflight merge", (source) => source.replace("  preflight:", "  preflight:\n    <<: { defaults: { run: { working-directory: shim } } }")],
  ])("rejects inherited source execution overrides in %s", (_name, alter) => {
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication: alter(files.publication) })).toThrow()
  })
  it.each([
    "${{ inputs.bamboo_sha }}", "${{ env.BAMBOO_E2E_REVISION }}",
    "${{ needs.verify.outputs.bamboo_sha }}", "${{ needs.preflight.outputs.source_sha }}",
    "${{ needs.preflight.outputs.bamboo_sha || 'main' }}", dynamicBinding + "suffix", "main",
  ])("rejects publication backend authority %s", (value) => {
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication: replaceBinding(files.publication, value) })).toThrow()
  })
  it.each(["ci", "publication"])("rejects commented or ambiguous %s assignments", (file) => {
    const original = files[file]
    const commented = original.replace(/^(\s*)(BAMBOO_E2E_REVISION:)/m, "$1# $2")
    const duplicate = original + `\n      BAMBOO_E2E_REVISION: ${workflowSha}\n`
    const suffixed = replaceBinding(original, (file === "ci" ? bambooSha : dynamicBinding) + "suffix")
    for (const source of [commented, duplicate, suffixed]) {
      expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, [file]: source })).toThrow()
    }
  })
})

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
