import tailwindcss from "@tailwindcss/vite"
import solid from "@solidjs/vite-plugin"
import { defineConfig, loadEnv, type Plugin } from "vite"
import { assertSafePublicBuildEnvironment, portableArtifactBase, sourceAliases } from "./vite.config.ts"

function assertSolidRuntime(): Plugin {
  const reactRuntime = /[/\\]node_modules[/\\](react|react-dom|react-i18next)(?:[/\\]|$)/
  return {
    name: "lotus-solid-preview-runtime",
    generateBundle(_options, bundle) {
      for (const entry of Object.values(bundle)) {
        if (entry.type !== "chunk") continue
        const incompatible = Object.keys(entry.modules).find((id) => reactRuntime.test(id))
        if (incompatible) this.error(`Solid preview imports a React runtime: ${incompatible}`)
      }
    },
  }
}

export default defineConfig(({ mode }) => {
  assertSafePublicBuildEnvironment(loadEnv(mode, process.cwd(), "VITE_"))

  return {
    appType: "mpa",
    base: portableArtifactBase,
    plugins: [solid(), tailwindcss(), assertSolidRuntime()],
    resolve: { alias: sourceAliases },
    server: { host: "127.0.0.1", port: 9573, strictPort: true },
    build: {
      outDir: "dist-solid-preview",
      rollupOptions: { input: "solid-preview.html" },
    },
  }
})
