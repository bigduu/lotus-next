import assert from "node:assert/strict"
import { appendFileSync, readFileSync, writeFileSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { featureSource } from "./verification-browser.mjs"

export { featureSource }

const resultNames = ["source", "verify", "browser", "realBamboo", "realBambooPackage", "realBambooSurface", "nativeActor"]


export const verifyFeatureSource = (receipt, expected) => {
  assert.ok(Number.isSafeInteger(receipt?.sourceRunAttempt) && receipt.sourceRunAttempt > 0 &&
    receipt.sourceRunAttempt <= expected.sourceRunAttempt, "Invalid feature source attempt")
  assert.deepEqual({ ...receipt, sourceRunAttempt: expected.sourceRunAttempt }, expected, "Feature source receipt differs from this run's exact inputs")
  return receipt
}

export const requireFeatureResults = (results) => {
  assert.deepEqual(Object.keys(results).sort(), [...resultNames].sort(), "Incomplete feature gates")
  for (const name of resultNames) assert.equal(results[name], "success", `Feature ${name} gate did not succeed`)
  return results
}

const writeReceipt = (file, value) => writeFileSync(file, JSON.stringify(value, null, 2) + "\n", { flag: "wx" })
const main = () => {
  const command = process.argv[2]
  if (command === "source") {
    const receipt = featureSource()
    writeReceipt(process.env.FEATURE_RECEIPT_PATH, receipt)
    appendFileSync(process.env.GITHUB_OUTPUT, `tested_snapshot=${receipt.testedSnapshot}\ntested_tree=${receipt.testedTree}\n`)
    console.log(`Feature PR ${receipt.pullRequest}: base=${receipt.baseSha} head=${receipt.headSha} snapshot=${receipt.testedSnapshot} tree=${receipt.testedTree}`)
    return
  }
  if (command === "summarize") {
    const gates = requireFeatureResults({ source: process.env.SOURCE_RESULT, verify: process.env.VERIFY_RESULT,
      browser: process.env.BROWSER_RESULT, realBamboo: process.env.REAL_BAMBOO_RESULT,
      realBambooPackage: process.env.REAL_BAMBOO_PACKAGE_RESULT, realBambooSurface: process.env.REAL_BAMBOO_SURFACE_RESULT,
      nativeActor: process.env.NATIVE_ACTOR_RESULT })
    const source = verifyFeatureSource(JSON.parse(readFileSync(process.env.FEATURE_RECEIPT_PATH, "utf8")), featureSource())
    const receipt = { schemaVersion: 2, kind: "lotus-feature-acceptance/v2", source, gates,
      acceptanceRunAttempt: Number(process.env.GITHUB_RUN_ATTEMPT) }
    writeReceipt(process.env.FEATURE_ACCEPTANCE_PATH, receipt)
    console.log(`Accepted all feature gates for tested snapshot ${source.testedSnapshot}, tree ${source.testedTree}`)
    return
  }
  throw new Error("Usage: feature-acceptance.mjs source|summarize")
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main() } catch (error) { console.error(error.message); process.exitCode = 1 }
}
