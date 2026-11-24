import path from "node:path"
import { configDefaults, defineConfig } from "vitest/config"
import solid from "@solidjs/vite-plugin"

const solidSource = /[\\/]src[\\/]solid[\\/]/

export default defineConfig({
  plugins: [solid({ include: solidSource, refresh: false })],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@services": path.resolve(__dirname, "./src/services"),
      "@shared": path.resolve(__dirname, "./src/shared"),
      "@pages": path.resolve(__dirname, "./src/pages"),
    },
  },
  test: {
    exclude: [...configDefaults.exclude, "e2e/**"],
    environment: "jsdom",
    environmentOptions: {
      jsdom: {
        url: "http://localhost:9563/",
      },
    },
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
    restoreMocks: true,
    unstubEnvs: true,
    unstubGlobals: true,
  },
})
