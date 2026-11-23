import path from "node:path"
import type { Plugin } from "vite"

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

export function packageNameFromModuleId(id: string): string | undefined {
  const normalized = id.replaceAll("\\", "/")
  const marker = "/node_modules/"
  const packageStart = normalized.lastIndexOf(marker)
  if (packageStart < 0) return undefined
  const pathParts = normalized.slice(packageStart + marker.length).split("/")
  return pathParts[0]?.startsWith("@") ? pathParts.slice(0, 2).join("/") : pathParts[0]
}

export function bundleOwnershipPlugin(): Plugin {
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

export const sourceAliases = {
  "@": path.resolve(__dirname, "./src"),
  // Mirror lotus's aliases so ported backend/service/store modules resolve
  // verbatim without import rewrites.
  "@services": path.resolve(__dirname, "./src/services"),
  "@shared": path.resolve(__dirname, "./src/shared"),
  "@pages": path.resolve(__dirname, "./src/pages"),
  "@components": path.resolve(__dirname, "./src/components"),
  "@app": path.resolve(__dirname, "./src/app"),
}
