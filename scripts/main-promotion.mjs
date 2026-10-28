import assert from "node:assert/strict"
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, readFileSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { extractSafeTar } from "./verify-published-npm.mjs"
import { assertPackageVersion, verifyArtifactManifest } from "./artifact-manifest.mjs"

const repository = "bigduu/lotus-next", packageName = "@bigduu/lotus-next"
const publisher = ".github/workflows/publish-npm.yml", workflow = ".github/workflows/main-promotion.yml"
const registry = "https://registry.npmjs.org", slsa = "https://slsa.dev/provenance/v1", sha = /^[0-9a-f]{40}$/
const hash = (bytes, algorithm, encoding = "hex") => createHash(algorithm).update(bytes).digest(encoding)
const positive = value => { assert.ok(Number.isSafeInteger(Number(value)) && Number(value) > 0); return Number(value) }
const ancestor = (proof, source) => {
  assert.equal(proof.base_commit.sha, source); assert.equal(proof.merge_base_commit.sha, source)
  assert.ok(["ahead", "identical"].includes(proof.status), "Source left protected Dev history")
}

export function verifyPromotionSource(event, env, pr, main, dev, merge) {
  assert.equal(env.GITHUB_EVENT_NAME, "pull_request_target"); assert.equal(env.GITHUB_REPOSITORY, repository)
  assert.equal(env.GITHUB_REF, "refs/heads/main")
  assert.equal(env.GITHUB_WORKFLOW_REF, `${repository}/${workflow}@refs/heads/main`)
  assert.equal(env.GITHUB_WORKFLOW_SHA, env.GITHUB_SHA)
  const expected = event.pull_request
  for (const value of [expected.base, expected.head, pr.base, pr.head]) assert.equal(value.repo.full_name, repository)
  assert.equal(pr.number, positive(event.number)); assert.equal(pr.state, "open"); assert.equal(pr.merged, false); assert.equal(pr.draft, false)
  assert.equal(pr.base.ref, "main"); assert.equal(expected.base.ref, "main")
  assert.match(pr.head.sha, sha); assert.match(pr.base.sha, sha); assert.match(pr.merge_commit_sha, sha)
  assert.equal(pr.head.ref, `release/${pr.head.sha}`); assert.equal(expected.head.ref, pr.head.ref)
  assert.equal(expected.head.sha, pr.head.sha); assert.equal(expected.base.sha, pr.base.sha)
  assert.equal(env.GITHUB_SHA, pr.base.sha); assert.equal(main.name, "main"); assert.equal(main.protected, true)
  assert.equal(main.commit.sha, pr.base.sha, "Main advanced; refresh the actual merge")
  assert.equal(dev.name, "dev"); assert.equal(dev.protected, true)
  assert.equal(merge.sha, pr.merge_commit_sha); assert.deepEqual(merge.parents, [pr.base.sha, pr.head.sha])
  assert.equal(merge.tree, merge.sourceTree, "Main promotion must preserve the published source tree")
  return pr.head.sha
}

export function releaseTag(remote, source) {
  const refs = new Map()
  for (const line of remote.trim().split("\n")) {
    const match = /^([0-9a-f]{40})\t(refs\/tags\/lotus-next-v[^\s]+)$/.exec(line)
    assert.ok(match, "Malformed version tag listing"); assert.ok(!refs.has(match[2]), "Duplicate version ref")
    refs.set(match[2], match[1])
  }
  const matches = [...refs].filter(([ref, target]) => ref.endsWith("^{}") && target === source).map(([peeled]) => {
    const ref = peeled.slice(0, -3), version = ref.slice("refs/tags/lotus-next-v".length)
    assertPackageVersion(version); assert.match(version, /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/)
    assert.notEqual(version, "0.0.0"); assert.match(refs.get(ref) ?? "", sha)
    return { ref, version, object: refs.get(ref) }
  })
  assert.equal(matches.length, 1, "Require one existing annotated formal version tag for the source")
  return matches[0]
}

