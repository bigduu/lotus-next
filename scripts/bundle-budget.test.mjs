import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  analyzeBundleBudget,
  findBundleBudgetViolations,
} from "./bundle-budget.mjs"

const temporaryDirectories = []

const featureEntries = [
  ["src/components/chat/Settings.tsx", "Settings"],
  ["src/components/chat/StreamdownMarkdown.tsx", "StreamdownMarkdown"],
  ["src/components/chat/StreamdownMermaid.tsx", "StreamdownMermaid"],
  ["src/components/chat/Markdown.tsx", "Markdown"],
  ["src/components/chat/CodeBlock.tsx", "CodeBlock"],
  ["src/components/chat/MermaidChart.tsx", "MermaidChart"],
  ["src/lib/export/renderPdf.tsx", "renderPdf"],
]

const vendorFeatureNames = [
  "vendor-streamdown",
  "vendor-streamdown-code",
  "vendor-markdown",
  "vendor-mermaid",
  "vendor-highlighter",
]

const createFixture = async ({
  leakSettings = false,
  leakedOwnedModule,
  leakedOwnedPackage,
  missingSettingsOwnedModule,
  missingSettingsOwnedPackage,
} = {}) => {
  const directory = await mkdtemp(path.join(tmpdir(), "lotus-next-bundle-budget-"))
  temporaryDirectories.push(directory)
  await mkdir(path.join(directory, "assets"), { recursive: true })

  const manifest = {
    "_runtime.js": {
      file: "assets/runtime.js",
      name: "rolldown-runtime",
    },
    "_react.js": {
      file: "assets/react.js",
      name: "vendor-react",
      imports: ["_runtime.js"],
    },
    "_vendor.js": {
      file: "assets/vendor.js",
      name: "vendor",
      imports: ["_runtime.js", "_react.js", "index.html"],
    },
    "index.html": {
      file: "assets/index.js",
      name: "index",
      src: "index.html",
      isEntry: true,
      imports: ["_runtime.js", "_react.js"],
      dynamicImports: ["src/Root.tsx", "src/components/app/ErrorBoundary.tsx"],
      css: ["assets/index.css"],
    },
    "src/Root.tsx": {
      file: "assets/Root.js",
      name: "Root",
      src: "src/Root.tsx",
      isDynamicEntry: true,
      imports: [
        "_runtime.js",
        "_react.js",
        "_vendor.js",
        ...(leakSettings ? ["src/components/chat/Settings.tsx"] : []),
      ],
      dynamicImports: ["src/components/chat/Settings.tsx"],
    },
    "src/components/app/ErrorBoundary.tsx": {
      file: "assets/ErrorBoundary.js",
      name: "ErrorBoundary",
      src: "src/components/app/ErrorBoundary.tsx",
      isDynamicEntry: true,
      imports: ["_runtime.js", "_react.js", "_vendor.js"],
    },
  }

  for (const [source, name] of featureEntries) {
    manifest[source] = {
      file: `assets/${name}.js`,
      name,
      src: source,
      isDynamicEntry: true,
      imports: ["_runtime.js", "_react.js"],
    }
  }
  for (const name of vendorFeatureNames) {
    manifest[`_${name}.js`] = {
      file: `assets/${name}.js`,
      name,
      imports: ["_runtime.js"],
    }
  }

  await writeFile(
    path.join(directory, "index.html"),
    `<!doctype html><script type="module" src="/assets/index.js"></script><link rel="modulepreload" href="/assets/runtime.js"><link rel="modulepreload" href="/assets/react.js"><link rel="stylesheet" href="/assets/index.css">`,
  )
  await writeFile(
    path.join(directory, "asset-manifest.json"),
    JSON.stringify(manifest, null, 2),
  )

  const assetFiles = new Set(
    Object.values(manifest).flatMap((entry) => [entry.file, ...(entry.css ?? [])]),
  )
  for (const file of assetFiles) {
    await writeFile(path.join(directory, file), `${file}\n`)
  }
  const chunks = Object.fromEntries([...assetFiles]
    .filter((file) => file.endsWith(".js"))
    .map((file) => [file, { modules: [], packages: [] }]))
  chunks["assets/Settings.js"] = {
    modules: [
      "src/components/chat/Settings.tsx",
      "src/components/chat/settings/SettingsMetrics.tsx",
      "src/components/chat/settings/SettingsPlugins.tsx",
      "src/services/metrics/MetricsService.ts",
      "src/services/plugin/PluginService.ts",
    ].filter((module) => module !== missingSettingsOwnedModule),
    packages: [
      "@radix-ui/react-label",
      "@radix-ui/react-switch",
    ].filter((packageName) => packageName !== missingSettingsOwnedPackage),
  }
  if (leakedOwnedModule) chunks["assets/Root.js"].modules.push(leakedOwnedModule)
  if (leakedOwnedPackage) chunks["assets/Root.js"].packages.push(leakedOwnedPackage)
  await writeFile(
    path.join(directory, "bundle-ownership.json"),
    JSON.stringify({ version: 2, chunks }, null, 2),
  )

  return directory
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  )
})

