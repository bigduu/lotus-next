// Test data only: exercise the real read-only source verifier without source authority.
import { execFileSync } from "node:child_process"
import { createHash } from "node:crypto"
import { calculateResourcesSha256 } from "./artifact-manifest.mjs"
import { verifyAcceptedDev, FEATURE_JOBS, FEATURE_WORKFLOW_ID, PRODUCER, REPOSITORY } from "./frozen-dev-source.mjs"

const S = "1".repeat(40), B = "2".repeat(40), F = "3".repeat(40), M = "4".repeat(40)
const T = "5".repeat(40), D = "6".repeat(40), D2 = "7".repeat(40)
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")
const bytes = (value) => Buffer.from(JSON.stringify(value))
const safeEnv = Object.fromEntries(["PATH", "HOME", "USERPROFILE", "SystemRoot", "TEMP", "TMP", "TMPDIR", "LANG", "LC_ALL"]
  .filter((key) => process.env[key] !== undefined).map((key) => [key, process.env[key]]))
const clock = (second) => "2026-10-27T00:00:" + String(second).padStart(2, "0") + "Z"
const input = { source: S, pullRequest: 17, runId: 42, attempt: 1 }
const steps = [
  ["Bind the exact feature base, head, snapshot and tree", "Preserve the run-bound feature source"],
  ["Verify Node 22 Unit compatibility"],
  ["Verify architecture, behavior, build, and package contents", "Verify the deterministic provider fixture",
    "Verify the complete four-shard browser inventory", "Share the verified exact-source artifact and inventory"],
  ...[1, 2, 3, 4].map((shard) => ["Check exact artifact source and inventory", "Verify the all-surface browser shard",
    ...(shard === 1 ? ["Verify controlled Project Work component fixtures", "Verify Sprint planning and fixed-snapshot browser contracts",
      "Verify configuration sharing with the synthetic source harness"] : []),
    "Record this shard's actual outcome and inventory", "Upload the independent shard receipt"]),
  ["Require all Node lanes, shards, and original browser cases", "Upload the complete browser summary"],
  ["Check the exact artifact source and inventory", "Prepare the fixed verification browser",
    "Verify a real chat round trip with the pinned published Bamboo",
    "Verify the current source artifact on local and secure browser surfaces"],
  ["Verify and preserve the pristine artifact for both base controls", "Compile bounded base and observer-control fixtures",
    "Verify three negative controls and restored real Actor proof", "Upload native Actor evidence"],
  ["Require every feature gate on the exact tested snapshot", "Preserve complete feature acceptance"],
]
const zipCache = new Map()
const archive = (members) => {
  const encoded = JSON.stringify(Object.fromEntries(Object.entries(members).map(([name, data]) => [name, data.toString("base64")])))
  if (!zipCache.has(encoded)) zipCache.set(encoded, execFileSync("python3", ["-c",
    "import base64,io,json,sys,zipfile\nout=io.BytesIO()\nwith zipfile.ZipFile(out,'w',zipfile.ZIP_STORED) as z:\n for name,value in json.load(sys.stdin).items(): z.writestr(name,base64.b64decode(value))\nsys.stdout.buffer.write(out.getvalue())"],
  { input: encoded, env: safeEnv, maxBuffer: 8 * 1024 * 1024 }))
  return zipCache.get(encoded)
}
function canonicalDist(snapshot = M) {
  const html = Buffer.from("<html>one canonical test artifact</html>")
  const resources = [{ path: "index.html", size: html.length, sha256: sha256(html) }]
  return { "dist/index.html": html, "dist/lotus-next-manifest.json": bytes({ schemaVersion: 1, packageName: "@bigduu/lotus-next",
    packageVersion: "0.0.0", sourceRevision: snapshot, sourceDirty: false, entrypoint: "index.html",
    resourcesSha256: calculateResourcesSha256(resources), resources }),
  "browser-inventory.json": bytes({ schemaVersion: 2, producerNode: 24, sourceSha: snapshot,
    projects: ["desktop-chromium", "tablet-chromium", "phone-chromium"], tests: ["one", "two", "three", "four"],
    shards: [["one"], ["two"], ["three"], ["four"]] }) }
}
function fixture(identity = {}) {
  const source = identity.S ?? S, base = identity.B ?? B, head = identity.F ?? F
  const snapshot = identity.M ?? M, tree = identity.T ?? T
  const f = {
    pr: { number: 17, merged: true, state: "closed", merged_at: "2026-10-27T00:02:00Z",
      merge_commit_sha: source, base: { ref: "dev", sha: base, repo: { full_name: REPOSITORY } },
      head: { ref: "lotus-next/ci/example", sha: head, repo: { full_name: REPOSITORY } } },
    accepted: { parents: [{ sha: base }, { sha: head }], tree: { sha: tree } },
    tested: { parents: [{ sha: base }, { sha: head }], tree: { sha: tree } },
    branch: { protected: true, commit: { sha: D }, protection: { required_status_checks: {
      enforcement_level: "everyone", contexts: ["Feature acceptance"], checks: [{ context: "Feature acceptance", app_id: 15368 }],
    } } },
    run: { id: 42, repository: { full_name: REPOSITORY }, head_repository: { full_name: REPOSITORY },
      event: "pull_request", path: ".github/workflows/ci.yml", workflow_id: FEATURE_WORKFLOW_ID, head_sha: head,
      head_branch: "lotus-next/ci/example", run_attempt: 1, status: "completed", conclusion: "success", check_suite_id: 81,
      pull_requests: [] },
    suite: { id: 81, app: { id: 15368 }, head_sha: head, status: "completed", conclusion: "success" },
    jobs: FEATURE_JOBS.map((name, index) => ({ id: 101 + index, name, run_id: 42, head_sha: head, run_attempt: 1,
      status: "completed", conclusion: "success", started_at: clock(0), completed_at: clock(50),
      steps: steps[index].map((name, position) => ({ name, number: position + 1, status: "completed", conclusion: "success",
        started_at: clock(position * 2 + 1), completed_at: clock(position * 2 + 2) })) })),
    frozen: source, producer: { ...PRODUCER }, artifacts: [], archives: {}, reads: [],
  }
  f.source = { schemaVersion: 1, kind: "lotus-feature-source/v1", repository: REPOSITORY, pullRequest: 17,
    baseRef: "dev", baseSha: base, headRepository: REPOSITORY, headRef: "lotus-next/ci/example", headSha: head,
    testedSnapshot: snapshot, testedTree: tree, workflowRef: REPOSITORY + "/.github/workflows/ci.yml@refs/pull/17/merge",
    workflowSha: snapshot, runId: "42", sourceRunAttempt: 1 }
  f.acceptance = { schemaVersion: 1, kind: "lotus-feature-acceptance/v1", source: f.source,
    gates: { source: "success", verify: "success", browser: "success", realBamboo: "success", nativeActor: "success" },
    acceptanceRunAttempt: 1 }
  f.replaceArtifact = (name, members) => {
    const found = f.artifacts.find((item) => item.name === name), archiveId = found?.id ?? 501 + f.artifacts.length
    const zip = archive(members)
    const item = { id: archiveId, name, expired: false, digest: "sha256:" + sha256(zip), size_in_bytes: zip.length,
      workflow_run: { id: 42, head_sha: head }, created_at: clock(30) }
    if (found) f.artifacts.splice(f.artifacts.indexOf(found), 1, item)
    else f.artifacts.push(item)
    f.archives[archiveId] = zip
  }
  f.replaceArtifact("feature-source", { "feature-source.json": bytes(f.source) })
  f.replaceArtifact("feature-acceptance", { "feature-acceptance.json": bytes(f.acceptance) })
  f.replaceArtifact("browser-input-node-24", canonicalDist(snapshot))
  f.request = (endpoint) => {
    f.reads.push(endpoint)
    const fixed = { "pulls/17": f.pr, ["git/commits/" + source]: f.accepted, ["git/commits/" + snapshot]: f.tested,
      "branches/dev": f.branch, ["compare/" + source + "..." + D]: { merge_base_commit: { sha: source } },
      ["git/ref/heads/release/" + source]: { object: { sha: f.frozen } }, "actions/runs/42": f.run, "check-suites/81": f.suite,
      "actions/runs/42/jobs?filter=all&per_page=100&page=1": { total_count: f.jobs.length, jobs: f.jobs },
      "actions/runs/42/artifacts?per_page=100&page=1": { total_count: f.artifacts.length, artifacts: f.artifacts } }
    if (Object.hasOwn(fixed, endpoint)) return structuredClone(fixed[endpoint])
    const content = /^contents\/(.+)\?ref=(.+)$/u.exec(endpoint)
    if (content && content[2] === snapshot) return { sha: f.producer[content[1]] }
    throw new Error("Unexpected read: " + endpoint)
  }
  f.dependencies = { request: f.request, artifactBytes: (artifactId) => f.archives[artifactId] }
  f.verify = () => verifyAcceptedDev({ ...input, source }, f.dependencies)
  return f
}

export { S, B, F, M, T, D, D2, sha256, bytes, safeEnv, clock, input, steps, archive, canonicalDist, fixture }
