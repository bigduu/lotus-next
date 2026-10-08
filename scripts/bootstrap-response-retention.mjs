import { createHash } from "node:crypto"
import { mkdirSync, writeFileSync } from "node:fs"
import path from "node:path"
import { pathToFileURL } from "node:url"

const bodyLimit = 1024 * 1024
const isBootstrap = (url) => new URL(url).pathname === "/api/v1/bootstrap"

// Use a dedicated public CDP session. Its durable buffer preserves the body
// of the browser's actual request; no HTTP replay or application interception.
export const retainBootstrapResponseBodies = (browser) => {
  const originalNewContext = browser.newContext
  const evidence = []
  browser.newContext = async function (...arguments_) {
    const context = await originalNewContext.apply(this, arguments_)
    const originalNewPage = context.newPage
    context.newPage = async function (...pageArguments) {
      const page = await originalNewPage.apply(this, pageArguments)
      const session = await context.newCDPSession(page)
      // This release spec gives each surface a fresh page. Keep a single-use
      // Playwright Request binding across navigation, never a per-document reset.
      // A second bootstrap is rejected before any old CDP body can be reused.
      let bootstrapRequest
      let bootstrapRequestCount = 0
      page.on("request", (request) => {
        if (!isBootstrap(request.url())) return
        bootstrapRequestCount++
        bootstrapRequest ??= request
      })
      const assertSingleRequest = (request) => {
        if (bootstrapRequestCount !== 1 || bootstrapRequest !== request) {
          throw new Error("Bootstrap evidence requires one unique request on a fresh page")
        }
      }
      const records = new Map()
      const waiters = new Set()
      const progress = () => { for (const wake of waiters) wake(); waiters.clear() }
      session.on("Network.requestWillBeSent", ({ requestId, request }) => {
        if (!isBootstrap(request.url)) return
        let resolveBody, rejectBody
        const body = new Promise((resolve, reject) => { resolveBody = resolve; rejectBody = reject })
        void body.catch(() => {}) // The original observer reports read failures.
        const record = {
          requestId, url: request.url, method: request.method,
          body, resolveBody, rejectBody,
          receipt: { requestId, url: request.url, method: request.method,
            viewport: arguments_[0]?.viewport ?? null, status: null },
        }
        // A redirect cannot reuse an already bound body as bootstrap evidence.
        if (records.has(requestId)) records.get(requestId).rejectBody(new Error("Bootstrap request redirected"))
        records.set(requestId, record)
        evidence.push(record.receipt)
        progress()
      })
      session.on("Network.responseReceived", ({ requestId, response }) => {
        const record = records.get(requestId)
        if (!record) return
        record.receipt.status = response.status
        record.responseUrl = response.url
        progress()
      })
      session.on("Network.loadingFailed", ({ requestId, errorText }) => {
        const record = records.get(requestId)
        if (record) { record.receipt.error = errorText; record.rejectBody(new Error(errorText)) }
      })
      session.on("Network.loadingFinished", ({ requestId }) => {
        const record = records.get(requestId)
        if (!record) return
        void session.send("Network.getResponseBody", { requestId }).then(({ body, base64Encoded }) => {
          const bytes = Buffer.from(body, base64Encoded ? "base64" : "utf8")
          if (bytes.length > bodyLimit) throw new Error("Bootstrap response exceeds the evidence body limit")
          record.receipt.bodyBytes = bytes.length
          record.receipt.bodySha256 = createHash("sha256").update(bytes).digest("hex")
          record.resolveBody(bytes)
        }).catch((error) => { record.receipt.error = String(error); record.rejectBody(error) })
      })
      // Register before returning the page, ahead of the unchanged observer.
      page.on("response", (response) => {
        if (!isBootstrap(response.url()) || !response.ok()) return
        const request = response.request()
        response.json = async () => {
          assertSingleRequest(request)
          const deadline = performance.now() + 10_000
          let matches
          for (;;) {
            matches = [...records.values()].filter((record) =>
              record.url === response.url() && record.responseUrl === response.url() &&
              record.method === response.request().method() && record.receipt.status === response.status())
            if (matches.length) break
            await new Promise((resolve, reject) => {
              const wake = () => { clearTimeout(timer); waiters.delete(wake); resolve() }
              const timer = setTimeout(() => { waiters.delete(wake); reject(new Error("Missing matching bootstrap CDP response")) },
                Math.max(0, deadline - performance.now()))
              waiters.add(wake)
            })
          }
          if (matches.length !== 1) throw new Error("Ambiguous bootstrap CDP response identity")
          // JSON syntax/contract, duplicate requests and HTTP/browser errors
          // remain subject to the original observer and canonical assertions.
          const bytes = await matches[0].body
          assertSingleRequest(request)
          return JSON.parse(bytes.toString("utf8"))
        }
      })
      await session.send("Network.enable", {
        maxTotalBufferSize: 64 * bodyLimit,
        maxResourceBufferSize: bodyLimit,
        enableDurableMessages: true,
      })
      return page
    }
    return context
  }
  return {
    evidence,
    restore() { browser.newContext = originalNewContext },
  }
}

// Run the frozen source's original spec/config from a temporary control file.
// Only evidence retention is added; source files, assertions and retry policy
// are untouched. Paths stay outside the clean candidate checkout.
export const writeRetainedAcceptanceConfig = ({ directory, sourceDirectory }) => {
  mkdirSync(directory, { recursive: true })
  const url = (relative) => pathToFileURL(path.join(sourceDirectory, relative)).href
  const testModule = url("node_modules/@playwright/test/index.mjs")
  const helperModule = import.meta.url
  writeFileSync(path.join(directory, "real-bamboo-published-surfaces.spec.mjs"), `
import { test } from ${JSON.stringify(testModule)}
import { retainBootstrapResponseBodies } from ${JSON.stringify(helperModule)}
import ${JSON.stringify(url("e2e/real-bamboo-published-surfaces.spec.ts"))}
let collector
test.beforeEach(({ browser }) => { collector = retainBootstrapResponseBodies(browser) })
test.afterEach(async ({}, testInfo) => {
  collector?.restore()
  if (collector) await testInfo.attach("retained bootstrap HTTP evidence", {
    body: Buffer.from(JSON.stringify(collector.evidence, null, 2)), contentType: "application/json",
  })
})
`)
  const configPath = path.join(directory, "playwright.retained-bootstrap.config.mjs")
  writeFileSync(configPath, `
import original from ${JSON.stringify(url("playwright.real-bamboo.config.ts"))}
import path from "node:path"
const sourceDirectory = ${JSON.stringify(sourceDirectory)}
export default {
  ...original,
  testDir: ${JSON.stringify(directory)},
  testMatch: "real-bamboo-published-surfaces.spec.mjs",
  globalSetup: path.join(sourceDirectory, "e2e/support/realBambooRuntime.ts"),
  outputDir: path.resolve(sourceDirectory, original.outputDir),
  reporter: original.reporter.map(([name, options]) => [name, options?.outputFolder
    ? { ...options, outputFolder: path.resolve(sourceDirectory, options.outputFolder) } : options]),
}
`)
  return configPath
}
