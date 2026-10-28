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

// Read the graph from the immutable accepted source, never from today's
// controller or from the (possibly incomplete) job names in a receipt.
export const acceptanceJobNames = (source) => {
  assert.equal(typeof source, "string", "Acceptance requires its source workflow")
  const graph = workflowBlock(source, "jobs", 0)
  const ids = [...graph.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)].map((match) => match[1]).sort()
  const sharded = ids.includes("browser")
  assert.deepEqual(ids, sharded ? ["browser", "browser-summary", "real-bamboo", "verify"] : ["real-bamboo", "verify"], "Unknown acceptance workflow graph")
  const verify = workflowBlock(graph, "verify", 2)
  assert.equal(workflowValue(verify, "name", 4), "Node ${{ matrix.node }}")
  const nodes = (block) => [...workflowBlock(workflowBlock(workflowBlock(block, "strategy", 4), "matrix", 6), "node", 8).matchAll(/^          - (\d+)$/gm)].map((match) => Number(match[1]))
  assert.deepEqual(nodes(verify), [22, 24])
  assert.equal(workflowValue(workflowBlock(graph, "real-bamboo", 2), "name", 4), "Real Bamboo / Node 22")
  const names = ["Node 22", "Node 24", "Real Bamboo / Node 22"]
  if (sharded) {
    const browser = workflowBlock(graph, "browser", 2)
    assert.equal(workflowValue(browser, "name", 4), "Browser / Node ${{ matrix.node }} / shard ${{ matrix.shard }} of 4")
    assert.deepEqual(nodes(browser), [22, 24])
    const matrix = workflowBlock(workflowBlock(browser, "strategy", 4), "matrix", 6)
    assert.deepEqual([...workflowBlock(matrix, "shard", 8).matchAll(/^          - (\d+)$/gm)].map((match) => Number(match[1])), [1, 2, 3, 4])
    const summary = workflowBlock(graph, "browser-summary", 2)
    assert.equal(workflowValue(summary, "name", 4), "Browser acceptance")
    assert.equal(workflowValue(summary, "if", 4), "${{ always() }}")
    assert.equal(workflowValue(summary, "needs", 4), "[verify, browser]")
    assert.equal(workflowValue(workflowBlock(graph, "real-bamboo", 2), "needs", 4), "[verify, browser-summary]")
    for (const node of [22, 24]) for (const shard of [1, 2, 3, 4]) names.push(`Browser / Node ${node} / shard ${shard} of 4`)
    names.push("Browser acceptance")
  }
  return names
}

// This graph belongs to the new Dev feature contract. Keep the historical
// parser above separate so adding this read-only proof cannot authorize an old
// publisher to consume a new-contract receipt.
export const devFeatureJobNames = (source) => {
  assert.equal(typeof source, "string", "Feature acceptance requires its source workflow")
  const graph = workflowBlock(source, "jobs", 0)
  const ids = [...graph.matchAll(/^  ([a-z][a-z0-9-]*):\s*$/gm)].map((match) => match[1]).sort()
  assert.deepEqual(ids, ["browser", "browser-summary", "feature-acceptance", "native-actor", "real-bamboo", "source", "verify"])
  assert.match(source, /pull_request:\n    branches: \[dev\]/)
  const matrixValues = (job, key) => [...workflowBlock(workflowBlock(workflowBlock(job, "strategy", 4), "matrix", 6), key, 8)
    .matchAll(/^          - (\d+)$/gm)].map((match) => Number(match[1]))
  const verify = workflowBlock(graph, "verify", 2), browser = workflowBlock(graph, "browser", 2)
  assert.equal(workflowValue(verify, "name", 4), "Node ${{ matrix.node }}")
  assert.deepEqual(matrixValues(verify, "node"), [22, 24])
  assert.equal(workflowValue(browser, "name", 4), "Browser / Node ${{ matrix.node }} / shard ${{ matrix.shard }} of 4")
  assert.deepEqual(matrixValues(browser, "node"), [24])
  assert.deepEqual(matrixValues(browser, "shard"), [1, 2, 3, 4])
  assert.equal(workflowValue(workflowBlock(graph, "real-bamboo", 2), "name", 4), "Real Bamboo / Node 24")
  return ["Feature Source", "Node 22", "Node 24", ...[1, 2, 3, 4].map(n => `Browser / Node 24 / shard ${n} of 4`),
    "Browser acceptance", "Real Bamboo / Node 24", "Native Actor acceptance / Native Actor / Node 24", "Feature acceptance"]
}

