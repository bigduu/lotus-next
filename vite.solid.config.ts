import tailwindcss from "@tailwindcss/vite"
import solid from "@solidjs/vite-plugin"
import { defineConfig, loadEnv, type Plugin, type PreviewServer, type ViteDevServer } from "vite"
import {
  assertSafePublicBuildEnvironment, bundleOwnershipPlugin, developmentProxy, packageNameFromModuleId, portableArtifactBase, sourceAliases,
} from "./vite.shared.ts"

const previewEntry = "solid-preview.html"
const candidateEntry = "solid-candidate.html"
const artifactEntry = "index.html"

function useSolidArtifactEntry(): Plugin {
  return {
    name: "lotus-solid-artifact-entry",
    transformIndexHtml: {
      order: "pre",
      handler(html) {
        const entry = 'src="/src/main.tsx"'
        if (!html.includes(entry)) throw new Error("The production application entry cannot be selected.")
        return html.replace(entry, 'src="/src/solid/entry.tsx"')
      },
    },
  }
}

function serveSolidIndex(): Plugin {
  const configure = (server: ViteDevServer | PreviewServer) => {
    server.middlewares.use((request, _response, next) => {
      // Both preview servers use the Solid entry at the URL printed by Vite.
      request.url = request.url?.replace(/^\/(?:index\.html)?(?=\?|$)/, `/${candidateEntry}`)
      next()
    })
  }
  return {
    name: "lotus-solid-preview-index",
    configureServer: configure,
    configurePreviewServer: configure,
  }
}

function assertSolidRuntime(): Plugin {
  const reactRuntime = /^(?:@[^/]+\/)?(?:react(?:-.*)?|.+-react)$/
  return {
    name: "lotus-solid-preview-runtime",
    generateBundle(_options, bundle) {
      for (const entry of Object.values(bundle)) {
        if (entry.type !== "chunk") continue
        const incompatible = Object.keys(entry.modules).find((id) => {
          const pkg = packageNameFromModuleId(id)
          return pkg && reactRuntime.test(pkg)
        })
        if (incompatible) this.error(`Solid preview imports a React runtime: ${incompatible}`)
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  assertSafePublicBuildEnvironment(loadEnv(mode, process.cwd(), "VITE_"))
  const artifact = mode === "solid-artifact"
  const entries = artifact ? [artifactEntry] : [previewEntry, candidateEntry]

  return {
    appType: "mpa",
    base: portableArtifactBase,
    cacheDir: "node_modules/.vite-solid-preview",
    optimizeDeps: { entries },
    plugins: [solid(), tailwindcss(), artifact ? useSolidArtifactEntry() : serveSolidIndex(), assertSolidRuntime(), bundleOwnershipPlugin()],
    resolve: { alias: sourceAliases },
    server: { host: "127.0.0.1", port: 9573, strictPort: true, proxy: developmentProxy },
    build: {
      outDir: artifact ? "dist-solid-artifact" : "dist-solid-preview",
      manifest: "asset-manifest.json",
      rollupOptions: { input: entries },
    },
  }
})
