import { spawnSync } from "node:child_process"
import { readFileSync } from "node:fs"

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

const assetManifest = JSON.parse(
  readFileSync(new URL("../dist/asset-manifest.json", import.meta.url), "utf8"),
)
const isAssetRecord = (value) =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const streamdownEntry = Object.entries(assetManifest).find(
  ([, record]) =>
    isAssetRecord(record) && record.src === "src/components/chat/StreamdownMarkdown.tsx",
)?.[0]

if (!streamdownEntry) {
  process.stderr.write(
    "Production asset manifest has no StreamdownMarkdown dynamic entry.\n",
  )
  process.exit(1)
}

function collectStaticAssetImports(current) {
  const record = assetManifest[current]
  if (!isAssetRecord(record)) {
    throw new Error(`Asset manifest is missing static import target ${current}.`)
  }
  if (record.imports === undefined) return []
  if (!Array.isArray(record.imports) || record.imports.some((value) => typeof value !== "string")) {
    throw new Error(`Asset manifest imports for ${current} are malformed.`)
  }
  for (const imported of record.imports) {
    if (!isAssetRecord(assetManifest[imported])) {
      throw new Error(`Asset manifest entry ${current} imports missing target ${imported}.`)
    }
  }
  return record.imports
}

function collectStaticAssetClosure(entry) {
  const closure = new Set()
  const pending = [entry]

  while (pending.length > 0) {
    const current = pending.pop()
    if (!current || closure.has(current)) continue
    closure.add(current)

    for (const imported of collectStaticAssetImports(current)) {
      if (!closure.has(imported)) pending.push(imported)
    }
  }

  return closure
}

function findStaticAssetCycle(entry) {
  const complete = new Set()
  const active = new Set()
  const stack = []

  const visit = (current) => {
    if (active.has(current)) {
      return [...stack.slice(stack.indexOf(current)), current]
    }
    if (complete.has(current)) return undefined

    active.add(current)
    stack.push(current)
    for (const imported of collectStaticAssetImports(current)) {
      const cycle = visit(imported)
      if (cycle) return cycle
    }
    stack.pop()
    active.delete(current)
    complete.add(current)
    return undefined
  }

  return visit(entry)
}

if (streamdownEntry) {
  const firstAssistantClosure = collectStaticAssetClosure(streamdownEntry)
  const closureFiles = [...firstAssistantClosure]
    .map((key) => assetManifest[key]?.file)
    .filter((file) => typeof file === "string" && file.endsWith(".js"))
    .map((file) => `dist/${file}`)
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

  const staticImportCycle = findStaticAssetCycle(streamdownEntry)
  if (staticImportCycle) {
    process.stderr.write(
      `Streamdown first-render closure contains a static import cycle:\n  - ${staticImportCycle.join("\n  - ")}\n`,
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
