import { spawnSync } from "node:child_process"

import { findUnexpectedPackagePaths } from "./package-policy.mjs"

const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm"
const result = spawnSync(
  npmCommand,
  ["pack", "--dry-run", "--json", "--ignore-scripts", "--loglevel=error"],
  { encoding: "utf8" },
)

if (result.error) {
  throw result.error
}

if (result.status !== 0) {
  process.stderr.write(result.stderr)
  process.exit(result.status ?? 1)
}

let manifests
try {
  manifests = JSON.parse(result.stdout)
} catch {
  process.stderr.write("npm pack did not return a JSON manifest.\n")
  process.stderr.write(result.stdout)
  process.exit(1)
}

if (!Array.isArray(manifests) || manifests.length !== 1) {
  process.stderr.write(`Expected one package manifest, received ${manifests?.length ?? 0}.\n`)
  process.exit(1)
}

const [manifest] = manifests
const paths = (manifest.files ?? []).map((file) => file.path).sort()
const unexpected = findUnexpectedPackagePaths(paths)
const missing = ["package.json", "dist/index.html"].filter((file) => !paths.includes(file))

if (!paths.some((file) => file.startsWith("dist/assets/"))) {
  missing.push("dist/assets/*")
}

if (manifest.name !== "@bigduu/lotus-next" || manifest.version !== "0.0.0") {
  process.stderr.write(
    `Unexpected package identity: ${String(manifest.name)}@${String(manifest.version)}.\n`,
  )
  process.exit(1)
}

if (unexpected.length > 0 || missing.length > 0) {
  if (unexpected.length > 0) {
    process.stderr.write(`Unexpected package files:\n${unexpected.map((file) => `  - ${file}`).join("\n")}\n`)
  }
  if (missing.length > 0) {
    process.stderr.write(`Missing package files:\n${missing.map((file) => `  - ${file}`).join("\n")}\n`)
  }
  process.exit(1)
}

process.stdout.write(
  `Verified ${manifest.name}@${manifest.version}: ${paths.length} files, ${manifest.unpackedSize} unpacked bytes.\n`,
)
