import { expect, it, vi } from "vitest"
import { ApiClient } from "./client"
import { HttpTransport, type FetchFunction } from "./transport"

it("does not replay a GET refused with browser_busy and preserves its structured reason", async () => {
  const body = JSON.stringify({ error: { type: "browser_error", code: "browser_busy", message: "Busy" } })
  const fetchImplementation = vi.fn<FetchFunction>().mockImplementation(async () => new Response(body, { status: 503 }))
  const client = new ApiClient({ baseUrl: "http://fixture.test/api/v1", requestCredentials: "include", transport: new HttpTransport({ fetchImplementation, totalAttempts: 3, retryDelayMs: () => 0 }) })
  await expect(client.getOnce("browser/sessions/a")).rejects.toMatchObject({ status: 503, body })
  expect(fetchImplementation).toHaveBeenCalledTimes(1)
  expect(fetchImplementation.mock.calls[0]?.[1]).toMatchObject({ method: "GET", credentials: "include" })
})
