import { describe, expect, it } from "vitest"
import { pathToFileURL } from "node:url"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { resolveReleaseRequest, verifyAcceptanceEvidence, verifySourceReceipt, verifyCommittedAcceptance, verifyCandidateBackendPins, acceptanceJobNames, devFeatureJobNames, verifyProductMerge } from "./release-source.mjs"

const legacyWorkflow = readFileSync("scripts/fixtures/ci-unsharded.yml", "utf8")
// Historical receipts retain their original source/workflow graph.
const currentPublication = readFileSync(".github/workflows/publish-npm.yml", "utf8")
// Small structural fixture for the historical parser; no shallow-Git dependency.
const legacyPublication = currentPublication
  .replace("      source_receipt_artifact_id: ${{ steps.receipt.outputs.artifact-id }}\n", "")
  .replace("    permissions:\n      contents: write\n      actions: read\n      pull-requests: read\n", "")
  .replace("        run: node scripts/release-source.mjs reserve", "        run: node scripts/release-source.mjs")
  .replaceAll("          LOTUS_RELEASE_TAG_RULESET_ID: ${{ vars.LOTUS_RELEASE_TAG_RULESET_ID }}\n", "")
  .replace("          GH_TOKEN: ${{ github.token }}\n          FEATURE_PR_INPUT: ${{ inputs.feature_pr }}\n", "")
  .replaceAll("    if: github.ref == 'refs/heads/dev' && github.ref_protected\n", "")
  .replace("  build:\n", "  real-bamboo:\n")
  .replace("    name: Build and pack the final artifact once\n", "    name: Legacy runtime\n    timeout-minutes: 60\n")
  .replace("    outputs:\n      filename: ${{ steps.pack.outputs.filename }}\n      integrity: ${{ steps.pack.outputs.integrity }}\n      shasum: ${{ steps.pack.outputs.shasum }}\n", "")
  .replace("    needs: [preflight, build]\n", "    needs:\n      - preflight\n      - real-bamboo\n")
  .replace("      ACCEPTED_SOURCE_TREE: ${{ needs.preflight.outputs.source_tree }}\n", "      ACCEPTED_SOURCE_TREE: ${{ needs.preflight.outputs.source_tree }}\n      BAMBOO_E2E_REVISION: ${{ needs.preflight.outputs.bamboo_sha }}\n      LOTUS_NEXT_ACCEPTANCE_SOURCE_DIR: ${{ github.workspace }}\n\n")
  .replace("      - name: Refuse another build on workflow retries\n", `      - name: Check out the paired Bamboo revision
        uses: actions/checkout@v7
        with:
          repository: bigduu/Bamboo-agent
          ref: \${{ env.BAMBOO_E2E_REVISION }}
          path: .e2e-bamboo
          persist-credentials: false
      - name: Refuse another build on workflow retries
`)

// Preserve the exact pre-transition graph for historical publication contracts.
// Neither the temporary bridge nor the new feature receipt authorizes the old publisher.
const shardedWorkflow = readFileSync("scripts/fixtures/ci-sharded-main-v1.yml", "utf8")
const verifyLegacyAcceptance = (...args) => verifyAcceptanceEvidence(...args, legacyWorkflow)
const verifyLegacyCommittedAcceptance = (...args) => verifyCommittedAcceptance(...args, legacyWorkflow)

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

describe("feature delivery activation boundary", () => {
  it("recognizes the complete feature graph while preserving historical graph reads", () => {
    expect(devFeatureJobNames(readFileSync(".github/workflows/ci.yml", "utf8"))).toHaveLength(11)
    expect(acceptanceJobNames(shardedWorkflow)).toHaveLength(12)
  })
})