describe("ordinary-chat production bundle budget", () => {
  it("follows the generated HTML/manifest graph without traversing optional features", async () => {
    const report = analyzeBundleBudget(await createFixture())

    expect(report.closureFiles).toEqual([
      "assets/ErrorBoundary.js",
      "assets/Root.js",
      "assets/index.js",
      "assets/react.js",
      "assets/runtime.js",
      "assets/vendor.js",
    ])
    expect(report.cssFiles).toEqual(["assets/index.css"])
    expect(report.settingsIsOwnedByRoot).toBe(true)
    expect(report.forbiddenStartupModules).toEqual([])
    expect(report.leakedStartupPackages).toEqual([])
    expect(report.missingSettingsOwnedModules).toEqual([])
    expect(report.missingSettingsOwnedPackages).toEqual([])
    expect(report.optionalFeatures.every((feature) => !feature.inStartupClosure)).toBe(true)
    // Freeze the pako level/header contract so the Node 22/24 CI matrix proves
    // identical deterministic gzip accounting rather than merely passing a
    // generous ceiling with different compressor output.
    expect(report.javascript).toEqual({ rawBytes: 106, gzipBytes: 226 })
    expect(report.css).toEqual({ rawBytes: 17, gzipBytes: 37 })
    expect(findBundleBudgetViolations(report)).toEqual([])
  })

  it("rejects a Settings static-import regression even when the chunk still exists", async () => {
    const report = analyzeBundleBudget(await createFixture({ leakSettings: true }))

    expect(findBundleBudgetViolations(report)).toContain(
      "Settings leaked into the ordinary-chat startup closure.",
    )
    expect(report.forbiddenStartupModules).toContain("src/components/chat/Settings.tsx")
  })

  it.each([
    "src/services/plugin/PluginService.ts",
    "src/services/metrics/MetricsService.ts",
    "src/components/chat/streamdownConfig.ts",
    "src/lib/export/pdfPaginator.ts",
    "src/lib/mermaid/strictConfig.ts",
  ])("rejects optional application ownership leaked through a shared startup chunk: %s", async (module) => {
    const report = analyzeBundleBudget(await createFixture({ leakedOwnedModule: module }))

    expect(report.forbiddenStartupModules).toContain(module)
    expect(findBundleBudgetViolations(report).join("\n")).toMatch(
      /application modules leaked into startup/,
    )
  })

  it.each([
    "@babel/runtime",
    "@radix-ui/react-switch",
    "@radix-ui/react-label",
    "html2canvas",
    "jspdf",
    "canvg",
    "iobuffer",
    "svg-pathdata",
  ])("rejects optional package ownership leaked through a startup chunk: %s", async (packageName) => {
    const report = analyzeBundleBudget(await createFixture({ leakedOwnedPackage: packageName }))

    expect(report.leakedStartupPackages).toContain(packageName)
    expect(findBundleBudgetViolations(report).join("\n")).toMatch(
      /Settings\/PDF packages leaked into startup/,
    )
  })

  it("requires metrics and plugin implementation ownership in the Settings chunk", async () => {
    const missing = "src/services/plugin/PluginService.ts"
    const report = analyzeBundleBudget(
      await createFixture({ missingSettingsOwnedModule: missing }),
    )

    expect(report.missingSettingsOwnedModules).toEqual([missing])
    expect(findBundleBudgetViolations(report).join("\n")).toContain(
      `Settings feature ownership is incomplete: ${missing}.`,
    )
  })

  it("requires Settings-only package ownership in the Settings feature closure", async () => {
    const missing = "@radix-ui/react-switch"
    const report = analyzeBundleBudget(
      await createFixture({ missingSettingsOwnedPackage: missing }),
    )

    expect(report.missingSettingsOwnedPackages).toEqual([missing])
    expect(findBundleBudgetViolations(report).join("\n")).toContain(
      `Settings package ownership is incomplete: ${missing}.`,
    )
  })

  it("enforces raw, gzip, relative-improvement, and CSS ceilings independently", async () => {
    const report = analyzeBundleBudget(await createFixture())
    const violations = findBundleBudgetViolations({
      ...report,
      javascript: { rawBytes: 1_950_000, gzipBytes: 568_000 },
      css: { rawBytes: 105_001, gzipBytes: 18_001 },
    }).join("\n")

    expect(violations).toMatch(/raw size 1950000 exceeds 1820000/)
    expect(violations).toMatch(/gzip size 568000 exceeds 535000/)
    expect(violations).toMatch(/raw reduction .* is below 6\.00%/)
    expect(violations).toMatch(/gzip reduction .* is below 5\.00%/)
    expect(violations).toMatch(/CSS raw size 105001 exceeds 105000/)
    expect(violations).toMatch(/CSS gzip size 18001 exceeds 18000/)
  })

  it("freezes the two immediate bootstrap owners and Root-owned Settings entry", async () => {
    const report = analyzeBundleBudget(await createFixture())
    const violations = findBundleBudgetViolations({
      ...report,
      immediateDynamicNames: ["Root", "Settings"],
      settingsIsOwnedByRoot: false,
    }).join("\n")

    expect(violations).toMatch(/must be exactly ErrorBoundary and Root/)
    expect(violations).toMatch(/Root must own Settings through one direct dynamic feature entry/)
  })
})
