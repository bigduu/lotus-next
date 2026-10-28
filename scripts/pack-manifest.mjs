import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

// A release passes the manifest from its one actual pack; ordinary local
// verification can still ask npm for an inventory without lifecycle scripts.
export const readPackManifest = (manifestPath, runNpm = spawnSync) => {
  let output
  if (manifestPath !== undefined) {
    if (typeof manifestPath !== "string" || manifestPath.trim() === "") {
      throw new Error("A nonempty npm pack manifest path is required.")
    }
    output = readFileSync(manifestPath, "utf8")
  } else {
    const command = process.platform === "win32" ? "npm.cmd" : "npm"
    const result = runNpm(command,
      ["pack", "--dry-run", "--json", "--ignore-scripts", "--loglevel=error"],
      { encoding: "utf8" })
    if (result.error) throw result.error
    if (result.status !== 0) {
      throw new Error(`npm pack inventory failed: ${result.stderr || result.status}`)
    }
    output = result.stdout
  }

  let manifests
  try {
    manifests = JSON.parse(output)
  } catch {
    throw new Error("npm pack did not return a JSON manifest.")
  }
  if (!Array.isArray(manifests) || manifests.length !== 1) {
    throw new Error(`Expected one package manifest, received ${manifests?.length ?? 0}.`)
  }
  return manifests[0]
}
