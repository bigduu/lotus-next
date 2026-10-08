import { EventEmitter } from "node:events"
import { createHash } from "node:crypto"
import { describe, expect, it, vi } from "vitest"
import { retainBootstrapResponseBodies } from "./bootstrap-response-retention.mjs"

const url = "http://127.0.0.1:18080/api/v1/bootstrap"
const fixture = async ({ contents = '{"actual":true}', failure, base64Encoded = false } = {}) => {
  const session = new EventEmitter()
  session.send = vi.fn(async (command) => {
    if (command === "Network.getResponseBody") {
      if (failure) throw failure
      return { body: base64Encoded ? Buffer.from(contents).toString("base64") : contents, base64Encoded }
    }
  })
  const page = new EventEmitter()
  const context = { newPage: async () => page, newCDPSession: async () => session }
  const browser = { newContext: async () => context }
  const originalNewContext = browser.newContext
  const collector = retainBootstrapResponseBodies(browser)
  await (await browser.newContext({ viewport: { width: 915, height: 412 } })).newPage()
  const exchange = (requestId = "actual-request", { method = "GET", responseUrl = url, status = 200 } = {}) => {
    session.emit("Network.requestWillBeSent", { requestId, request: { url, method } })
    session.emit("Network.responseReceived", { requestId, response: { url: responseUrl, status } })
    session.emit("Network.loadingFinished", { requestId })
  }
  const response = ({ method = "GET", status = 200 } = {}) => {
    const originalJson = vi.fn(async () => ({ fabricatedFallback: true }))
    const value = { url: () => url, ok: () => status >= 200 && status < 300,
      status: () => status, request: () => ({ method: () => method }), json: originalJson }
    page.emit("response", value)
    return { value, originalJson }
  }
  return { session, collector, browser, originalNewContext, exchange, response }
}

describe("release bootstrap response retention", () => {
  it("uses bytes from the bound actual request and records their digest", async () => {
    const f = await fixture({ base64Encoded: true })
    const { value, originalJson } = f.response()
    const result = value.json()
    f.exchange()
    await expect(result).resolves.toEqual({ actual: true })
    expect(originalJson).not.toHaveBeenCalled()
    expect(f.session.send).toHaveBeenCalledWith("Network.enable", {
      maxTotalBufferSize: 64 * 1024 * 1024, maxResourceBufferSize: 1024 * 1024, enableDurableMessages: true,
    })
    expect(f.collector.evidence).toEqual([{
      requestId: "actual-request", method: "GET", url, status: 200, viewport: { width: 915, height: 412 },
      bodyBytes: 15, bodySha256: createHash("sha256").update('{"actual":true}').digest("hex"),
    }])
    f.collector.restore()
    expect(f.browser.newContext).toBe(f.originalNewContext)
  })

  it("never substitutes another response or a fallback when CDP body retrieval fails", async () => {
    const f = await fixture({ failure: new Error("No data found for resource") })
    f.exchange()
    const { value, originalJson } = f.response()
    await expect(value.json()).rejects.toThrow("No data found for resource")
    expect(originalJson).not.toHaveBeenCalled()
    expect(f.session.send.mock.calls.filter(([name]) => name === "Network.getResponseBody")).toHaveLength(1)
    expect(f.collector.evidence[0]).not.toHaveProperty("bodySha256")
  })

  it.each(["malformed", "x".repeat(1024 * 1024 + 1)])("rejects invalid or oversized bodies", async (contents) => {
    const f = await fixture({ contents })
    f.exchange()
    await expect(f.response().value.json()).rejects.toThrow()
  })

  it("rejects an ambiguous repeated bootstrap rather than reusing the earlier body", async () => {
    const f = await fixture()
    f.exchange("first")
    f.exchange("second")
    await expect(f.response().value.json()).rejects.toThrow("Ambiguous bootstrap CDP response identity")
  })

  it.each([
    { method: "POST" }, { status: 201 }, { responseUrl: "http://other.test/api/v1/bootstrap" },
  ])("does not bind different method, status or response URL: %j", async (overrides) => {
    vi.useFakeTimers()
    try {
      const f = await fixture()
      f.exchange("other", overrides)
      const result = expect(f.response().value.json()).rejects.toThrow("Missing matching bootstrap CDP response")
      await vi.advanceTimersByTimeAsync(10_000)
      await result
    } finally { vi.useRealTimers() }
  })

  it("retains original HTTP error handling", async () => {
    const f = await fixture()
    const { value, originalJson } = f.response({ status: 403 })
    await value.json()
    expect(originalJson).toHaveBeenCalledOnce()
    expect(f.collector.evidence).toEqual([])
  })
})