export function verifyPublisherProvenance(attestations, metadata, version) {
  const matches = attestations.attestations.filter(item => item.predicateType === slsa)
  assert.equal(matches.length, 1); const envelope = matches[0].bundle.dsseEnvelope
  assert.equal(envelope.payloadType, "application/vnd.in-toto+json")
  assert.match(envelope.payload, /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/)
  const statement = JSON.parse(Buffer.from(envelope.payload, "base64"))
  assert.equal(statement._type, "https://in-toto.io/Statement/v1"); assert.equal(statement.predicateType, slsa)
  assert.deepEqual(statement.subject, [{ name: `pkg:npm/%40bigduu/lotus-next@${version}`,
    digest: { sha512: Buffer.from(metadata.dist.integrity.slice(7), "base64").toString("hex") } }])
  const build = statement.predicate.buildDefinition, ref = "refs/heads/dev"
  assert.equal(build.buildType, "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1")
  assert.deepEqual(build.externalParameters.workflow, { ref, repository: `https://github.com/${repository}`, path: publisher })
  assert.deepEqual(build.internalParameters.github, { event_name: "workflow_dispatch", repository_id: "1281544268", repository_owner_id: "18681616" })
  assert.equal(build.resolvedDependencies.length, 1)
  const dependency = build.resolvedDependencies[0]
  assert.equal(dependency.uri, `git+https://github.com/${repository}@${ref}`); assert.match(dependency.digest.gitCommit, sha)
  assert.equal(statement.predicate.runDetails.builder.id, "https://github.com/actions/runner/github-hosted")
  const invocation = /^https:\/\/github\.com\/bigduu\/lotus-next\/actions\/runs\/([1-9][0-9]*)\/attempts\/([1-9][0-9]*)$/.exec(statement.predicate.runDetails.metadata.invocationId)
  assert.ok(invocation)
  return { controller: dependency.digest.gitCommit, runId: positive(invocation[1]), attempt: positive(invocation[2]) }
}

export function verifyPublishedBytes(metadata, archive, version, source, destination) {
  assert.equal(metadata.name, packageName); assert.equal(metadata.version, version)
  assert.equal(metadata.dist.tarball, `${registry}/@bigduu/lotus-next/-/lotus-next-${version}.tgz`)
  assert.equal(metadata.dist.shasum, hash(archive, "sha1"))
  assert.equal(metadata.dist.integrity, `sha512-${hash(archive, "sha512", "base64")}`)
  assert.equal(metadata.dist.attestations.provenance.predicateType, slsa)
  assert.equal(metadata.dist.attestations.url, `${registry}/-/npm/v1/attestations/@bigduu%2flotus-next@${version}`)
  const files = extractSafeTar(archive, destination)
  const document = JSON.parse(files.find(file => file.name === "package/package.json").bytes)
  assert.equal(document.name, packageName); assert.equal(document.version, version)
  verifyArtifactManifest({ distDirectory: join(destination, "package/dist"), expectedPackageName: packageName,
    expectedPackageVersion: version, expectedSourceRevision: source, expectedSourceDirty: false })
}

async function publicBytes(url, maximum) {
  const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(30000) })
  assert.equal(response.status, 200); let length = 0; const chunks = []
  for await (const chunk of response.body) { length += chunk.length; assert.ok(length <= maximum, "Published response exceeds its bound"); chunks.push(chunk) }
  return Buffer.concat(chunks)
}

