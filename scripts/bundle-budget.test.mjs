import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import path from "node:path"

import { afterEach, describe, expect, it } from "vitest"

import {
  BUNDLE_BASELINE,
  BUNDLE_BUDGET,
  analyzeBundleBudget,
  findBundleBudgetViolations,
} from "./bundle-budget.mjs"

const temporaryDirectories = []

const featureEntries = [
  ["src/solid/project-work/ProjectWorkBoard.tsx", "ProjectWorkBoard"],
  ["src/solid/workbench/browser/BrowserPane.tsx", "BrowserPane"],
  ["src/solid/composer/ComposerEditor.tsx", "ComposerEditor"],
  ["src/solid/settings/SettingsPage.tsx", "SettingsPage"],
  ["src/solid/markdown/AssistantMarkdown.tsx", "AssistantMarkdown"],
  ["src/solid/markdown/highlight/highlightCode.ts", "highlightCode"],
  ["src/solid/markdown/renderMermaid.ts", "renderMermaid"],
  ["src/solid/chat/export/renderPdf.ts", "renderPdf"],
  ["src/solid/chat/home/HomeDashboard.tsx", "HomeDashboard"],
  ["src/solid/shell/project-drag/SidebarProjectDrag.tsx", "SidebarProjectDrag"],
]

