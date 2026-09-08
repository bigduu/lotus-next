import { createServer } from "node:http"
import { readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import ts from "typescript"
import { expect, test } from "@playwright/test"

test("real HTTP null-body responses survive the transport without response reconstruction", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-chromium", "native Fetch regression")
  const modules = new Map<string, string>()
  for (const name of ["transport", "errors"]) {
    const source = await readFile(fileURLToPath(new URL(`../src/services/api/${name}.ts`, import.meta.url)), "utf8")
    modules.set(`/${name}`, ts.transpileModule(source, {
      compilerOptions: { target: ts.ScriptTarget.ES2023, module: ts.ModuleKind.ESNext },
    }).outputText)
  }
  // A real HTTP server deliberately bypasses Playwright route fulfillment:
  // native Chromium fetch can expose a non-null stream for these responses.
  const server = createServer((request, response) => {
    const pathname = request.url ?? "/"
    if (modules.has(pathname)) {
      response.writeHead(200, { "content-type": "text/javascript" })
      response.end(modules.get(pathname))
    } else if (/^\/status\/(204|205|304)$/.test(pathname)) {
      response.writeHead(Number(pathname.split("/").at(-1)), {
        "x-response-marker": "preserved", "cache-control": "no-store",
      })
      response.end()
    } else {
      response.writeHead(200, { "content-type": "text/html" })
      response.end("<!doctype html><title>Native HTTP response regression</title>")
    }
  })
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
  try {
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Missing test server address")
    const origin = `http://127.0.0.1:${address.port}`
    await page.goto(origin)
    const results = await page.evaluate(async (moduleUrl) => {
      const { HttpTransport } = await import(moduleUrl)
      const results = []
      for (const status of [204, 205, 304]) {
        let nativeResponse: Response | undefined
        const transport = new HttpTransport({
          fetchImplementation: async (input: string, init: RequestInit) => {
            nativeResponse = await fetch(input, init)
            return nativeResponse
          },
        })
        const response = await transport.request(`/status/${status}`, { method: status === 304 ? "GET" : "DELETE" })
        results.push({
          status: response.status,
          bodyIsNull: response.body === null,
          sameResponse: response === nativeResponse,
          ok: response.ok,
          marker: response.headers.get("x-response-marker"),
          text: await response.text(),
        })
      }
      return results
    }, `${origin}/transport`)
    expect(results).toEqual([204, 205, 304].map((status) => ({
      status, bodyIsNull: expect.any(Boolean), sameResponse: true,
      ok: status < 300, marker: "preserved", text: "",
    })))
    await testInfo.attach("native-null-body-responses", {
      body: JSON.stringify(results, null, 2), contentType: "application/json",
    })
  } finally {
    server.closeAllConnections()
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
  }
})
