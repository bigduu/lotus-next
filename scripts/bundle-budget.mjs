import { readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { gzip } from "pako"

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url))
const defaultDistDirectory = path.resolve(scriptDirectory, "../dist")

export const BUNDLE_BASELINE = Object.freeze({
  javascriptRawBytes: 1_949_302,
  javascriptGzipBytes: 567_482,
})

export const BUNDLE_BUDGET = Object.freeze({
  javascriptRawBytes: 1_820_000,
  javascriptGzipBytes: 535_000,
  minimumRawReduction: 0.06,
  minimumGzipReduction: 0.05,
  cssRawBytes: 105_000,
  cssGzipBytes: 18_000,
})

const immediateBootstrapNames = new Set(["ErrorBoundary", "Root"])

const optionalFeatureEntries = Object.freeze([
  { label: "Settings", source: "src/components/chat/Settings.tsx" },
  { label: "StreamdownMarkdown", source: "src/components/chat/StreamdownMarkdown.tsx" },
  { label: "StreamdownMermaid", source: "src/components/chat/StreamdownMermaid.tsx" },
  { label: "Markdown", source: "src/components/chat/Markdown.tsx" },
  { label: "CodeBlock", source: "src/components/chat/CodeBlock.tsx" },
  { label: "MermaidChart", source: "src/components/chat/MermaidChart.tsx" },
  { label: "renderPdf", source: "src/lib/export/renderPdf.tsx" },
  { label: "vendor-streamdown", name: "vendor-streamdown" },
  { label: "vendor-streamdown-code", name: "vendor-streamdown-code" },
  { label: "vendor-markdown", name: "vendor-markdown" },
  { label: "vendor-mermaid", name: "vendor-mermaid" },
  { label: "vendor-highlighter", name: "vendor-highlighter" },
])

const forbiddenStartupModulePaths = Object.freeze([
  "src/components/chat/Settings.tsx",
  "src/components/chat/StreamdownMarkdown.tsx",
  "src/components/chat/StreamdownMermaid.tsx",
  "src/components/chat/streamdownConfig.ts",
  "src/components/chat/Markdown.tsx",
  "src/components/chat/CodeBlock.tsx",
  "src/components/chat/MermaidChart.tsx",
  "src/lib/export/renderPdf.tsx",
])

const forbiddenStartupModulePrefixes = Object.freeze([
  "src/components/chat/settings/",
  "src/lib/export/",
  "src/lib/mermaid/",
  "src/services/metrics/",
  "src/services/plugin/",
])

const forbiddenStartupPackages = Object.freeze([
  "@babel/runtime",
  "@radix-ui/react-label",
  "@radix-ui/react-switch",
  "canvg",
  "core-js",
  "fast-png",
  "fflate",
  "html2canvas",
  "iobuffer",
  "jspdf",
  "pako",
  "performance-now",
  "raf",
  "rgbcolor",
  "stackblur-canvas",
  "svg-pathdata",
])

const requiredSettingsOwnedModules = Object.freeze([
  "src/components/chat/Settings.tsx",
  "src/components/chat/settings/SettingsMetrics.tsx",
  "src/components/chat/settings/SettingsPlugins.tsx",
  "src/services/metrics/MetricsService.ts",
  "src/services/plugin/PluginService.ts",
])

const requiredSettingsOwnedPackages = Object.freeze([
  "@radix-ui/react-label",
  "@radix-ui/react-switch",
])

const readJson = (file) => JSON.parse(readFileSync(file, "utf8"))

const assetFile = (distDirectory, relativeFile) => {
  const root = path.resolve(distDirectory)
  const resolved = path.resolve(root, relativeFile)
  if (resolved !== root && !resolved.startsWith(`${root}${path.sep}`)) {
    throw new Error(`Bundle manifest asset escapes dist/: ${relativeFile}`)
  }
  return resolved
}

const deterministicSizes = (file) => {
  const contents = readFileSync(file)
  return {
    rawBytes: contents.byteLength,
    gzipBytes: gzip(contents, {
      level: 6,
      header: { time: 0, os: 255 },
    }).byteLength,
  }
}

