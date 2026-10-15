import { createHash } from "node:crypto"
import {
  existsSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { gzipSync } from "node:zlib"

import { afterEach, describe, expect, it, vi } from "vitest"

import { buildArtifactManifest } from "./artifact-manifest.mjs"
import {
  createRecoveryReceipt,
  extractSafeTar,
  inspectTar,
  verifyNpmPackResult,
  verifyOriginalPublication,
  verifyProvenance,
  verifyPublishedNpm,
  verifyRecoveryContext,
  verifyRecoveryRecord,
  verifyRegistryBytes,
  verifyRegistryMetadata,
  verifyRegistryPackage,
} from "./verify-published-npm.mjs"

const temporaryDirectories = []
const hash = (algorithm, bytes, encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding)
const sha256 = (bytes) => hash("sha256", bytes)
const jsonBytes = (value) => Buffer.from(`${JSON.stringify(value, null, 2)}\n`)
const readRepositoryBytes = (relativePath) =>
  readFileSync(path.resolve(process.cwd(), relativePath))
const temporaryDirectory = () => {
  const root = mkdtempSync(path.join(tmpdir(), "lotus-registry-recovery-"))
  temporaryDirectories.push(root)
  return root
}

// Keep archive fixtures self-contained. Neither npm nor a system tar utility is
// needed, and each adversarial header has a valid checksum unless it is the
// checksum itself under test.
const tarEntry = ({ name, contents = "", type = "0", linkname = "", prefix = "", size }) => {
  const bytes = Buffer.from(contents)
  const header = Buffer.alloc(512)
  header.write(name, 0, 100)
  header.write("0000644\0", 100, 8)
  header.write("0000000\0", 108, 8)
  header.write("0000000\0", 116, 8)
  header.write((size ?? bytes.length).toString(8).padStart(11, "0") + "\0", 124, 12)
  header.write("00000000000\0", 136, 12)
  header.fill(0x20, 148, 156)
  header.write(type, 156, 1)
  header.write(linkname, 157, 100)
  header.write("ustar\0", 257, 6)
  header.write("00", 263, 2)
  header.write(prefix, 345, 155)
  const checksum = header.reduce((sum, byte) => sum + byte, 0)
  header.write(checksum.toString(8).padStart(6, "0") + "\0 ", 148, 8)
  return Buffer.concat([header, bytes, Buffer.alloc((512 - bytes.length % 512) % 512)])
}
const rawTar = (entries, trailer = Buffer.alloc(1024)) =>
  Buffer.concat([...entries.map(tarEntry), trailer])
const tarball = (entries, trailer) => gzipSync(rawTar(entries, trailer))

// Every test owns its output directory; a failed verifier must never leave a
// success receipt in a pre-existing directory used by another test.
afterEach(() => {
  vi.restoreAllMocks()
  for (const root of temporaryDirectories.splice(0)) {
    rmSync(root, { recursive: true, force: true })
  }
})

const committedRecordBytes = readRepositoryBytes(".github/release-recoveries/2026.10.12.json")
const committedRecord = JSON.parse(committedRecordBytes)
const candidateBytes = readRepositoryBytes(".github/release-candidates.json")
const acceptanceBytes = readRepositoryBytes(".github/release-acceptance/2026.10.12.json")
const recordFixture = () => structuredClone(committedRecord)
const rewriteEvidence = (record, name, mutate) => {
  const evidence = record.rawEvidence[name]
  const value = JSON.parse(evidence.utf8)
  mutate(value)
  evidence.utf8 = jsonBytes(value).toString("utf8")
  evidence.sha256 = sha256(evidence.utf8)
}

describe("reviewed original publication record", () => {
  it("verifies the committed original receipts against the reviewed candidate and acceptance", () => {
    expect(() => verifyRecoveryRecord(recordFixture(), candidateBytes, acceptanceBytes)).not.toThrow()
  })

  it("rejects altered candidate or acceptance bytes", () => {
    expect(() => verifyRecoveryRecord(recordFixture(), Buffer.concat([candidateBytes, Buffer.from(" ")]), acceptanceBytes)).toThrow()
    expect(() => verifyRecoveryRecord(recordFixture(), candidateBytes, Buffer.concat([acceptanceBytes, Buffer.from(" ")]))).toThrow()
  })

  it.each(["sourceReceipt", "acceptedIdentity", "localArtifact", "httpsArtifact"])(
    "rejects tampering with the raw %s receipt",
    (name) => {
      const record = recordFixture()
      record.rawEvidence[name].utf8 += " "
      expect(() => verifyRecoveryRecord(record, candidateBytes, acceptanceBytes)).toThrow()
    },
  )

  it.each([
    ["sourceSha", "f".repeat(40)],
    ["sourceTree", "f".repeat(40)],
    ["sourceRef", "refs/tags/lotus-next-v2026.10.8"],
    ["tagObjectSha", "f".repeat(40)],
    ["bambooSha", "f".repeat(40)],
    ["workflowSha", "f".repeat(40)],
    ["workflowRef", "bigduu/lotus-next/.github/workflows/publish-npm.yml@refs/heads/other"],
    ["runId", "1"],
    ["runAttempt", "2"],
    ["version", "2026.10.8"],
  ])("rejects a self-consistently rehashed source receipt with wrong %s", (key, value) => {
    const record = recordFixture()
    rewriteEvidence(record, "sourceReceipt", (receipt) => { receipt[key] = value })
    expect(() => verifyRecoveryRecord(record, candidateBytes, acceptanceBytes)).toThrow()
  })

  it.each([
    ["acceptedIdentity", "sourceRevision", "f".repeat(40)],
    ["acceptedIdentity", "packageVersion", "2026.10.8"],
    ["acceptedIdentity", "manifestSha256", "f".repeat(64)],
    ["localArtifact", "sourceDirty", true],
    ["localArtifact", "npmShasum", "f".repeat(40)],
    ["httpsArtifact", "resourcesSha256", "f".repeat(64)],
    ["httpsArtifact", "resourceCount", 1],
  ])("rejects divergent %s %s evidence", (name, key, value) => {
    const record = recordFixture()
    rewriteEvidence(record, name, (receipt) => { receipt[key] = value })
    expect(() => verifyRecoveryRecord(record, candidateBytes, acceptanceBytes)).toThrow()
  })
})

describe("safe registry archive inspection", () => {
  const validEntries = [
    { name: "package/package.json", contents: '{"name":"@bigduu/lotus-next"}\n' },
    { name: "package/dist/index.html", contents: "<!doctype html>" },
  ]

  it("reads regular USTAR members without executing an archive tool", () => {
    const entries = inspectTar(rawTar(validEntries))
    expect(entries.map((entry) => entry.name)).toEqual(validEntries.map((entry) => entry.name))
    expect(entries.map((entry) => entry.bytes.toString())).toEqual(validEntries.map((entry) => entry.contents))
    expect(inspectTar(rawTar([{ name: "index.html", prefix: "package/dist", contents: "ok", type: "\0" }]))[0].name)
      .toBe("package/dist/index.html")
  })

  it.each([
    "../outside",
    "/outside",
    "foreign/index.html",
    "package/../outside",
    "package/dist/../../outside",
    "package\\dist\\index.html",
    "package//dist/index.html",
    "package/./dist/index.html",
    "package/dist/control\n.html",
    "package/dist/control\u0085.html",
    "C:/outside",
  ])("rejects unsafe member %s", (name) => {
    expect(() => inspectTar(rawTar([{ name, contents: "unsafe" }]))).toThrow()
  })

  it.each([
    ["symbolic link", "2"],
    ["hard link", "1"],
    ["directory", "5"],
    ["character device", "3"],
    ["block device", "4"],
    ["FIFO", "6"],
    ["PAX extended header", "x"],
    ["PAX global header", "g"],
    ["GNU long name", "L"],
    ["GNU long link", "K"],
    ["GNU sparse member", "S"],
  ])("rejects %s members", (_name, type) => {
    expect(() => inspectTar(rawTar([{ name: "package/dist/unsafe", type, linkname: "../../outside" }]))).toThrow()
  })

  it("rejects duplicate archive names before extracting any member", () => {
    const root = temporaryDirectory()
    const destination = path.join(root, "extracted")
    const bytes = tarball([...validEntries, validEntries[0]])
    expect(() => extractSafeTar(bytes, destination)).toThrow()
    expect(existsSync(destination)).toBe(false)
  })

  it("rejects traversal introduced through a USTAR prefix", () => {
    expect(() => inspectTar(rawTar([{ name: "outside", prefix: "package/..", contents: "unsafe" }]))).toThrow()
  })

  it("rejects invalid checksums, truncated headers, and truncated file payloads", () => {
    const corruptChecksum = rawTar(validEntries)
    corruptChecksum[0] ^= 1
    expect(() => inspectTar(corruptChecksum)).toThrow()
    expect(() => inspectTar(Buffer.alloc(100, 1))).toThrow()
    expect(() => inspectTar(rawTar([{ name: "package/dist/large.js", size: 8192, contents: "short" }]))).toThrow()
  })

  it("requires two zero terminator blocks and rejects hidden records after them", () => {
    expect(() => inspectTar(rawTar(validEntries, Buffer.alloc(0)))).toThrow()
    expect(() => inspectTar(rawTar(validEntries, Buffer.alloc(512)))).toThrow()
    expect(() => inspectTar(Buffer.concat([rawTar(validEntries), tarEntry({ name: "package/dist/hidden.js", contents: "hidden" })]))).toThrow()
  })

  it("extracts a safe gzip archive only into a fresh destination", () => {
    const root = temporaryDirectory()
    const destination = path.join(root, "extracted")
    extractSafeTar(tarball(validEntries), destination)
    expect(readFileSync(path.join(destination, "package/dist/index.html"), "utf8")).toBe(validEntries[1].contents)
    expect(() => extractSafeTar(tarball(validEntries), destination)).toThrow()
    expect(readFileSync(path.join(destination, "package/package.json"), "utf8")).toBe(validEntries[0].contents)
  })

  it("will not write through an existing destination symlink", () => {
    const root = temporaryDirectory()
    const outside = path.join(root, "outside")
    const destination = path.join(root, "extracted")
    mkdirSync(outside)
    symlinkSync(outside, destination)
    expect(() => extractSafeTar(tarball(validEntries), destination)).toThrow()
    expect(readdirSync(outside)).toEqual([])
  })

  it("validates the entire archive before writing its first member", () => {
    const root = temporaryDirectory()
    const destination = path.join(root, "extracted")
    expect(() => extractSafeTar(tarball([...validEntries, { name: "../escaped", contents: "unsafe" }]), destination)).toThrow()
    expect(existsSync(destination)).toBe(false)
    expect(existsSync(path.join(root, "escaped"))).toBe(false)
  })

  it("rejects corrupt gzip bytes and oversized decompressed archives", () => {
    const root = temporaryDirectory()
    const destination = path.join(root, "extracted")
    expect(() => extractSafeTar(Buffer.from("not gzip"), destination)).toThrow()
    expect(() => extractSafeTar(gzipSync(Buffer.alloc(50 * 1024 * 1024 + 1)), destination)).toThrow()
    expect(existsSync(destination)).toBe(false)
  })
})

const originalPublicationFixture = () => {
  const record = recordFixture()
  return {
    record,
    run: structuredClone(record.originalRun),
    attempt: structuredClone(record.originalRun),
    jobs: structuredClone(record.originalJobs),
    artifacts: {
      total_count: 8,
      artifacts: [
        ...record.artifacts.map((artifact) => ({ ...structuredClone(artifact), expired: false })),
        ...Array.from({ length: 5 }, (_, index) => ({ id: 100 + index, name: `other-browser-evidence-${index}` })),
      ],
    },
    now: new Date("2026-10-12T10:10:00Z"),
  }
}
const verifyOriginalFixture = ({ record, run, attempt, jobs, artifacts, now }) =>
  verifyOriginalPublication(record, run, attempt, jobs, artifacts, now)
const publishJob = (fixture) => fixture.jobs.jobs.find((job) => job.name === "Pack, publish, and verify registry artifact")
const publishStep = (fixture, name) => publishJob(fixture).steps.find((step) => step.name === name)

describe("fresh original Actions evidence", () => {
  it("accepts the exact original attempt with only its registry round-trip failure", () => {
    expect(() => verifyOriginalFixture(originalPublicationFixture())).not.toThrow()
  })

  it.each([
    ["id", 1],
    ["run_attempt", 2],
    ["head_sha", "f".repeat(40)],
    ["head_branch", "other"],
    ["path", ".github/workflows/ci.yml"],
    ["event", "push"],
    ["status", "in_progress"],
    ["conclusion", "success"],
  ])("rejects a latest run with wrong %s", (key, value) => {
    const sample = originalPublicationFixture()
    sample.run[key] = value
    expect(() => verifyOriginalFixture(sample)).toThrow()
  })

  it.each([
    ["run_attempt", 2],
    ["head_sha", "f".repeat(40)],
    ["conclusion", "cancelled"],
  ])("rejects conflicting attempt-specific %s", (key, value) => {
    const sample = originalPublicationFixture()
    sample.attempt[key] = value
    expect(() => verifyOriginalFixture(sample)).toThrow()
  })

  it.each([
    "Validate publication request",
    "Node 22 release artifact",
    "Node 24 release artifact",
    "Real Bamboo / Node 22 release artifact",
  ])("rejects an unsuccessful earlier %s job", (name) => {
    const sample = originalPublicationFixture()
    sample.jobs.jobs.find((job) => job.name === name).conclusion = "failure"
    expect(() => verifyOriginalFixture(sample)).toThrow()
  })

  it.each([
    "Build and verify the final package tree",
    "Verify the exact local tarball",
    "Require the final tarball to match both real browser surfaces",
    "Recheck the immutable source tag before publication",
    "Publish the exact verified tarball with provenance",
    "Wait for the immutable registry version",
  ])("rejects a failure before registry verification: %s", (name) => {
    const sample = originalPublicationFixture()
    publishStep(sample, name).conclusion = "failure"
    expect(() => verifyOriginalFixture(sample)).toThrow()
  })

  it.each(["success", "skipped", "cancelled"])(
    "rejects registry-round-trip conclusion %s",
    (conclusion) => {
      const sample = originalPublicationFixture()
      publishStep(sample, "Download and verify the registry copy").conclusion = conclusion
      expect(() => verifyOriginalFixture(sample)).toThrow()
    },
  )

  it("rejects truncated job and artifact API pages", () => {
    const jobs = originalPublicationFixture()
    jobs.jobs.total_count += 1
    expect(() => verifyOriginalFixture(jobs)).toThrow()
    const artifacts = originalPublicationFixture()
    artifacts.artifacts.total_count += 1
    expect(() => verifyOriginalFixture(artifacts)).toThrow()
  })

  it("rejects a missing or ambiguous required job", () => {
    const missing = originalPublicationFixture()
    missing.jobs.jobs.splice(1, 1)
    missing.jobs.total_count = missing.jobs.jobs.length
    expect(() => verifyOriginalFixture(missing)).toThrow()
    const duplicate = originalPublicationFixture()
    duplicate.jobs.jobs.push(structuredClone(duplicate.jobs.jobs[1]))
    duplicate.jobs.total_count = duplicate.jobs.jobs.length
    expect(() => verifyOriginalFixture(duplicate)).toThrow()
  })

  it("rejects missing, duplicate, renumbered, or reordered required steps", () => {
    for (const mutation of [
      (steps, index) => steps.splice(index, 1),
      (steps, index) => steps.push(structuredClone(steps[index])),
      (steps, index) => { steps[index].number += 1 },
      (steps, index) => { [steps[index - 1], steps[index]] = [steps[index], steps[index - 1]] },
    ]) {
      const sample = originalPublicationFixture()
      const steps = publishJob(sample).steps
      const index = steps.findIndex((step) => step.name === "Publish the exact verified tarball with provenance")
      mutation(steps, index)
      expect(() => verifyOriginalFixture(sample)).toThrow()
    }
  })

  it("rejects a job from another controller, run, or attempt", () => {
    for (const [key, value] of [["head_sha", "f".repeat(40)], ["run_id", 1], ["run_attempt", 2]]) {
      const sample = originalPublicationFixture()
      sample.jobs.jobs[0][key] = value
      expect(() => verifyOriginalFixture(sample)).toThrow()
    }
  })

  it("rejects an original receipt step that was run rather than skipped", () => {
    const sample = originalPublicationFixture()
    publishStep(sample, "Record the verified publication source receipt").conclusion = "success"
    expect(() => verifyOriginalFixture(sample)).toThrow()
  })

  it.each([
    ["expired", true],
    ["expires_at", "2026-10-12T09:00:00Z"],
    ["expires_at", "not-a-date"],
    ["digest", `sha256:${"f".repeat(64)}`],
    ["id", 1],
    ["name", "other-artifact"],
    ["size_in_bytes", 1],
  ])("rejects expired or mismatched original artifact %s", (key, value) => {
    const sample = originalPublicationFixture()
    sample.artifacts.artifacts[0][key] = value
    expect(() => verifyOriginalFixture(sample)).toThrow()
  })

  it("rejects an artifact bound to another publication run or source", () => {
    for (const [key, value] of [["id", 1], ["head_sha", "f".repeat(40)], ["head_branch", "other"]]) {
      const sample = originalPublicationFixture()
      sample.artifacts.artifacts[0].workflow_run[key] = value
      expect(() => verifyOriginalFixture(sample)).toThrow()
    }
  })

  it("rejects missing, duplicate, or already-issued publication receipts", () => {
    const missing = originalPublicationFixture()
    missing.artifacts.artifacts.pop()
    missing.artifacts.total_count -= 1
    expect(() => verifyOriginalFixture(missing)).toThrow()
    const duplicate = originalPublicationFixture()
    duplicate.artifacts.artifacts.push(structuredClone(duplicate.artifacts.artifacts[0]))
    duplicate.artifacts.total_count += 1
    expect(() => verifyOriginalFixture(duplicate)).toThrow()
    for (const name of ["publication-source-receipt", "publication-recovery-receipt"]) {
      const existing = originalPublicationFixture()
      existing.artifacts.artifacts[3] = { ...structuredClone(existing.artifacts.artifacts[0]), id: 1, name }
      expect(() => verifyOriginalFixture(existing)).toThrow()
    }
  })
})

describe("registry recovery workflow authority", () => {
  it("is verification-only, manually dispatched, and has no publication credentials", () => {
    const workflow = readRepositoryBytes(".github/workflows/verify-published-npm.yml").toString()
    expect(workflow).toContain("workflow_dispatch:")
    expect(workflow).toContain("contents: read")
    expect(workflow).not.toMatch(/actions:\s*write/)
    expect(workflow).not.toMatch(/\b(?:contents|actions|packages|id-token):\s*write/)
    expect(workflow).not.toMatch(/NPM_TOKEN|NODE_AUTH_TOKEN|secrets\./)
    expect(workflow).not.toMatch(/\bnpm\s+(?:publish|pack|version)\b|npm run (?:build|verify)\b/)
    expect(workflow).not.toMatch(/\bgit\s+(?:push|tag|commit)\b/)
    expect(workflow).toContain("persist-credentials: false")
    expect(workflow).toContain("node scripts/verify-published-npm.mjs")
  })

  it("uploads a receipt only after verification succeeds and requires that file to exist", () => {
    const workflow = readRepositoryBytes(".github/workflows/verify-published-npm.yml").toString()
    const verify = workflow.indexOf("node scripts/verify-published-npm.mjs")
    const upload = workflow.indexOf("uses: actions/upload-artifact@")
    expect(verify).toBeGreaterThanOrEqual(0)
    expect(upload).toBeGreaterThan(verify)
    expect(workflow.slice(upload)).toContain("if-no-files-found: error")
    expect(workflow).not.toMatch(/if:\s*.*(?:always\(\)|!cancelled\(\))/)
  })
})

const recoveryEnvironment = () => ({
  GITHUB_REPOSITORY: "bigduu/lotus-next",
  DEFAULT_BRANCH: "main",
  GITHUB_EVENT_NAME: "workflow_dispatch",
  GITHUB_REF: "refs/heads/main",
  GITHUB_WORKFLOW_REF: "bigduu/lotus-next/.github/workflows/verify-published-npm.yml@refs/heads/main",
  GITHUB_SHA: "a".repeat(40),
  GITHUB_WORKFLOW_SHA: "a".repeat(40),
  GITHUB_RUN_ID: "40000000000",
  GITHUB_RUN_ATTEMPT: "1",
})
const contextGit = (environment, overrides = {}) => (args) => {
  const command = args.join(" ")
  if (Object.hasOwn(overrides, command)) return overrides[command]
  if (command === "rev-parse HEAD^{commit}") return environment.GITHUB_SHA
  if (command === "status --porcelain --untracked-files=all") return ""
  if (command === "ls-remote --exit-code origin refs/heads/main") return `${environment.GITHUB_SHA}\trefs/heads/main`
  if (args[0] === "diff") return "scripts/verify-published-npm.mjs\n.github/workflows/verify-published-npm.yml"
  throw new Error(`Unexpected test Git operation: ${command}`)
}

describe("recovery controller authority", () => {
  it("accepts only a clean current default-branch recovery controller", () => {
    const environment = recoveryEnvironment()
    expect(() => verifyRecoveryContext(environment, contextGit(environment))).not.toThrow()
  })

  it.each([
    ["GITHUB_REPOSITORY", "other/lotus-next"],
    ["DEFAULT_BRANCH", "other"],
    ["GITHUB_EVENT_NAME", "push"],
    ["GITHUB_REF", "refs/tags/lotus-next-v2026.10.12"],
    ["GITHUB_WORKFLOW_REF", "bigduu/lotus-next/.github/workflows/publish-npm.yml@refs/heads/main"],
    ["GITHUB_SHA", "not-a-sha"],
    ["GITHUB_WORKFLOW_SHA", "b".repeat(40)],
    ["GITHUB_RUN_ID", String(committedRecord.originalRun.id)],
    ["GITHUB_RUN_ID", "0"],
    ["GITHUB_RUN_ATTEMPT", "0"],
  ])("rejects wrong recovery context %s", (key, value) => {
    const environment = { ...recoveryEnvironment(), [key]: value }
    expect(() => verifyRecoveryContext(environment, contextGit(environment))).toThrow()
  })

  it.each([
    ["rev-parse HEAD^{commit}", "b".repeat(40)],
    ["status --porcelain --untracked-files=all", "?? unreviewed-file"],
    ["ls-remote --exit-code origin refs/heads/main", `${"b".repeat(40)}\trefs/heads/main`],
  ])("rejects stale or dirty controller check %s", (command, value) => {
    const environment = recoveryEnvironment()
    expect(() => verifyRecoveryContext(environment, contextGit(environment, { [command]: value }))).toThrow()
  })

  it.each([
    "src/app/App.tsx",
    ".github/workflows/publish-npm.yml",
    ".github/release-candidates.json",
    "scripts/release-source.mjs",
    "scripts/artifact-manifest.mjs",
    "scripts/release-acceptance-identity.mjs",
    "",
  ])("rejects unreviewed source or acceptance-control changes: %s", (changed) => {
    const environment = recoveryEnvironment()
    const git = contextGit(environment, { [`diff --name-only ${committedRecord.originalRun.head_sha} HEAD`]: changed })
    expect(() => verifyRecoveryContext(environment, git)).toThrow()
  })
})

const metadataFixture = (record) => ({
  name: "@bigduu/lotus-next",
  version: "2026.10.12",
  dist: {
    tarball: "https://registry.npmjs.org/@bigduu/lotus-next/-/lotus-next-2026.10.12.tgz",
    shasum: record.originalFinalPack.npmShasum,
    integrity: record.originalFinalPack.npmIntegrity,
    fileCount: record.originalFinalPack.fileCount,
    unpackedSize: record.independentlyObservedRegistry.unpackedSize,
    attestations: {
      url: "https://registry.npmjs.org/-/npm/v1/attestations/@bigduu%2flotus-next@2026.10.12",
      provenance: { predicateType: "https://slsa.dev/provenance/v1" },
    },
  },
})
const provenanceFixture = (record, mutate = () => {}) => {
  const statement = {
    _type: "https://in-toto.io/Statement/v1",
    predicateType: "https://slsa.dev/provenance/v1",
    subject: [{
      name: "pkg:npm/%40bigduu/lotus-next@2026.10.12",
      digest: { sha512: Buffer.from(record.originalFinalPack.npmIntegrity.slice(7), "base64").toString("hex") },
    }],
    predicate: {
      buildDefinition: {
        buildType: "https://slsa-framework.github.io/github-actions-buildtypes/workflow/v1",
        externalParameters: { workflow: {
          ref: "refs/heads/main", repository: "https://github.com/bigduu/lotus-next", path: ".github/workflows/publish-npm.yml",
        } },
        internalParameters: { github: {
          event_name: "workflow_dispatch", repository_id: "1281544268", repository_owner_id: "18681616",
        } },
        resolvedDependencies: [{
          uri: "git+https://github.com/bigduu/lotus-next@refs/heads/main",
          digest: { gitCommit: record.originalRun.head_sha },
        }],
      },
      runDetails: {
        builder: { id: "https://github.com/actions/runner/github-hosted" },
        metadata: { invocationId: `https://github.com/bigduu/lotus-next/actions/runs/${record.originalRun.id}/attempts/1` },
      },
    },
  }
  mutate(statement)
  return { attestations: [{
    predicateType: "https://slsa.dev/provenance/v1",
    bundle: { dsseEnvelope: {
      payloadType: "application/vnd.in-toto+json",
      payload: jsonBytes(statement).toString("base64"),
    } },
  }] }
}

const registryPackageFixture = () => {
  const root = temporaryDirectory()
  const distDirectory = path.join(root, "source-dist")
  mkdirSync(path.join(distDirectory, "assets"), { recursive: true })
  writeFileSync(path.join(distDirectory, "index.html"), '<!doctype html><script src="./assets/main.js"></script>\n')
  writeFileSync(path.join(distDirectory, "assets/main.js"), 'console.log("verified")\n')
  const manifest = buildArtifactManifest({
    distDirectory, packageVersion: committedRecord.version,
    sourceRevision: JSON.parse(committedRecord.rawEvidence.sourceReceipt.utf8).sourceSha, sourceDirty: false,
  })
  const manifestBytes = jsonBytes(manifest)
  const record = recordFixture()
  rewriteEvidence(record, "acceptedIdentity", (accepted) => {
    accepted.manifestSha256 = sha256(manifestBytes)
    accepted.resourcesSha256 = manifest.resourcesSha256
    accepted.resourceCount = manifest.resources.length
  })
  const entries = [
    { name: "package/LICENSE", contents: "MIT\n" },
    { name: "package/README.md", contents: "Lotus Next\n" },
    { name: "package/README.zh-CN.md", contents: "Lotus Next\n" },
    { name: "package/package.json", contents: jsonBytes({ name: "@bigduu/lotus-next", version: committedRecord.version }) },
    ...manifest.resources.map((resource) => ({ name: `package/dist/${resource.path}`, contents: readFileSync(path.join(distDirectory, resource.path)) })),
    { name: "package/dist/lotus-next-manifest.json", contents: manifestBytes },
  ]
  const sample = { root, distDirectory, record, entries, manifest }
  sample.repack = () => {
    sample.bytes = tarball(sample.entries)
    record.originalFinalPack.npmShasum = hash("sha1", sample.bytes)
    record.originalFinalPack.npmIntegrity = `sha512-${hash("sha512", sample.bytes, "base64")}`
    record.originalFinalPack.fileCount = sample.entries.length
    record.independentlyObservedRegistry.tarballSha256 = sha256(sample.bytes)
    record.independentlyObservedRegistry.unpackedSize = sample.entries.reduce((size, entry) => size + Buffer.byteLength(entry.contents), 0)
    sample.metadata = metadataFixture(record)
    sample.attestations = provenanceFixture(record)
  }
  sample.verify = (destination = path.join(root, "extracted")) =>
    verifyRegistryPackage(sample.bytes, sample.metadata, sample.attestations, record, destination)
  sample.repack()
  return sample
}

describe("registry identity and provenance", () => {
  it("binds registry metadata and bytes to all independently recorded digests", () => {
    const sample = registryPackageFixture()
    expect(verifyRegistryMetadata(sample.metadata, sample.record)).toEqual(sample.metadata.dist)
    expect(() => verifyRegistryBytes(sample.bytes, sample.record)).not.toThrow()
    expect(() => verifyRegistryBytes(Buffer.concat([sample.bytes, Buffer.from("changed")]), sample.record)).toThrow()
  })

  it.each([
    ["shasum", "f".repeat(40)],
    ["integrity", `sha512-${Buffer.alloc(64, 1).toString("base64")}`],
    ["fileCount", 1],
    ["unpackedSize", 1],
    ["tarball", "https://example.invalid/package.tgz"],
  ])("rejects registry metadata %s mismatch", (key, value) => {
    const record = recordFixture()
    const metadata = metadataFixture(record)
    metadata.dist[key] = value
    expect(() => verifyRegistryMetadata(metadata, record)).toThrow()
  })

  it("rejects a different package, version, or provenance destination", () => {
    for (const mutate of [
      (metadata) => { metadata.name = "@other/lotus-next" },
      (metadata) => { metadata.version = "2026.10.8" },
      (metadata) => { metadata.dist.attestations.url = "https://example.invalid/attestations" },
      (metadata) => { metadata.dist.attestations.provenance.predicateType = "https://slsa.dev/provenance/v0.2" },
    ]) {
      const record = recordFixture()
      const metadata = metadataFixture(record)
      mutate(metadata)
      expect(() => verifyRegistryMetadata(metadata, record)).toThrow()
    }
  })

  it.each(["npmShasum", "npmIntegrity", "tarballSha256"])("checks the actual tarball %s independently", (key) => {
    const sample = registryPackageFixture()
    if (key === "tarballSha256") sample.record.independentlyObservedRegistry[key] = "f".repeat(64)
    else sample.record.originalFinalPack[key] = key === "npmShasum" ? "f".repeat(40) : `sha512-${Buffer.alloc(64, 1).toString("base64")}`
    expect(() => verifyRegistryBytes(sample.bytes, sample.record)).toThrow()
  })

  it("binds the decoded SLSA payload without claiming signature verification", () => {
    const record = recordFixture()
    const attestations = provenanceFixture(record)
    const result = verifyProvenance(attestations, record)
    expect(result).toMatchObject({
      predicateType: "https://slsa.dev/provenance/v1",
      invocationId: `https://github.com/bigduu/lotus-next/actions/runs/${record.originalRun.id}/attempts/1`,
      workflowSha: record.originalRun.head_sha,
      cryptographicVerification: false,
    })
    expect(result.payloadSha256).toBe(sha256(Buffer.from(attestations.attestations[0].bundle.dsseEnvelope.payload, "base64")))
  })

  it.each([
    ["statement type", (statement) => { statement._type = "https://in-toto.io/Statement/v0.1" }],
    ["subject name", (statement) => { statement.subject[0].name = "pkg:npm/other@1.0.0" }],
    ["subject digest", (statement) => { statement.subject[0].digest.sha512 = "f".repeat(128) }],
    ["extra subject", (statement) => { statement.subject.push(structuredClone(statement.subject[0])) }],
    ["workflow ref", (statement) => { statement.predicate.buildDefinition.externalParameters.workflow.ref = "refs/heads/other" }],
    ["workflow path", (statement) => { statement.predicate.buildDefinition.externalParameters.workflow.path = ".github/workflows/verify-published-npm.yml" }],
    ["workflow repository", (statement) => { statement.predicate.buildDefinition.externalParameters.workflow.repository = "https://github.com/other/lotus-next" }],
    ["event", (statement) => { statement.predicate.buildDefinition.internalParameters.github.event_name = "push" }],
    ["repository id", (statement) => { statement.predicate.buildDefinition.internalParameters.github.repository_id = "1" }],
    ["owner id", (statement) => { statement.predicate.buildDefinition.internalParameters.github.repository_owner_id = "1" }],
    ["controller", (statement) => { statement.predicate.buildDefinition.resolvedDependencies[0].digest.gitCommit = "f".repeat(40) }],
    ["builder", (statement) => { statement.predicate.runDetails.builder.id = "https://example.invalid/builder" }],
    ["run", (statement) => { statement.predicate.runDetails.metadata.invocationId = "https://github.com/bigduu/lotus-next/actions/runs/1/attempts/1" }],
    ["attempt", (statement) => { statement.predicate.runDetails.metadata.invocationId = `https://github.com/bigduu/lotus-next/actions/runs/${committedRecord.originalRun.id}/attempts/2` }],
  ])("rejects mismatched provenance %s", (_label, mutate) => {
    const record = recordFixture()
    expect(() => verifyProvenance(provenanceFixture(record, mutate), record)).toThrow()
  })

  it("rejects missing or ambiguous provenance and malformed DSSE payloads", () => {
    const record = recordFixture()
    expect(() => verifyProvenance({ attestations: [] }, record)).toThrow()
    const duplicate = provenanceFixture(record)
    duplicate.attestations.push(structuredClone(duplicate.attestations[0]))
    expect(() => verifyProvenance(duplicate, record)).toThrow()
    for (const payload of ["not base64!", Buffer.from("not JSON").toString("base64")]) {
      const invalid = provenanceFixture(record)
      invalid.attestations[0].bundle.dsseEnvelope.payload = payload
      expect(() => verifyProvenance(invalid, record)).toThrow()
    }
    const wrongType = provenanceFixture(record)
    wrongType.attestations[0].bundle.dsseEnvelope.payloadType = "application/json"
    expect(() => verifyProvenance(wrongType, record)).toThrow()
  })
})

describe("extracted registry package", () => {
  it("verifies a synthetic package against its original browser acceptance manifest", () => {
    const sample = registryPackageFixture()
    expect(sample.verify()).toMatchObject({
      packageName: "@bigduu/lotus-next", packageVersion: committedRecord.version,
      sourceRevision: sample.manifest.sourceRevision, sourceDirty: false,
      npmShasum: sample.record.originalFinalPack.npmShasum,
      npmIntegrity: sample.record.originalFinalPack.npmIntegrity,
      tarballSha256: sha256(sample.bytes), manifestSha256: sha256(jsonBytes(sample.manifest)),
      resourcesSha256: sample.manifest.resourcesSha256, resourceCount: 2,
      fileCount: sample.entries.length,
    })
  })

  it.each(["name", "version"])("rejects package.json %s drift even with matching archive hashes", (key) => {
    const sample = registryPackageFixture()
    const entry = sample.entries.find((file) => file.name === "package/package.json")
    const document = JSON.parse(entry.contents)
    document[key] = key === "name" ? "@other/lotus-next" : "2026.10.8"
    entry.contents = jsonBytes(document)
    sample.repack()
    expect(() => sample.verify()).toThrow()
  })

  it.each(["sourceRevision", "sourceDirty", "packageVersion"])("rejects manifest %s drift", (key) => {
    const sample = registryPackageFixture()
    const entry = sample.entries.find((file) => file.name === "package/dist/lotus-next-manifest.json")
    const manifest = JSON.parse(entry.contents)
    manifest[key] = key === "sourceDirty" ? true : key === "packageVersion" ? "2026.10.8" : "f".repeat(40)
    entry.contents = jsonBytes(manifest)
    sample.repack()
    expect(() => sample.verify()).toThrow()
  })

  it("rejects changed resource bytes even after archive hashes are updated", () => {
    const sample = registryPackageFixture()
    sample.entries.find((file) => file.name === "package/dist/assets/main.js").contents = "tampered\n"
    sample.repack()
    expect(() => sample.verify()).toThrow(/size|digest/)
  })

  it("rejects an internally valid rebuilt artifact that differs from browser acceptance", () => {
    const sample = registryPackageFixture()
    writeFileSync(path.join(sample.distDirectory, "assets/main.js"), "changed after acceptance\n")
    const rebuilt = buildArtifactManifest({
      distDirectory: sample.distDirectory, packageVersion: committedRecord.version,
      sourceRevision: sample.manifest.sourceRevision, sourceDirty: false,
    })
    sample.entries.find((file) => file.name === "package/dist/assets/main.js").contents = readFileSync(path.join(sample.distDirectory, "assets/main.js"))
    sample.entries.find((file) => file.name === "package/dist/lotus-next-manifest.json").contents = jsonBytes(rebuilt)
    sample.repack()
    expect(() => sample.verify()).toThrow(/accepted browser artifact/)
  })

  it("rejects extra package paths and missing required metadata files", () => {
    const extra = registryPackageFixture()
    extra.entries.push({ name: "package/scripts/install.js", contents: "unsafe\n" })
    extra.repack()
    expect(() => extra.verify()).toThrow(/Unexpected package file/)
    const missing = registryPackageFixture()
    missing.entries = missing.entries.filter((entry) => entry.name !== "package/LICENSE")
    missing.repack()
    expect(() => missing.verify()).toThrow(/Missing package file/)
  })
})

const npmPackFixture = (sample) => [{
  id: "@bigduu/lotus-next@2026.10.12",
  name: "@bigduu/lotus-next",
  version: "2026.10.12",
  filename: "bigduu-lotus-next-2026.10.12.tgz",
  shasum: sample.metadata.dist.shasum,
  integrity: sample.metadata.dist.integrity,
  size: sample.bytes.length,
  entryCount: sample.entries.length,
  unpackedSize: sample.metadata.dist.unpackedSize,
  bundled: [],
  files: sample.entries.map((entry) => ({ path: entry.name.slice("package/".length), size: Buffer.byteLength(entry.contents) })),
}]

describe("fresh npm pack result", () => {
  it("binds the reported pack result to the complete downloaded tar inventory", () => {
    const sample = registryPackageFixture()
    const packed = npmPackFixture(sample)
    expect(() => verifyNpmPackResult(packed, sample.metadata, sample.bytes)).not.toThrow()
    packed[0].files.reverse()
    expect(() => verifyNpmPackResult(packed, sample.metadata, sample.bytes)).not.toThrow()
  })

  it.each([
    ["id", "@other/lotus-next@2026.10.12"],
    ["name", "@other/lotus-next"],
    ["version", "2026.10.8"],
    ["filename", "../outside.tgz"],
    ["shasum", "f".repeat(40)],
    ["integrity", "sha512-wrong"],
    ["size", 1],
    ["entryCount", 1],
    ["unpackedSize", 1],
    ["bundled", ["unexpected-dependency"]],
  ])("rejects mismatched npm pack %s", (key, value) => {
    const sample = registryPackageFixture()
    const packed = npmPackFixture(sample)
    packed[0][key] = value
    expect(() => verifyNpmPackResult(packed, sample.metadata, sample.bytes)).toThrow()
  })

  it("rejects missing, duplicate, renamed, and wrong-size inventory entries", () => {
    for (const mutate of [
      (files) => files.pop(),
      (files) => files.push(structuredClone(files[0])),
      (files) => { files[0].path = "dist/unreported.js" },
      (files) => { files[0].size += 1 },
    ]) {
      const sample = registryPackageFixture()
      const packed = npmPackFixture(sample)
      mutate(packed[0].files)
      expect(() => verifyNpmPackResult(packed, sample.metadata, sample.bytes)).toThrow()
    }
  })

  it("requires exactly one reported package", () => {
    const sample = registryPackageFixture()
    expect(() => verifyNpmPackResult([], sample.metadata, sample.bytes)).toThrow()
    expect(() => verifyNpmPackResult([...npmPackFixture(sample), ...npmPackFixture(sample)], sample.metadata, sample.bytes)).toThrow()
  })
})

const integrationFixture = () => {
  const root = temporaryDirectory()
  const environment = {
    ...recoveryEnvironment(),
    RUNNER_TEMP: root,
    RECOVERY_RECEIPT_PATH: path.join(root, "publication-recovery-receipt.json"),
    NPM_TOKEN: "synthetic-secret-must-not-be-forwarded",
    NODE_AUTH_TOKEN: "synthetic-auth-must-not-be-forwarded",
    GITHUB_TOKEN: "synthetic-token-must-not-be-forwarded",
    NPM_CONFIG_REGISTRY: "https://example.invalid/registry",
    NODE_OPTIONS: "--require=untrusted-hook",
  }
  const original = originalPublicationFixture()
  const record = original.record
  const source = JSON.parse(record.rawEvidence.sourceReceipt.utf8)
  const historicalBamboo = JSON.parse(candidateBytes).candidates[record.version].bambooSha
  // These git-show results belong to the recovered source, not today's checkout.
  // Keep its source-bound pins stable when a later release changes the pairing.
  const sourceFiles = new Map([
    [".github/workflows/ci.yml", `BAMBOO_E2E_REVISION: ${historicalBamboo}`],
    [".github/workflows/publish-npm.yml", readRepositoryBytes(".github/workflows/publish-npm.yml").toString()],
    ["e2e/support/realBambooRuntime.ts", `export const REAL_BAMBOO_REVISION = "${historicalBamboo}";`],
    ["scripts/published-real-bamboo-acceptance.test.mjs", `const expectedBambooRevision = "${historicalBamboo}"`],
  ])
  const api = `https://api.github.com/repos/bigduu/lotus-next/actions/runs/${record.originalRun.id}`
  const metadataUrl = "https://registry.npmjs.org/@bigduu%2flotus-next/2026.10.12"
  const attestationUrl = "https://registry.npmjs.org/-/npm/v1/attestations/@bigduu%2flotus-next@2026.10.12"
  const responses = new Map([
    [api, original.run],
    [`${api}/attempts/1`, original.attempt],
    [`${api}/attempts/1/jobs?per_page=100`, original.jobs],
    [`${api}/artifacts?per_page=100`, original.artifacts],
    [metadataUrl, metadataFixture(record)],
    [attestationUrl, provenanceFixture(record)],
  ])
  const sample = { root, environment, original, record, source, sourceFiles, api, metadataUrl, attestationUrl, responses, gitOverrides: {}, responseOverrides: new Map() }
  sample.fetchImpl = vi.fn(async (url, options) => {
    expect(options.method).toBe("GET")
    expect(options.redirect).toBe("error")
    expect(options.headers).toEqual({ accept: "application/json" })
    expect(responses.has(url)).toBe(true)
    const response = { status: 200, headers: { get: () => null }, arrayBuffer: async () => jsonBytes(responses.get(url)) }
    return { ...response, ...sample.responseOverrides.get(url) }
  })
  sample.exec = vi.fn((command, args, options) => {
    if (command === "npm") {
      const fake = registryPackageFixture()
      const destination = args[args.indexOf("--pack-destination") + 1]
      writeFileSync(path.join(destination, record.originalFinalPack.filename), fake.bytes)
      return JSON.stringify(npmPackFixture(fake))
    }
    expect(command).toBe("git")
    expect(options.cwd).toBe(process.cwd())
    const key = args.join(" ")
    if (Object.hasOwn(sample.gitOverrides, key)) return sample.gitOverrides[key]
    if (args[0] === "fetch") return ""
    if (key === "cat-file -t FETCH_HEAD") return "tag"
    if (key === "rev-parse FETCH_HEAD") return source.tagObjectSha
    if (key === "rev-parse FETCH_HEAD^{commit}") return source.sourceSha
    if (key === `rev-parse ${source.sourceSha}^{tree}` || key === `rev-parse ${source.productMergeSha}^{tree}`) return source.sourceTree
    if (args[0] === "show") {
      const [revision, file] = args[1].split(":")
      expect(revision).toBe(source.sourceSha)
      expect(sourceFiles.has(file)).toBe(true)
      return sourceFiles.get(file)
    }
    if (key === `ls-remote --exit-code origin ${source.sourceRef} ${source.sourceRef}^{}`) {
      return `${source.tagObjectSha}\t${source.sourceRef}\n${source.sourceSha}\t${source.sourceRef}^{}`
    }
    return contextGit(environment)(args)
  })
  sample.verify = () => verifyPublishedNpm({ environment, cwd: process.cwd(), fetchImpl: sample.fetchImpl, exec: sample.exec, now: () => original.now })
  return sample
}

describe("fail-closed recovery orchestration", () => {
  it("writes no receipt for an invalid recovery controller", async () => {
    const sample = integrationFixture()
    sample.environment.GITHUB_WORKFLOW_SHA = "b".repeat(40)
    await expect(sample.verify()).rejects.toThrow()
    expect(sample.fetchImpl).not.toHaveBeenCalled()
    expect(existsSync(sample.environment.RECOVERY_RECEIPT_PATH)).toBe(false)
  })

  it.each([
    ["cat-file -t FETCH_HEAD", "commit"],
    ["rev-parse FETCH_HEAD", "f".repeat(40)],
    ["rev-parse FETCH_HEAD^{commit}", "f".repeat(40)],
  ])("writes no receipt for wrong immutable tag check %s", async (command, value) => {
    const sample = integrationFixture()
    sample.gitOverrides[command] = value
    await expect(sample.verify()).rejects.toThrow()
    expect(sample.fetchImpl).not.toHaveBeenCalled()
    expect(existsSync(sample.environment.RECOVERY_RECEIPT_PATH)).toBe(false)
  })

  it("writes no receipt after an original acceptance gate failure", async () => {
    const sample = integrationFixture()
    sample.original.jobs.jobs[1].conclusion = "failure"
    await expect(sample.verify()).rejects.toThrow()
    expect(sample.fetchImpl).toHaveBeenCalledTimes(4)
    expect(sample.exec.mock.calls.some(([command]) => command === "npm")).toBe(false)
    expect(existsSync(sample.environment.RECOVERY_RECEIPT_PATH)).toBe(false)
  })

  it.each([
    [".github/workflows/ci.yml", `BAMBOO_E2E_REVISION: ${"f".repeat(40)}`],
    [".github/workflows/publish-npm.yml", `BAMBOO_E2E_REVISION: ${"f".repeat(40)}`],
    ["e2e/support/realBambooRuntime.ts", `export const REAL_BAMBOO_REVISION = "${"f".repeat(40)}";`],
    ["scripts/published-real-bamboo-acceptance.test.mjs", `const expectedBambooRevision = "${"f".repeat(40)}"`],
  ])("rejects a different backend in recovered source %s before public evidence or npm", async (file, contents) => {
    const sample = integrationFixture()
    sample.sourceFiles.set(file, contents)
    await expect(sample.verify()).rejects.toThrow()
    expect(sample.fetchImpl).not.toHaveBeenCalled()
    expect(sample.exec.mock.calls.some(([command]) => command === "npm")).toBe(false)
    expect(existsSync(sample.environment.RECOVERY_RECEIPT_PATH)).toBe(false)
  })

  it.each([
    ["HTTP failure", { status: 503 }],
    ["pagination", { headers: { get: () => '<https://api.github.com/next>; rel="next"' } }],
    ["invalid JSON", { arrayBuffer: async () => Buffer.from("not JSON") }],
    ["oversized response", { arrayBuffer: async () => Buffer.alloc(4 * 1024 * 1024 + 1, 32) }],
  ])("writes no receipt on public-evidence %s", async (_name, response) => {
    const sample = integrationFixture()
    sample.responseOverrides.set(sample.api, response)
    await expect(sample.verify()).rejects.toThrow()
    expect(existsSync(sample.environment.RECOVERY_RECEIPT_PATH)).toBe(false)
    expect(sample.exec.mock.calls.some(([command]) => command === "npm")).toBe(false)
  })

  it("writes no receipt for registry metadata or provenance mismatches", async () => {
    for (const target of ["metadata", "provenance"]) {
      const sample = integrationFixture()
      if (target === "metadata") sample.responses.get(sample.metadataUrl).dist.shasum = "f".repeat(40)
      else sample.responses.set(sample.attestationUrl, provenanceFixture(sample.record, (statement) => {
        statement.predicate.runDetails.metadata.invocationId += "0"
      }))
      await expect(sample.verify()).rejects.toThrow()
      expect(existsSync(sample.environment.RECOVERY_RECEIPT_PATH)).toBe(false)
      expect(sample.exec.mock.calls.some(([command]) => command === "npm")).toBe(false)
    }
  })

  it("uses a fresh online read-only pack with stripped credentials and writes no receipt for wrong bytes", async () => {
    const sample = integrationFixture()
    await expect(sample.verify()).rejects.toThrow()
    const npmCalls = sample.exec.mock.calls.filter(([command]) => command === "npm")
    expect(npmCalls).toHaveLength(1)
    const [, args, options] = npmCalls[0]
    expect(args.slice(0, 2)).toEqual(["pack", "@bigduu/lotus-next@2026.10.12"])
    expect(args).toContain("--ignore-scripts")
    expect(args).toContain("--prefer-online")
    expect(args).toContain("--registry=https://registry.npmjs.org/")
    const cache = args.find((argument) => argument.startsWith("--cache="))?.slice("--cache=".length)
    expect(cache).toBeDefined()
    expect(existsSync(cache)).toBe(false)
    for (const key of ["NPM_TOKEN", "NODE_AUTH_TOKEN", "GITHUB_TOKEN", "NPM_CONFIG_REGISTRY", "NODE_OPTIONS"]) {
      expect(options.env).not.toHaveProperty(key)
    }
    expect(options.env.NPM_CONFIG_IGNORE_SCRIPTS).toBe("true")
    expect(readFileSync(options.env.NPM_CONFIG_USERCONFIG, "utf8")).toBe("")
    expect(readFileSync(options.env.NPM_CONFIG_GLOBALCONFIG, "utf8")).toBe("")
    expect(options.env.NPM_CONFIG_GLOBALCONFIG).not.toBe(options.env.NPM_CONFIG_USERCONFIG)
    expect(sample.exec.mock.calls.some(([, operation]) => operation.includes("publish"))).toBe(false)
    expect(existsSync(sample.environment.RECOVERY_RECEIPT_PATH)).toBe(false)
  })

  it("does not overwrite a pre-existing receipt or write outside the runner temporary directory", async () => {
    const existing = integrationFixture()
    writeFileSync(existing.environment.RECOVERY_RECEIPT_PATH, "preserve existing evidence\n")
    await expect(existing.verify()).rejects.toThrow()
    expect(readFileSync(existing.environment.RECOVERY_RECEIPT_PATH, "utf8")).toBe("preserve existing evidence\n")
    expect(existing.fetchImpl).not.toHaveBeenCalled()
    const outside = integrationFixture()
    outside.environment.RECOVERY_RECEIPT_PATH = path.join(outside.root, "..", "outside-recovery-receipt.json")
    await expect(outside.verify()).rejects.toThrow()
    expect(existsSync(outside.environment.RECOVERY_RECEIPT_PATH)).toBe(false)
    expect(outside.fetchImpl).not.toHaveBeenCalled()
  })
})

describe("separate recovery receipt", () => {
  it("preserves the failed original publication and separately identifies the verifier run", () => {
    const sample = registryPackageFixture()
    const record = recordFixture()
    const environment = recoveryEnvironment()
    const originalPublication = verifyOriginalFixture(originalPublicationFixture())
    const registryIdentity = sample.verify()
    const evidence = { registryMetadataSha256: sha256(jsonBytes(sample.metadata)), attestationsSha256: sha256(jsonBytes(sample.attestations)) }
    const verifiedAt = "2026-10-12T10:10:00.000Z"
    const receipt = createRecoveryReceipt({ record, recordBytes: committedRecordBytes, environment, registryIdentity, evidence, originalPublication, verifiedAt })
    expect(receipt).toMatchObject({
      schemaVersion: 2,
      kind: "registry-verification-recovery",
      repository: "bigduu/lotus-next",
      version: "2026.10.12",
      sourceReceipt: JSON.parse(record.rawEvidence.sourceReceipt.utf8),
      originalPublication: { runId: String(record.originalRun.id), runAttempt: "1", conclusion: "failure", workflowSha: record.originalRun.head_sha },
      verification: {
        workflowRef: environment.GITHUB_WORKFLOW_REF,
        workflowSha: environment.GITHUB_SHA,
        runId: environment.GITHUB_RUN_ID,
        runAttempt: environment.GITHUB_RUN_ATTEMPT,
        verifiedAt,
        operation: "read-only-registry-verification",
      },
      registryIdentity,
      evidence: { ...evidence, recordSha256: sha256(committedRecordBytes) },
    })
    expect(receipt.sourceReceipt.runId).not.toBe(receipt.verification.runId)
    expect(receipt.sourceReceipt.workflowSha).not.toBe(receipt.verification.workflowSha)
    expect(receipt.originalPublication.failureStep.errorCode).toBe("ETARGET")
    expect(receipt.registryIdentity.provenance.cryptographicVerification).toBe(false)
    expect(receipt.evidence.originalArtifacts).toEqual(record.artifacts.map(({ id, name, digest }) => ({ id, name, digest })))
  })
})
