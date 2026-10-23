import { expect, it, vi } from "vitest"
import { ApiClient } from "./client"
import { HttpTransport, type FetchFunction } from "./transport"

it.each([503, 409])("preserves a DELETE %i business error and never retries a scope close", async (status) => {
  const body = JSON.stringify({ error: { type: "browser_error", code: "browser_profile_mode_conflict", message: "Refused" } })
  const fetchImplementation = vi.fn<FetchFunction>().mockImplementation(async () => new Response(body, { status }))
  const client = new ApiClient({ baseUrl: "http://fixture.test/api/v1", requestCredentials: "include", transport: new HttpTransport({ fetchImplementation, totalAttempts: 3, retryDelayMs: () => 0 }) })
  const signal = new AbortController().signal
  await expect(client.deleteOnce("browser/sessions/chat%2Fa", { signal })).rejects.toMatchObject({ status, body })
  expect(fetchImplementation).toHaveBeenCalledTimes(1)
  expect(fetchImplementation.mock.calls[0]?.[0]).toBe("http://fixture.test/api/v1/browser/sessions/chat%2Fa")
  expect(fetchImplementation.mock.calls[0]?.[1]).toMatchObject({ method: "DELETE", credentials: "include" })
})
