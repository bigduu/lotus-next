import path from "node:path"
import { defineConfig, loadEnv, type Plugin } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const allowedPublicViteNames = new Set([
  "VITE_APP_REVISION",
  "VITE_APP_VERSION",
  "VITE_BACKEND_BASE_URL",
])

const containsControlCharacter = (value: string): boolean =>
  Array.from(value).some((character) => {
    const codePoint = character.charCodeAt(0)
    return codePoint <= 0x1f || codePoint === 0x7f
  })

export const assertSafePublicBuildEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
) => {
  for (const name of Object.keys(environment)) {
    if (name.startsWith("VITE_") && !allowedPublicViteNames.has(name)) {
      throw new Error(`${name} is outside the exact Lotus Next public build variable schema.`)
    }
  }

  const rawBackendBaseUrl = environment.VITE_BACKEND_BASE_URL
  if (rawBackendBaseUrl && containsControlCharacter(rawBackendBaseUrl)) {
    throw new Error("VITE_BACKEND_BASE_URL must not contain control characters.")
  }
  const backendBaseUrl = rawBackendBaseUrl?.trim()
  if (!backendBaseUrl) return

  let parsed: URL
  try {
    parsed = new URL(backendBaseUrl)
  } catch {
    throw new Error("VITE_BACKEND_BASE_URL must be an absolute HTTP(S) URL.")
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("VITE_BACKEND_BASE_URL must use HTTP or HTTPS.")
  }
  if (backendBaseUrl.includes("\\")) {
    throw new Error("VITE_BACKEND_BASE_URL path must be empty or /api/v1.")
  }
  if (backendBaseUrl.includes("?") || backendBaseUrl.includes("#")) {
    throw new Error("VITE_BACKEND_BASE_URL must not contain a query or fragment.")
  }
  if (parsed.username || parsed.password) {
    throw new Error("VITE_BACKEND_BASE_URL must not contain credentials.")
  }
  const rawEndpoint = /^(?:https?):\/\/([^/]+)(\/.*)?$/i.exec(backendBaseUrl)
  if (!rawEndpoint) {
    throw new Error("VITE_BACKEND_BASE_URL must be an absolute HTTP(S) URL.")
  }
  if (rawEndpoint[1].includes("@")) {
    throw new Error("VITE_BACKEND_BASE_URL must not contain credentials.")
  }
  const rawPath = rawEndpoint[2] ?? ""
  if (/^\/v1\/*$/.test(rawPath)) {
    throw new Error(
      "VITE_BACKEND_BASE_URL must use the backend origin or canonical /api/v1; legacy /v1 is not supported by new builds.",
    )
  }
  const isBareOrigin = rawPath === "" || rawPath === "/"
  const isCanonicalApi = /^\/api\/v1\/*$/.test(rawPath)
  if (!isBareOrigin && !isCanonicalApi) {
    throw new Error("VITE_BACKEND_BASE_URL path must be empty or /api/v1.")
  }
}

const STREAMDOWN_PACKAGES = new Set([
  "@streamdown/cjk",
  "html-url-attributes",
  "remend",
  "remark-cjk-friendly",
  "remark-cjk-friendly-gfm-strikethrough",
  "streamdown",
])

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

function packageNameFromModuleId(id: string): string | undefined {
  const normalized = id.replaceAll("\\", "/")
  const marker = "/node_modules/"
  const packageStart = normalized.lastIndexOf(marker)
  if (packageStart < 0) return undefined
  const pathParts = normalized.slice(packageStart + marker.length).split("/")
  return pathParts[0]?.startsWith("@") ? pathParts.slice(0, 2).join("/") : pathParts[0]
}

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

function bundleOwnershipPlugin(): Plugin {
  let projectRoot = path.resolve(process.cwd())
  const cleanModuleId = (id: string): string =>
    (id.startsWith("\0") ? id.slice(1) : id).split("?", 1)[0]
  const projectModule = (id: string): string | undefined => {
    const cleanId = cleanModuleId(id)
    const relative = path.relative(projectRoot, cleanId).replaceAll("\\", "/")
    return relative.startsWith("src/") ? relative : undefined
  }
  const packageModule = (id: string): string | undefined =>
    packageNameFromModuleId(cleanModuleId(id))
  const uniqueSorted = (values: Array<string | undefined>): string[] =>
    [...new Set(values.filter((value): value is string => value !== undefined))].sort()

  return {
    name: "lotus-next-bundle-ownership",
    configResolved(config) {
      projectRoot = path.resolve(config.root)
    },
    generateBundle(_options, bundle) {
      const chunks = Object.values(bundle)
        .filter((output) => output.type === "chunk")
        .sort((left, right) => left.fileName.localeCompare(right.fileName))
        .reduce<Record<string, { modules: string[]; packages: string[] }>>((ownership, chunk) => {
          const moduleIds = Object.keys(chunk.modules)
          ownership[chunk.fileName] = {
            modules: uniqueSorted(moduleIds.map(projectModule)),
            packages: uniqueSorted(moduleIds.map(packageModule)),
          }
          return ownership
        }, {})

      this.emitFile({
        type: "asset",
        fileName: "bundle-ownership.json",
        source: `${JSON.stringify({ version: 2, chunks }, null, 2)}\n`,
      })
    },
  }
}

export const developmentProxy = {
  "/api": { target: "http://127.0.0.1:9562", changeOrigin: true },
  "/v2": { target: "http://127.0.0.1:9562", changeOrigin: true, ws: true },
}

// The published dist is mounted at an origin root by standalone Bamboo and at
// a nested path by embedded hosts. Relative entry URLs keep one immutable
// artifact portable across both placements; runtime API and WSS endpoints stay
// origin-rooted through runtimeConfig rather than inheriting this asset base.
export const portableArtifactBase = "./"

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const publicEnvironment = loadEnv(mode, process.cwd(), "VITE_")
  assertSafePublicBuildEnvironment(publicEnvironment)

  return {
    base: portableArtifactBase,
    plugins: [react(), tailwindcss(), bundleOwnershipPlugin()],
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
      alias: {
        "@": path.resolve(__dirname, "./src"),
        // Mirror lotus's aliases so ported backend/service/store modules resolve
        // verbatim without import rewrites.
        "@services": path.resolve(__dirname, "./src/services"),
        "@shared": path.resolve(__dirname, "./src/shared"),
        "@pages": path.resolve(__dirname, "./src/pages"),
        "@components": path.resolve(__dirname, "./src/components"),
        "@app": path.resolve(__dirname, "./src/app"),
      },
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