describe("frozen reviewed PR-head merge provenance", () => {
  const mainPr = { base: { ref: "main", repo: { full_name: "bigduu/lotus-next" } } }
  it("retains historical equal-tree merges and accepts an exact head merged after main advanced", () => {
    expect(() => verifyProductMerge(candidate, candidate.sourceTree, [sourceSha])).not.toThrow()
    expect(() => verifyProductMerge(candidate, "a".repeat(40), [workflowSha, sourceSha], mainPr)).not.toThrow()
  })
  it.each([
    [], [sourceSha], [sourceSha, workflowSha], [workflowSha, "b".repeat(40)],
    [workflowSha, sourceSha, "b".repeat(40)], ["moving-main", sourceSha],
  ])("rejects unrelated, indirect, rewritten or malformed merge parents %j", (...parents) => {
    expect(() => verifyProductMerge(candidate, "a".repeat(40), parents, mainPr)).toThrow()
  })
  it.each([undefined, {}, { base: { ref: "dev", repo: { full_name: "bigduu/lotus-next" } } },
    { base: { ref: "main", repo: { full_name: "other/lotus-next" } } },
  ])("rejects missing or foreign main provenance even with the exact head parent: %j", (pr) => {
    expect(() => verifyProductMerge(candidate, "a".repeat(40), [workflowSha, sourceSha], pr)).toThrow()
  })
})