const createFixture = async ({
  leakSettings = false,
  leakProjectWork = false,
  projectWorkCss = false,
  leakBrowserPane = false,
  leakedOwnedModule,
  leakedOwnedPackage,
  missingSettingsOwnedModule,
  missingSettingsOwnedPackage,
  leakedRendererPackage,
  leakedReactPackage,
  missingMarkdownPackage,
  missingSolidEntry = false,
} = {}) => {
  const directory = await mkdtemp(path.join(tmpdir(), "lotus-next-bundle-budget-"))
  temporaryDirectories.push(directory)
  await mkdir(path.join(directory, "assets"), { recursive: true })

  const manifest = {
    "_runtime.js": {
      file: "assets/runtime.js",
      name: "rolldown-runtime",
    },
    "_web.js": {
      file: "assets/web.js",
      name: "web",
      imports: ["_runtime.js"],
    },
    "_vendor.js": {
      file: "assets/vendor.js",
      name: "vendor",
      imports: ["_runtime.js", "_web.js", "index.html"],
    },
    "index.html": {
      file: "assets/index.js",
      name: "index",
      src: "index.html",
      isEntry: true,
      imports: ["_runtime.js", "_web.js"],
      dynamicImports: ["src/solid/shell/SolidApp.tsx", "src/solid/bootstrap/Root.tsx"],
      css: ["assets/index.css"],
    },
    "src/solid/shell/SolidApp.tsx": {
      file: "assets/SolidApp.js",
      name: "SolidApp",
      src: "src/solid/shell/SolidApp.tsx",
      isDynamicEntry: true,
      imports: [
        "_runtime.js",
        "_web.js",
        "_vendor.js",
        ...(leakSettings ? ["src/solid/settings/SettingsPage.tsx"] : []),
        ...(leakProjectWork ? ["src/solid/project-work/ProjectWorkBoard.tsx"] : []),
        ...(leakBrowserPane ? ["src/solid/workbench/browser/BrowserPane.tsx"] : []),
      ],
      dynamicImports: ["src/solid/settings/SettingsPage.tsx"],
    },
    "src/solid/bootstrap/Root.tsx": {
      file: "assets/SolidRoot.js",
      name: "Root",
      src: "src/solid/bootstrap/Root.tsx",
      isDynamicEntry: true,
      imports: ["_runtime.js", "_web.js", "_vendor.js"],
    },
  }

  for (const [source, name] of featureEntries) {
    manifest[source] = {
      file: `assets/${name}.js`,
      name,
      src: source,
      isDynamicEntry: true,
      imports: ["_runtime.js", "_web.js"],
    }
  }
  if (projectWorkCss) manifest["src/solid/project-work/ProjectWorkBoard.tsx"].css = ["assets/ProjectWorkBoard.css"]

  await writeFile(
    path.join(directory, "index.html"),
    `<!doctype html><script type="module" src="/assets/index.js"></script><link rel="modulepreload" href="/assets/runtime.js"><link rel="modulepreload" href="/assets/web.js"><link rel="stylesheet" href="/assets/index.css">`,
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
  if (!missingSolidEntry) chunks["assets/index.js"].modules = ["src/solid/entry.tsx"]
  chunks["assets/AssistantMarkdown.js"].packages = ["unified", "remark-parse", "rehype-sanitize"]
    .filter((name) => name !== missingMarkdownPackage)
  if (leakedRendererPackage) chunks["assets/AssistantMarkdown.js"].packages.push(leakedRendererPackage)
  if (leakedReactPackage) chunks["assets/highlightCode.js"].packages.push(leakedReactPackage)
  chunks["assets/SettingsPage.js"] = {
    modules: [
      "src/solid/settings/SettingsPage.tsx",
      "src/solid/settings/metrics/SettingsMetrics.tsx",
      "src/solid/settings/plugins/SettingsPlugins.tsx",
      "src/services/metrics/MetricsService.ts",
      "src/services/plugin/PluginService.ts",
    ].filter((module) => module !== missingSettingsOwnedModule),
    packages: ["@kobalte/core"].filter((packageName) => packageName !== missingSettingsOwnedPackage),
  }
  if (leakedOwnedModule) chunks["assets/SolidApp.js"].modules.push(leakedOwnedModule)
  if (leakedOwnedPackage) chunks["assets/SolidApp.js"].packages.push(leakedOwnedPackage)
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
      "assets/SolidApp.js",
      "assets/SolidRoot.js",
      "assets/index.js",
      "assets/runtime.js",
      "assets/vendor.js",
      "assets/web.js",
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
    expect(report.javascript).toEqual({ rawBytes: 104, gzipBytes: 224 })
    expect(report.css).toEqual({ rawBytes: 17, gzipBytes: 37 })
    expect(findBundleBudgetViolations(report)).toEqual([])
  })

  it("rejects a Settings static-import regression even when the chunk still exists", async () => {
    const report = analyzeBundleBudget(await createFixture({ leakSettings: true }))

    expect(findBundleBudgetViolations(report)).toContain(
      "Settings leaked into the ordinary-chat startup closure.",
    )
    expect(report.forbiddenStartupModules).toContain("src/solid/settings/SettingsPage.tsx")
  })

  it("rejects an eager Project Work regression even when its optional chunk exists", async () => {
    const report = analyzeBundleBudget(await createFixture({ leakProjectWork: true }))
    expect(findBundleBudgetViolations(report)).toContain(
      "ProjectWorkBoard leaked into the ordinary-chat startup closure.",
    )
  })

  it("keeps lazy board CSS out of startup and counts it if the board becomes eager", async () => {
    const lazy = analyzeBundleBudget(await createFixture({ projectWorkCss: true }))
    const eager = analyzeBundleBudget(await createFixture({ projectWorkCss: true, leakProjectWork: true }))
    expect(lazy.cssFiles).toEqual(["assets/index.css"])
    expect(eager.cssFiles).toContain("assets/ProjectWorkBoard.css")
    expect(eager.css.rawBytes).toBeGreaterThan(lazy.css.rawBytes)
    expect(findBundleBudgetViolations(eager)).toContain("ProjectWorkBoard leaked into the ordinary-chat startup closure.")
  })

  it("rejects the optional BrowserPane view in the startup import graph", async () => {
    const report = analyzeBundleBudget(await createFixture({ leakBrowserPane: true }))
    expect(findBundleBudgetViolations(report)).toContain("BrowserPane leaked into the ordinary-chat startup closure.")
  })

  it.each([
    "src/solid/project-work/ProjectWorkBoard.tsx",
    "src/solid/settings/SettingsPage.tsx",
    "src/solid/workbench/browser/BrowserPane.tsx",
    "src/services/plugin/PluginService.ts",
    "src/services/metrics/MetricsService.ts",
    "src/solid/markdown/AssistantMarkdown.tsx",
    "src/solid/chat/export/renderPdf.ts",
    "src/solid/markdown/renderMermaid.ts",
    "src/shared/i18n/generated/frAutoOverrides.ts",
    "src/shared/i18n/generated/hiAutoOverrides.ts",
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
    const missing = "@kobalte/core"
    const report = analyzeBundleBudget(
      await createFixture({ missingSettingsOwnedPackage: missing }),
    )

    expect(report.missingSettingsOwnedPackages).toEqual([missing])
    expect(findBundleBudgetViolations(report).join("\n")).toContain(
      `Settings package ownership is incomplete: ${missing}.`,
    )
  })

  it("rejects a packed graph that bypasses the Solid composition root", async () => {
    const directory = await createFixture({ missingSolidEntry: true })
    expect(() => analyzeBundleBudget(directory)).toThrow(/must load the Solid composition root/)
  })

  it.each(["react", "@radix-ui/react-dialog", "streamdown", "@streamdown/code"])(
    "rejects %s anywhere in the packaged JavaScript graph", async (leakedReactPackage) => {
      const report = analyzeBundleBudget(await createFixture({ leakedReactPackage }))
      expect(findBundleBudgetViolations(report)).toContain(`Solid artifact contains React packages: ${leakedReactPackage}.`)
    },
  )

  it("requires first-pass Markdown parsing and sanitization without preloading heavy renderers", async () => {
    const report = analyzeBundleBudget(await createFixture({ missingMarkdownPackage: "rehype-sanitize", leakedRendererPackage: "shiki" }))
    expect(findBundleBudgetViolations(report)).toEqual([
      "Assistant Markdown first-render closure is incomplete: rehype-sanitize.",
      "Heavy plugins leaked into the plain assistant Markdown closure: shiki.",
    ])
  })

  it("keeps the historical baseline and the bounded approved editor allowance explicit", () => {
    expect(BUNDLE_BASELINE).toEqual({ javascriptRawBytes: 1_949_302, javascriptGzipBytes: 567_482 })
    expect(BUNDLE_BUDGET).toEqual({
      javascriptRawBytes: 1_900_000, javascriptGzipBytes: 595_000,
      minimumRawReduction: 0.02, minimumGzipReduction: -0.049,
      cssRawBytes: 109_000, cssGzipBytes: 18_500,
    })
  })

  it("enforces raw, gzip, historical-comparison, and CSS ceilings independently", async () => {
    const report = analyzeBundleBudget(await createFixture())
    const violations = findBundleBudgetViolations({
      ...report,
      javascript: { rawBytes: 1_950_000, gzipBytes: 600_000 },
      css: { rawBytes: BUNDLE_BUDGET.cssRawBytes + 1, gzipBytes: BUNDLE_BUDGET.cssGzipBytes + 1 },
    }).join("\n")

    expect(violations).toMatch(/raw size 1950000 exceeds 1900000/)
    expect(violations).toMatch(new RegExp(`gzip size 600000 exceeds ${BUNDLE_BUDGET.javascriptGzipBytes}`))
    expect(violations).toMatch(/raw reduction .* is below 2\.00%/)
    expect(violations).toMatch(/gzip reduction .* is below -4\.90%/)
    expect(violations).toContain(`CSS raw size ${BUNDLE_BUDGET.cssRawBytes + 1} exceeds ${BUNDLE_BUDGET.cssRawBytes}`)
    expect(violations).toContain(`CSS gzip size ${BUNDLE_BUDGET.cssGzipBytes + 1} exceeds ${BUNDLE_BUDGET.cssGzipBytes}`)
  })

  it("freezes the two immediate bootstrap owners and Root-owned Settings entry", async () => {
    const report = analyzeBundleBudget(await createFixture())
    const violations = findBundleBudgetViolations({
      ...report,
      immediateDynamicNames: ["Root", "Settings"],
      settingsIsOwnedByRoot: false,
    }).join("\n")

    expect(violations).toMatch(/must be exactly Root and SolidApp/)
    expect(violations).toMatch(/Root must own Settings through one direct dynamic feature entry/)
  })
})
