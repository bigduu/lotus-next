import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  buildBackendUrl,
  clearBackendBaseUrlOverride,
  getBackendBaseUrl,
  getBackendBaseUrlSync,
  getDefaultBackendBaseUrl,
  getV2StreamUrl,
  hasBackendBaseUrlOverride,
  normalizeBackendBaseUrl,
  setBackendBaseUrl,
} from "../backendBaseUrl"

type ProcessLike = { env: Record<string, string | undefined> }

const getProcessEnv = (): ProcessLike["env"] => {
  const target = globalThis as typeof globalThis & { process?: ProcessLike }
  target.process ??= { env: {} }
  return target.process.env
}

describe("backendBaseUrl", () => {
  const stubLocation = (protocol: string, hostname: string, href?: string) => {
    vi.stubGlobal("location", {
      protocol,
      hostname,
      href: href ?? `${protocol}//${hostname}/`,
    } as Partial<Location>)
  }

  let originalFetch: typeof globalThis.fetch
  let mockFetch: ReturnType<typeof vi.fn>
  let originalProcessBackendUrl: string | undefined

  beforeEach(() => {
    const processEnv = getProcessEnv()
    originalFetch = globalThis.fetch
    mockFetch = vi.fn()
    globalThis.fetch = mockFetch as typeof globalThis.fetch
    originalProcessBackendUrl = processEnv.VITE_BACKEND_BASE_URL
    delete processEnv.VITE_BACKEND_BASE_URL
    delete window.__BAMBOO_BACKEND_PORT__
    stubLocation("http:", "localhost", "http://localhost:1420/")
  })

  afterEach(() => {
    const processEnv = getProcessEnv()
    globalThis.fetch = originalFetch
    delete window.__BAMBOO_BACKEND_PORT__
    if (originalProcessBackendUrl === undefined) {
      delete processEnv.VITE_BACKEND_BASE_URL
    } else {
      processEnv.VITE_BACKEND_BASE_URL = originalProcessBackendUrl
    }
    vi.unstubAllGlobals()
  })

  it.each([
    [" http://localhost:9562/v1/ ", "http://localhost:9562/v1"],
    ["http://localhost:9562/v1///", "http://localhost:9562/v1"],
    ["", ""],
    ["   ", ""],
  ])("normalizes %j to %j", (input, expected) => {
    expect(normalizeBackendBaseUrl(input)).toBe(expected)
  })

  it("uses the loopback fallback on a loopback page", () => {
    expect(getDefaultBackendBaseUrl()).toBe("http://127.0.0.1:9562/v1")
    expect(getBackendBaseUrlSync()).toBe("http://127.0.0.1:9562/v1")
  })

  it("derives an HTTP backend from a remote page hostname", () => {
    stubLocation("http:", "mac.local", "http://mac.local:1420/chat")

    expect(getDefaultBackendBaseUrl()).toBe("http://mac.local:9562/v1")
    expect(getBackendBaseUrlSync()).toBe("http://mac.local:9562/v1")
  })

  it("uses same-origin HTTPS on an HTTPS page", () => {
    stubLocation("https:", "bodhi.bigduu.com", "https://bodhi.bigduu.com/")

    expect(getDefaultBackendBaseUrl()).toBe("https://bodhi.bigduu.com/v1")
    expect(getBackendBaseUrlSync()).toBe("https://bodhi.bigduu.com/v1")
  })

  it("falls back to loopback for a non-HTTP page protocol", () => {
    stubLocation("tauri:", "localhost", "tauri://localhost/")

    expect(getDefaultBackendBaseUrl()).toBe("http://127.0.0.1:9562/v1")
  })

  it("uses and normalizes the environment default", () => {
    getProcessEnv().VITE_BACKEND_BASE_URL = "http://example.com/v1/"

    expect(getDefaultBackendBaseUrl()).toBe("http://example.com/v1")
  })

  it("persists, normalizes, and clears an explicit override", () => {
    expect(hasBackendBaseUrlOverride()).toBe(false)

    setBackendBaseUrl("http://localhost:9562/v1/")

    expect(hasBackendBaseUrlOverride()).toBe(true)
    expect(getBackendBaseUrlSync()).toBe("http://localhost:9562/v1")

    clearBackendBaseUrlOverride()
    expect(hasBackendBaseUrlOverride()).toBe(false)
  })

  it("removes an invalid stored override instead of returning it", () => {
    localStorage.setItem("copilot_backend_base_url", "not-a-valid-url")
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(getBackendBaseUrlSync()).toBe("http://127.0.0.1:9562/v1")
    expect(hasBackendBaseUrlOverride()).toBe(false)
    expect(warn).toHaveBeenCalledWith(
      "Invalid stored backend URL, using default:",
      "not-a-valid-url",
    )
  })

  it("rejects an insecure HTTP override on an HTTPS page", () => {
    stubLocation("https:", "bodhi.bigduu.com", "https://bodhi.bigduu.com/")
    setBackendBaseUrl("http://bodhi.bigduu.com:9562/v1")
    vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(getBackendBaseUrlSync()).toBe("https://bodhi.bigduu.com/v1")
    expect(hasBackendBaseUrlOverride()).toBe(false)
  })

  it("rejects a loopback override when the page is served remotely", () => {
    stubLocation("http:", "mac.local", "http://mac.local:9562/")
    setBackendBaseUrl("http://127.0.0.1:9562/v1")
    vi.spyOn(console, "warn").mockImplementation(() => {})

    expect(getBackendBaseUrlSync()).toBe("http://mac.local:9562/v1")
    expect(hasBackendBaseUrlOverride()).toBe(false)
  })

  it("joins backend paths with exactly one slash", () => {
    setBackendBaseUrl("http://localhost:9562/v1/")

    expect(buildBackendUrl("/models")).toBe("http://localhost:9562/v1/models")
    expect(buildBackendUrl("///workspace/validate")).toBe(
      "http://localhost:9562/v1/workspace/validate",
    )
  })

  it.each([
    ["http://localhost:9562/v1", "ws://localhost:9562/v2/stream"],
    ["https://bodhi.bigduu.com/v1/", "wss://bodhi.bigduu.com/v2/stream"],
  ])("derives the unified v2 stream URL from %s", (backendUrl, streamUrl) => {
    setBackendBaseUrl(backendUrl)

    expect(getV2StreamUrl()).toBe(streamUrl)
  })

  describe("getBackendBaseUrl health discovery", () => {
    it("uses an injected sidecar port when its canonical health endpoint is healthy", async () => {
      window.__BAMBOO_BACKEND_PORT__ = 8080
      mockFetch.mockResolvedValueOnce({ ok: true })

      await expect(getBackendBaseUrl()).resolves.toBe("http://127.0.0.1:8080/v1")
      expect(mockFetch).toHaveBeenCalledWith(
        "http://127.0.0.1:8080/api/v1/health",
        expect.objectContaining({ method: "GET", signal: expect.any(AbortSignal) }),
      )
    })

    it("falls back to the legacy health path for an otherwise valid stored URL", async () => {
      setBackendBaseUrl("http://custom:9000/v1")
      mockFetch.mockResolvedValueOnce({ ok: false }).mockResolvedValueOnce({ ok: true })

      await expect(getBackendBaseUrl()).resolves.toBe("http://custom:9000/v1")
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "http://custom:9000/api/v1/health",
        expect.objectContaining({ method: "GET" }),
      )
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "http://custom:9000/v1/health",
        expect.objectContaining({ method: "GET" }),
      )
    })

    it("ignores a stored loopback override during remote discovery", async () => {
      stubLocation("http:", "mac.local", "http://mac.local:9562/")
      setBackendBaseUrl("http://127.0.0.1:9562/v1")
      vi.spyOn(console, "warn").mockImplementation(() => {})
      mockFetch.mockResolvedValueOnce({ ok: true })

      await expect(getBackendBaseUrl()).resolves.toBe("http://mac.local:9562/v1")
      expect(hasBackendBaseUrlOverride()).toBe(false)
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "http://mac.local:9562/api/v1/health",
        expect.objectContaining({ method: "GET" }),
      )
    })

    it("falls back from an unavailable remote host to loopback", async () => {
      stubLocation("http:", "mac.local", "http://mac.local:1420/")
      mockFetch
        .mockRejectedValueOnce(new Error("host unavailable"))
        .mockResolvedValueOnce({ ok: true })

      await expect(getBackendBaseUrl()).resolves.toBe("http://127.0.0.1:9562/v1")
      expect(mockFetch).toHaveBeenNthCalledWith(
        1,
        "http://mac.local:9562/api/v1/health",
        expect.objectContaining({ method: "GET" }),
      )
      expect(mockFetch).toHaveBeenNthCalledWith(
        2,
        "http://127.0.0.1:9562/api/v1/health",
        expect.objectContaining({ method: "GET" }),
      )
    })

    it("returns the host-derived URL when all health probes fail", async () => {
      stubLocation("http:", "mac.local", "http://mac.local:1420/")
      mockFetch.mockRejectedValue(new Error("connection refused"))

      await expect(getBackendBaseUrl()).resolves.toBe("http://mac.local:9562/v1")
    })

    it("never probes insecure loopback from an HTTPS page", async () => {
      stubLocation("https:", "bodhi.bigduu.com", "https://bodhi.bigduu.com/")
      window.__BAMBOO_BACKEND_PORT__ = 8080
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
      mockFetch.mockResolvedValueOnce({ ok: true })

      await expect(getBackendBaseUrl()).resolves.toBe("https://bodhi.bigduu.com/v1")
      expect(mockFetch).toHaveBeenCalledTimes(1)
      expect(mockFetch).toHaveBeenCalledWith(
        "https://bodhi.bigduu.com/api/v1/health",
        expect.objectContaining({ method: "GET" }),
      )
      expect(warn).toHaveBeenCalledWith(
        "Backend not available at configured port 8080, falling back to discovery",
      )
    })
  })
})
