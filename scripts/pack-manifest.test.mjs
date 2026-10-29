import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { readPackManifest } from "./pack-manifest.mjs"

describe("package inventory input", () => {
  it("uses the actual pack manifest without running npm again", () => {
    const root = mkdtempSync(join(tmpdir(), "lotus-pack-manifest-"))
    try {
      const filename = join(root, "pack.json")
      const record = { name: "@bigduu/lotus-next", version: "2026.10.30", files: [{ path: "dist/index.html" }] }
      writeFileSync(filename, JSON.stringify([record]))
      expect(readPackManifest(filename, () => { throw new Error("unexpected second pack") })).toEqual(record)
      writeFileSync(filename, "not JSON")
      expect(() => readPackManifest(filename, () => { throw new Error("unexpected second pack") })).toThrow(/JSON manifest/)
      writeFileSync(filename, "[]")
      expect(() => readPackManifest(filename, () => { throw new Error("unexpected second pack") })).toThrow(/one package manifest/)
      expect(() => readPackManifest(join(root, "missing.json"), () => { throw new Error("unexpected second pack") })).toThrow()
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })

  it("retains the standalone inventory command when no manifest is supplied", () => {
    const calls = []
    const result = readPackManifest(undefined, (command, args) => {
      calls.push({ command, args })
      return { status: 0, stdout: '[{"name":"example"}]' }
    })
    expect(result).toEqual({ name: "example" })
    expect(calls).toHaveLength(1)
    expect(calls[0].args).toEqual(["pack", "--dry-run", "--json", "--ignore-scripts", "--loglevel=error"])
    expect(() => readPackManifest(undefined, () => ({ status: 1, stderr: "failed" }))).toThrow(/failed/)
  })
})
