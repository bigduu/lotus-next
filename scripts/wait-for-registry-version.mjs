import { spawnSync } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { stripVTControlCharacters } from "node:util"

import { assertPackageVersion } from "./artifact-manifest.mjs"

export const REGISTRY_VISIBILITY_TIMEOUT_MS = 10 * 60 * 1000
export const REGISTRY_VISIBILITY_INTERVAL_MS = 5 * 1000
export const REGISTRY_VISIBILITY_MAX_ATTEMPTS =
  REGISTRY_VISIBILITY_TIMEOUT_MS / REGISTRY_VISIBILITY_INTERVAL_MS + 1
export const REGISTRY_PROBE_TIMEOUT_MS = 20 * 1000
export const PUBLIC_NPM_REGISTRY = "https://registry.npmjs.org/"

const sleep = (milliseconds) =>
  new Promise((resolve) => {
    setTimeout(resolve, milliseconds)
  })

const concise = (value) =>
  stripVTControlCharacters(String(value ?? "")).trim().slice(0, 2_000)

export const classifyNpmViewResult = ({ result, expectedVersion }) => {
  if (result.error) {
    throw new Error(`npm registry probe could not run: ${concise(result.error.message)}`)
  }

  const stdout = concise(result.stdout)
  const stderr = concise(result.stderr)
  if (result.status === 0) {
    if (stdout === expectedVersion) {
      return { kind: "visible", version: stdout }
    }
    throw new Error(
      `npm returned an unexpected version while probing ${expectedVersion}: ${stdout || "<empty>"}`,
    )
  }

  if (/\bE404\b/.test(stderr)) {
    return { kind: "missing" }
  }

  throw new Error(
    `npm registry probe failed with a non-404 response: ${stderr || `exit status ${result.status}`}`,
  )
}

export const probeRegistryVersion = ({
  packageName,
  expectedVersion,
  cacheRoot = process.env.RUNNER_TEMP || tmpdir(),
  registry = PUBLIC_NPM_REGISTRY,
  timeoutMs = REGISTRY_PROBE_TIMEOUT_MS,
  commandRunner = spawnSync,
}) => {
  const cacheDirectory = mkdtempSync(path.join(cacheRoot, "lotus-next-registry-probe-"))
  try {
    const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"
    const result = commandRunner(
      npmCommand,
      [
        "view",
        `${packageName}@${expectedVersion}`,
        "version",
        `--registry=${registry}`,
        "--prefer-online",
        `--cache=${cacheDirectory}`,
        "--loglevel=error",
      ],
      {
        encoding: "utf8",
        env: process.env,
        timeout: timeoutMs,
      },
    )
    return classifyNpmViewResult({ result, expectedVersion })
  } finally {
    rmSync(cacheDirectory, { recursive: true, force: true })
  }
}

export const waitForRegistryVersion = async ({
  packageName,
  expectedVersion,
  probe = probeRegistryVersion,
  timeoutMs = REGISTRY_VISIBILITY_TIMEOUT_MS,
  intervalMs = REGISTRY_VISIBILITY_INTERVAL_MS,
  maxAttempts = REGISTRY_VISIBILITY_MAX_ATTEMPTS,
  now = Date.now,
  wait = sleep,
  onRetry = () => {},
}) => {
  assertPackageVersion(expectedVersion)
  if (!packageName) throw new Error("A package name is required")
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("The registry visibility timeout must be positive")
  }
  if (!Number.isFinite(intervalMs) || intervalMs <= 0) {
    throw new Error("The registry visibility interval must be positive")
  }
  if (!Number.isInteger(maxAttempts) || maxAttempts <= 0) {
    throw new Error("The registry visibility attempt limit must be a positive integer")
  }

  const startedAt = now()
  let attempt = 0
  while (true) {
    attempt += 1
    const outcome = await probe({ packageName, expectedVersion, attempt })
    if (outcome.kind === "visible") {
      return { attempts: attempt, elapsedMs: now() - startedAt }
    }
    if (outcome.kind !== "missing") {
      throw new Error(`Unknown registry probe outcome: ${outcome.kind}`)
    }

    const elapsedMs = now() - startedAt
    if (elapsedMs >= timeoutMs || attempt >= maxAttempts) {
      throw new Error(
        `${packageName}@${expectedVersion} remained unavailable after ${Math.round(timeoutMs / 60_000)} minutes and ${attempt} cache-isolated probes`,
      )
    }

    const delayMs = Math.min(intervalMs, timeoutMs - elapsedMs)
    onRetry({ attempt, delayMs, elapsedMs })
    await wait(delayMs)
  }
}

const runCli = async () => {
  const [packageName, expectedVersion] = process.argv.slice(2)
  const result = await waitForRegistryVersion({
    packageName,
    expectedVersion,
    onRetry: ({ attempt, elapsedMs }) => {
      if (attempt === 1 || attempt % 12 === 0) {
        console.log(
          `Registry copy is still propagating after ${Math.floor(elapsedMs / 1_000)} seconds (probe ${attempt}); retrying with a fresh npm cache.`,
        )
      }
    },
  })
  console.log(
    `${packageName}@${expectedVersion} became readable after ${result.attempts} probe(s) and ${Math.round(result.elapsedMs / 1_000)} seconds.`,
  )
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  runCli().catch((error) => {
    console.error(`::error::${error instanceof Error ? error.message : String(error)}`)
    process.exitCode = 1
  })
}
