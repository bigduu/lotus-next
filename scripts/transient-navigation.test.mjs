import { describe, expect, it, vi } from "vitest"

import { navigateWithNetworkChangeRecovery } from "../e2e/support/transientNavigation.ts"

describe("remote Chromium navigation recovery", () => {
  it("retries one transient network-change navigation", async () => {
    const navigate = vi
      .fn()
      .mockRejectedValueOnce(
        new Error(
          "page.goto: net::ERR_NETWORK_CHANGED at https://remote.lotus.test:4173/",
        ),
      )
      .mockResolvedValueOnce("ready")

    await expect(navigateWithNetworkChangeRecovery(navigate)).resolves.toBe(
      "ready",
    )
    expect(navigate).toHaveBeenCalledTimes(2)
  })

  it.each([
    "page.goto: net::ERR_CERT_AUTHORITY_INVALID",
    "page.goto: net::ERR_NAME_NOT_RESOLVED",
    "remote surface returned HTTP 503",
  ])("does not retry %s", async (message) => {
    const failure = new Error(message)
    const navigate = vi.fn().mockRejectedValue(failure)

    await expect(navigateWithNetworkChangeRecovery(navigate)).rejects.toBe(
      failure,
    )
    expect(navigate).toHaveBeenCalledOnce()
  })

  it("does not hide a repeated network-change failure", async () => {
    const first = new Error("page.goto: net::ERR_NETWORK_CHANGED")
    const repeated = new Error("page.goto: net::ERR_NETWORK_CHANGED again")
    const navigate = vi
      .fn()
      .mockRejectedValueOnce(first)
      .mockRejectedValueOnce(repeated)

    await expect(navigateWithNetworkChangeRecovery(navigate)).rejects.toBe(
      repeated,
    )
    expect(navigate).toHaveBeenCalledTimes(2)
  })
})
