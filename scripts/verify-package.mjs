import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"
import path from "node:path"

import {
  analyzeBundleBudget,
  findBundleBudgetViolations,
  formatBundleBudgetReport,
} from "./bundle-budget.mjs"
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
const missing = [
  "package.json",
  "dist/index.html",
  "dist/asset-manifest.json",
  "dist/bundle-ownership.json",
].filter((file) => !paths.includes(file))
const lazyJavaScriptChunks = [
  ["Settings", /^dist\/assets\/Settings-[^/]+\.js$/],
  ["StreamdownMarkdown", /^dist\/assets\/StreamdownMarkdown-[^/]+\.js$/],
  ["StreamdownMermaid", /^dist\/assets\/StreamdownMermaid-[^/]+\.js$/],
  ["vendor-streamdown", /^dist\/assets\/vendor-streamdown-(?!code-)[^/]+\.js$/],
  ["vendor-streamdown-code", /^dist\/assets\/vendor-streamdown-code-[^/]+\.js$/],
  ["vendor-mermaid", /^dist\/assets\/vendor-mermaid-[^/]+\.js$/],
  ["vendor-markdown", /^dist\/assets\/vendor-markdown-[^/]+\.js$/],
  ["vendor-highlighter", /^dist\/assets\/vendor-highlighter-[^/]+\.js$/],
]

if (!paths.some((file) => file.startsWith("dist/assets/"))) {
  missing.push("dist/assets/*")
}
for (const [chunkName, pattern] of lazyJavaScriptChunks) {
  if (!paths.some((file) => pattern.test(file))) missing.push(`dist/assets/${chunkName}-*.js`)
}

const entryHtml = readFileSync(new URL("../dist/index.html", import.meta.url), "utf8")
const nonPortableEntryReferences = [
  ...entryHtml.matchAll(/\b(?:href|src)=["'](\/(?!\/)[^"']*)["']/g),
].map((match) => match[1])
if (nonPortableEntryReferences.length > 0) {
  process.stderr.write(
    `Packaged entrypoint contains origin-root asset references:\n${nonPortableEntryReferences
      .map((reference) => `  - ${reference}`)
      .join("\n")}\n`,
  )
  process.exit(1)
}
if (!entryHtml.includes('="./assets/')) {
  process.stderr.write("Packaged entrypoint does not reference its entry assets relatively.\n")
  process.exit(1)
}
const eagerlyPreloaded = lazyJavaScriptChunks
  .map(([chunkName]) => chunkName)
  .filter((chunkName) => entryHtml.includes(chunkName))

if (eagerlyPreloaded.length > 0) {
  process.stderr.write(
    `Lazy feature chunks leaked into the initial HTML:\n${eagerlyPreloaded
      .map((chunkName) => `  - ${chunkName}`)
      .join("\n")}\n`,
  )
  process.exit(1)
}

let bundleReport
try {
  bundleReport = analyzeBundleBudget()
} catch (error) {
  process.stderr.write(
    `Could not verify the production bundle graph: ${error instanceof Error ? error.message : String(error)}\n`,
  )
  process.exit(1)
}
const bundleViolations = findBundleBudgetViolations(bundleReport)
if (bundleViolations.length > 0) {
  process.stderr.write(
    `Production bundle budget failed:\n${bundleViolations
      .map((violation) => `  - ${violation}`)
      .join("\n")}\n`,
  )
  process.exit(1)
}

const streamdownEntry = paths.find((file) =>
  /^dist\/assets\/StreamdownMarkdown-[^/]+\.js$/.test(file),
)
const javascriptPaths = new Set(paths.filter((file) => file.endsWith(".js")))
const staticImportPattern =
  /\b(?:import|export)(?:[\w\s{},*$]+from\s*)?["'](\.[^"']+\.js)["']/g

function collectStaticJavaScriptClosure(entry) {
  const closure = new Set()
  const pending = [entry]

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || closure.has(current)) continue
    closure.add(current)

    const source = readFileSync(new URL(`../${current}`, import.meta.url), "utf8")
    staticImportPattern.lastIndex = 0
    for (const match of source.matchAll(staticImportPattern)) {
      const imported = path.posix.normalize(
        path.posix.join(path.posix.dirname(current), match[1]),
      )
      if (javascriptPaths.has(imported) && !closure.has(imported)) pending.push(imported)
    }
  }

  return closure
}

if (streamdownEntry) {
  const firstAssistantClosure = collectStaticJavaScriptClosure(streamdownEntry)
  const closureFiles = [...firstAssistantClosure]
  const closureChunkPatterns = new Map([
    ["vendor-streamdown", /^dist\/assets\/vendor-streamdown-(?!code-)[^/]+\.js$/],
    ["vendor-markdown", /^dist\/assets\/vendor-markdown-[^/]+\.js$/],
    ["vendor-streamdown-code", /^dist\/assets\/vendor-streamdown-code-[^/]+\.js$/],
    ["vendor-mermaid", /^dist\/assets\/vendor-mermaid-[^/]+\.js$/],
    ["vendor-highlighter", /^dist\/assets\/vendor-highlighter-[^/]+\.js$/],
  ])
  const hasClosureChunk = (chunkName) => {
    const pattern = closureChunkPatterns.get(chunkName)
    return pattern ? closureFiles.some((file) => pattern.test(file)) : false
  }
  const requiredLazyCore = ["vendor-streamdown", "vendor-markdown"]
  const missingLazyCore = requiredLazyCore.filter((chunkName) => !hasClosureChunk(chunkName))
  if (missingLazyCore.length > 0) {
    process.stderr.write(
      `Streamdown first-render closure is incomplete:\n${missingLazyCore
        .map((chunkName) => `  - ${chunkName}`)
        .join("\n")}\n`,
    )
    process.exit(1)
  }

  const expensiveFirstAssistantChunks = [
    "vendor-streamdown-code",
    "vendor-mermaid",
    "vendor-highlighter",
  ].filter(hasClosureChunk)
  if (expensiveFirstAssistantChunks.length > 0) {
    process.stderr.write(
      `Expensive plugins leaked into the plain assistant Markdown closure:\n${expensiveFirstAssistantChunks
        .map((chunkName) => `  - ${chunkName}`)
        .join("\n")}\n`,
    )
    process.exit(1)
  }
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
  `${formatBundleBudgetReport(bundleReport)}\nVerified ${manifest.name}@${manifest.version}: ${paths.length} files, ${manifest.unpackedSize} unpacked bytes.\n`,
)