// Only inspect evidence supplied by a later release controller; this function
// has no network, versioning, build, packing or publication side effects.
export const verifyDevAcceptance = (sourceSha, pr, run, jobs, receipt, merged, tested, workflowId, sourceWorkflow) => {
  assert.match(sourceSha, sha)
  assert.equal(pr.state, "closed"); assert.equal(pr.merged, true)
  assert.equal(pr.base?.ref, "dev"); assert.equal(pr.base.repo.full_name, repository)
  assert.equal(pr.head?.repo?.full_name, repository); assert.equal(pr.merge_commit_sha, sourceSha)
  assert.equal(run.event, "pull_request"); assert.equal(run.workflow_id, workflowId)
  assert.equal(run.path.split("@")[0], ".github/workflows/ci.yml")
  assert.equal(run.repository?.full_name, repository); assert.equal(run.head_repository?.full_name, repository)
  assert.equal(run.head_sha, pr.head.sha); assert.equal(run.status, "completed"); assert.equal(run.conclusion, "success")
  assert.match(pr.head.sha, sha)
  for (const value of [pr.number, run.id, run.run_attempt]) assert.ok(Number.isSafeInteger(value) && value > 0)
  const names = devFeatureJobNames(sourceWorkflow)
  assert.equal(jobs.total_count, jobs.jobs.length)
  assert.deepEqual(jobs.jobs.map(job => job.name).sort(), names.sort())
  for (const job of jobs.jobs) {
    assert.equal(job.head_sha, pr.head.sha); assert.equal(job.status, "completed"); assert.equal(job.conclusion, "success")
    assert.ok(Date.parse(job.completed_at) <= Date.parse(pr.merged_at), "Feature evidence must predate Dev admission")
  }
  for (const [job, step] of [["Node 22", "Verify Node 22 Unit compatibility"], ["Node 24", "Verify architecture, build, and package contents"],
    ...[1, 2, 3, 4].map(n => [`Browser / Node 24 / shard ${n} of 4`, "Verify the all-surface browser shard"]),
    ["Real Bamboo / Node 24", "Verify a real chat round trip with the pinned published Bamboo"],
    ["Real Bamboo / Node 24", "Verify the current source artifact on local and secure browser surfaces"],
    ["Native Actor acceptance / Native Actor / Node 24", "Verify three negative controls and restored real Actor proof"]]) {
    const found = jobs.jobs.find(item => item.name === job).steps.filter(item => item.name === step)
    assert.equal(found.length, 1); assert.equal(found[0].status, "completed"); assert.equal(found[0].conclusion, "success")
  }
  assert.equal(receipt.schemaVersion, 1); assert.equal(receipt.kind, "lotus-feature-acceptance/v1")
  assert.deepEqual(receipt.gates, { source: "success", verify: "success", browser: "success", realBamboo: "success", nativeActor: "success" })
  const source = receipt.source
  assert.equal(source.repository, repository); assert.equal(source.pullRequest, pr.number); assert.equal(source.baseRef, "dev")
  assert.equal(source.headSha, pr.head.sha); assert.equal(source.runId, String(run.id))
  for (const value of [source.baseSha, source.headSha, source.testedSnapshot, source.testedTree]) assert.match(value, sha)
  for (const value of [source.sourceRunAttempt, receipt.acceptanceRunAttempt]) assert.ok(Number.isSafeInteger(value) && value > 0)
  assert.ok(source.sourceRunAttempt > 0 && source.sourceRunAttempt <= receipt.acceptanceRunAttempt && receipt.acceptanceRunAttempt <= run.run_attempt)
  assert.equal(merged.sha, sourceSha); assert.equal(tested.sha, source.testedSnapshot)
  assert.deepEqual(merged.parents.map(item => item.sha), [source.baseSha, source.headSha])
  assert.deepEqual(tested.parents.map(item => item.sha), [source.baseSha, source.headSha])
  assert.equal(merged.tree.sha, source.testedTree); assert.equal(tested.tree.sha, source.testedTree)
  return { sourceTree: source.testedTree, testedSnapshot: source.testedSnapshot, featureRunAttempt: receipt.acceptanceRunAttempt }
}

