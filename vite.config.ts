import path from "node:path"
import { defineConfig } from "vite"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"

// https://vite.dev/config/
export default defineConfig({
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
          if (id.includes("/react/") || id.includes("/react-dom/") || id.includes("/scheduler/"))
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
})
