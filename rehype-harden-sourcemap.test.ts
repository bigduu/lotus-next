import path from "node:path"
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { createLogger, createServer } from "vite"
import { expect, it } from "vitest"
import { rehypeHardenDevelopmentSourceMap } from "./vite.config"

it("leaves a newer sanitizer without a published map to Vite", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "lotus-rehype-map-"))
  try {
    const packageRoot = path.join(root, "node_modules/rehype-harden")
    await mkdir(path.join(packageRoot, "dist"), { recursive: true })
    await writeFile(path.join(packageRoot, "package.json"), JSON.stringify({ version: "1.1.9" }))
    const load = rehypeHardenDevelopmentSourceMap().load
    if (typeof load !== "function") throw new Error("Expected a source-map load hook")
    await expect(load.call({} as never, path.join(packageRoot, "dist/index.js"))).resolves.toBeUndefined()
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

it("serves the published sanitizer with embedded, valid source coordinates", async () => {
  const warnings: string[] = []
  const logger = createLogger("silent")
  logger.warn = (message) => { warnings.push(message) }
  logger.warnOnce = logger.warn
  const server = await createServer({
    configFile: path.resolve("vite.config.ts"),
    customLogger: logger,
    server: { middlewareMode: true },
  })
  try {
    const file = path.resolve("node_modules/rehype-harden/dist/index.js")
    const publishedCode = await readFile(file, "utf8")
    const result = await server.transformRequest("/node_modules/rehype-harden/dist/index.js")
    expect(result?.code).toContain("export function harden")
    expect(result?.map?.sourcesContent).toContain(publishedCode)
    expect(result?.map?.sources.some((source) => path.basename(source) === "index.js")).toBe(true)
    expect(result?.map?.mappings).toBeTruthy()
    expect(warnings.filter((warning) => warning.includes("rehype-harden"))).toEqual([])
  } finally {
    await server.close()
  }
})
