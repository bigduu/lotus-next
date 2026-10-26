// @vitest-environment node
import assert from "node:assert/strict"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { describe, it } from "vitest"
import { calculateResourcesSha256 } from "./artifact-manifest.mjs"
import { admitFrozenDev, verifyAcceptedDev, requireController, requireProduct, zipFiles, verifyDist,
  selectJobs, FEATURE_JOBS, FEATURE_WORKFLOW_ID, PRODUCER, REPOSITORY } from "./frozen-dev-source.mjs"

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

describe("original frozen-dev authority", () => {
  it("preserves actual M, normal accepted S and all eleven physical jobs without a release ref", () => {
    const f = fixture(), proof = f.verify()
    assert.equal(proof.source, S); assert.equal(proof.snapshot, M); assert.notEqual(S, M)
    assert.equal(proof.tree, T); assert.equal(proof.jobs.length, 11); assert.equal(proof.artifacts.length, 3)
    assert.equal(proof.dist.resources, 1); assert.equal(proof.dist.cases, 4)
    assert.ok(f.reads.every((endpoint) => !endpoint.includes("git/ref/heads/release/")))
    f.frozen = B
    assert.throws(() => admitFrozenDev(input, f.dependencies), /Frozen cut/)
  })
  it("keeps copied successes at their original execution and accepts the matching present association", () => {
    const f = fixture()
    f.run.run_attempt = 2; f.run.pull_requests = [{ number: 17, base: { ref: "dev", sha: B }, head: { sha: F } }]
    for (const original of [...f.jobs]) f.jobs.push({ ...structuredClone(original), id: original.id + 1000, run_attempt: 2 })
    const proof = verifyAcceptedDev({ ...input, attempt: 2 }, f.dependencies)
    assert.equal(proof.jobs[0].id, 101); assert.equal(proof.jobs[0].attempt, 1)
    assert.deepEqual(proof.jobs[0].logical, { id: 1101, attempt: 2 })
  })
  it("pins the complete real authority closure and all selected labels", () => {
    for (const [file, expected] of Object.entries(PRODUCER)) {
      const value = execFileSync("git", ["hash-object", file], { encoding: "utf8", env: safeEnv }).trim()
      assert.equal(value, expected)
    }
    const workflows = readFileSync(".github/workflows/ci.yml", "utf8") + readFileSync(".github/workflows/actor-native.yml", "utf8")
    for (const name of steps.flat()) assert.ok(workflows.includes("- name: " + name), "Unknown actual producer step: " + name)
  })
  for (const [label, mutate] of [
    ["open matching-tree PR", (f) => { f.pr.merged = false; f.pr.state = "open" }],
    ["foreign PR source", (f) => { f.pr.merge_commit_sha = D }],
    ["foreign base repository", (f) => { f.pr.base.repo.full_name = "other/lotus" }],
    ["squashed accepted merge", (f) => { f.accepted.parents.pop() }],
    ["wrong actual M parents", (f) => { f.tested.parents[1].sha = B }],
    ["wrong actual M tree", (f) => { f.tested.tree.sha = D }],
    ["unprotected dev", (f) => { f.branch.protected = false }],
    ["administrator bypass", (f) => { f.branch.protection.required_status_checks.enforcement_level = "non_admins" }],
    ["foreign required app", (f) => { f.branch.protection.required_status_checks.checks[0].app_id = 1 }],
    ["compile-only legacy workflow", (f) => { f.producer[".github/workflows/ci.yml"] = B }],
    ["changed source recorder", (f) => { f.producer["scripts/feature-acceptance.mjs"] = B }],
    ["manual diagnostic", (f) => { f.run.event = "workflow_dispatch" }],
    ["main-push runtime skip", (f) => { f.run.event = "push" }],
    ["unofficial check suite", (f) => { f.suite.app.id = 1 }],
    ["foreign suite source", (f) => { f.suite.head_sha = B }],
    ["foreign workflow ID", (f) => { f.run.workflow_id = 1 }],
    ["missing PR association state", (f) => { delete f.run.pull_requests }],
    ["conflicting PR association", (f) => { f.run.pull_requests = [{ number: 99 }] }],
    ["missing native job", (f) => { f.jobs.splice(9, 1) }],
    ["skipped runtime", (f) => { f.jobs[8].conclusion = "skipped" }],
    ["failed HTTPS step", (f) => { f.jobs[8].steps.at(-1).conclusion = "failure" }],
    ["execution after merge", (f) => { f.pr.merged_at = clock(10) }],
    ["missing runtime step", (f) => { f.jobs[8].steps.pop() }],
    ["ambiguous job attempt", (f) => { f.jobs.push({ ...f.jobs[0], id: 999 }) }],
    ["foreign job", (f) => { f.jobs.push({ ...f.jobs[0], id: 999, name: "Success stub" }) }],
    ["invalid execution time", (f) => { f.jobs[0].steps[0].completed_at = null }],
    ["missing original bytes", (f) => { delete f.archives[501] }],
    ["expired original dist", (f) => { f.artifacts[2].expired = true }],
    ["changed original digest", (f) => { f.artifacts[2].digest = "sha256:" + "0".repeat(64) }],
    ["foreign artifact run", (f) => { f.artifacts[2].workflow_run.id = 43 }],
    ["late replacement artifact", (f) => { f.artifacts[2].created_at = "2026-10-27T00:03:00Z" }],
  ]) it("refuses " + label, () => { const f = fixture(); mutate(f); assert.throws(f.verify) })
  it("does not hide a later logical failure behind a successful physical original", () => {
    const f = fixture(); f.run.run_attempt = 2
    f.jobs.push({ ...structuredClone(f.jobs[8]), id: 999, run_attempt: 2, conclusion: "failure" })
    assert.throws(() => verifyAcceptedDev({ ...input, attempt: 2 }, f.dependencies))
  })
  it("requires the source and acceptance records from their physical attempts", () => {
    for (const field of ["sourceRunAttempt", "headSha", "testedTree", "workflowSha", "pullRequest"]) {
      const f = fixture(); f.source[field] = field === "sourceRunAttempt" || field === "pullRequest" ? 2 : D
      f.replaceArtifact("feature-source", { "feature-source.json": bytes(f.source) })
      assert.throws(f.verify)
    }
    const f = fixture(); f.acceptance.gates.realBamboo = "skipped"
    f.replaceArtifact("feature-acceptance", { "feature-acceptance.json": bytes(f.acceptance) })
    assert.throws(f.verify)
  })
  it("permits only normal dev advancement and ignores changing repository metadata", () => {
    const f = fixture(); let branchReads = 0, prReads = 0
    const request = (endpoint) => {
      if (endpoint === "branches/dev" && ++branchReads > 1) return { ...f.branch, commit: { sha: D2 } }
      if (endpoint === "compare/" + D + "..." + D2) return { status: "ahead", behind_by: 0, merge_base_commit: { sha: D } }
      const value = f.request(endpoint)
      if (endpoint === "pulls/17" && ++prReads > 1) value.head.repo.updated_at = "a normal metadata advance"
      return value
    }
    assert.equal(verifyAcceptedDev(input, { ...f.dependencies, request }).currentDev, D2)
    branchReads = 0
    assert.throws(() => verifyAcceptedDev(input, { ...f.dependencies, request: (endpoint) => endpoint.startsWith("compare/" + D + "...")
      ? { status: "diverged", behind_by: 1, merge_base_commit: { sha: B } } : request(endpoint) }))
  })
  it("rechecks the frozen ref, PR, logical run and original jobs", () => {
    for (const changed of ["pulls/17", "actions/runs/42", "actions/runs/42/jobs?filter=all&per_page=100&page=1",
      "git/ref/heads/release/" + S]) {
      const f = fixture(); let reads = 0
      const request = (endpoint) => {
        const value = f.request(endpoint)
        if (endpoint === changed && ++reads === 2) {
          if (changed === "pulls/17") value.head.sha = D
          else if (changed === "actions/runs/42") value.run_attempt++
          else if (changed.includes("/jobs?")) value.jobs[0].conclusion = "failure"
          else value.object.sha = D
        }
        return value
      }
      assert.throws(() => admitFrozenDev(input, { ...f.dependencies, request }))
    }
  })
})

