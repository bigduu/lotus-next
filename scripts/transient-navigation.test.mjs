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
    'page.goto: Navigation to "https://remote.lotus.test:4173/" is interrupted by another navigation to "chrome-error://chromewebdata/"',
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

  it("replaces the throwaway page only after network change then Chromium error page", async () => {
    const navigate = vi
      .fn()
      .mockRejectedValueOnce(new Error("page.goto: net::ERR_NETWORK_CHANGED"))
      .mockRejectedValueOnce(
        new Error(
          'page.goto: Navigation to "https://remote.lotus.test:4173/" is interrupted by another navigation to "chrome-error://chromewebdata/"',
        ),
      )
      .mockResolvedValueOnce("ready")
    const resetErrorPage = vi.fn().mockResolvedValue(undefined)

    await expect(
      navigateWithNetworkChangeRecovery(navigate, resetErrorPage),
    ).resolves.toBe("ready")
    expect(navigate).toHaveBeenCalledTimes(3)
    expect(resetErrorPage).toHaveBeenCalledOnce()
  })

  it("does not replace the page for an unrelated second navigation failure", async () => {
    const failure = new Error("page.goto: net::ERR_CERT_AUTHORITY_INVALID")
    const navigate = vi
      .fn()
      .mockRejectedValueOnce(new Error("page.goto: net::ERR_NETWORK_CHANGED"))
      .mockRejectedValueOnce(failure)
    const resetErrorPage = vi.fn().mockResolvedValue(undefined)

    await expect(
      navigateWithNetworkChangeRecovery(navigate, resetErrorPage),
    ).rejects.toBe(failure)
    expect(navigate).toHaveBeenCalledTimes(2)
    expect(resetErrorPage).not.toHaveBeenCalled()
  })

  it("does not hide failure on the final fresh-page attempt", async () => {
    const failure = new Error("page.goto: net::ERR_CERT_AUTHORITY_INVALID")
    const navigate = vi
      .fn()
      .mockRejectedValueOnce(new Error("page.goto: net::ERR_NETWORK_CHANGED"))
      .mockRejectedValueOnce(
        new Error(
          'page.goto: Navigation to "https://remote.lotus.test:4173/" is interrupted by another navigation to "chrome-error://chromewebdata/"',
        ),
      )
      .mockRejectedValueOnce(failure)
    const resetErrorPage = vi.fn().mockResolvedValue(undefined)

    await expect(
      navigateWithNetworkChangeRecovery(navigate, resetErrorPage),
    ).rejects.toBe(failure)
    expect(navigate).toHaveBeenCalledTimes(3)
    expect(resetErrorPage).toHaveBeenCalledOnce()
  })
})