export async function checkMainPromotion({ env = process.env, event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH)),
  git = (...args) => execFileSync("git", ["--no-replace-objects", ...args], { encoding: "utf8", maxBuffer: 256 * 1024 }).trim(),
  api = route => JSON.parse(execFileSync("gh", ["api", `repos/${repository}/${route}`], { encoding: "utf8", maxBuffer: 2 * 1024 * 1024 })),
  bytes = publicBytes } = {}) {
  assert.equal(git("rev-parse", "HEAD"), env.GITHUB_WORKFLOW_SHA, "Execute only the trusted Main workflow controls")
  assert.equal(git("status", "--porcelain", "--untracked-files=all"), "")
  const number = positive(event.number), pr = api(`pulls/${number}`), source = pr.head.sha
  git("fetch", "--no-tags", "--depth=2", "origin", `refs/pull/${number}/merge`)
  const merged = git("rev-parse", "FETCH_HEAD")
  const dev = api("branches/dev")
  verifyPromotionSource(event, env, pr, api("branches/main"), dev, { sha: merged,
    parents: git("show", "-s", "--format=%P", merged).split(" "), tree: git("rev-parse", `${merged}^{tree}`), sourceTree: git("rev-parse", `${source}^{tree}`) })
  ancestor(api(`compare/${source}...${dev.commit.sha}`), source)
  assert.equal(api(`git/ref/heads/release/${source}`).object.sha, source)
  const tags = () => git("ls-remote", "origin", "refs/tags/lotus-next-v*")
  const tag = releaseTag(tags(), source)
  git("fetch", "--no-tags", "origin", tag.ref)
  assert.equal(git("cat-file", "-t", "FETCH_HEAD"), "tag"); assert.equal(git("rev-parse", "FETCH_HEAD"), tag.object)
  assert.equal(git("rev-parse", "FETCH_HEAD^{commit}"), source)
  const metadata = JSON.parse(await bytes(`${registry}/@bigduu%2flotus-next/${tag.version}`, 2 * 1024 * 1024))
  assert.equal(metadata.dist.tarball, `${registry}/@bigduu/lotus-next/-/lotus-next-${tag.version}.tgz`)
  assert.equal(metadata.dist.attestations.url, `${registry}/-/npm/v1/attestations/@bigduu%2flotus-next@${tag.version}`)
  const directory = mkdtempSync(join(tmpdir(), "lotus-main-promotion-"))
  try {
    verifyPublishedBytes(metadata, await bytes(metadata.dist.tarball, 20 * 1024 * 1024), tag.version, source, join(directory, "original"))
    // Bind registry-served SLSA data to the actual successful publisher. This is
    // source binding, not a claim of Sigstore certificate/signature verification.
    const proof = verifyPublisherProvenance(JSON.parse(await bytes(metadata.dist.attestations.url, 2 * 1024 * 1024)), metadata, tag.version)
    const run = api(`actions/runs/${proof.runId}`)
    for (const repo of [run.repository, run.head_repository]) assert.equal(repo.full_name, repository)
    assert.equal(run.id, proof.runId); assert.equal(run.head_sha, proof.controller); assert.equal(run.head_branch, "dev")
    assert.equal(run.event, "workflow_dispatch"); assert.equal(run.path.split("@")[0], publisher)
    assert.equal(run.workflow_id, api("actions/workflows/publish-npm.yml").id)
    assert.equal(run.status, "completed"); assert.equal(run.conclusion, "success")
    assert.equal(run.display_title, `Publish ${packageName}@${tag.version}`); assert.ok(run.run_attempt >= proof.attempt)
    const jobs = api(`actions/runs/${proof.runId}/jobs?filter=latest&per_page=100`)
    assert.equal(jobs.total_count, jobs.jobs.length)
    assert.deepEqual(jobs.jobs.map(job => job.name).sort(), ["Validate publication request", "Build and pack the final artifact once", "Publish the retained tarball and verify the registry"].sort())
    for (const job of jobs.jobs) { assert.equal(job.head_sha, proof.controller); assert.equal(job.status, "completed"); assert.equal(job.conclusion, "success") }
    const final = jobs.jobs.find(job => job.name === "Publish the retained tarball and verify the registry")
    for (const name of ["Download and verify the registry copy", "Record immutable publication identity"]) {
      const selected = final.steps.filter(step => step.name === name); assert.equal(selected.length, 1)
      assert.equal(selected[0].status, "completed"); assert.equal(selected[0].conclusion, "success")
    }
    const current = api("branches/dev"); assert.equal(current.protected, true)
    for (const revision of [source, proof.controller]) ancestor(api(`compare/${revision}...${current.commit.sha}`), revision)
    assert.equal(api(`git/ref/heads/release/${source}`).object.sha, source)
    const after = api(`pulls/${number}`)
    for (const key of ["base", "head"]) for (const field of ["sha", "ref"]) assert.equal(after[key][field], pr[key][field])
    assert.equal(after.merge_commit_sha, merged); assert.equal(api("branches/main").commit.sha, pr.base.sha)
    assert.deepEqual(releaseTag(tags(), source), tag)
    assert.equal(git("rev-parse", "HEAD"), env.GITHUB_WORKFLOW_SHA); assert.equal(git("status", "--porcelain", "--untracked-files=all"), "")
    return { source, merge: merged, version: tag.version, publisher: proof.controller, runId: proof.runId }
  } finally { rmSync(directory, { recursive: true, force: true }) }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  checkMainPromotion().then(result => console.log("Verified read-only Main promotion " + JSON.stringify(result)))
    .catch(error => { console.error(error.message); process.exitCode = 1 })
}