const acceptanceWorkflow = (candidate) => execFileSync("git", ["show", `${candidate.sourceSha}:.github/workflows/ci.yml`], { encoding: "utf8" })

export const verifyAcceptanceEvidence = (candidate, run, jobs, pullRequest, sourceWorkflow = acceptanceWorkflow(candidate)) => {
  assert.equal(run.id, candidate.acceptanceRunId)
  const [path, ref, ...extra] = run.path.split("@")
  assert.equal(path, ".github/workflows/ci.yml")
  assert.equal(extra.length, 0)
  if (ref !== undefined) assert.equal(ref, run.head_branch, "Acceptance workflow ref suffix differs from its run")
  const mergedMainSource = candidate.sourceSha === candidate.productMergeSha
  const mainAdmission = mergedMainSource && run.event === "push"
  const pullRequestAdmission = run.event === "pull_request"
  const sourceAdmission = mainAdmission || pullRequestAdmission
  if (sourceAdmission) {
    if (mainAdmission) assert.equal(run.head_branch, "main", "Main admission must run on main")
    assert.equal(run.repository?.full_name, repository, "Main admission must belong to this repository")
    assert.equal(run.head_repository?.full_name, repository, "Main admission source must belong to this repository")
  } else {
    assert.equal(run.event, "workflow_dispatch")
  }
  assert.equal(run.head_sha, candidate.sourceSha)
  assert.equal(run.status, "completed")
  assert.equal(run.conclusion, "success")
  assert.equal(jobs.total_count, jobs.jobs.length, "Acceptance jobs must not be truncated")
  const graphJobs = acceptanceJobNames(sourceWorkflow)
  assert.deepEqual(jobs.jobs.map((job) => job.name).sort(), [...graphJobs].sort(), "Acceptance must contain exactly its source workflow's complete job set")
  const requiredJobs = graphJobs.filter((name) => !sourceAdmission || name !== "Real Bamboo / Node 22")
  for (const name of requiredJobs) {
    const matches = jobs.jobs.filter((job) => job.name === name)
    assert.equal(matches.length, 1, `Missing original acceptance job: ${name}`)
    assert.equal(matches[0].head_sha, candidate.sourceSha)
    assert.equal(matches[0].status, "completed")
    assert.equal(matches[0].conclusion, "success", `${name} was not accepted`)
  }
  if (sourceAdmission) {
    const runtime = jobs.jobs.filter((job) => job.name === "Real Bamboo / Node 22")
    assert.equal(runtime.length, 1, "Main admission must retain the runtime job's actual result")
    assert.equal(runtime[0].head_sha, candidate.sourceSha)
    assert.equal(runtime[0].status, "completed")
    assert.ok(["success", "skipped"].includes(runtime[0].conclusion), "Failed runtime evidence cannot authorize publication")
    // A policy skip is source admission only. The publication workflow still
    // requires its own exact-version Real Bamboo artifact gate before npm upload.
  }
  assert.equal(pullRequest.number, candidate.productPullRequest)
  assert.equal(pullRequest.merged, true)
  assert.equal(pullRequest.merge_commit_sha, candidate.productMergeSha)
  if (mergedMainSource || pullRequestAdmission) {
    assert.equal(pullRequest.base?.ref, "main", "Merged source must have entered main")
    assert.equal(pullRequest.base?.repo?.full_name, repository, "Merged source must belong to this repository")
  }
  if (!mergedMainSource) assert.equal(pullRequest.head.sha, candidate.sourceSha)
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

export const verifyCommittedAcceptance = (candidate, bytes, sourceWorkflow = acceptanceWorkflow(candidate)) => {
  assert.equal(createHash("sha256").update(bytes).digest("hex"), candidate.acceptanceReceiptSha256)
  const receipt = JSON.parse(bytes)
  assert.equal(receipt.schemaVersion, 1)
  assert.equal(receipt.repository, repository)
  verifyAcceptanceEvidence(candidate, receipt.run, receipt.jobs, receipt.pullRequest, sourceWorkflow)
  return receipt
}

export const verifyProductMerge = (candidate, mergeTree, parents, pullRequest) => {
  assert.match(mergeTree, sha)
  if (mergeTree === candidate.sourceTree) return
  // A reviewed PR head can remain frozen while main advances independently.
  // The canonical PR receipt above binds the actual main merge; Git must also
  // prove that it directly merged this exact head, not just an older ancestor.
  assert.equal(pullRequest?.base?.ref, "main", "A different merge tree requires a main PR")
  assert.equal(pullRequest?.base?.repo?.full_name, repository, "A different merge tree requires this repository's main")
  assert.equal(parents.length, 2, "A different merge tree requires a normal two-parent merge")
  for (const parent of parents) assert.match(parent, sha)
  assert.equal(parents[1], candidate.sourceSha, "The main merge did not directly include the reviewed source head")
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
  const jobNames = [...workflowMappingKeys(jobs, 2)].sort()
  const historicalVerification = jobNames.includes("verify")
  assert.deepEqual(jobNames, historicalVerification
    ? ["preflight", "publish", "real-bamboo", "verify"]
    : ["preflight", "publish", "real-bamboo"], "Candidate publication requires its complete reviewed job graph")
  const realBamboo = workflowBlock(jobs, "real-bamboo", 2)
  assert.deepEqual([...workflowMappingKeys(realBamboo, 4)].sort(), ["env", "name", "needs", "runs-on", "steps", "timeout-minutes"])
  assert.equal(workflowValue(realBamboo, "needs", 4), historicalVerification ? "[preflight, verify]" : "[preflight]")
  const publishNeeds = workflowBlock(workflowBlock(jobs, "publish", 2), "needs", 4)
    .split(/\r?\n/).map((line) => line.trim()).filter((line) => line && !line.startsWith("#"))
  assert.deepEqual(publishNeeds, historicalVerification
    ? ["- preflight", "- verify", "- real-bamboo"]
    : ["- preflight", "- real-bamboo"], "Publication must wait for its exact-source authority and real Bamboo acceptance")
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

export const legacySource = async () => {
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
  // Node/unit/browser source tests are reused; publication still builds and
  // checks the exact versioned artifact against the paired real Bamboo runtime.
  git(["fetch", "--no-tags", "origin", candidate.sourceRef])
  assert.equal(git(["cat-file", "-t", "FETCH_HEAD"]), "tag", "An annotated release tag is required")
  const tagObjectSha = git(["rev-parse", "FETCH_HEAD"])
  assert.equal(tagObjectSha, candidate.tagObjectSha, "The accepted release tag object changed")
  assert.equal(git(["rev-parse", "FETCH_HEAD^{commit}"]), candidate.sourceSha)
  assert.equal(git(["rev-parse", `${candidate.sourceSha}^{tree}`]), candidate.sourceTree)
  git(["fetch", "--no-tags", "origin", candidate.productMergeSha])
  const sourceWorkflow = git(["show", `${candidate.sourceSha}:.github/workflows/ci.yml`])
  const acceptance = verifyCommittedAcceptance(candidate, readFileSync(`.github/release-acceptance/${environment.LOTUS_NEXT_RELEASE_VERSION}.json`), sourceWorkflow)
  verifyProductMerge(candidate,
    git(["rev-parse", `${candidate.productMergeSha}^{tree}`]),
    git(["show", "-s", "--format=%P", candidate.productMergeSha]).split(" "), acceptance.pullRequest)
  verifyCandidateBackendPins(candidate, {
    ci: sourceWorkflow,
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


const main = async () => {
  const env = process.env, sourceSha = env.EXPECTED_SOURCE_SHA_INPUT, version = env.LOTUS_NEXT_RELEASE_VERSION
  assert.equal(env.GITHUB_REPOSITORY, repository); assert.equal(env.GITHUB_REF_PROTECTED, "true")
  assert.equal(env.GITHUB_REF, "refs/heads/dev"); assert.equal(env.GITHUB_EVENT_NAME, "workflow_dispatch")
  assert.equal(env.GITHUB_WORKFLOW_REF, `${repository}/${workflowPath}@refs/heads/dev`)
  assert.equal(env.GITHUB_WORKFLOW_SHA, env.GITHUB_SHA)
  assert.equal(env.EXPECTED_WORKFLOW_SHA, env.GITHUB_SHA); assert.match(env.GITHUB_SHA, sha); assert.match(sourceSha, sha)
  assert.match(version, versionPattern); assert.notEqual(version, "0.0.0")
  assert.equal(env.SOURCE_REF_INPUT, `refs/tags/lotus-next-v${version}`)
  const git = (...args) => execFileSync("git", ["--no-replace-objects", ...args], { encoding: "utf8" }).trim()
  const api = route => JSON.parse(execFileSync("gh", ["api", `repos/${repository}/${route}`], { encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }))
  const id = value => { assert.match(value ?? "", /^[1-9][0-9]*$/); assert.ok(Number.isSafeInteger(Number(value))); return Number(value) }
  const prId = id(env.FEATURE_PR_INPUT), runId = id(env.FEATURE_RUN_INPUT)
  assert.equal(git("rev-parse", "HEAD"), env.GITHUB_SHA); assert.equal(git("status", "--porcelain", "--untracked-files=all"), "")
  // A replacement dispatch cannot rebuild a previously attempted version.
  // Failed publication resumes in the original run using its retained tarball.
  const ownRun = api(`actions/runs/${id(env.GITHUB_RUN_ID)}`)
  for (let page = 1; ; page++) {
    const history = api(`actions/workflows/publish-npm.yml/runs?event=workflow_dispatch&per_page=100&page=${page}`)
    assert.ok(page <= 100 && Array.isArray(history.workflow_runs))
    for (const prior of history.workflow_runs) if (prior.id !== ownRun.id &&
      Date.parse(prior.created_at) <= Date.parse(ownRun.created_at) && prior.display_title === `Publish @bigduu/lotus-next@${version}`) {
      throw new Error(`Reuse original publication run ${prior.id}; do not dispatch/build this version again`)
    }
    if (page * 100 >= history.total_count) break
    assert.equal(history.workflow_runs.length, 100, "Incomplete publication history")
  }
  const pr = api(`pulls/${prId}`), run = api(`actions/runs/${runId}`), jobs = api(`actions/runs/${runId}/jobs?filter=latest&per_page=100`)
  assert.equal(pr.number, prId); assert.equal(run.id, runId)
  const artifacts = api(`actions/runs/${runId}/artifacts?per_page=100`)
  assert.equal(artifacts.total_count, artifacts.artifacts.length)
  const matches = artifacts.artifacts.filter(item => item.name === "feature-acceptance" && !item.expired)
  assert.equal(matches.length, 1); const artifact = matches[0]
  assert.equal(artifact.workflow_run.id, runId); assert.equal(artifact.workflow_run.head_sha, pr.head.sha)
  assert.ok(Date.parse(artifact.created_at) <= Date.parse(pr.merged_at))
  const zip = execFileSync("gh", ["api", `repos/${repository}/actions/artifacts/${artifact.id}/zip`], { maxBuffer: 128 * 1024 })
  assert.equal(zip.length, artifact.size_in_bytes)
  assert.equal("sha256:" + createHash("sha256").update(zip).digest("hex"), artifact.digest)
  const receipt = JSON.parse(execFileSync("python3", ["-c", "import io,sys,zipfile; z=zipfile.ZipFile(io.BytesIO(sys.stdin.buffer.read())); assert z.namelist()==['feature-acceptance.json']; i=z.infolist()[0]; assert i.file_size<=65536 and not i.is_dir(); sys.stdout.buffer.write(z.read(i))"], { input: zip, maxBuffer: 65536 }).toString())
  git("fetch", "--no-tags", "origin", env.SOURCE_REF_INPUT)
  assert.equal(git("cat-file", "-t", "FETCH_HEAD"), "tag")
  const tagObjectSha = git("rev-parse", "FETCH_HEAD")
  assert.equal(git("rev-parse", "FETCH_HEAD^{commit}"), sourceSha)
  const sourceWorkflow = git("show", `${sourceSha}:.github/workflows/ci.yml`)
  const product = JSON.parse(git("show", `${sourceSha}:package.json`))
  assert.equal(product.name, "@bigduu/lotus-next"); assert.equal(product.version, "0.0.0")
  const facts = verifyDevAcceptance(sourceSha, pr, run, jobs, receipt, api(`git/commits/${sourceSha}`),
    api(`git/commits/${receipt.source.testedSnapshot}`), api("actions/workflows/ci.yml").id, sourceWorkflow)
  const current = api("branches/dev"); assert.equal(current.protected, true)
  const controller = api(`compare/${env.GITHUB_SHA}...${current.commit.sha}`)
  assert.equal(controller.merge_base_commit.sha, env.GITHUB_SHA); assert.ok(["identical", "ahead"].includes(controller.status))
  const ancestry = api(`compare/${sourceSha}...${current.commit.sha}`)
  assert.equal(ancestry.merge_base_commit.sha, sourceSha); assert.ok(["identical", "ahead"].includes(ancestry.status))
  assert.equal(api(`git/ref/heads/release/${sourceSha}`).object.sha, sourceSha, "Frozen release source moved")
  assert.equal(api(`pulls/${prId}`).merge_commit_sha, sourceSha)
  const bambooSha = sourceWorkflow.match(/^\s*BAMBOO_E2E_REVISION: ([0-9a-f]{40})$/m)?.[1]; assert.match(bambooSha ?? "", sha)
  const result = { schemaVersion: 1, repository, version, sourceRef: env.SOURCE_REF_INPUT, sourceSha, sourceTree: facts.sourceTree,
    bambooSha, tagObjectSha, workflowRef: env.GITHUB_WORKFLOW_REF, workflowSha: env.GITHUB_SHA, runId: env.GITHUB_RUN_ID,
    runAttempt: env.GITHUB_RUN_ATTEMPT, featurePr: prId, featureRun: runId, ...facts }
  writeFileSync(env.SOURCE_RECEIPT_PATH, JSON.stringify(result, null, 2) + "\n", { flag: "wx" })
  appendFileSync(env.GITHUB_OUTPUT, Object.entries({ source_sha: sourceSha, source_tree: facts.sourceTree, source_ref: result.sourceRef,
    bamboo_sha: bambooSha, workflow_sha: env.GITHUB_SHA, tag_object_sha: tagObjectSha }).map(([key, value]) => `${key}=${value}\n`).join(""))
}


if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error.message)
    process.exitCode = 1
  })
}
