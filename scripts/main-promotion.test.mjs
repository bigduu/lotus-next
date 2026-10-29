import assert from "node:assert/strict"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { gzipSync } from "node:zlib"
import { afterEach, describe, expect, it } from "vitest"
import { buildArtifactManifest } from "./artifact-manifest.mjs"
import { checkMainPromotion, releaseTag } from "./main-promotion.mjs"

const roots = [], clone = value => JSON.parse(JSON.stringify(value))
afterEach(() => { for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true }) })
const [B, S, M, T, C, D, O] = ["b", "a", "d", "e", "c", "f", "1"].map(value => value.repeat(40))
const repository = "bigduu/lotus-next", version = "2026.10.30", packageName = "@bigduu/lotus-next", repo = { full_name: repository }
const hash = (bytes, algorithm, encoding = "hex") => createHash(algorithm).update(bytes).digest(encoding)
function tar(entries) {
  const pieces = []
  for (const [name, bytes] of entries) {
    const header = Buffer.alloc(512)
    header.write(name); header.write("0000644\0", 100); header.write("0000000\0", 108); header.write("0000000\0", 116)
    header.write(bytes.length.toString(8).padStart(11, "0") + "\0", 124); header.write("00000000000\0", 136)
    header.fill(32, 148, 156); header[156] = 48; header.write("ustar\0" + "00", 257)
    header.write([...header].reduce((a, b) => a + b, 0).toString(8).padStart(6, "0") + "\0 ", 148)
    pieces.push(header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512))
  }
  return gzipSync(Buffer.concat([...pieces, Buffer.alloc(1024)]))
}
function fixture(manifestChange = {}) {
  const root = mkdtempSync(join(tmpdir(), "lotus-main-gate-test-")); roots.push(root)
  const dist = join(root, "dist"); mkdirSync(dist); writeFileSync(join(dist, "index.html"), "<!doctype html>fixture only")
  const manifest = { ...buildArtifactManifest({ distDirectory: dist, packageName, packageVersion: version, sourceRevision: S, sourceDirty: false }), ...manifestChange }
  const archive = tar([["package/package.json", Buffer.from(JSON.stringify({ name: packageName, version }))],
    ["package/dist/index.html", readFileSync(join(dist, "index.html"))],
    ["package/dist/lotus-next-manifest.json", Buffer.from(JSON.stringify(manifest, null, 2) + "\n")]])
  const metadata = { name: packageName, version, dist: { tarball: `https://registry.npmjs.org/@bigduu/lotus-next/-/lotus-next-${version}.tgz`,
    shasum: hash(archive, "sha1"), integrity: `sha512-${hash(archive, "sha512", "base64")}`,
    attestations: { provenance: { predicateType: "https://slsa.dev/provenance/v1" }, url: `https://registry.npmjs.org/-/npm/v1/attestations/@bigduu%2flotus-next@${version}` } } }
  const statement = { _type: "https://in-toto.io/Statement/v1", predicateType: "https://slsa.dev/provenance/v1",
    subject: [{ name: `pkg:npm/%40bigduu/lotus-next@${version}`, digest: { sha512: hash(archive, "sha512") } }],
    predicate: { buildDefinition: { buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
      externalParameters: { workflow: { ref: "refs/heads/dev", repository: `https://github.com/${repository}`, path: ".github/workflows/publish-npm.yml" } },
      internalParameters: { github: { event_name: "workflow_dispatch", repository_id: "1281544268", repository_owner_id: "18681616" } },
      resolvedDependencies: [{ uri: `git+https://github.com/${repository}@refs/heads/dev`, digest: { gitCommit: C } }] },
      runDetails: { builder: { id: "https://github.com/actions/runner/github-hosted" }, metadata: { invocationId: `https://github.com/${repository}/actions/runs/77/attempts/1` } } } }
  const env = { GITHUB_EVENT_NAME: "pull_request_target", GITHUB_REPOSITORY: repository, GITHUB_REF: "refs/heads/main",
    GITHUB_SHA: B, GITHUB_WORKFLOW_SHA: B, GITHUB_WORKFLOW_REF: `${repository}/.github/workflows/main-promotion.yml@refs/heads/main` }
  const pr = { number: 9, state: "open", merged: false, draft: false, base: { ref: "main", sha: B, repo },
    head: { ref: `release/${S}`, sha: S, repo }, merge_commit_sha: M }
  const event = { number: 9, pull_request: clone(pr) }
  const finalSteps = ["Download and verify the registry copy", "Record immutable publication identity"]
    .map(name => ({ name, status: "completed", conclusion: "success" }))
  const routes = { "pulls/9": pr, "branches/main": { name: "main", protected: true, commit: { sha: B } },
    "branches/dev": { name: "dev", protected: true, commit: { sha: D } },
    [`git/ref/heads/release/${S}`]: { object: { type: "commit", sha: S } },
    [`compare/${S}...${D}`]: { base_commit: { sha: S }, merge_base_commit: { sha: S }, status: "ahead" },
    [`compare/${C}...${D}`]: { base_commit: { sha: C }, merge_base_commit: { sha: C }, status: "ahead" },
    "actions/workflows/publish-npm.yml": { id: 5 },
    "actions/runs/77": { id: 77, repository: repo, head_repository: repo, head_sha: C, head_branch: "dev", workflow_id: 5,
      event: "workflow_dispatch", path: ".github/workflows/publish-npm.yml", status: "completed", conclusion: "success",
      display_title: `Publish ${packageName}@${version}`, run_attempt: 2 },
    "actions/runs/77/jobs?filter=latest&per_page=100": { total_count: 3, jobs: ["Validate publication request", "Build and pack the final artifact once", "Publish the retained tarball and verify the registry"]
      .map(name => ({ name, head_sha: C, status: "completed", conclusion: "success", steps: name.startsWith("Publish the retained") ? finalSteps : [] })) } }
  const state = { mergeTree: T, sourceTree: T, parents: [B, S], head: B,
    remote: `${O}\trefs/tags/lotus-next-v${version}\n${S}\trefs/tags/lotus-next-v${version}^{}\n`, tagType: "tag", peeled: S }
  let fetched = M
  const commands = [], urls = []
  const git = (...args) => {
    commands.push(args)
    if (args[0] === "fetch") { fetched = args.at(-1).startsWith("refs/pull/") ? M : O; return "" }
    if (args[0] === "status") return ""
    if (args[0] === "ls-remote") return state.remote
    if (args[0] === "cat-file") return state.tagType
    if (args[0] === "show") return state.parents.join(" ")
    if (args[0] === "rev-parse") return ({ HEAD: state.head, FETCH_HEAD: fetched, "FETCH_HEAD^{commit}": state.peeled,
      [`${M}^{tree}`]: state.mergeTree, [`${S}^{tree}`]: state.sourceTree })[args[1]] ?? assert.fail("Unknown Git read")
    assert.fail("Unexpected command: " + args.join(" "))
  }
  const api = route => { assert.ok(routes[route], "Unknown API read " + route); return clone(routes[route]) }
  const bytes = async url => {
    urls.push(url)
    if (url === metadata.dist.tarball) return archive
    if (url === metadata.dist.attestations.url) return Buffer.from(JSON.stringify({ attestations: [{ predicateType: "https://slsa.dev/provenance/v1",
      bundle: { dsseEnvelope: { payloadType: "application/vnd.in-toto+json", payload: Buffer.from(JSON.stringify(statement)).toString("base64") } } }] }))
    assert.equal(url, `https://registry.npmjs.org/@bigduu%2flotus-next/${version}`); return Buffer.from(JSON.stringify(metadata))
  }
  return { env, event, routes, state, metadata, statement, commands, urls, run: () => checkMainPromotion({ env, event, git, api, bytes }) }
}

