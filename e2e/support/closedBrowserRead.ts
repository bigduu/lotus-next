import assert from "node:assert/strict"

interface HttpResponse {
  readonly method: string
  readonly url: string
  readonly status: number
}

export interface ClosedBrowserRead {
  readonly response: HttpResponse
  readonly body: unknown
  readonly beforeExplicitOpen: boolean
  readonly consoleErrors: readonly { readonly text: string; readonly url: string }[]
}

export interface DefaultOpenRefusal {
  readonly response: HttpResponse
  readonly body: unknown
  readonly closedResponse: HttpResponse
  readonly closedBody: unknown
  readonly consoleErrors: readonly { readonly text: string; readonly url: string }[]
}

export const closedBrowserResourceError =
  "Failed to load resource: the server responded with a status of 404 (Not Found)"
export const unsupportedSharedResourceError =
  "Failed to load resource: the server responded with a status of 503 (Service Unavailable)"

export const assertClosedBrowserRead = (read: ClosedBrowserRead, origin: string, sessionId: string): void => {
  assert.ok(sessionId)
  assert.deepEqual(read.response, {
    method: "GET", url: `${origin}/api/v1/browser/sessions/${encodeURIComponent(sessionId)}`, status: 404,
  })
  assert.deepEqual(read.body, {
    error: { code: "browser_not_open", message: "browser session not open", type: "browser_error" },
  })
  assert.equal(read.beforeExplicitOpen, true)
  assert.ok(read.consoleErrors.length <= 1, "Repeated closed-browser resource errors")
  for (const error of read.consoleErrors) {
    assert.deepEqual(error, { text: closedBrowserResourceError, url: read.response.url })
  }
}

/** Retain every unexplained error; admit only the independently observed initial read. */
export const unexplainedBrowserErrors = (
  responses: readonly HttpResponse[], consoleErrors: readonly string[],
  read: ClosedBrowserRead | null, origin: string, sessionId: string | null, refusal: DefaultOpenRefusal | null = null,
): { httpErrors: HttpResponse[]; consoleErrors: string[] } => {
  const httpErrors = responses.filter((response) => response.status >= 400)
  const remainingConsoleErrors = [...consoleErrors]
  if (read !== null) {
    assert.ok(sessionId, "An initial browser read requires the selected session")
    assertClosedBrowserRead(read, origin, sessionId)
    if (refusal) {
      const url = `${origin}/api/v1/browser/sessions/${encodeURIComponent(sessionId)}`
      assert.deepEqual(refusal.response, { method: "PUT", url, status: 503 })
      assert.deepEqual(refusal.closedResponse, read.response)
      assert.deepEqual(refusal.closedBody, read.body)
      const body = refusal.body as { error?: { code?: unknown; message?: unknown; type?: unknown } }
      assert.equal(body?.error?.code, "browser_unavailable")
      assert.equal(body.error.type, "browser_error")
      assert.equal(body.error.message, "browser runtime unavailable: browser_shared_profile_unsupported: request clean explicitly")
      assert.ok(refusal.consoleErrors.length <= 2)
      for (const error of refusal.consoleErrors) {
        assert.equal(error.url, url)
        assert.ok(error.text === closedBrowserResourceError || error.text === unsupportedSharedResourceError)
      }
      assert.ok(refusal.consoleErrors.filter((error) => error.text === closedBrowserResourceError).length <= 1)
      assert.ok(refusal.consoleErrors.filter((error) => error.text === unsupportedSharedResourceError).length <= 1)
      const refused = httpErrors.filter((response) => response.method === "PUT" && response.url === url && response.status === 503)
      assert.equal(refused.length, 1, "Require exactly one observed unsupported-shared refusal")
      httpErrors.splice(httpErrors.indexOf(refused[0]!), 1)
    }
    const matching = httpErrors.filter((response) => response.method === read.response.method &&
      response.url === read.response.url && response.status === read.response.status)
    assert.equal(matching.length, refusal ? 2 : 1, "Require the observed closed-browser reads")
    for (const response of matching) httpErrors.splice(httpErrors.indexOf(response), 1)
    for (const error of [...read.consoleErrors, ...(refusal?.consoleErrors ?? [])]) {
      const index = remainingConsoleErrors.indexOf(error.text)
      assert.ok(index >= 0, "Expected resource console message was not observed")
      remainingConsoleErrors.splice(index, 1)
    }
  }
  else assert.equal(refusal, null, "A default refusal requires the initial closed-browser read")
  return { httpErrors, consoleErrors: remainingConsoleErrors }
}