describe("candidate Bamboo source bindings", () => {
  const runtime = readFileSync("e2e/support/realBambooRuntime.ts", "utf8")
  const bambooSha = runtime.match(/export const REAL_BAMBOO_REVISION = "([0-9a-f]{40})";/)[1]
  const replaceBinding = (source, value) => source.replace(/BAMBOO_E2E_REVISION: [^\r\n]+/, `BAMBOO_E2E_REVISION: ${value}`)
  const historicalBindings = [...shardedWorkflow.matchAll(/^[ \t]*BAMBOO_E2E_REVISION: [^\r\n]+$/gm)]
  if (historicalBindings.length !== 1) throw new Error("Historical CI fixture must contain exactly one Bamboo binding")
  const files = {
    // Synthetic wiring input only: historical receipt checks use shardedWorkflow unchanged.
    ci: replaceBinding(shardedWorkflow, bambooSha),
    publication: legacyPublication,
    runtime,
    acceptanceTest: readFileSync("scripts/published-real-bamboo-acceptance.test.mjs", "utf8"),
  }
  const currentCandidate = { ...candidate, bambooSha }
  const dynamicBinding = "${{ needs.preflight.outputs.bamboo_sha }}"

  it("preserves the historical CI fixture while binding the synthetic input to the current runtime", () => {
    expect(shardedWorkflow).toContain("BAMBOO_E2E_REVISION: d6325a732c7669f94962f604e4ce98966e374d73")
    expect(files.ci).toContain(`BAMBOO_E2E_REVISION: ${bambooSha}`)
    expect(readFileSync("scripts/fixtures/ci-sharded-main-v1.yml", "utf8")).toBe(shardedWorkflow)
  })

  it("accepts the actual receipt-bound publication workflow with its paired source pins", () => {
    expect(() => verifyCandidateBackendPins(currentCandidate, files)).not.toThrow()
  })
  it("retains the historical publication graph with its Node verification dependency", () => {
    const publication = files.publication
      .replace("  real-bamboo:\n", "  verify:\n    name: Node verification\n    runs-on: ubuntu-latest\n    steps: []\n\n  real-bamboo:\n")
      .replace("    needs: [preflight]\n", "    needs: [preflight, verify]\n")
      .replace("      - preflight\n      - real-bamboo\n", "      - preflight\n      - verify\n      - real-bamboo\n")
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication })).not.toThrow()
  })
  it.each([
    ["an extra job", (source) => source.replace("  real-bamboo:\n", "  extra:\n    steps: []\n  real-bamboo:\n")],
    ["a missing real-Bamboo job", (source) => source.replace("  real-bamboo:\n", "  other-runtime:\n")],
    ["a missing pack/publish job", (source) => source.replace("  publish:\n", "  other-publish:\n")],
    ["a stale verification dependency", (source) => source.replace("    needs: [preflight]\n", "    needs: [preflight, verify]\n")],
    ["publication before Bamboo acceptance", (source) => source.replace("      - real-bamboo\n", "")],
    ["publication without source authority", (source) => source.replace("      - preflight\n", "")],
    ["duplicate publication dependency", (source) => source.replace("      - real-bamboo\n", "      - real-bamboo\n      - real-bamboo\n")],
    ["an unknown publication dependency", (source) => source.replace("      - real-bamboo\n", "      - real-bamboo\n      - other\n")],
  ])("rejects a publication graph with %s", (_name, alter) => {
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication: alter(files.publication) })).toThrow()
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
        write(path, path === ".github/workflows/ci.yml" ? files.ci : path === ".github/workflows/publish-npm.yml" ? files.publication : readFileSync(resolve(path)))
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
        jobs: { total_count: acceptanceJobNames(files.ci).length, jobs: acceptanceJobNames(files.ci).map((name) => ({ name, head_sha: sourceSha, status: "completed", conclusion: "success" })) },
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
      execFileSync(process.execPath, ["--input-type=module", "-e", `import { legacySource } from ${JSON.stringify(pathToFileURL(join(repo, "scripts/release-source.mjs")).href)}; await legacySource()`], {
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
    ["missing preflight dependency", (source) => source.replace("    needs: [preflight]", "    needs: verify")],
    ["another environment level", (source) => source.replace(`      BAMBOO_E2E_REVISION: ${dynamicBinding}`, `          BAMBOO_E2E_REVISION: ${dynamicBinding}`)],
    ["wrong source step", (source) => source.replace("        id: source", "        id: other")],
    ["duplicate source step ID", (source) => source.replace("        id: source", "        id: source\n        id: other")],
    ["commented source invocation", (source) => source.replace("        run: node scripts/release-source.mjs", "        # run: node scripts/release-source.mjs\n        run: echo bamboo_sha=main")],
    ["invocation in another step", (source) => source.replace("        run: node scripts/release-source.mjs", "      - name: Unrelated step\n        run: node scripts/release-source.mjs")],
  ])("rejects a dynamic binding wired to %s", (_name, alter) => {
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication: alter(files.publication) })).toThrow()
  })
  it.each([
    ["single-quoted duplicate", (source) => source.replace("    outputs:\n", "    outputs:\n      'bamboo_sha': main\n")],
    ["double-quoted duplicate", (source) => source.replace("    outputs:\n", '    outputs:\n      "bamboo_sha": main\n')],
    ["merged output", (source) => source.replace("    outputs:\n", "    outputs:\n      <<: { bamboo_sha: main }\n")],
    ["plain duplicate", (source) => source.replace("    outputs:\n", "    outputs:\n      bamboo_sha: main\n")],
    ["missing reviewed output", (source) => source.replace("      source_tree: ${{ steps.source.outputs.source_tree }}\n", "")],
    ["extra output", (source) => source.replace("    outputs:\n", "    outputs:\n      other: main\n")],
    ["nested output", (source) => source.replace("      source_tree: ${{ steps.source.outputs.source_tree }}", "      source_tree:\n        override: main")],
  ])("rejects preflight outputs with %s", (_name, alter) => {
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication: alter(files.publication) })).toThrow()
  })
  it.each(["preflight", "real-bamboo"].flatMap((job) => [
    [job, "single-quoted equivalent", `  '${job}': {}`],
    [job, "double-quoted equivalent", `  "${job}": {}`],
    [job, "merged equivalent", `  <<: { ${job}: {} }`],
    [job, "plain duplicate", `  ${job}: {}`],
  ]))("rejects %s job name with %s", (_job, _name, extra) => {
    const publication = files.publication.replace("jobs:\n", `jobs:\n${extra}\n`)
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication })).toThrow()
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
    ["preflight block", (source) => source.replace("  preflight:", "  preflight:\n    env:\n      NODE_OPTIONS: --require ./shim.cjs")],
    ["preflight flow", (source) => source.replace("  preflight:", "  preflight:\n    env: { NODE_OPTIONS: --require ./shim.cjs }")],
    ["preflight quoted", (source) => source.replace("  preflight:", "  preflight:\n    'env': { NODE_OPTIONS: --require ./shim.cjs }")],
    ["preflight merge", (source) => source.replace("  preflight:", "  preflight:\n    <<: { env: { NODE_OPTIONS: --require ./shim.cjs } }")],
    ["preflight duplicate", (source) => source.replace("  preflight:", "  preflight:\n    env: {}\n    env: { NODE_OPTIONS: --require ./shim.cjs }")],
    ["workflow extra entry", (source) => source.replace("env:\n", "env:\n  NODE_OPTIONS: --require ./shim.cjs\n")],
    ["workflow missing entry", (source) => source.replace('  NPM_CONFIG_AUDIT: "false"\n', "")],
    ["workflow quoted entry", (source) => source.replace("  NPM_CONFIG_AUDIT:", "  'NPM_CONFIG_AUDIT':")],
    ["workflow merged entry", (source) => source.replace("env:\n", "env:\n  <<: { NODE_OPTIONS: --require ./shim.cjs }\n")],
    ["workflow duplicate entry", (source) => source.replace('  NPM_CONFIG_AUDIT: "false"', '  NPM_CONFIG_AUDIT: "false"\n  NPM_CONFIG_AUDIT: "true"')],
    ["workflow nested entry", (source) => source.replace('  NPM_CONFIG_AUDIT: "false"', '  NPM_CONFIG_AUDIT:\n    NODE_OPTIONS: --require ./shim.cjs')],
    ["workflow flow", (source) => source.replace(/env:\n[\s\S]*?\n\njobs:/, "env: { NODE_OPTIONS: --require ./shim.cjs }\n\njobs:")],
    ["workflow quoted", (source) => source.replace(/^env:/m, "'env':")],
    ["workflow merge", (source) => `<<: { env: { NODE_OPTIONS: --require ./shim.cjs } }\n${source}`],
    ["workflow duplicate", (source) => `env: { NODE_OPTIONS: --require ./shim.cjs }\n${source}`],
  ])("rejects inherited source environments in %s", (_name, alter) => {
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication: alter(files.publication) })).toThrow()
  })
  it.each([
    "LOTUS_NEXT_RELEASE_VERSION", "LOTUS_NEXT_SOURCE_DIRTY", "LOTUS_NEXT_EXPECTED_SOURCE_DIRTY", "DEFAULT_BRANCH",
    "NPM_CONFIG_AUDIT", "NPM_CONFIG_FUND", "NPM_CONFIG_PROGRESS",
  ])("rejects altered workflow environment input %s", (key) => {
    const publication = files.publication.replace(new RegExp(`^  ${key}:.*$`, "m"), `  ${key}: --require ./shim.cjs`)
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication })).toThrow()
  })
  const alterRealBamboo = (alter) => {
    const start = files.publication.indexOf("  real-bamboo:\n")
    return files.publication.slice(0, start) + alter(files.publication.slice(start))
  }
  it.each([
    ["extra entry", (source) => source.replace("    env:\n", "    env:\n      NODE_OPTIONS: --import=data:text/javascript;base64,c2hpbQ==\n")],
    ["missing entry", (source) => source.replace("      LOTUS_NEXT_ACCEPTANCE_SOURCE_DIR: ${{ github.workspace }}\n", "")],
    ["quoted entry", (source) => source.replace("      LOTUS_NEXT_ACCEPTANCE_SOURCE_DIR:", "      'LOTUS_NEXT_ACCEPTANCE_SOURCE_DIR':")],
    ["merged entry", (source) => source.replace("    env:\n", "    env:\n      <<: { NODE_OPTIONS: --require ./shim.cjs }\n")],
    ["duplicate entry", (source) => source.replace("      LOTUS_NEXT_ACCEPTANCE_SOURCE_DIR:", "      LOTUS_NEXT_ACCEPTANCE_SOURCE_DIR: shim\n      LOTUS_NEXT_ACCEPTANCE_SOURCE_DIR:")],
    ["nested entry", (source) => source.replace("      LOTUS_NEXT_ACCEPTANCE_SOURCE_DIR: ${{ github.workspace }}", "      LOTUS_NEXT_ACCEPTANCE_SOURCE_DIR:\n        NODE_OPTIONS: --require ./shim.cjs")],
    ["flow mapping", (source) => source.replace(/    env:\n[\s\S]*?\n\n    steps:/, `    env: { BAMBOO_E2E_REVISION: ${dynamicBinding} }\n\n    steps:`)],
    ["quoted mapping", (source) => source.replace("    env:", "    'env':")],
    ["merged mapping", (source) => source.replace("    env:", "    <<: { env: { NODE_OPTIONS: --require ./shim.cjs } }\n    env:")],
    ["duplicate mapping", (source) => source.replace("    env:", "    env: { NODE_OPTIONS: --require ./shim.cjs }\n    env:")],
  ])("rejects real-Bamboo inherited environment with %s", (_name, alter) => {
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication: alterRealBamboo(alter) })).toThrow()
  })
  it.each([
    "LOTUS_NEXT_SOURCE_REVISION", "LOTUS_NEXT_EXPECTED_SOURCE_REVISION", "PUBLICATION_WORKFLOW_SHA",
    "ACCEPTED_SOURCE_TREE", "BAMBOO_E2E_REVISION", "LOTUS_NEXT_ACCEPTANCE_SOURCE_DIR",
  ])("rejects altered real-Bamboo environment input %s", (key) => {
    const publication = alterRealBamboo((source) => source.replace(new RegExp(`^      ${key}:.*$`, "m"), `      ${key}: main`))
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication })).toThrow()
  })
  const jobExecutionOverrides = [
    ["block container", "    container:\n      image: node:24\n      env:\n        NODE_OPTIONS: --require ./shim.cjs"],
    ["flow container", "    container: { image: 'node:24', env: { NODE_OPTIONS: --require ./shim.cjs } }"],
    ["quoted container", "    'container': { image: 'node:24', env: { NODE_OPTIONS: --require ./shim.cjs } }"],
    ["merged container", "    <<: { container: { image: 'node:24', env: { NODE_OPTIONS: --require ./shim.cjs } } }"],
    ["duplicate container", "    container: node:24\n    container: { image: 'node:24', env: { NODE_OPTIONS: --require ./shim.cjs } }"],
    ["run defaults", "    defaults: { run: { working-directory: shim } }"],
  ]
  it.each(["preflight", "real-bamboo"].flatMap((job) => jobExecutionOverrides.map(([name, extra]) => [job, name, extra])))("rejects %s job execution wrapper %s", (job, _name, extra) => {
    const publication = files.publication.replace(`  ${job}:\n`, `  ${job}:\n${extra}\n`)
    expect(() => verifyCandidateBackendPins(currentCandidate, { ...files, publication })).toThrow()
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
  const shardedEvidence = () => ({
    run: { id: candidate.acceptanceRunId, path: ".github/workflows/ci.yml", event: "workflow_dispatch", head_sha: sourceSha, status: "completed", conclusion: "success" },
    jobs: { total_count: 12, jobs: acceptanceJobNames(shardedWorkflow).map((name) => ({ name, head_sha: sourceSha, status: "completed", conclusion: "success" })) },
    pr: { number: candidate.productPullRequest, merged: true, head: { sha: sourceSha }, merge_commit_sha: candidate.productMergeSha },
  })
  it("binds all eight shards and the aggregate to the source workflow rather than the controller", () => {
    const { run, jobs, pr } = shardedEvidence()
    expect(() => verifyAcceptanceEvidence(candidate, run, jobs, pr, shardedWorkflow)).not.toThrow()
    expect(() => verifyAcceptanceEvidence(candidate, run, jobs, pr, legacyWorkflow)).toThrow()
    const legacyJobs = jobs.jobs.filter((job) => ["Node 22", "Node 24", "Real Bamboo / Node 22"].includes(job.name))
    expect(() => verifyAcceptanceEvidence(candidate, run, { total_count: 3, jobs: legacyJobs }, pr, shardedWorkflow)).toThrow()
    expect(() => verifyAcceptanceEvidence(candidate, run, { total_count: 3, jobs: legacyJobs }, pr, legacyWorkflow)).not.toThrow()
    const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, repository: "bigduu/lotus-next", run, jobs, pullRequest: pr }))
    const accepted = { ...candidate, acceptanceReceiptSha256: createHash("sha256").update(bytes).digest("hex") }
    expect(() => verifyCommittedAcceptance(accepted, bytes, shardedWorkflow)).not.toThrow()
    expect(() => verifyCommittedAcceptance(accepted, bytes, legacyWorkflow)).toThrow()
  })
  it.each(["missing", "duplicate", "failure", "cancelled", "skipped", "wrong SHA", "in progress"])("rejects %s for every required shard and aggregate", (mutation) => {
    for (const name of acceptanceJobNames(shardedWorkflow).filter((name) => name.startsWith("Browser"))) {
      const { run, jobs, pr } = shardedEvidence()
      const index = jobs.jobs.findIndex((job) => job.name === name)
      if (mutation === "missing") jobs.jobs.splice(index, 1)
      else if (mutation === "duplicate") jobs.jobs.push(clone(jobs.jobs[index]))
      else if (mutation === "wrong SHA") jobs.jobs[index].head_sha = workflowSha
      else if (mutation === "in progress") jobs.jobs[index].status = "in_progress"
      else jobs.jobs[index].conclusion = mutation
      jobs.total_count = jobs.jobs.length
      expect(() => verifyAcceptanceEvidence(candidate, run, jobs, pr, shardedWorkflow)).toThrow()
    }
  })
  it.each([
    (source) => source.replace("          - 4", "          - 5"),
    (source) => source.replace("          - 24", "          - 26"),
    (source) => source.replace("    needs: [verify, browser-summary]", "    needs: verify"),
    (source) => source.replace("    needs: [verify, browser]", "    needs: browser"),
    (source) => source.replace("    name: Browser acceptance\n    if: ${{ always() }}", "    name: Browser acceptance\n    if: ${{ success() }}"),
    (source) => source.replace("  browser-summary:", "  other-summary:"),
  ])("rejects an unknown or incomplete source workflow graph", (mutate) => {
    expect(() => acceptanceJobNames(mutate(shardedWorkflow))).toThrow()
  })
  it("verifies real reviewed historical acceptance bytes and rejects tampering", () => {
    const accepted = JSON.parse(readFileSync(".github/release-candidates.json", "utf8")).candidates["2026.10.8"]
    const bytes = readFileSync(".github/release-acceptance/2026.10.8.json")
    const actual = verifyLegacyCommittedAcceptance(accepted, bytes)
    expect(actual.run.head_sha).toBe(accepted.sourceSha)
    expect(actual.jobs.jobs.every((job) => job.conclusion === "success")).toBe(true)
    expect(() => verifyLegacyCommittedAcceptance(accepted, Buffer.concat([bytes, Buffer.from(" ")]))).toThrow()
    const altered = { ...actual, run: { ...actual.run, head_sha: workflowSha } }
    const alteredBytes = Buffer.from(JSON.stringify(altered))
    expect(() => verifyLegacyCommittedAcceptance({ ...accepted, acceptanceReceiptSha256: createHash("sha256").update(alteredBytes).digest("hex") }, alteredBytes)).toThrow()
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
    expect(() => verifyLegacyAcceptance(candidate, run, jobs, pr)).not.toThrow()
    expect(() => verifyLegacyAcceptance(candidate, { ...run, path: run.path + "@release/2026.10.8", head_branch: "release/2026.10.8" }, jobs, pr)).not.toThrow()
    expect(() => verifyLegacyAcceptance(candidate, { ...run, path: ".github/workflows/other.yml@main", head_branch: "main" }, jobs, pr)).toThrow()
    expect(() => verifyLegacyAcceptance(candidate, { ...run, path: run.path + "@wrong", head_branch: "release/2026.10.8" }, jobs, pr)).toThrow()
    for (const conclusion of ["skipped", "failure", "cancelled"]) {
      const skipped = clone(jobs)
      skipped.jobs[2].conclusion = conclusion
      expect(() => verifyLegacyAcceptance(candidate, run, skipped, pr)).toThrow()
    }
    expect(() => verifyLegacyAcceptance(candidate, { ...run, head_sha: workflowSha }, jobs, pr)).toThrow()
    expect(() => verifyLegacyAcceptance(candidate, run, { ...jobs, total_count: 4 }, pr)).toThrow()
    expect(() => verifyLegacyAcceptance(candidate, run, jobs, { ...pr, merged: false })).toThrow()
  })
  const mergedMainEvidence = () => ({
    accepted: { ...candidate, productMergeSha: sourceSha },
    run: { id: candidate.acceptanceRunId, path: ".github/workflows/ci.yml", event: "push", head_branch: "main", head_sha: sourceSha, status: "completed", conclusion: "success", repository: { full_name: "bigduu/lotus-next" }, head_repository: { full_name: "bigduu/lotus-next" } },
    jobs: { total_count: 3, jobs: ["Node 22", "Node 24", "Real Bamboo / Node 22"].map((name) => ({ name, head_sha: sourceSha, status: "completed", conclusion: name.startsWith("Real Bamboo") ? "skipped" : "success" })) },
    pr: { number: candidate.productPullRequest, merged: true, head: { sha: workflowSha }, base: { ref: "main", repo: { full_name: "bigduu/lotus-next" } }, merge_commit_sha: sourceSha },
  })
  it("accepts the normally merged fixed main snapshot without pretending the skipped runtime gate executed", () => {
    const { accepted, run, jobs, pr } = mergedMainEvidence()
    expect(pr.head.sha).not.toBe(accepted.sourceSha)
    expect(() => verifyLegacyAcceptance(accepted, run, jobs, pr)).not.toThrow()
    expect(jobs.jobs[2].conclusion).toBe("skipped")
    const bytes = Buffer.from(JSON.stringify({ schemaVersion: 1, repository: "bigduu/lotus-next", run, jobs, pullRequest: pr }))
    const recorded = { ...accepted, acceptanceReceiptSha256: createHash("sha256").update(bytes).digest("hex") }
    expect(verifyLegacyCommittedAcceptance(recorded, bytes).jobs.jobs[2].conclusion).toBe("skipped")
  })
  it.each(["failure", "cancelled", "skipped"])("rejects a %s Node gate for the merged main snapshot", (conclusion) => {
    const { accepted, run, jobs, pr } = mergedMainEvidence()
    for (const index of [0, 1]) {
      const changed = clone(jobs); changed.jobs[index].conclusion = conclusion
      expect(() => verifyLegacyAcceptance(accepted, run, changed, pr)).toThrow()
    }
  })
  it.each(["failure", "cancelled"])("retains the failed main runtime evidence: %s", (conclusion) => {
    const { accepted, run, jobs, pr } = mergedMainEvidence(); jobs.jobs[2].conclusion = conclusion
    expect(() => verifyLegacyAcceptance(accepted, run, jobs, pr)).toThrow()
  })
  it("rejects moving, foreign, incomplete, mismatched or unmerged main evidence", () => {
    const { accepted, run, jobs, pr } = mergedMainEvidence()
    for (const change of [{ head_branch: "feature" }, { head_sha: workflowSha }, { status: "in_progress" }, { conclusion: "failure" }, { repository: { full_name: "other/lotus-next" } }, { head_repository: { full_name: "other/lotus-next" } }]) {
      expect(() => verifyLegacyAcceptance(accepted, { ...run, ...change }, jobs, pr)).toThrow()
    }
    for (const change of [{ merged: false }, { merge_commit_sha: workflowSha }, { base: { ref: "dev", repo: { full_name: "bigduu/lotus-next" } } }, { base: { ref: "main", repo: { full_name: "other/lotus-next" } } }]) {
      expect(() => verifyLegacyAcceptance(accepted, run, jobs, { ...pr, ...change })).toThrow()
    }
    expect(() => verifyLegacyAcceptance(accepted, run, { ...jobs, total_count: 4 }, pr)).toThrow()
    expect(() => verifyLegacyAcceptance(accepted, run, { total_count: 2, jobs: jobs.jobs.slice(0, 2) }, pr)).toThrow()
    const duplicate = [...jobs.jobs, jobs.jobs[0]]
    expect(() => verifyLegacyAcceptance(accepted, run, { total_count: duplicate.length, jobs: duplicate }, pr)).toThrow()
    expect(() => verifyLegacyAcceptance(candidate, run, jobs, pr)).toThrow()
  })
  it("reuses successful reviewed PR-head admission without repeating its artifact runtime gate", () => {
    const { run, jobs, pr } = mergedMainEvidence()
    const headRun = { ...run, event: "pull_request", head_branch: "release/fixed-ui" }
    const headPr = { ...pr, head: { sha: sourceSha }, merge_commit_sha: candidate.productMergeSha }
    expect(() => verifyLegacyAcceptance(candidate, headRun, jobs, headPr)).not.toThrow()
    expect(() => verifyLegacyAcceptance(candidate, headRun, jobs, { ...headPr, head: { sha: workflowSha } })).toThrow()
    expect(() => verifyLegacyAcceptance(candidate, headRun, jobs, { ...headPr, merged: false })).toThrow()
    expect(() => verifyLegacyAcceptance(candidate, { ...headRun, head_repository: { full_name: "foreign/lotus-next" } }, jobs, headPr)).toThrow()
    expect(() => verifyLegacyAcceptance(candidate, headRun, jobs, { ...headPr, base: { ref: "dev", repo: { full_name: "bigduu/lotus-next" } } })).toThrow()
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


describe("minimal protected Dev controller", () => {
  it.each([["refs/heads/main", "false"], ["refs/heads/main", "true"], ["refs/heads/dev", "false"]])(
    "rejects controller ref/protection %s/%s before any API or source work", (ref, protectedRef) => {
      let error
      try { execFileSync(process.execPath, [resolve("scripts/release-source.mjs")], { encoding: "utf8", env: {
        PATH: "", GITHUB_REPOSITORY: "bigduu/lotus-next", GITHUB_REF: ref, GITHUB_REF_PROTECTED: protectedRef,
        GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_SHA: workflowSha, GITHUB_WORKFLOW_SHA: workflowSha,
        GITHUB_WORKFLOW_REF: `bigduu/lotus-next/.github/workflows/publish-npm.yml@${ref}`,
        EXPECTED_WORKFLOW_SHA: workflowSha, EXPECTED_SOURCE_SHA_INPUT: sourceSha, LOTUS_NEXT_RELEASE_VERSION: "2026.10.30",
      }, stdio: "pipe" }) } catch (value) { error = value }
      expect(error).toBeDefined(); expect(String(error.stderr)).toMatch(/Expected values|AssertionError/)
    },
  )
})
