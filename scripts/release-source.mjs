import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const sha = /^[0-9a-f]{40}$/
const versionPattern = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/
const workflowPath = ".github/workflows/publish-npm.yml"
const repository = "bigduu/lotus-next"
const exactKeys = (value, keys) => {
  assert.ok(value && typeof value === "object" && !Array.isArray(value))
  assert.deepEqual(Object.keys(value).sort(), [...keys].sort())
}

export const resolveReleaseRequest = (document, request) => {
  exactKeys(document, ["schemaVersion", "candidates"])
  assert.equal(document.schemaVersion, 1)
  assert.match(request.version, versionPattern)
  assert.notEqual(request.version, "0.0.0")
  assert.match(request.expectedSourceSha, sha)
  const candidate = document.candidates[request.version]
  assert.ok(candidate, "Publication requires a committed accepted candidate")
  exactKeys(candidate, ["sourceRef", "sourceSha", "sourceTree", "bambooSha", "tagObjectSha", "acceptanceRunId", "productPullRequest", "productMergeSha", "reviewEvidence", "acceptanceReceiptSha256"])
  assert.equal(candidate.sourceRef, `refs/tags/lotus-next-v${request.version}`)
  for (const field of ["sourceSha", "sourceTree", "bambooSha", "productMergeSha", "tagObjectSha"]) assert.match(candidate[field], sha)
  assert.match(candidate.acceptanceReceiptSha256, /^[0-9a-f]{64}$/)
  assert.ok(Number.isSafeInteger(candidate.acceptanceRunId) && candidate.acceptanceRunId > 0)
  assert.ok(Number.isSafeInteger(candidate.productPullRequest) && candidate.productPullRequest > 0)
  assert.ok(Array.isArray(candidate.reviewEvidence) && candidate.reviewEvidence.length > 0)
  for (const link of candidate.reviewEvidence) assert.match(link, /^https:\/\/github\.com\/bigduu\/lotus-next\/(pull|issues)\/\d+(#issuecomment-\d+)?$/)
  assert.equal(request.sourceRef, candidate.sourceRef, "Requested ref is not accepted")
  assert.equal(request.expectedSourceSha, candidate.sourceSha, "Requested SHA is not accepted")
  return candidate
}

export const verifyAcceptanceEvidence = (candidate, run, jobs, pullRequest) => {
  assert.equal(run.id, candidate.acceptanceRunId)
  const [path, ref, ...extra] = run.path.split("@")
  assert.equal(path, ".github/workflows/ci.yml")
  assert.equal(extra.length, 0)
  if (ref !== undefined) assert.equal(ref, run.head_branch, "Acceptance workflow ref suffix differs from its run")
  assert.equal(run.event, "workflow_dispatch")
  assert.equal(run.head_sha, candidate.sourceSha)
  assert.equal(run.status, "completed")
  assert.equal(run.conclusion, "success")
  assert.equal(jobs.total_count, jobs.jobs.length, "Acceptance jobs must not be truncated")
  for (const name of ["Node 22", "Node 24", "Real Bamboo / Node 22"]) {
    const matches = jobs.jobs.filter((job) => job.name === name)
    assert.equal(matches.length, 1, `Missing original acceptance job: ${name}`)
    assert.equal(matches[0].head_sha, candidate.sourceSha)
    assert.equal(matches[0].status, "completed")
    assert.equal(matches[0].conclusion, "success", `${name} was not accepted`)
  }
  assert.equal(pullRequest.number, candidate.productPullRequest)
  assert.equal(pullRequest.merged, true)
  assert.equal(pullRequest.head.sha, candidate.sourceSha)
  assert.equal(pullRequest.merge_commit_sha, candidate.productMergeSha)
}

export const verifySourceReceipt = (receipt, environment, actualSourceSha) => {
  assert.equal(receipt.schemaVersion, 1)
  assert.equal(receipt.repository, repository)
  for (const field of ["sourceSha", "sourceTree", "workflowSha", "tagObjectSha"]) assert.match(receipt[field], sha)
  assert.match(receipt.version, versionPattern)
  assert.equal(receipt.sourceRef, `refs/tags/lotus-next-v${receipt.version}`)
  assert.equal(receipt.workflowRef, `${repository}/${workflowPath}@refs/heads/${environment.DEFAULT_BRANCH}`)
  assert.equal(environment.GITHUB_REF, `refs/heads/${environment.DEFAULT_BRANCH}`)
  assert.equal(environment.GITHUB_REPOSITORY, repository)
  assert.equal(environment.GITHUB_WORKFLOW_REF, receipt.workflowRef)
  assert.equal(environment.GITHUB_SHA, receipt.workflowSha)
  assert.equal(environment.GITHUB_RUN_ID, receipt.runId)
  assert.equal(environment.GITHUB_RUN_ATTEMPT, receipt.runAttempt)
  assert.equal(environment.LOTUS_NEXT_EXPECTED_SOURCE_REVISION, receipt.sourceSha)
  assert.equal(environment.LOTUS_NEXT_RELEASE_VERSION, receipt.version)
  assert.equal(actualSourceSha, receipt.sourceSha)
  return receipt
}

export const verifyCommittedAcceptance = (candidate, bytes) => {
  assert.equal(createHash("sha256").update(bytes).digest("hex"), candidate.acceptanceReceiptSha256)
  const receipt = JSON.parse(bytes)
  assert.equal(receipt.schemaVersion, 1)
  assert.equal(receipt.repository, repository)
  verifyAcceptanceEvidence(candidate, receipt.run, receipt.jobs, receipt.pullRequest)
  return receipt
}

// Accept the reviewed workflow's explicit block form, failing closed if its
// authority wiring changes. This is deliberately not a general YAML parser.
const workflowBlock = (source, key, indentation) => {
  const lines = source.split(/\r?\n/)
  const header = `${" ".repeat(indentation)}${key}:`
  const starts = lines.flatMap((line, index) => line.trimEnd() === header ? [index] : [])
  assert.equal(starts.length, 1, `Candidate publication requires one ${key} block`)
  let end = starts[0] + 1
  while (end < lines.length) {
    const line = lines[end]
    if (line.trim() && !line.trimStart().startsWith("#") && line.search(/\S/) <= indentation) break
    end++
  }
  return lines.slice(starts[0] + 1, end).join("\n")
}

const workflowValue = (source, key, indentation) => {
  const assignments = [...source.matchAll(new RegExp(`^ {${indentation}}${key}:[ \\t]*(.*)$`, "gm"))]
  assert.equal(assignments.length, 1, `Candidate publication requires one ${key} assignment`)
  return assignments[0][1].trim()
}

const verifyWorkflowStepShape = (step, expectedKeys, blockKey, expectedInputs) => {
  const keys = []
  const inputs = []
  let currentKey
  for (const line of step.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue
    const declaration = /^( *)([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]+(.*))?$/.exec(line.trimEnd())
    assert.ok(declaration, "Candidate authority step requires plain block keys")
    const [, spaces, key, value] = declaration
    // Splitting the sequence removes the first key's six-space dash prefix.
    if (keys.length === 0 || spaces.length === 8) {
      assert.equal(spaces.length, keys.length === 0 ? 0 : 8)
      keys.push(key)
      currentKey = key
      if (key === blockKey) assert.equal(value, undefined, "Candidate authority step requires block inputs")
    } else {
      assert.equal(spaces.length, 10)
      assert.equal(currentKey, blockKey)
      inputs.push(key)
    }
  }
  // Reject overrides, merge/quoted keys, duplicates, and unreviewed inputs
  // instead of trying to evaluate YAML precedence rules.
  assert.deepEqual(keys.sort(), expectedKeys)
  assert.deepEqual(inputs.sort(), expectedInputs)
}

const workflowMappingKeys = (source, indentation, flat = false) => {
  const keys = new Set()
  for (const line of source.split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue
    if (line.search(/\S/) !== indentation) {
      assert.equal(flat, false, "Candidate environment requires flat mapping entries")
      continue
    }
    const declaration = /^ *([A-Za-z][A-Za-z0-9_-]*):(?:[ \t]+.*)?$/.exec(line.trimEnd())
    assert.ok(declaration, "Candidate execution scope requires plain mapping keys")
    const key = declaration[1]
    assert.ok(!keys.has(key), "Candidate execution scope requires unique mapping keys")
    keys.add(key)
  }
  return keys
}

const verifyWorkflowEnvironment = (source, indentation, expected) => {
  const environment = workflowBlock(source, "env", indentation)
  assert.deepEqual([...workflowMappingKeys(environment, indentation + 2, true)].sort(), Object.keys(expected).sort())
  for (const [key, value] of Object.entries(expected)) assert.equal(workflowValue(environment, key, indentation + 2), value)
}

const verifyDynamicBackendWiring = (publication) => {
  assert.ok(!workflowMappingKeys(publication, 0).has("defaults"), "Candidate source authority cannot inherit run defaults")
  verifyWorkflowEnvironment(publication, 0, {
    LOTUS_NEXT_RELEASE_VERSION: "${{ inputs.version }}",
    LOTUS_NEXT_SOURCE_DIRTY: '"false"',
    LOTUS_NEXT_EXPECTED_SOURCE_DIRTY: '"false"',
    DEFAULT_BRANCH: "${{ github.event.repository.default_branch }}",
    NPM_CONFIG_AUDIT: '"false"',
    NPM_CONFIG_FUND: '"false"',
    NPM_CONFIG_PROGRESS: '"false"',
  })
  const jobs = workflowBlock(publication, "jobs", 0)
  workflowMappingKeys(jobs, 2)
  const realBamboo = workflowBlock(jobs, "real-bamboo", 2)
  assert.deepEqual([...workflowMappingKeys(realBamboo, 4)].sort(), ["env", "name", "needs", "runs-on", "steps", "timeout-minutes"])
  assert.equal(workflowValue(realBamboo, "needs", 4), "[preflight, verify]")
  verifyWorkflowEnvironment(realBamboo, 4, {
    LOTUS_NEXT_SOURCE_REVISION: "${{ needs.preflight.outputs.source_sha }}",
    LOTUS_NEXT_EXPECTED_SOURCE_REVISION: "${{ needs.preflight.outputs.source_sha }}",
    PUBLICATION_WORKFLOW_SHA: "${{ needs.preflight.outputs.workflow_sha }}",
    ACCEPTED_SOURCE_TREE: "${{ needs.preflight.outputs.source_tree }}",
    BAMBOO_E2E_REVISION: "${{ needs.preflight.outputs.bamboo_sha }}",
    LOTUS_NEXT_ACCEPTANCE_SOURCE_DIR: "${{ github.workspace }}",
  })
  const checkoutSteps = workflowBlock(realBamboo, "steps", 4).split(/^ {6}-[ \t]/m)
    .filter((step) => /^ {10}path:[ \t]*\.e2e-bamboo[ \t]*$/m.test(step))
  assert.equal(checkoutSteps.length, 1, "Candidate publication requires one paired Bamboo checkout")
  verifyWorkflowStepShape(checkoutSteps[0], ["name", "uses", "with"], "with", ["path", "persist-credentials", "ref", "repository"])
  assert.equal(workflowValue(checkoutSteps[0], "uses", 8), "actions/checkout@v7")
  const checkout = workflowBlock(checkoutSteps[0], "with", 8)
  assert.equal(workflowValue(checkout, "repository", 10), "bigduu/Bamboo-agent")
  assert.equal(workflowValue(checkout, "ref", 10), "${{ env.BAMBOO_E2E_REVISION }}")
  assert.equal(workflowValue(checkout, "path", 10), ".e2e-bamboo")
  assert.equal(workflowValue(checkout, "persist-credentials", 10), "false")
  const preflight = workflowBlock(jobs, "preflight", 2)
  assert.deepEqual([...workflowMappingKeys(preflight, 4)].sort(), ["name", "outputs", "runs-on", "steps"])
  const outputs = workflowBlock(preflight, "outputs", 4)
  assert.deepEqual([...workflowMappingKeys(outputs, 6, true)].sort(), ["bamboo_sha", "source_ref", "source_sha", "source_tree", "tag_object_sha", "workflow_sha"])
  assert.equal(workflowValue(outputs, "bamboo_sha", 6), "${{ steps.source.outputs.bamboo_sha }}")
  const steps = workflowBlock(preflight, "steps", 4).split(/^ {6}-[ \t]/m)
  const sourceSteps = steps.filter((step) => /^ {8}id:[ \t]*source[ \t]*$/m.test(step))
  assert.equal(sourceSteps.length, 1, "Candidate preflight requires one source authority step")
  verifyWorkflowStepShape(sourceSteps[0], ["env", "id", "name", "run"], "env", ["EXPECTED_SOURCE_SHA_INPUT", "EXPECTED_WORKFLOW_SHA", "SOURCE_RECEIPT_PATH", "SOURCE_REF_INPUT"])
  assert.equal(workflowValue(sourceSteps[0], "id", 8), "source")
  assert.equal(workflowValue(sourceSteps[0], "run", 8), "node scripts/release-source.mjs")
  const sourceEnvironment = workflowBlock(sourceSteps[0], "env", 8)
  assert.equal(workflowValue(sourceEnvironment, "SOURCE_REF_INPUT", 10), "${{ inputs.source_ref }}")
  assert.equal(workflowValue(sourceEnvironment, "EXPECTED_SOURCE_SHA_INPUT", 10), "${{ inputs.expected_source_sha }}")
  assert.equal(workflowValue(sourceEnvironment, "EXPECTED_WORKFLOW_SHA", 10), "${{ github.workflow_sha }}")
  assert.equal(workflowValue(sourceEnvironment, "SOURCE_RECEIPT_PATH", 10), "${{ runner.temp }}/release-source-receipt.json")
}

export const verifyCandidateBackendPins = (candidate, files) => {
  const workflowPin = (source) => {
    const assignments = [...source.matchAll(/^[ \t]*BAMBOO_E2E_REVISION:[ \t]*(.*)$/gm)]
    assert.equal(assignments.length, 1, "Candidate workflow requires one backend source binding")
    return assignments[0][1].trim()
  }
  assert.equal(workflowPin(files.ci), candidate.bambooSha, "Candidate CI backend pin differs from acceptance")
  const publicationPin = workflowPin(files.publication)
  // Historical candidates pin the SHA directly; current publication obtains it
  // from the same accepted candidate through the run-bound preflight output.
  assert.ok(
    publicationPin === candidate.bambooSha || publicationPin === "${{ needs.preflight.outputs.bamboo_sha }}",
    "Candidate publication backend source differs from acceptance",
  )
  if (publicationPin !== candidate.bambooSha) verifyDynamicBackendWiring(files.publication)
  assert.ok(files.runtime.includes(`REAL_BAMBOO_REVISION = "${candidate.bambooSha}"`))
  assert.ok(files.acceptanceTest.includes(`"${candidate.bambooSha}"`))
}

const main = async () => {
  const environment = process.env
  assert.equal(environment.GITHUB_REPOSITORY, repository)
  assert.equal(environment.GITHUB_REF, `refs/heads/${environment.DEFAULT_BRANCH}`)
  assert.equal(environment.GITHUB_WORKFLOW_REF, `${repository}/${workflowPath}@${environment.GITHUB_REF}`)
  assert.match(environment.GITHUB_SHA, sha)
  assert.equal(environment.EXPECTED_WORKFLOW_SHA, environment.GITHUB_SHA)
  const git = (args) => execFileSync("git", args, { encoding: "utf8" }).trim()
  assert.equal(git(["rev-parse", "HEAD^{commit}"]), environment.GITHUB_SHA)
  assert.equal(git(["status", "--porcelain", "--untracked-files=all"]), "")
  const recordBytes = readFileSync(".github/release-candidates.json")
  const candidate = resolveReleaseRequest(JSON.parse(recordBytes), {
    version: environment.LOTUS_NEXT_RELEASE_VERSION,
    sourceRef: environment.SOURCE_REF_INPUT,
    expectedSourceSha: environment.EXPECTED_SOURCE_SHA_INPUT,
  })
  // This historical acceptance receipt is part of the reviewed main authority.
  // Every original publication gate still reruns against the fixed source below.
  verifyCommittedAcceptance(candidate, readFileSync(`.github/release-acceptance/${environment.LOTUS_NEXT_RELEASE_VERSION}.json`))
  git(["fetch", "--no-tags", "origin", candidate.sourceRef])
  assert.equal(git(["cat-file", "-t", "FETCH_HEAD"]), "tag", "An annotated release tag is required")
  const tagObjectSha = git(["rev-parse", "FETCH_HEAD"])
  assert.equal(tagObjectSha, candidate.tagObjectSha, "The accepted release tag object changed")
  assert.equal(git(["rev-parse", "FETCH_HEAD^{commit}"]), candidate.sourceSha)
  assert.equal(git(["rev-parse", `${candidate.sourceSha}^{tree}`]), candidate.sourceTree)
  git(["fetch", "--no-tags", "origin", candidate.productMergeSha])
  assert.equal(git(["rev-parse", `${candidate.productMergeSha}^{tree}`]), candidate.sourceTree)
  verifyCandidateBackendPins(candidate, {
    ci: git(["show", `${candidate.sourceSha}:.github/workflows/ci.yml`]),
    publication: git(["show", `${candidate.sourceSha}:.github/workflows/publish-npm.yml`]),
    runtime: git(["show", `${candidate.sourceSha}:e2e/support/realBambooRuntime.ts`]),
    acceptanceTest: git(["show", `${candidate.sourceSha}:scripts/published-real-bamboo-acceptance.test.mjs`]),
  })
  const receipt = {
    schemaVersion: 1, repository,
    version: environment.LOTUS_NEXT_RELEASE_VERSION,
    sourceRef: candidate.sourceRef, sourceSha: candidate.sourceSha, sourceTree: candidate.sourceTree,
    bambooSha: candidate.bambooSha, tagObjectSha,
    workflowRef: environment.GITHUB_WORKFLOW_REF, workflowSha: environment.GITHUB_SHA,
    runId: environment.GITHUB_RUN_ID, runAttempt: environment.GITHUB_RUN_ATTEMPT,
    candidateRecordSha256: createHash("sha256").update(recordBytes).digest("hex"),
    acceptanceRunId: candidate.acceptanceRunId, acceptanceReceiptSha256: candidate.acceptanceReceiptSha256, productPullRequest: candidate.productPullRequest,
    productMergeSha: candidate.productMergeSha, reviewEvidence: candidate.reviewEvidence,
  }
  writeFileSync(environment.SOURCE_RECEIPT_PATH, `${JSON.stringify(receipt, null, 2)}\n`, { flag: "wx" })
  appendFileSync(environment.GITHUB_OUTPUT, Object.entries({
    source_sha: candidate.sourceSha, source_tree: candidate.sourceTree,
    source_ref: candidate.sourceRef, bamboo_sha: candidate.bambooSha,
    workflow_sha: environment.GITHUB_SHA, tag_object_sha: tagObjectSha,
  }).map(([key, value]) => `${key}=${value}\n`).join(""))
  console.log(`Accepted source ${candidate.sourceRef} -> ${candidate.sourceSha}; workflow ${environment.GITHUB_SHA}`)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
