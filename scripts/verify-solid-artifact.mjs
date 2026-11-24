import { fileURLToPath } from "node:url"
import { verifyArtifactManifest } from "./artifact-manifest.mjs"
import { analyzeBundleBudget, findBundleBudgetViolations, formatBundleBudgetReport } from "./bundle-budget.mjs"

const dist = fileURLToPath(new URL("../dist-solid-artifact/", import.meta.url))
const manifest = verifyArtifactManifest({ distDirectory: dist })
const budget = analyzeBundleBudget(dist)
const violations = findBundleBudgetViolations(budget)
if (violations.length) throw new Error(violations.join("\n"))

process.stdout.write(`Verified Solid candidate ${manifest.packageName}@${manifest.packageVersion} with ${manifest.resources.length} resources.\n`)
process.stdout.write(`${formatBundleBudgetReport(budget)}\n`)
