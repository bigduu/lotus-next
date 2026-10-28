import { describe, expect, it } from "vitest"
import { execFileSync, spawnSync } from "node:child_process"
import { createHash } from "node:crypto"
import { chmodSync, copyFileSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { assertPreviousPackagesUnstarted, packageArtifactName, packageJobName, packageStepName,
  packageUploadStepName, validateFeatureArtifactMetadata, validatePackageReceipt, extractVerifiedFeatureZip,
  verifyFeaturePackageContents } from "./feature-bamboo-package.mjs"
import { buildArtifactManifest } from "./artifact-manifest.mjs"
import { verifyExtractedCurrentArtifact } from "./published-real-bamboo-acceptance.mjs"

describe("real Bamboo feature package retry admission", () => {
  const expected = { runId: 42, attempt: 2, headSha: "a".repeat(40) }
  const previous = () => ({ total_count: 1, jobs: [{
    name: packageJobName, run_id: 42, run_attempt: 1, head_sha: expected.headSha,
    status: "completed", conclusion: "failure", steps: [{
      name: packageStepName, status: "completed", conclusion: "skipped",
    }],
  }] })

  it("allows a first pack after an earlier positively unstarted pack", () => {
    expect(() => assertPreviousPackagesUnstarted(expected, () => previous())).not.toThrow()
    const skipped = previous()
    skipped.jobs[0].conclusion = "skipped"
    skipped.jobs[0].steps = []
    expect(() => assertPreviousPackagesUnstarted(expected, () => skipped)).not.toThrow()
  })

  it.each(["success", "failure", "cancelled"])("does not repack after the prior pack %s", conclusion => {
    const started = previous()
    started.jobs[0].steps[0].conclusion = conclusion
    expect(() => assertPreviousPackagesUnstarted(expected, () => started)).toThrow(/already started/)
  })

  it("fails closed for missing, partial, foreign or ambiguous job history", () => {
    const changes = [
      x => { x.total_count++ },
      x => { x.jobs = [] },
      x => { x.jobs.push(x.jobs[0]); x.total_count++ },
      x => { x.jobs[0].run_id++ },
      x => { x.jobs[0].run_attempt++ },
      x => { x.jobs[0].head_sha = "b".repeat(40) },
      x => { x.jobs[0].status = "in_progress" },
      x => { x.jobs[0].steps = [] },
      x => { x.jobs[0].steps[0].status = "in_progress" },
    ]
    for (const change of changes) {
      const altered = previous()
      change(altered)
      expect(() => assertPreviousPackagesUnstarted(expected, () => altered)).toThrow()
    }
    expect(() => assertPreviousPackagesUnstarted(expected, () => { throw Error("Actions unavailable") })).toThrow(/unavailable/)
  })
})

describe("real Bamboo feature package source binding", () => {
  const source = { runId: "42", headSha: "a".repeat(40), testedSnapshot: "b".repeat(40),
    testedTree: "c".repeat(40), sourceRunAttempt: 1 }
  const receipt = () => ({ schemaVersion: 1, kind: "lotus-feature-bamboo-package/v1", source: { ...source }, producerAttempt: 1,
    packRecord: { filename: "bigduu-lotus-next-0.0.0.tgz" }, identity: { sourceRevision: source.testedSnapshot } })

  it("accepts the original package source on a later attempt of the same run", () => {
    expect(validatePackageReceipt(receipt(), { ...source, sourceRunAttempt: 2 }, 2)).toEqual(receipt())
  })

  it("rejects a foreign run, snapshot, version, or future source attempt", () => {
    const changes = [
      x => { x.source.runId = "43" },
      x => { x.source.testedSnapshot = "d".repeat(40) },
      x => { x.source.sourceRunAttempt = 3 },
      x => { x.producerAttempt = 3 },
      x => { x.packRecord.filename = "bigduu-lotus-next-1.0.0.tgz" },
      x => { x.identity.sourceRevision = "d".repeat(40) },
      x => { x.unexpected = true },
    ]
    for (const change of changes) {
      const altered = receipt()
      change(altered)
      expect(() => validatePackageReceipt(altered, { ...source, sourceRunAttempt: 2 }, 2)).toThrow()
    }
  })
})

describe("real Bamboo feature package artifact metadata", () => {
  const source = { runId: "42", headSha: "a".repeat(40) }
  const expected = { id: 73, digest: "d".repeat(64), source, producerAttempt: 1, currentAttempt: 2 }
  const artifact = () => ({ id: 73, name: packageArtifactName, expired: false, size_in_bytes: 100,
    digest: `sha256:${expected.digest}`, workflow_run: { id: 42, head_sha: source.headSha } })
  const jobs = () => ({ total_count: 1, jobs: [{ name: packageJobName, run_id: 42, run_attempt: 1,
    head_sha: source.headSha, status: "completed", conclusion: "success", steps: [packageStepName, packageUploadStepName]
      .map(name => ({ name, status: "completed", conclusion: "success" })) }] })

  it("accepts the original upload from the same run and PR head on a later attempt", () => {
    expect(() => validateFeatureArtifactMetadata(artifact(), expected, () => jobs())).not.toThrow()
  })

  it("rejects expired, foreign, missing, altered, or unproven artifacts", () => {
    const mutations = [
      x => { x.id++ }, x => { x.expired = true }, x => { x.size_in_bytes = 0 },
      x => { x.name = "another-package" }, x => { x.digest = `sha256:${"e".repeat(64)}` },
      x => { x.workflow_run.id++ }, x => { x.workflow_run.head_sha = "b".repeat(40) },
    ]
    for (const change of mutations) {
      const altered = artifact(); change(altered)
      expect(() => validateFeatureArtifactMetadata(altered, expected, () => jobs())).toThrow()
    }
    const badJobs = [
      x => { x.total_count++ }, x => { x.jobs[0].run_attempt = 2 },
      x => { x.jobs[0].head_sha = "b".repeat(40) }, x => { x.jobs[0].conclusion = "failure" },
      x => { x.jobs[0].steps[0].conclusion = "failure" }, x => { x.jobs[0].steps.pop() },
    ]
    for (const change of badJobs) {
      const altered = jobs(); change(altered)
      expect(() => validateFeatureArtifactMetadata(artifact(), expected, () => altered)).toThrow()
    }
    expect(() => validateFeatureArtifactMetadata(artifact(), { ...expected, producerAttempt: 3 }, () => jobs())).toThrow()
  })
})

describe("real Bamboo feature package transport", () => {
  it("restores only the exact original ZIP and refuses altered or extra members", () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "lotus-feature-package-test-")))
    try {
      writeFileSync(path.join(root, "feature-bamboo-package.json"), "original receipt")
      writeFileSync(path.join(root, "bigduu-lotus-next-0.0.0.tgz"), "original package")
      const archive = path.join(root, "original.zip")
      execFileSync("zip", ["-q", archive, "feature-bamboo-package.json", "bigduu-lotus-next-0.0.0.tgz"], { cwd: root })
      const digest = createHash("sha256").update(readFileSync(archive)).digest("hex")
      const restored = path.join(root, "restored")
      extractVerifiedFeatureZip(archive, restored, digest)
      expect(readFileSync(path.join(restored, "bigduu-lotus-next-0.0.0.tgz"), "utf8")).toBe("original package")
      expect(() => extractVerifiedFeatureZip(archive, path.join(root, "wrong-digest"), "a".repeat(64))).toThrow(/ZIP differs/)
      expect(() => extractVerifiedFeatureZip(archive, path.join(root, "wrong-size"), digest, "0.0.0", 1)).toThrow(/size differs/)

      writeFileSync(path.join(root, "unexpected"), "other")
      const extra = path.join(root, "extra.zip")
      execFileSync("zip", ["-q", extra, "feature-bamboo-package.json", "bigduu-lotus-next-0.0.0.tgz", "unexpected"], { cwd: root })
      const extraDigest = createHash("sha256").update(readFileSync(extra)).digest("hex")
      expect(() => extractVerifiedFeatureZip(extra, path.join(root, "wrong-members"), extraDigest)).toThrow(/ZIP members/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it("binds the restored tarball and extracted resources to the original source and pack identity", () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "lotus-feature-package-content-")))
    try {
      const source = { runId: "42", headSha: "a".repeat(40), testedSnapshot: "b".repeat(40), sourceRunAttempt: 1 }
      const sourceDistRoot = path.join(root, "dist"), staged = path.join(root, "staged", "package")
      const packageDist = path.join(staged, "dist"), directory = path.join(root, "artifact")
      for (const dir of [sourceDistRoot, packageDist, directory]) mkdirSync(dir, { recursive: true })
      const html = "<!doctype html><title>synthetic</title>"
      writeFileSync(path.join(sourceDistRoot, "index.html"), html)
      writeFileSync(path.join(packageDist, "index.html"), html)
      const manifest = buildArtifactManifest({ distDirectory: sourceDistRoot, packageVersion: "0.0.0",
        sourceRevision: source.testedSnapshot, sourceDirty: false })
      for (const dir of [sourceDistRoot, packageDist]) writeFileSync(path.join(dir, "lotus-next-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
      writeFileSync(path.join(staged, "package.json"), JSON.stringify({ name: "@bigduu/lotus-next", version: "0.0.0" }))
      const tarballPath = path.join(directory, "bigduu-lotus-next-0.0.0.tgz")
      execFileSync("tar", ["-czf", tarballPath, "-C", path.join(root, "staged"), "package/package.json",
        "package/dist/index.html", "package/dist/lotus-next-manifest.json"])
      const bytes = readFileSync(tarballPath)
      const packRecord = { name: "@bigduu/lotus-next", version: "0.0.0", filename: path.basename(tarballPath),
        shasum: createHash("sha1").update(bytes).digest("hex"), integrity: `sha512-${createHash("sha512").update(bytes).digest("base64")}` }
      const original = verifyExtractedCurrentArtifact({ tarballPath, packageRoot: staged, sourceDistRoot,
        expectedRevision: source.testedSnapshot, expectedVersion: "0.0.0", packRecord })
      const receipt = { schemaVersion: 1, kind: "lotus-feature-bamboo-package/v1", source, producerAttempt: 1,
        packRecord, identity: original.identity }
      writeFileSync(path.join(directory, "feature-bamboo-package.json"), JSON.stringify(receipt))
      const options = { directory, source, sourceDistRoot, expectedVersion: "0.0.0", producerAttempt: 1, currentAttempt: 2 }
      const work = path.join(root, "work"); mkdirSync(work)
      expect(verifyFeaturePackageContents({ ...options, temporaryRoot: work }).identity).toEqual(original.identity)
      const changed = path.join(root, "changed"); mkdirSync(changed)
      receipt.identity.npmShasum = "0".repeat(40)
      writeFileSync(path.join(directory, "feature-bamboo-package.json"), JSON.stringify(receipt))
      expect(() => verifyFeaturePackageContents({ ...options, temporaryRoot: changed })).toThrow(/identity differs/)
    } finally { rmSync(root, { recursive: true, force: true }) }
  })

  it("packs once and restores that exact synthetic PR snapshot package on a later attempt", () => {
    const root = realpathSync(mkdtempSync(path.join(tmpdir(), "lotus-feature-package-cli-")))
    try {
      const repo = path.join(root, "repo"), scripts = path.join(repo, "scripts"), bin = path.join(root, "bin")
      mkdirSync(scripts, { recursive: true }); mkdirSync(bin)
      for (const file of ["feature-bamboo-package.mjs", "feature-acceptance.mjs", "verification-browser.mjs",
        "published-real-bamboo-acceptance.mjs", "artifact-manifest.mjs", "release-source.mjs",
        "release-browser.mjs", "release-acceptance-identity.mjs"]) copyFileSync(path.resolve("scripts", file), path.join(scripts, file))
      writeFileSync(path.join(repo, ".gitignore"), "dist/\n")
      writeFileSync(path.join(repo, "package.json"), JSON.stringify({ name: "@bigduu/lotus-next", version: "0.0.0", files: ["dist"] }))
      const git = (...args) => execFileSync("git", ["-C", repo, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim()
      git("init", "-q", "--initial-branch=dev"); git("config", "user.name", "Fixture"); git("config", "user.email", "fixture@example.invalid")
      git("config", "commit.gpgSign", "false"); git("config", "core.hooksPath", "/dev/null")
      git("add", "."); git("commit", "-qm", "base"); const base = git("rev-parse", "HEAD")
      git("checkout", "-qb", "feature/test")
      writeFileSync(path.join(repo, "feature"), "synthetic feature\n"); git("add", "feature"); git("commit", "-qm", "feature")
      const head = git("rev-parse", "HEAD")
      git("checkout", "-q", "dev"); git("merge", "--no-ff", "-qm", "PR merge", "feature/test")
      const snapshot = git("rev-parse", "HEAD")
      const dist = path.join(repo, "dist"); mkdirSync(dist)
      writeFileSync(path.join(dist, "index.html"), "<!doctype html><title>synthetic</title>")
      const manifest = buildArtifactManifest({ distDirectory: dist, packageVersion: "0.0.0", sourceRevision: snapshot, sourceDirty: false })
      writeFileSync(path.join(dist, "lotus-next-manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`)
      const event = { number: 446, pull_request: { number: 446,
        base: { ref: "dev", sha: base, repo: { full_name: "bigduu/lotus-next" } },
        head: { ref: "feature/test", sha: head, repo: { full_name: "bigduu/lotus-next" } } } }
      const eventPath = path.join(root, "event.json"), sourcePath = path.join(root, "source.json")
      writeFileSync(eventPath, JSON.stringify(event))
      const env = { ...process.env, GITHUB_ACTIONS: "true", GITHUB_REPOSITORY: "bigduu/lotus-next", GITHUB_EVENT_NAME: "pull_request",
        GITHUB_BASE_REF: "dev", GITHUB_HEAD_REF: "feature/test", GITHUB_REF: "refs/pull/446/merge",
        GITHUB_WORKFLOW_REF: "bigduu/lotus-next/.github/workflows/ci.yml@refs/pull/446/merge", GITHUB_SHA: snapshot,
        FEATURE_WORKFLOW_SHA: snapshot, GITHUB_RUN_ID: "42", GITHUB_RUN_ATTEMPT: "1", GITHUB_EVENT_PATH: eventPath,
        FEATURE_RECEIPT_PATH: sourcePath, GITHUB_OUTPUT: path.join(root, "outputs"), PATH: `${bin}${path.delimiter}${process.env.PATH}` }
      delete env.npm_execpath
      const run = (script, args, changes = {}) => spawnSync(process.execPath, [path.join(scripts, script), ...args],
        { cwd: repo, encoding: "utf8", env: { ...env, ...changes } })
      const sourceRun = run("feature-acceptance.mjs", ["source"])
      expect(sourceRun.status, sourceRun.stderr).toBe(0)
      const guard = run("feature-bamboo-package.mjs", ["guard"])
      expect(guard.status, guard.stderr).toBe(0)
      const original = path.join(root, "original")
      const prepare = run("feature-bamboo-package.mjs", ["prepare", original])
      expect(prepare.status, prepare.stderr).toBe(0)
      const archive = path.join(root, "artifact.zip")
      execFileSync("zip", ["-q", archive, "feature-bamboo-package.json", "bigduu-lotus-next-0.0.0.tgz"], { cwd: original })
      const digest = createHash("sha256").update(readFileSync(archive)).digest("hex")
      const metadata = { id: 73, name: packageArtifactName, expired: false, size_in_bytes: readFileSync(archive).length,
        digest: `sha256:${digest}`, workflow_run: { id: 42, head_sha: head } }
      const jobs = { total_count: 1, jobs: [{ name: packageJobName, run_id: 42, run_attempt: 1, head_sha: head,
        status: "completed", conclusion: "success", steps: [packageStepName, packageUploadStepName].map(name => ({ name, status: "completed", conclusion: "success" })) }] }
      const metaPath = path.join(root, "artifact.json"), jobsPath = path.join(root, "jobs.json")
      writeFileSync(metaPath, JSON.stringify(metadata)); writeFileSync(jobsPath, JSON.stringify(jobs))
      const fakeGh = path.join(bin, "gh")
      writeFileSync(fakeGh, '#!/bin/sh\ncase "$2" in\n  */artifacts/73/zip) cat "$FIXTURE_ZIP" ;;\n  */artifacts/73) cat "$FIXTURE_META" ;;\n  */attempts/1/jobs*) cat "$FIXTURE_JOBS" ;;\n  *) exit 9 ;;\nesac\n')
      chmodSync(fakeGh, 0o755)
      const restored = path.join(root, "restored")
      const later = { GITHUB_RUN_ATTEMPT: "2", FEATURE_PACKAGE_ARTIFACT_ID: "73", FEATURE_PACKAGE_ARTIFACT_DIGEST: digest,
        FEATURE_PACKAGE_PRODUCER_ATTEMPT: "1", FIXTURE_ZIP: archive, FIXTURE_META: metaPath, FIXTURE_JOBS: jobsPath }
      const retrieve = run("feature-bamboo-package.mjs", ["retrieve", restored], later)
      expect(retrieve.status, retrieve.stderr).toBe(0)
      expect(readFileSync(path.join(restored, "bigduu-lotus-next-0.0.0.tgz"))).toEqual(readFileSync(path.join(original, "bigduu-lotus-next-0.0.0.tgz")))
      const verifyRoot = path.join(root, "verify"); mkdirSync(verifyRoot)
      const receipt = JSON.parse(readFileSync(sourcePath, "utf8"))
      const verified = verifyFeaturePackageContents({ directory: restored, temporaryRoot: verifyRoot, source: receipt,
        sourceDistRoot: dist, expectedVersion: "0.0.0", producerAttempt: 1, currentAttempt: 2 })
      expect(verified.identity.sourceRevision).toBe(snapshot)
    } finally { rmSync(root, { recursive: true, force: true }) }
  }, 30000)
})