const sumSizes = (sizes) =>
  sizes.reduce(
    (total, current) => ({
      rawBytes: total.rawBytes + current.rawBytes,
      gzipBytes: total.gzipBytes + current.gzipBytes,
    }),
    { rawBytes: 0, gzipBytes: 0 },
  )

const htmlAssetsWithExtension = (html, extension) => {
  const pattern = new RegExp(
    String.raw`(?:src|href)=["']([^"'?#]+\.${extension})(?:[?#][^"']*)?["']`,
    "g",
  )
  return [...html.matchAll(pattern)].map((match) => match[1].replace(/^\.\//, ""))
}

const findManifestKeyByAsset = (manifest, rawAsset) => {
  const asset = rawAsset.replace(/^\/+/, "")
  const matches = Object.entries(manifest)
    .filter(([, entry]) => asset === entry.file || asset.endsWith(`/${entry.file}`))
    .map(([key]) => key)
  if (matches.length !== 1) {
    throw new Error(
      `Expected one manifest entry for HTML asset ${rawAsset}; received ${matches.length}.`,
    )
  }
  return matches[0]
}

const findFeatureKey = (manifest, descriptor) => {
  const matches = Object.entries(manifest)
    .filter(([, entry]) =>
      descriptor.source ? entry.src === descriptor.source : entry.name === descriptor.name,
    )
    .map(([key]) => key)
  if (matches.length !== 1) {
    throw new Error(
      `Expected one ${descriptor.label} feature entry; received ${matches.length}.`,
    )
  }
  return matches[0]
}

const collectStaticClosure = (manifest, initialKeys) => {
  const closure = new Set()
  const pending = [...initialKeys]

  while (pending.length > 0) {
    const key = pending.pop()
    if (!key || closure.has(key)) continue
    const entry = manifest[key]
    if (!entry) throw new Error(`Manifest import ${key} is missing.`)
    if (!entry.file?.endsWith(".js")) {
      throw new Error(`Startup manifest entry ${key} is not JavaScript.`)
    }
    closure.add(key)
    for (const imported of entry.imports ?? []) pending.push(imported)
  }

  return closure
}

export function analyzeBundleBudget(distDirectory = defaultDistDirectory) {
  const manifestPath = path.join(distDirectory, "asset-manifest.json")
  const manifest = readJson(manifestPath)
  const ownershipPath = path.join(distDirectory, "bundle-ownership.json")
  const ownership = readJson(ownershipPath)
  if (ownership.version !== 2 || typeof ownership.chunks !== "object" || !ownership.chunks) {
    throw new Error("Bundle ownership manifest must use the exact version-2 chunks schema.")
  }
  const readChunkOwnership = (file) => {
    const entry = ownership.chunks[file]
    if (
      typeof entry !== "object" ||
      !entry ||
      !Array.isArray(entry.modules) ||
      entry.modules.some((module) => typeof module !== "string") ||
      !Array.isArray(entry.packages) ||
      entry.packages.some((packageName) => typeof packageName !== "string")
    ) {
      throw new Error(`Bundle ownership is missing exact module/package lists for ${file}.`)
    }
    return entry
  }
  const html = readFileSync(path.join(distDirectory, "index.html"), "utf8")
  const entryKeys = Object.entries(manifest)
    .filter(([, entry]) => entry.isEntry === true)
    .map(([key]) => key)
  if (entryKeys.length !== 1) {
    throw new Error(`Expected one HTML entry manifest record; received ${entryKeys.length}.`)
  }

  const [entryKey] = entryKeys
  const entry = manifest[entryKey]
  if (entry.src !== "index.html") {
    throw new Error(`Expected index.html entry; received ${String(entry.src)}.`)
  }

  const htmlJavaScriptKeys = htmlAssetsWithExtension(html, "js").map((asset) =>
    findManifestKeyByAsset(manifest, asset),
  )
  const immediateDynamicKeys = entry.dynamicImports ?? []
  const closure = collectStaticClosure(manifest, [
    entryKey,
    ...htmlJavaScriptKeys,
    ...immediateDynamicKeys,
  ])
  const closureFiles = [...closure].map((key) => manifest[key].file)
  const javascript = sumSizes(
    closureFiles.map((file) => deterministicSizes(assetFile(distDirectory, file))),
  )

  const cssFiles = new Set(htmlAssetsWithExtension(html, "css").map((asset) => {
    const normalized = asset.replace(/^\/+/, "")
    const knownFiles = Object.values(manifest).flatMap((manifestEntry) => [
      manifestEntry.file,
      ...(manifestEntry.css ?? []),
    ])
    const matches = knownFiles.filter(
      (file) => normalized === file || normalized.endsWith(`/${file}`),
    )
    if (matches.length !== 1) {
      throw new Error(`Expected one manifest CSS asset for ${asset}; received ${matches.length}.`)
    }
    return matches[0]
  }))
  for (const key of closure) {
    for (const file of manifest[key].css ?? []) cssFiles.add(file)
  }
  const css = sumSizes(
    [...cssFiles].map((file) => deterministicSizes(assetFile(distDirectory, file))),
  )

  const immediateDynamicNames = immediateDynamicKeys.map((key) => manifest[key]?.name)
  const optionalFeatures = optionalFeatureEntries.map((descriptor) => {
    const key = findFeatureKey(manifest, descriptor)
    return {
      ...descriptor,
      key,
      file: manifest[key].file,
      isDynamicEntry: manifest[key].isDynamicEntry === true,
      inStartupClosure: closure.has(key),
    }
  })
  const settings = optionalFeatures.find((feature) => feature.label === "Settings")
  if (!settings) throw new Error("Settings feature ownership is missing.")
  const startupOwnership = closureFiles.map(readChunkOwnership)
  const startupModules = [...new Set(startupOwnership.flatMap(({ modules }) => modules))].sort()
  const startupPackages = [...new Set(startupOwnership.flatMap(({ packages }) => packages))].sort()
  const settingsClosure = collectStaticClosure(manifest, [settings.key])
  const settingsOwnership = [...settingsClosure]
    .map((key) => manifest[key].file)
    .map(readChunkOwnership)
  const settingsOwnedModules = [
    ...new Set(settingsOwnership.flatMap(({ modules }) => modules)),
  ].sort()
  const settingsOwnedPackages = [
    ...new Set(settingsOwnership.flatMap(({ packages }) => packages)),
  ].sort()
  const forbiddenStartupModules = startupModules.filter(
    (module) =>
      forbiddenStartupModulePaths.includes(module) ||
      forbiddenStartupModulePrefixes.some((prefix) => module.startsWith(prefix)),
  )
  const leakedStartupPackages = startupPackages.filter((packageName) =>
    forbiddenStartupPackages.includes(packageName),
  )
  const missingSettingsOwnedModules = requiredSettingsOwnedModules.filter(
    (module) => !settingsOwnedModules.includes(module),
  )
  const missingSettingsOwnedPackages = requiredSettingsOwnedPackages.filter(
    (packageName) => !settingsOwnedPackages.includes(packageName),
  )
  const rootKey = Object.entries(manifest).find(([, manifestEntry]) =>
    manifestEntry.src === "src/Root.tsx"
  )?.[0]

  return {
    entryKey,
    manifestPath,
    ownershipPath,
    closureKeys: [...closure].sort(),
    closureFiles: [...closureFiles].sort(),
    cssFiles: [...cssFiles].sort(),
    immediateDynamicNames,
    rootKey,
    settingsIsOwnedByRoot:
      Boolean(rootKey && settings) && (manifest[rootKey].dynamicImports ?? []).includes(settings.key),
    startupModules,
    startupPackages,
    settingsOwnedModules: [...settingsOwnedModules].sort(),
    settingsOwnedPackages,
    forbiddenStartupModules,
    leakedStartupPackages,
    missingSettingsOwnedModules,
    missingSettingsOwnedPackages,
    optionalFeatures,
    javascript,
    css,
  }
}

const percent = (value) => `${(value * 100).toFixed(2)}%`

export function findBundleBudgetViolations(report) {
  const violations = []
  const immediateNames = new Set(report.immediateDynamicNames)
  if (
    immediateNames.size !== immediateBootstrapNames.size ||
    [...immediateBootstrapNames].some((name) => !immediateNames.has(name))
  ) {
    violations.push(
      `HTML entry immediate dynamic owners must be exactly ErrorBoundary and Root; received ${[
        ...immediateNames,
      ].sort().join(", ")}.`,
    )
  }
  if (!report.settingsIsOwnedByRoot) {
    violations.push("Root must own Settings through one direct dynamic feature entry.")
  }
  if (report.forbiddenStartupModules.length > 0) {
    violations.push(
      `Settings/metrics/plugins/renderer/PDF application modules leaked into startup: ${report.forbiddenStartupModules.join(", ")}.`,
    )
  }
  if (report.leakedStartupPackages.length > 0) {
    violations.push(
      `Settings/PDF packages leaked into startup: ${report.leakedStartupPackages.join(", ")}.`,
    )
  }
  if (report.missingSettingsOwnedModules.length > 0) {
    violations.push(
      `Settings feature ownership is incomplete: ${report.missingSettingsOwnedModules.join(", ")}.`,
    )
  }
  if (report.missingSettingsOwnedPackages.length > 0) {
    violations.push(
      `Settings package ownership is incomplete: ${report.missingSettingsOwnedPackages.join(", ")}.`,
    )
  }

  for (const feature of report.optionalFeatures) {
    if (!feature.isDynamicEntry && feature.source) {
      violations.push(`${feature.label} must remain a dynamic feature entry.`)
    }
    if (feature.inStartupClosure) {
      violations.push(`${feature.label} leaked into the ordinary-chat startup closure.`)
    }
  }

  const rawReduction =
    (BUNDLE_BASELINE.javascriptRawBytes - report.javascript.rawBytes) /
    BUNDLE_BASELINE.javascriptRawBytes
  const gzipReduction =
    (BUNDLE_BASELINE.javascriptGzipBytes - report.javascript.gzipBytes) /
    BUNDLE_BASELINE.javascriptGzipBytes

  if (report.javascript.rawBytes > BUNDLE_BUDGET.javascriptRawBytes) {
    violations.push(
      `Startup JavaScript raw size ${report.javascript.rawBytes} exceeds ${BUNDLE_BUDGET.javascriptRawBytes}.`,
    )
  }
  if (report.javascript.gzipBytes > BUNDLE_BUDGET.javascriptGzipBytes) {
    violations.push(
      `Startup JavaScript gzip size ${report.javascript.gzipBytes} exceeds ${BUNDLE_BUDGET.javascriptGzipBytes}.`,
    )
  }
  if (rawReduction < BUNDLE_BUDGET.minimumRawReduction) {
    violations.push(
      `Startup JavaScript raw reduction ${percent(rawReduction)} is below ${percent(BUNDLE_BUDGET.minimumRawReduction)}.`,
    )
  }
  if (gzipReduction < BUNDLE_BUDGET.minimumGzipReduction) {
    violations.push(
      `Startup JavaScript gzip reduction ${percent(gzipReduction)} is below ${percent(BUNDLE_BUDGET.minimumGzipReduction)}.`,
    )
  }
  if (report.css.rawBytes > BUNDLE_BUDGET.cssRawBytes) {
    violations.push(`Startup CSS raw size ${report.css.rawBytes} exceeds ${BUNDLE_BUDGET.cssRawBytes}.`)
  }
  if (report.css.gzipBytes > BUNDLE_BUDGET.cssGzipBytes) {
    violations.push(
      `Startup CSS gzip size ${report.css.gzipBytes} exceeds ${BUNDLE_BUDGET.cssGzipBytes}.`,
    )
  }

  return violations
}

export function formatBundleBudgetReport(report) {
  const rawReduction =
    (BUNDLE_BASELINE.javascriptRawBytes - report.javascript.rawBytes) /
    BUNDLE_BASELINE.javascriptRawBytes
  const gzipReduction =
    (BUNDLE_BASELINE.javascriptGzipBytes - report.javascript.gzipBytes) /
    BUNDLE_BASELINE.javascriptGzipBytes
  const settings = report.optionalFeatures.find((feature) => feature.label === "Settings")
  return [
    `Ordinary-chat startup JS: ${report.javascript.rawBytes} raw / ${report.javascript.gzipBytes} gzip (${percent(rawReduction)} raw, ${percent(gzipReduction)} gzip reduction).`,
    `Initial CSS: ${report.css.rawBytes} raw / ${report.css.gzipBytes} gzip.`,
    `Settings feature: ${settings?.file ?? "missing"}; startup closure: ${report.closureFiles.join(", ")}.`,
  ].join("\n")
}
