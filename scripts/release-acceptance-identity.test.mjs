import { createHash } from "node:crypto"
import { spawnSync } from "node:child_process"
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import { buildArtifactManifest } from "./artifact-manifest.mjs"
import {
  ACCEPTED_IDENTITY_KEYS,
  acceptedIdentityFromArtifact,
  verifyFinalPackAgainstAccepted,
  writeAcceptedIdentity,
} from "./release-acceptance-identity.mjs"

const revision = "0123456789abcdef0123456789abcdef01234567"
const version = "2026.9.24"
const temporaryDirectories = []
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex")

const fixture = () => {
  const root = mkdtempSync(path.join(tmpdir(), "lotus-accepted-browser-"))
  temporaryDirectories.push(root)
  const distDirectory = path.join(root, "package", "dist")
  mkdirSync(path.join(distDirectory, "assets"), { recursive: true })
  writeFileSync(path.join(distDirectory, "index.html"), "<!doctype html><title>Accepted browser</title>\n")
  writeFileSync(path.join(distDirectory, "assets", "browser.js"), "export const accepted = true\n")
  const writeManifest = () => {
    const manifest = buildArtifactManifest({
      distDirectory,
      packageVersion: version,
      sourceRevision: revision,
      sourceDirty: false,
    })
    const bytes = `${JSON.stringify(manifest, null, 2)}\n`
    writeFileSync(path.join(distDirectory, "lotus-next-manifest.json"), bytes)
    return { manifest, manifestSha256: sha256(bytes) }
  }
  const { manifest, manifestSha256 } = writeManifest()
  const artifactIdentity = {
    registry: "local-pack",
    packageName: "@bigduu/lotus-next",
    packageVersion: version,
    sourceRevision: revision,
    sourceDirty: false,
    entrypoint: "index.html",
    manifestSha256,
    resourcesSha256: manifest.resourcesSha256,
    resourceCount: manifest.resources.length,
  }
  const acceptedPath = path.join(root, "accepted-identity.json")
  return { root, distDirectory, acceptedPath, artifactIdentity, writeManifest }
}

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("release browser acceptance identity", () => {
  it("records exactly the successful current-source resource identity and accepts the same final pack", () => {
    const sample = fixture()
    const accepted = writeAcceptedIdentity(sample.acceptedPath, sample.artifactIdentity)
    expect(Object.keys(accepted)).toEqual(ACCEPTED_IDENTITY_KEYS)
    expect(readFileSync(sample.acceptedPath, "utf8")).toBe(`${JSON.stringify(accepted, null, 2)}\n`)
    expect(verifyFinalPackAgainstAccepted({
      acceptedPath: sample.acceptedPath,
      distDirectory: sample.distDirectory,
      expectedRevision: revision,
      expectedVersion: version,
    })).toEqual(accepted)
    expect(() => writeAcceptedIdentity(sample.acceptedPath, sample.artifactIdentity)).toThrow()
  })

  it("checks the final package through the same CLI used by the publish workflow", () => {
    const sample = fixture()
    writeAcceptedIdentity(sample.acceptedPath, sample.artifactIdentity)
    const command = [
      path.resolve(process.cwd(), "scripts", "release-acceptance-identity.mjs"),
      "verify",
      "--accepted", sample.acceptedPath,
      "--dist", sample.distDirectory,
      "--expected-version", version,
      "--expected-revision", revision,
    ]
    const accepted = spawnSync(process.execPath, command, { encoding: "utf8" })
    expect(accepted.status).toBe(0)
    expect(accepted.stdout).toContain("Final npm tarball matches both real-Bamboo browser surfaces")

    writeFileSync(path.join(sample.distDirectory, "assets", "browser.js"), "changed bytes\n")
    const rejected = spawnSync(process.execPath, command, { encoding: "utf8" })
    expect(rejected.status).toBe(1)
    expect(rejected.stderr).toMatch(/does not match its declared size and digest/)
  })

  it("blocks publication when Node 24 creates a different but internally valid page", () => {
    const sample = fixture()
    writeAcceptedIdentity(sample.acceptedPath, sample.artifactIdentity)
    writeFileSync(path.join(sample.distDirectory, "assets", "browser.js"), "export const accepted = false\n")
    sample.writeManifest()
    expect(() => verifyFinalPackAgainstAccepted({
      acceptedPath: sample.acceptedPath,
      distDirectory: sample.distDirectory,
      expectedRevision: revision,
      expectedVersion: version,
    })).toThrow(/differs from the real-Bamboo accepted browser artifact/)
  })

  it("rejects a different source, dirty acceptance, or altered resource bytes", () => {
    const sample = fixture()
    expect(() => acceptedIdentityFromArtifact({ ...sample.artifactIdentity, sourceDirty: true })).toThrow(/clean/)
    writeAcceptedIdentity(sample.acceptedPath, sample.artifactIdentity)
    expect(() => verifyFinalPackAgainstAccepted({
      acceptedPath: sample.acceptedPath,
      distDirectory: sample.distDirectory,
      expectedRevision: "f".repeat(40),
      expectedVersion: version,
    })).toThrow(/different source revision/)
    writeFileSync(path.join(sample.distDirectory, "assets", "browser.js"), "tampered\n")
    expect(() => verifyFinalPackAgainstAccepted({
      acceptedPath: sample.acceptedPath,
      distDirectory: sample.distDirectory,
      expectedRevision: revision,
      expectedVersion: version,
    })).toThrow(/does not match its declared size and digest/)
  })
})
