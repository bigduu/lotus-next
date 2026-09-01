import path from "node:path"
import { defineConfig, loadEnv } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

const allowedPublicViteNames = new Set([
  "VITE_APP_REVISION",
  "VITE_APP_VERSION",
  "VITE_BACKEND_BASE_URL",
])

export const assertSafePublicBuildEnvironment = (
  environment: Readonly<Record<string, string | undefined>>,
) => {
  for (const name of Object.keys(environment)) {
    if (name.startsWith("VITE_") && !allowedPublicViteNames.has(name)) {
      throw new Error(`${name} is outside the exact Lotus Next public build variable schema.`)
    }
  }

  const backendBaseUrl = environment.VITE_BACKEND_BASE_URL?.trim()
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
  if (parsed.username || parsed.password) {
    throw new Error("VITE_BACKEND_BASE_URL must not contain credentials.")
  }
  if (parsed.search || parsed.hash) {
    throw new Error("VITE_BACKEND_BASE_URL must not contain a query or fragment.")
  }
  const pathname = parsed.pathname.replace(/\/+$/, "")
  if (pathname && pathname !== "/v1") {
    throw new Error("VITE_BACKEND_BASE_URL path must be empty or /v1.")
  }
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const publicEnvironment = loadEnv(mode, process.cwd(), "VITE_")
  assertSafePublicBuildEnvironment(publicEnvironment)

  return {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          // Vendor-only split (node_modules only — never app code, which would
          // risk module-init-order bugs). Heavy deps load in parallel + cache well.
          manualChunks(id) {
            if (!id.includes("node_modules")) return undefined
            if (id.includes("react-syntax-highlighter") || id.includes("refractor"))
              return "vendor-highlighter"
            if (
              id.includes("react-markdown") ||
              id.includes("/remark") ||
              id.includes("/rehype") ||
              id.includes("/micromark") ||
              id.includes("/hast") ||
              id.includes("/mdast") ||
              id.includes("/unist") ||
              id.includes("property-information") ||
              id.includes("character-entities")
            )
              return "vendor-markdown"
            if (
              id.includes("/react/") ||
              id.includes("/react-dom/") ||
              id.includes("/scheduler/")
            )
              return "vendor-react"
            return "vendor"
          },
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
      proxy: {
        "/v1": { target: "http://127.0.0.1:9562", changeOrigin: true },
        "/api": { target: "http://127.0.0.1:9562", changeOrigin: true },
        "/v2": { target: "http://127.0.0.1:9562", changeOrigin: true, ws: true },
      },
    },
  }
})
