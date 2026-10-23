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

export const closedBrowserResourceError =
  "Failed to load resource: the server responded with a status of 404 (Not Found)"

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
  read: ClosedBrowserRead | null, origin: string, sessionId: string | null,
): { httpErrors: HttpResponse[]; consoleErrors: string[] } => {
  const httpErrors = responses.filter((response) => response.status >= 400)
  const remainingConsoleErrors = [...consoleErrors]
  if (read !== null) {
    assert.ok(sessionId, "An initial browser read requires the selected session")
    assertClosedBrowserRead(read, origin, sessionId)
    const matching = httpErrors.filter((response) => response.method === read.response.method &&
      response.url === read.response.url && response.status === read.response.status)
    assert.equal(matching.length, 1, "Require exactly one observed initial closed-browser read")
    httpErrors.splice(httpErrors.indexOf(matching[0]!), 1)
    for (const error of read.consoleErrors) {
      const index = remainingConsoleErrors.indexOf(error.text)
      assert.ok(index >= 0, "Expected resource console message was not observed")
      remainingConsoleErrors.splice(index, 1)
    }
  }
  return { httpErrors, consoleErrors: remainingConsoleErrors }
}
