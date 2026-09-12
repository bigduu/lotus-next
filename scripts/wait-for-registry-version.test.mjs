import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it, vi } from "vitest"

import {
  PUBLIC_NPM_REGISTRY,
  REGISTRY_PROBE_TIMEOUT_MS,
  REGISTRY_VISIBILITY_INTERVAL_MS,
  REGISTRY_VISIBILITY_MAX_ATTEMPTS,
  REGISTRY_VISIBILITY_TIMEOUT_MS,
  classifyNpmViewResult,
  probeRegistryVersion,
  waitForRegistryVersion,
} from "./wait-for-registry-version.mjs"

const packageName = "@bigduu/lotus-next"
const expectedVersion = "2026.9.13"
const temporaryDirectories = []

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true })
  }
})

describe("npm registry visibility gate", () => {
  it("waits for a full ten-minute propagation window", () => {
    expect(REGISTRY_VISIBILITY_TIMEOUT_MS).toBe(10 * 60 * 1000)
    expect(REGISTRY_VISIBILITY_INTERVAL_MS).toBe(5 * 1000)
    expect(REGISTRY_VISIBILITY_MAX_ATTEMPTS).toBe(121)
    expect(REGISTRY_PROBE_TIMEOUT_MS).toBeLessThanOrEqual(30 * 1000)
  })

  it("accepts only the exact requested version", () => {
    expect(
      classifyNpmViewResult({
        result: { status: 0, stdout: `${expectedVersion}\n`, stderr: "" },
        expectedVersion,
      }),
    ).toEqual({ kind: "visible", version: expectedVersion })

    expect(() =>
      classifyNpmViewResult({
        result: { status: 0, stdout: "2026.9.12\n", stderr: "" },
        expectedVersion,
      }),
    ).toThrow(/unexpected version/)
  })

  it("retries only npm E404 responses", () => {
    expect(
      classifyNpmViewResult({
        result: { status: 1, stdout: "", stderr: "npm error code E404\n" },
        expectedVersion,
      }),
    ).toEqual({ kind: "missing" })

    expect(() =>
      classifyNpmViewResult({
        result: { status: 1, stdout: "", stderr: "npm error code E401\n" },
        expectedVersion,
      }),
    ).toThrow(/non-404 response/)
  })

  it("uses and removes a fresh npm cache for each probe", () => {
    const cacheRoot = mkdtempSync(path.join(tmpdir(), "lotus-next-registry-test-"))
    temporaryDirectories.push(cacheRoot)
    const observedCaches = []
    const commandRunner = vi.fn((_command, arguments_, options) => {
      const cacheArgument = arguments_.find((argument) => argument.startsWith("--cache="))
      const cacheDirectory = cacheArgument.slice("--cache=".length)
      observedCaches.push(cacheDirectory)
      expect(existsSync(cacheDirectory)).toBe(true)
      expect(arguments_).toContain("--prefer-online")
      expect(arguments_).toContain(`--registry=${PUBLIC_NPM_REGISTRY}`)
      expect(options.timeout).toBe(REGISTRY_PROBE_TIMEOUT_MS)
      return { status: 1, stdout: "", stderr: "npm error code E404\n" }
    })

    for (let index = 0; index < 2; index += 1) {
      expect(
        probeRegistryVersion({
          packageName,
          expectedVersion,
          cacheRoot,
          commandRunner,
        }),
      ).toEqual({ kind: "missing" })
    }

    expect(new Set(observedCaches).size).toBe(2)
    expect(observedCaches.every((directory) => !existsSync(directory))).toBe(true)
  })

  it("retries missing metadata and returns once the exact version appears", async () => {
    let currentTime = 0
    const wait = vi.fn(async (delayMs) => {
      currentTime += delayMs
    })
    const probe = vi
      .fn()
      .mockResolvedValueOnce({ kind: "missing" })
      .mockResolvedValueOnce({ kind: "missing" })
      .mockResolvedValueOnce({ kind: "visible", version: expectedVersion })

    await expect(
      waitForRegistryVersion({
        packageName,
        expectedVersion,
        probe,
        now: () => currentTime,
        wait,
      }),
    ).resolves.toEqual({ attempts: 3, elapsedMs: 10_000 })
    expect(wait).toHaveBeenCalledTimes(2)
  })

  it("performs a final probe at ten minutes, then times out without another sleep", async () => {
    let currentTime = 0
    const wait = vi.fn(async (delayMs) => {
      currentTime += delayMs
    })
    const probe = vi.fn(async () => ({ kind: "missing" }))

    await expect(
      waitForRegistryVersion({
        packageName,
        expectedVersion,
        probe,
        now: () => currentTime,
        wait,
      }),
    ).rejects.toThrow(/after 10 minutes and 121 cache-isolated probes/)
    expect(currentTime).toBe(REGISTRY_VISIBILITY_TIMEOUT_MS)
    expect(probe).toHaveBeenCalledTimes(121)
    expect(wait).toHaveBeenCalledTimes(120)
  })

  it("does not hide a fatal registry probe error behind retries", async () => {
    const wait = vi.fn()
    const probe = vi.fn(async () => {
      throw new Error("npm registry probe failed with a non-404 response")
    })

    await expect(
      waitForRegistryVersion({ packageName, expectedVersion, probe, wait }),
    ).rejects.toThrow(/non-404 response/)
    expect(wait).not.toHaveBeenCalled()
  })
})
