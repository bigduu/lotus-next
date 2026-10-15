import { describe, expect, it, vi } from "vitest"
import { preflightArtifactSurface } from "../e2e/support/transientNavigation.ts"

const ready = (url, status = 200, body = { status: "ok", version: "test" }) => ({
  url: () => url, status: () => status, ok: () => status >= 200 && status < 300,
  json: vi.fn(async () => body),
})
const harness = (results) => {
  const goto = vi.fn()
  for (const value of results) {
    if (value instanceof Error) goto.mockRejectedValueOnce(value)
    else goto.mockResolvedValueOnce(value)
  }
  const closePage = vi.fn(async () => {})
  const page = { goto, close: closePage }
  const context = { newPage: vi.fn(async () => page), close: vi.fn(async () => {}) }
  const browser = { newContext: vi.fn(async () => context) }
  return { browser, context, goto, closePage }
}

describe("artifact browser readiness preflight", () => {
  it.each(["http://127.0.0.1:18080/", "https://remote.lotus.test:18443/"])(
    "stabilizes only readiness before the first observed app document: %s", async (url) => {
      const target = new URL("/readyz", url).href
      const h = harness([ready(target)])
      await preflightArtifactSurface(h.browser, new URL(url))
      expect(h.goto.mock.calls).toEqual([[target, { waitUntil: "networkidle" }]])
      expect(h.browser.newContext).toHaveBeenCalledWith({ ignoreHTTPSErrors: url.startsWith("https:") })
      expect(h.context.close).toHaveBeenCalledOnce()
    },
  )

  it.each([
    null,
    ready("http://foreign.test/readyz"),
    ready("http://127.0.0.1:18080/"),
    ready("http://127.0.0.1:18080/readyz", 503),
    ready("http://127.0.0.1:18080/readyz", 200, { status: "starting", version: "test" }),
    ready("http://127.0.0.1:18080/readyz", 200, { status: "ok" }),
  ])("rejects an unverified readiness response without retry", async (result) => {
    const h = harness([result])
    await expect(preflightArtifactSurface(h.browser, new URL("http://127.0.0.1:18080/"))).rejects.toThrow()
    expect(h.goto).toHaveBeenCalledOnce()
    expect(h.context.close).toHaveBeenCalledOnce()
  })

  it("retries only an exact network transition, with the app still unopened", async () => {
    const target = "http://127.0.0.1:18080/readyz"
    const h = harness([new Error("page.goto: net::ERR_NETWORK_CHANGED"), ready(target)])
    await preflightArtifactSurface(h.browser, new URL("http://127.0.0.1:18080/"))
    expect(h.goto.mock.calls).toEqual([[target, { waitUntil: "networkidle" }], [target, { waitUntil: "networkidle" }]])
    expect(h.context.close).toHaveBeenCalledOnce()
  })

  it.each(["net::ERR_CONNECTION_RESET", "net::ERR_CERT_AUTHORITY_INVALID", "Timeout 30000ms exceeded"])(
    "retains unrelated navigation failures: %s", async (message) => {
      const failure = new Error(message), h = harness([failure])
      await expect(preflightArtifactSurface(h.browser, new URL("http://127.0.0.1:18080/"))).rejects.toBe(failure)
      expect(h.goto).toHaveBeenCalledOnce()
      expect(h.context.close).toHaveBeenCalledOnce()
    },
  )

  it("bounds repeated network transitions", async () => {
    const failure = new Error("page.goto: net::ERR_NETWORK_CHANGED"), h = harness([failure, failure])
    await expect(preflightArtifactSurface(h.browser, new URL("http://127.0.0.1:18080/"))).rejects.toBe(failure)
    expect(h.goto).toHaveBeenCalledTimes(2)
    expect(h.context.close).toHaveBeenCalledOnce()
  })

  it.each(["http://127.0.0.1:18080", "https://remote.lotus.test:18443"])(
    "replaces only a preceding network-change error page: %s", async (origin) => {
      const target = origin + "/readyz"
      const h = harness([
        new Error("page.goto: net::ERR_NETWORK_CHANGED"),
        new Error(`page.goto: Navigation to "${target}" is interrupted by another navigation to "chrome-error://chromewebdata/"`),
        ready(target),
      ])
      await preflightArtifactSurface(h.browser, new URL(origin))
      expect(h.goto).toHaveBeenCalledTimes(3)
      expect(h.closePage).toHaveBeenCalledOnce()
      expect(h.context.newPage).toHaveBeenCalledTimes(2)
      expect(h.context.close).toHaveBeenCalledOnce()
    },
  )

  it("does not retry invalid JSON or any response-body error", async () => {
    const response = ready("http://127.0.0.1:18080/readyz")
    const failure = new SyntaxError("invalid readiness JSON")
    response.json.mockRejectedValueOnce(failure)
    const h = harness([response])
    await expect(preflightArtifactSurface(h.browser, new URL("http://127.0.0.1:18080/"))).rejects.toBe(failure)
    expect(h.goto).toHaveBeenCalledOnce()
    expect(h.context.close).toHaveBeenCalledOnce()
  })
})