describe("read-only Main promotion", () => {
  it("uses trusted B controls, actual M/S and the completed publisher C without rebuilding a package", async () => {
    const x = fixture(); expect(await x.run()).toEqual({ source: S, merge: M, version, publisher: C, runId: 77 })
    expect(x.commands.some(args => args[0] === "checkout")).toBe(false)
    expect(x.urls).toHaveLength(3)
    expect(x.routes["actions/runs/77"].run_attempt).toBe(2) // Original provenance attempt remains 1.
  })
  it("rejects a draft and admits the unchanged promotion after it is marked ready", async () => {
    const x = fixture()
    x.routes["pulls/9"].draft = true
    await expect(x.run()).rejects.toThrow()
    x.routes["pulls/9"].draft = false
    expect(await x.run()).toEqual({ source: S, merge: M, version, publisher: C, runId: 77 })
  })
  it.each([
    ["untrusted checkout", x => { x.state.head = S }], ["wrong event", x => { x.env.GITHUB_EVENT_NAME = "pull_request" }],
    ["fork", x => { x.event.pull_request.head.repo = { full_name: "other/lotus-next" } }],
    ["ordinary feature branch", x => { x.routes["pulls/9"].head.ref = "feature/work" }],
    ["unprotected Main", x => { x.routes["branches/main"].protected = false }],
    ["unprotected Dev", x => { x.routes["branches/dev"].protected = false }],
    ["wrong parents", x => { x.state.parents.reverse() }], ["changed merge tree", x => { x.state.mergeTree = B }],
    ["withdrawn source", x => { x.routes[`compare/${S}...${D}`].merge_base_commit.sha = B }],
    ["moved release branch", x => { x.routes[`git/ref/heads/release/${S}`].object.sha = B }],
    ["lightweight version tag", x => { x.state.remote = `${S}\trefs/tags/lotus-next-v${version}\n` }],
    ["wrong annotated target", x => { x.state.peeled = B }], ["wrong tag type", x => { x.state.tagType = "commit" }],
    ["registry digest mismatch", x => { x.metadata.dist.shasum = "0".repeat(40) }],
    ["foreign registry URL", x => { x.metadata.dist.tarball = "https://other.invalid/package.tgz" }],
    ["Main publisher substitution", x => { x.statement.predicate.buildDefinition.externalParameters.workflow.ref = "refs/heads/main" }],
    ["wrong attested digest", x => { x.statement.subject[0].digest.sha512 = "0".repeat(128) }],
    ["wrong publisher C", x => { x.routes["actions/runs/77"].head_sha = S }],
    ["failed publisher", x => { x.routes["actions/runs/77"].conclusion = "failure" }],
    ["skipped registry readback", x => { x.routes["actions/runs/77/jobs?filter=latest&per_page=100"].jobs[2].steps[0].conclusion = "skipped" }],
    ["incomplete jobs", x => { x.routes["actions/runs/77/jobs?filter=latest&per_page=100"].total_count = 4 }],
    ["withdrawn publisher C", x => { x.routes[`compare/${C}...${D}`].merge_base_commit.sha = B }],
  ])("rejects %s", async (_name, change) => { const x = fixture(); change(x); await expect(x.run()).rejects.toThrow() })
  it.each([{ sourceRevision: B }, { sourceDirty: true }, { packageVersion: "2026.10.31" }])("rejects an unpublished source identity inside valid registry bytes: %j", async change => {
    await expect(fixture(change).run()).rejects.toThrow()
  })
  it("rejects ambiguous matching formal tags", () => {
    const x = fixture(); expect(() => releaseTag(x.state.remote + `${C}\trefs/tags/lotus-next-v2026.10.31\n${S}\trefs/tags/lotus-next-v2026.10.31^{}\n`, S)).toThrow()
  })
  it("keeps the Main entry point separate, trusted and free of product commands", () => {
    const workflow = readFileSync(".github/workflows/main-promotion.yml", "utf8")
    expect(workflow).toContain("pull_request_target:"); expect(workflow).toContain("branches: [main]")
    const trigger = workflow.match(/^  pull_request_target:\n((?:    .*\n)+)/mu)?.[1]
    const types = trigger?.match(/^    types: \[([^\]]+)\]$/mu)?.[1].split(",").map(type => type.trim())
    expect(types).toEqual(["opened", "synchronize", "reopened", "ready_for_review"])
    expect(workflow).toContain("ref: ${{ github.workflow_sha }}"); expect(workflow).toContain("persist-credentials: false")
    expect(workflow).not.toMatch(/npm ci|npm run|npm publish|id-token: write|contents: write|secrets\./)
    expect(readFileSync(".github/workflows/ci.yml", "utf8")).toContain("branches: [dev]")
  })
})
