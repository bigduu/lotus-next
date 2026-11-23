import tailwindcss from "@tailwindcss/vite"
import solid from "@solidjs/vite-plugin"
import { defineConfig, loadEnv, type ConfigEnv, type Plugin, type UserConfig } from "vite"
import {
  assertSafePublicBuildEnvironment, bundleOwnershipPlugin, developmentProxy, packageNameFromModuleId, portableArtifactBase, sourceAliases,
} from "./vite.shared.ts"

function assertSolidRuntime(): Plugin {
  const reactRuntime = /^(?:(?:@[^/]+\/)?(?:react(?:-.*)?|.+-react)|streamdown|@streamdown\/[^/]+)$/
  return {
    name: "lotus-next-solid-runtime",
    generateBundle(_options, bundle) {
      for (const entry of Object.values(bundle)) {
        if (entry.type !== "chunk") continue
        const incompatible = Object.keys(entry.modules).find((id) => {
          const pkg = packageNameFromModuleId(id)
          return pkg && reactRuntime.test(pkg)
        })
        if (incompatible) this.error(`Solid application imports a React runtime: ${incompatible}`)
      }
    },
  }
}

export function configureSolidApplication(
  { mode }: ConfigEnv,
  output: "application" | "preview" | "candidate",
): UserConfig {
  assertSafePublicBuildEnvironment(loadEnv(mode, process.cwd(), "VITE_"))
  const application = output === "application"
  const entries = output === "preview" ? ["index.html", "solid-preview.html"] : ["index.html"]

  return {
    appType: application ? "spa" : "mpa",
    base: portableArtifactBase,
    cacheDir: application ? undefined : "node_modules/.vite-solid-preview",
    optimizeDeps: { entries },
    plugins: [solid(), tailwindcss(), assertSolidRuntime(), bundleOwnershipPlugin()],
    resolve: { alias: sourceAliases },
    server: {
      host: application ? true : "127.0.0.1",
      port: application ? 9563 : 9573,
      strictPort: true,
      proxy: developmentProxy,
    },
    build: {
      outDir: application ? "dist" : output === "candidate" ? "dist-solid-artifact" : "dist-solid-preview",
      manifest: "asset-manifest.json",
      rollupOptions: { input: entries },
    },
  }
}

export default defineConfig((environment) => configureSolidApplication(
  environment,
  environment.mode === "solid-artifact" ? "candidate" : "preview",
))
