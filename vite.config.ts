import path from "node:path"
import { readFile } from "node:fs/promises"
import MagicString from "magic-string"
import { defineConfig, loadEnv, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

import { assertSafePublicBuildEnvironment, bundleOwnershipPlugin, developmentProxy, packageNameFromModuleId, portableArtifactBase, sourceAliases } from "./vite.shared.ts"
export { assertSafePublicBuildEnvironment, developmentProxy, portableArtifactBase, sourceAliases } from "./vite.shared.ts"

/** The 1.1.8 tarball omits the TS source referenced by its published map. */
export function rehypeHardenDevelopmentSourceMap(): Plugin {
  return {
    name: "lotus-next-rehype-harden-development-sourcemap",
    apply: "serve",
    enforce: "pre",
    async load(id) {
      const file = id.split("?", 1)[0]
      if (!file.replaceAll("\\", "/").endsWith("/node_modules/rehype-harden/dist/index.js")) return
      const metadata = await readFile(path.resolve(path.dirname(file), "../package.json"), "utf8")
      const packageInfo = JSON.parse(metadata)
      if (packageInfo.version !== "1.1.8") return
      const publishedMap = await readFile(`${file}.map`, "utf8")
      const map = JSON.parse(publishedMap)
      if (map.sources?.length !== 1 ||
        map.sources[0] !== "../src/index.ts" || map.sourcesContent?.[0] != null) return

      const code = await readFile(file, "utf8")
      // Preserve the shipped sanitizer byte-for-byte and map to that actual
      // source, rather than retaining coordinates for unpublished TypeScript.
      return {
        code,
        map: new MagicString(code).generateMap({ source: file, includeContent: true, hires: true }),
      }
    },
  }
}

const STREAMDOWN_PACKAGES = new Set([
  "@streamdown/cjk",
  "remend",
  "remark-cjk-friendly",
  "remark-cjk-friendly-gfm-strikethrough",
  "streamdown",
])

// `html-url-attributes` is shared by Streamdown and the HAST renderer. Let
// Rolldown place it in a neutral shared chunk: forcing it into either vendor
// group creates a vendor-streamdown <-> vendor-markdown initialization cycle.

const STREAMDOWN_CODE_PACKAGES = new Set([
  "@shikijs/core",
  "@shikijs/engine-javascript",
  "@shikijs/engine-oniguruma",
  "@shikijs/langs",
  "@shikijs/themes",
  "@shikijs/types",
  "@shikijs/vscode-textmate",
  "@streamdown/code",
  "hast-util-to-html",
  "oniguruma-parser",
  "oniguruma-to-es",
  "regex",
  "regex-recursion",
  "regex-utilities",
  "shiki",
])

const MERMAID_PACKAGES = new Set([
  "@antfu/install-pkg",
  "@braintree/sanitize-url",
  "@iconify/types",
  "@iconify/utils",
  "@mermaid-js/parser",
  "@streamdown/mermaid",
  "@upsetjs/venn.js",
  "commander",
  "cose-base",
  "cytoscape",
  "cytoscape-cose-bilkent",
  "cytoscape-fcose",
  "d3",
  "d3-array",
  "d3-sankey",
  "d3-shape",
  "dagre-d3-es",
  "dayjs",
  "delaunator",
  "dompurify",
  "es-toolkit",
  "hachure-fill",
  "import-meta-resolve",
  "internmap",
  "katex",
  "khroma",
  "layout-base",
  "lodash-es",
  "marked",
  "mermaid",
  "path-data-parser",
  "points-on-curve",
  "points-on-path",
  "robust-predicates",
  "roughjs",
  "rw",
  "stylis",
  "ts-dedent",
  "uuid",
])

const MARKDOWN_SUPPORT_PACKAGES = new Set([
  "@ungap/structured-clone",
  "bail",
  "ccount",
  "character-entities-html4",
  "character-entities-legacy",
  "character-reference-invalid",
  "comma-separated-tokens",
  "decode-named-character-reference",
  "devlop",
  "entities",
  "escape-string-regexp",
  "estree-util-is-identifier-name",
  "extend",
  "get-east-asian-width",
  "html-void-elements",
  "inline-style-parser",
  "is-alphabetical",
  "is-alphanumerical",
  "is-decimal",
  "is-hexadecimal",
  "is-plain-obj",
  "longest-streak",
  "markdown-table",
  "parse-entities",
  "parse5",
  "space-separated-tokens",
  "stringify-entities",
  "style-to-js",
  "style-to-object",
  "trim-lines",
  "trough",
  "unified",
  "unist-util-stringify-position",
  "vfile",
  "vfile-location",
  "vfile-message",
  "web-namespaces",
  "zwitch",
])

/** Keep every expensive assistant renderer graph behind its owning dynamic import. */
export function classifyVendorChunk(id: string): string | undefined {
  const normalized = id.replaceAll("\\", "/")
  const packageName = packageNameFromModuleId(normalized)
  if (!packageName) return undefined

  // Streamdown carries a separate nested marked version; classify by ancestry
  // before the root Mermaid dependency's package-name rule.
  if (normalized.includes("/node_modules/streamdown/node_modules/") || STREAMDOWN_PACKAGES.has(packageName)) {
    return "vendor-streamdown"
  }
  if (STREAMDOWN_CODE_PACKAGES.has(packageName)) return "vendor-streamdown-code"
  if (MERMAID_PACKAGES.has(packageName) || packageName.startsWith("d3-")) {
    return "vendor-mermaid"
  }
  if (packageName === "react-syntax-highlighter" || packageName === "refractor") {
    return "vendor-highlighter"
  }
  if (
    packageName === "react-markdown" ||
    packageName.startsWith("remark") ||
    packageName.startsWith("rehype") ||
    packageName.startsWith("micromark") ||
    packageName.startsWith("hast") ||
    packageName.startsWith("mdast") ||
    packageName.startsWith("unist") ||
    packageName === "property-information" ||
    packageName === "character-entities" ||
    MARKDOWN_SUPPORT_PACKAGES.has(packageName)
  ) {
    return "vendor-markdown"
  }
  if (packageName === "react" || packageName === "react-dom" || packageName === "scheduler") {
    return "vendor-react"
  }
  // Unknown packages follow the owning static/dynamic application graph. A
  // catch-all vendor group would eagerly merge Settings- and PDF-only packages
  // into Root merely because Root also imports unrelated third-party code.
  return undefined
}

export const developmentDependencyOptimization = {
  // Streamdown ships internal lazy ESM chunks. If Vite re-optimizes an
  // unrelated dependency during HMR, WebKit can retain the immutable optimized
  // entry while its generated child filename has changed, leaving a request to
  // a removed `highlighted-body-*` file that Vite answers with 504. Serving the
  // valid ESM package directly keeps those internal URLs stable.
  exclude: ["streamdown"],
  // These plugins are intentionally reached only by assistant-content paths.
  // Pre-bundle them at startup so the first code block or Mermaid diagram does
  // not trigger another dependency-optimizer pass mid-session. Streamdown's
  // raw dependency graph also reaches CommonJS leaves through micromark,
  // unified, and hast-util-to-jsx-runtime; those leaves must stay optimized
  // when their ESM parent is excluded (per Vite's nested-dep include contract).
  include: [
    "@streamdown/cjk",
    "@streamdown/code",
    "@streamdown/mermaid",
    "streamdown > debug",
    "streamdown > extend",
    "streamdown > style-to-js",
  ],
} as const

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const publicEnvironment = loadEnv(mode, process.cwd(), "VITE_")
  assertSafePublicBuildEnvironment(publicEnvironment)

  return {
    base: portableArtifactBase,
    plugins: [react(), tailwindcss(), rehypeHardenDevelopmentSourceMap(), bundleOwnershipPlugin()],
    optimizeDeps: {
      exclude: [...developmentDependencyOptimization.exclude],
      include: [...developmentDependencyOptimization.include],
    },
    build: {
      // The package verifier follows this exact generated graph when enforcing
      // the ordinary-chat startup budget and optional-feature boundaries.
      manifest: "asset-manifest.json",
      rollupOptions: {
        output: {
          // Keep a lazily imported package's dependency graph out of unrelated
          // vendor groups. Recursive capture can merge shared Markdown support
          // into the legacy Prism chunk, making plain Streamdown prose download
          // the highlighter before any fenced code is rendered.
          codeSplitting: {
            includeDependenciesRecursively: false,
            groups: [
              {
                name: (id) => classifyVendorChunk(id) ?? null,
                test: /node_modules[\\/]/,
              },
            ],
          },
          // Vendor-only split (node_modules only — never app code, which would
          // risk module-init-order bugs). Heavy deps load in parallel + cache well.
        },
      },
    },
    resolve: {
      alias: sourceAliases,
    },
    server: {
      port: 9563,
      strictPort: true,
      host: true, // expose on the LAN so it can be reached / tunnelled separately
      // Proxy the bamboo API to the existing :9562 instance so the dev app shares
      // the same backend + sessions (same-origin → no CORS; loopback bypasses the
      // access password). The old lotus on :9562 stays untouched.
      proxy: developmentProxy,
    },
  }
})
