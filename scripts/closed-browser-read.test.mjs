import { describe, expect, it } from "vitest"
import { assertClosedBrowserRead, closedBrowserResourceError, unexplainedBrowserErrors } from "../e2e/support/closedBrowserRead.ts"

const origin = "http://127.0.0.1:18080"
const sessionId = "selected"
const url = `${origin}/api/v1/browser/sessions/${sessionId}`
const receipt = () => ({
  response: { method: "GET", url, status: 404 },
  body: { error: { code: "browser_not_open", message: "browser session not open", type: "browser_error" } },
  beforeExplicitOpen: true,
  consoleErrors: [{ text: closedBrowserResourceError, url }],
})

describe("observed initial closed-browser read", () => {
  it("accounts for one validated pre-open response and its exact resource console message", () => {
    const read = receipt(), responses = [read.response], errors = [closedBrowserResourceError]
    expect(unexplainedBrowserErrors(responses, errors, read, origin, sessionId))
      .toEqual({ httpErrors: [], consoleErrors: [] })
    expect(responses).toEqual([read.response])
    expect(errors).toEqual([closedBrowserResourceError])
    read.consoleErrors = []
    expect(unexplainedBrowserErrors(responses, [], read, origin, sessionId))
      .toEqual({ httpErrors: [], consoleErrors: [] })
  })

  it.each([
    ["other session", (r) => { r.response.url = url + "-other" }],
    ["other origin", (r) => { r.response.url = url.replace("127.0.0.1", "localhost") }],
    ["other endpoint", (r) => { r.response.url += "/frame" }],
    ["query", (r) => { r.response.url += "?other=1" }],
    ["write", (r) => { r.response.method = "PUT" }],
    ["server failure", (r) => { r.response.status = 500 }],
    ["different error", (r) => { r.body.error.code = "not_found" }],
    ["different type", (r) => { r.body.error.type = "api_error" }],
    ["different message", (r) => { r.body.error.message = "unknown session" }],
    ["extra error field", (r) => { r.body.error.other = true }],
    ["after opening", (r) => { r.beforeExplicitOpen = false }],
    ["unrelated console source", (r) => { r.consoleErrors[0].url = origin + "/api/v1/other" }],
    ["different console error", (r) => { r.consoleErrors[0].text = "application error" }],
    ["repeated console error", (r) => { r.consoleErrors.push(r.consoleErrors[0]) }],
  ])("rejects %s", (_name, change) => {
    const read = receipt(); change(read)
    expect(() => assertClosedBrowserRead(read, origin, sessionId)).toThrow()
  })

  it("rejects missing, repeated and uncorrelated observations", () => {
    const read = receipt()
    expect(() => unexplainedBrowserErrors([], [], read, origin, sessionId)).toThrow()
    expect(() => unexplainedBrowserErrors([read.response, read.response], [closedBrowserResourceError], read, origin, sessionId)).toThrow()
    expect(() => unexplainedBrowserErrors([read.response], [], read, origin, sessionId)).toThrow()
    expect(() => unexplainedBrowserErrors([read.response], [closedBrowserResourceError], read, origin, null)).toThrow()
  })

  it("retains every other HTTP/console error and never grants an implicit allowance", () => {
    const read = receipt()
    const bad = [
      { method: "GET", url, status: 500 },
      { method: "PUT", url, status: 404 },
      { method: "GET", url: origin + "/api/v1/other", status: 404 },
    ]
    expect(unexplainedBrowserErrors([read.response, ...bad], [closedBrowserResourceError, closedBrowserResourceError, "app error"], read, origin, sessionId))
      .toEqual({ httpErrors: bad, consoleErrors: [closedBrowserResourceError, "app error"] })
    expect(unexplainedBrowserErrors([read.response], [closedBrowserResourceError], null, origin, sessionId))
      .toEqual({ httpErrors: [read.response], consoleErrors: [closedBrowserResourceError] })
  })
})