describe("canonical original bytes and controller boundaries", () => {
  it("validates the original ZIP, every resource and the complete inventory without extracting it", () => {
    const files = canonicalDist(); assert.deepEqual(zipFiles(archive(files)), files)
    assert.equal(verifyDist(files, M).resources, 1)
    for (const mutate of [
      (f) => { f["dist/index.html"] = Buffer.from("changed") },
      (f) => { f["dist/foreign.js"] = Buffer.from("foreign") },
      (f) => { delete f["dist/index.html"] },
      (f) => { const m = JSON.parse(f["dist/lotus-next-manifest.json"]); m.sourceRevision = S; f["dist/lotus-next-manifest.json"] = bytes(m) },
      (f) => { const i = JSON.parse(f["browser-inventory.json"]); i.shards[1] = i.shards[0]; f["browser-inventory.json"] = bytes(i) },
    ]) { const changed = canonicalDist(); mutate(changed); assert.throws(() => verifyDist(changed, M)) }
    for (const name of ["../outside", "/absolute", "a\\b", "a/../b"]) assert.throws(() => zipFiles(archive({ [name]: Buffer.from("x") })))
    assert.throws(() => zipFiles(Buffer.from("not a zip")))
  })
  it("uses real clean temporary Git checkouts and keeps C separate from S", () => {
    const root = mkdtempSync(path.join(tmpdir(), "lotus-frozen-source-git-"))
    try {
      const run = (directory, ...args) => execFileSync("git", ["-c", "user.name=Source fixture", "-c", "user.email=source@example.invalid",
        "-c", "commit.gpgSign=false", "-c", "core.hooksPath=" + path.join(root, "empty-hooks"), ...args], {
        cwd: directory, encoding: "utf8", env: safeEnv, stdio: ["ignore", "pipe", "pipe"],
      }).trim()
      const control = path.join(root, "controller"), product = path.join(root, "product")
      for (const dir of [control, product]) {
        mkdirSync(dir); run(dir, "init", "-q", "--initial-branch=main")
        writeFileSync(path.join(dir, "package.json"), JSON.stringify({ name: "@bigduu/lotus-next", version: "0.0.0" }))
        writeFileSync(path.join(dir, "package-lock.json"), "{}\n")
        run(dir, "add", "."); run(dir, "commit", "-qm", dir === control ? "controller" : "product")
      }
      const controller = run(control, "rev-parse", "HEAD"), source = run(product, "rev-parse", "HEAD")
      const env = Object.freeze({ GITHUB_REPOSITORY: REPOSITORY, GITHUB_EVENT_NAME: "workflow_dispatch",
        GITHUB_REF: "refs/heads/main", GITHUB_WORKFLOW_REF: REPOSITORY + "/.github/workflows/publish-npm.yml@refs/heads/main",
        GITHUB_WORKFLOW_SHA: controller, GITHUB_SHA: controller })
      const original = structuredClone(env)
      assert.equal(requireController(env, control), controller)
      assert.equal(requireProduct(source, product).tree, run(product, "rev-parse", "HEAD^{tree}"))
      assert.notEqual(controller, source); assert.deepEqual(env, original)
      assert.throws(() => requireController({ ...env, GITHUB_SHA: source }, control))
      assert.throws(() => requireController({ ...env, GITHUB_EVENT_NAME: "pull_request" }, control))
      writeFileSync(path.join(product, "untracked.txt"), "dirty")
      assert.throws(() => requireProduct(source, product))
      assert.throws(() => requireProduct(source, process.cwd()))
    } finally { rmSync(root, { recursive: true, force: true }) }
  })
  it("rejects absent/partial API state rather than treating it as success", () => {
    const f = fixture()
    assert.throws(() => verifyAcceptedDev(input, { ...f.dependencies, request: () => { throw new Error("HTTP 503") } }), /503/)
    assert.throws(() => selectJobs([], 42, 1, F, f.pr.merged_at), /Missing/)
  })
  it("runs the real read-only CLI with original ZIP transport and exclusive output", () => {
    const temporary = mkdtempSync(path.join(tmpdir(), "lotus-frozen-source-cli-"))
    try {
      const control = path.join(temporary, "controller"), product = path.join(temporary, "product"), bin = path.join(temporary, "bin")
      for (const dir of [control, product, bin]) mkdirSync(dir)
      const runGit = (directory, ...args) => execFileSync("git", ["-c", "user.name=CLI fixture",
        "-c", "user.email=cli@example.invalid", "-c", "commit.gpgSign=false",
        "-c", "core.hooksPath=" + path.join(temporary, "empty-hooks"), ...args], {
        cwd: directory, env: safeEnv, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
      }).trim()
      mkdirSync(path.join(control, "scripts"))
      for (const name of ["frozen-dev-source.mjs", "artifact-manifest.mjs", "browser-shards.mjs"]) {
        writeFileSync(path.join(control, "scripts", name), readFileSync("scripts/" + name))
      }
      runGit(control, "init", "-q", "--initial-branch=main")
      runGit(control, "add", "."); runGit(control, "commit", "-qm", "trusted controller")
      const controller = runGit(control, "rev-parse", "HEAD")
      runGit(product, "init", "-q", "--initial-branch=dev")
      writeFileSync(path.join(product, "package.json"), JSON.stringify({ name: "@bigduu/lotus-next", version: "0.0.0",
        scripts: { prepack: "this candidate code must never execute" } }))
      writeFileSync(path.join(product, "package-lock.json"), "{}\n")
      runGit(product, "add", "."); runGit(product, "commit", "-qm", "base")
      const base = runGit(product, "rev-parse", "HEAD")
      runGit(product, "checkout", "-qb", "feature")
      writeFileSync(path.join(product, "feature.txt"), "actual feature source\n")
      runGit(product, "add", "."); runGit(product, "commit", "-qm", "feature")
      const head = runGit(product, "rev-parse", "HEAD")
      runGit(product, "checkout", "-q", "dev"); runGit(product, "merge", "--no-ff", "--no-edit", "-q", "feature")
      const snapshot = runGit(product, "rev-parse", "HEAD"), tree = runGit(product, "rev-parse", "HEAD^{tree}")
      const source = runGit(product, "commit-tree", tree, "-p", base, "-p", head, "-m", "separate accepted merge")
      assert.notEqual(source, snapshot)
      runGit(product, "checkout", "-q", "--detach", source)
      const f = fixture({ S: source, B: base, F: head, M: snapshot, T: tree })
      const endpoints = ["pulls/17", "git/commits/" + source, "git/commits/" + snapshot, "branches/dev",
        "compare/" + source + "..." + D, "git/ref/heads/release/" + source, "actions/runs/42", "check-suites/81",
        "actions/runs/42/jobs?filter=all&per_page=100&page=1", "actions/runs/42/artifacts?per_page=100&page=1",
        ...Object.keys(PRODUCER).map((file) => "contents/" + file + "?ref=" + snapshot)]
      const database = path.join(temporary, "api.json")
      const save = () => writeFileSync(database, JSON.stringify({
        replies: Object.fromEntries(endpoints.map((endpoint) => [endpoint, f.request(endpoint)])),
        archives: Object.fromEntries(Object.entries(f.archives).map(([artifactId, zip]) => [artifactId, zip.toString("base64")])),
      }))
      save()
      const stub = [
        "#!" + process.execPath,
        "const fs=require('node:fs'),db=JSON.parse(fs.readFileSync(" + JSON.stringify(database) + "));",
        "const arg=process.argv[3],prefix='repos/" + REPOSITORY + "/';",
        "if(!arg?.startsWith(prefix))process.exit(2);const endpoint=arg.slice(prefix.length);",
        "const match=/^actions\\/artifacts\\/(\\d+)\\/zip$/.exec(endpoint);",
        "if(match){if(!process.argv.includes('--allow-escape-sequences'))process.exit(3);process.stdout.write(Buffer.from(db.archives[match[1]],'base64'));}",
        "else if(Object.hasOwn(db.replies,endpoint))process.stdout.write(JSON.stringify(db.replies[endpoint]));else process.exit(4);",
      ].join("\n")
      writeFileSync(path.join(bin, "gh"), stub, { mode: 0o755 })
      const output = path.join(temporary, "source-proof.json")
      const execute = (file) => spawnSync(process.execPath, [path.join(control, "scripts/frozen-dev-source.mjs"), "admit", file], {
        cwd: control, env: { ...safeEnv, PATH: bin + path.delimiter + safeEnv.PATH, GITHUB_REPOSITORY: REPOSITORY,
          GITHUB_EVENT_NAME: "workflow_dispatch", GITHUB_REF: "refs/heads/main",
          GITHUB_WORKFLOW_REF: REPOSITORY + "/.github/workflows/publish-npm.yml@refs/heads/main",
          GITHUB_WORKFLOW_SHA: controller, GITHUB_SHA: controller, EXPECTED_SOURCE_SHA: source,
          FEATURE_PULL_REQUEST: "17", FEATURE_RUN_ID: "42", FEATURE_RUN_ATTEMPT: "1", SOURCE_ROOT: product },
        encoding: "utf8",
      })
      const accepted = execute(output)
      assert.equal(accepted.status, 0, accepted.stderr)
      const proof = JSON.parse(readFileSync(output))
      assert.equal(proof.controller, controller); assert.equal(proof.source, source); assert.equal(proof.snapshot, snapshot)
      assert.equal(proof.product.tree, tree); assert.notEqual(controller, source)
      assert.notEqual(execute(output).status, 0, "Never overwrite the original source proof")
      f.run.event = "workflow_dispatch"; save()
      const denied = path.join(temporary, "denied.json")
      assert.notEqual(execute(denied).status, 0)
      assert.throws(() => readFileSync(denied), /ENOENT/)
    } finally { rmSync(temporary, { recursive: true, force: true }) }
  }, 15000)
})
