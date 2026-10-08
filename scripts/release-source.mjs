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
  exactKeys(candidate, ["sourceRef", "sourceSha", "sourceTree", "bambooSha", "tagObjectSha", "acceptanceRunId", "productPullRequest", "productMergeSha", "reviewEvidence"])
  assert.equal(candidate.sourceRef, `refs/tags/lotus-next-v${request.version}`)
  for (const field of ["sourceSha", "sourceTree", "bambooSha", "productMergeSha", "tagObjectSha"]) assert.match(candidate[field], sha)
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
  assert.equal(run.path, ".github/workflows/ci.yml")
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

export const readPublicEvidence = async (endpoint, fetchEvidence = fetch) => {
  const response = await fetchEvidence(`https://api.github.com/repos/${repository}/${endpoint}`, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "lotus-next-release-source" },
    signal: AbortSignal.timeout(30_000),
    redirect: "error",
  })
  assert.equal(response.status, 200, "Public acceptance evidence could not be read")
  return response.json()
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
  const [run, jobs, pullRequest] = await Promise.all([
    readPublicEvidence(`actions/runs/${candidate.acceptanceRunId}`),
    readPublicEvidence(`actions/runs/${candidate.acceptanceRunId}/jobs?per_page=100`),
    readPublicEvidence(`pulls/${candidate.productPullRequest}`),
  ])
  verifyAcceptanceEvidence(candidate, run, jobs, pullRequest)
  git(["fetch", "--no-tags", "origin", candidate.sourceRef])
  assert.equal(git(["cat-file", "-t", "FETCH_HEAD"]), "tag", "An annotated release tag is required")
  const tagObjectSha = git(["rev-parse", "FETCH_HEAD"])
  assert.equal(tagObjectSha, candidate.tagObjectSha, "The accepted release tag object changed")
  assert.equal(git(["rev-parse", "FETCH_HEAD^{commit}"]), candidate.sourceSha)
  assert.equal(git(["rev-parse", `${candidate.sourceSha}^{tree}`]), candidate.sourceTree)
  git(["fetch", "--no-tags", "origin", candidate.productMergeSha])
  assert.equal(git(["rev-parse", `${candidate.productMergeSha}^{tree}`]), candidate.sourceTree)
  for (const file of [".github/workflows/ci.yml", ".github/workflows/publish-npm.yml"]) {
    assert.ok(git(["show", `${candidate.sourceSha}:${file}`]).includes(`BAMBOO_E2E_REVISION: ${candidate.bambooSha}`), "Candidate workflow backend pin differs from acceptance")
  }
  assert.ok(git(["show", `${candidate.sourceSha}:e2e/support/realBambooRuntime.ts`]).includes(`REAL_BAMBOO_REVISION = "${candidate.bambooSha}"`))
  assert.ok(git(["show", `${candidate.sourceSha}:scripts/published-real-bamboo-acceptance.test.mjs`]).includes(`"${candidate.bambooSha}"`))
  const receipt = {
    schemaVersion: 1, repository,
    version: environment.LOTUS_NEXT_RELEASE_VERSION,
    sourceRef: candidate.sourceRef, sourceSha: candidate.sourceSha, sourceTree: candidate.sourceTree,
    bambooSha: candidate.bambooSha, tagObjectSha,
    workflowRef: environment.GITHUB_WORKFLOW_REF, workflowSha: environment.GITHUB_SHA,
    runId: environment.GITHUB_RUN_ID, runAttempt: environment.GITHUB_RUN_ATTEMPT,
    candidateRecordSha256: createHash("sha256").update(recordBytes).digest("hex"),
    acceptanceRunId: candidate.acceptanceRunId, productPullRequest: candidate.productPullRequest,
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
