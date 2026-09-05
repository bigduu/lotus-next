import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, NetworkRequestError } from "../api/errors"
import { ApiClient } from "../api/client"
import { HttpTransport, type FetchFunction } from "../api/transport"

const apiMock = vi.hoisted(() => ({
  get: vi.fn<(path: string, options?: RequestInit) => Promise<unknown>>(),
  post: vi.fn<(path: string, data?: unknown) => Promise<unknown>>(),
  put: vi.fn<(path: string, data?: unknown) => Promise<unknown>>(),
  putOnce: vi.fn<(path: string, data?: unknown) => Promise<unknown>>(),
}))

vi.mock("../api", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api")>()),
  apiClient: apiMock,
}))

import {
  NotificationConfigAuthorityError,
  NotificationConfigContractError,
  getNotificationChannelsConfig,
  getNotificationConfigErrorCode,
  getSafeNotificationErrorMessage,
  parseNotificationConfigEnvelope,
  putNotificationChannelsConfig,
  testNotificationChannels,
  type NotificationMutationData,
} from "./notificationChannelsApi"

const LOADED_AT = "2026-09-04T01:02:03.456Z"
const UPDATED_AT = "2026-09-04T00:02:03Z"

const envelopeFixture = () => {
  const sectionData = {
    notifications: {
      desktop: { enabled: true },
      ntfy: {
        enabled: true,
        base_url: "https://ntfy.example",
        topic: "alerts",
        credential_ref: "notification.ntfy.token",
        configured: true,
      },
      bark: {
        enabled: false,
        base_url: "https://api.day.app",
        configured: false,
      },
    },
  }
  return {
    revision: 7,
    status: "healthy",
    source: "file",
    source_path: "/tmp/bamboo/notifications.json",
    loaded_at: LOADED_AT,
    last_error: null,
    section: {
      data: sectionData,
      revision: 7,
      loaded_at: LOADED_AT,
      source_path: "/tmp/bamboo/notifications.json",
      source_kind: "file",
      status: "healthy",
      last_error: null,
    },
    credential_revision: 3,
    credential_status: "healthy",
    credential_source: "file",
    credential_last_error: null,
    credential_health: {
      revision: 3,
      status: "healthy",
      source: "file",
      last_error: null,
    },
    data: {
      desktop: { enabled: true },
      ntfy: {
        enabled: true,
        base_url: "https://ntfy.example",
        topic: "alerts",
        credential: {
          credential_ref: "notification.ntfy.token",
          state: "configured",
          configured: true,
          source: "user",
          updated_at: UPDATED_AT,
        },
      },
      bark: {
        enabled: false,
        base_url: "https://api.day.app",
        credential: {
          credential_ref: null,
          state: "missing",
          configured: false,
        },
      },
    },
  }
}

type Fixture = ReturnType<typeof envelopeFixture>

const credential = (fixture: Fixture) => fixture.data.ntfy.credential
const sectionNtfy = (fixture: Fixture) => fixture.section.data.notifications.ntfy
const setNtfyBaseUrl = (fixture: Fixture, value: string) => {
  fixture.data.ntfy.base_url = value
  sectionNtfy(fixture).base_url = value
}

beforeEach(() => {
  apiMock.get.mockReset()
  apiMock.post.mockReset()
  apiMock.put.mockReset()
  apiMock.putOnce.mockReset()
})

describe("notification section envelope", () => {
  it("accepts and normalizes the exact secret-free Bamboo response", () => {
    expect(parseNotificationConfigEnvelope(envelopeFixture())).toEqual({
      revision: 7,
      status: "healthy",
      source: "file",
      sourcePath: "/tmp/bamboo/notifications.json",
      loadedAt: LOADED_AT,
      lastError: null,
      credentialRevision: 3,
      credentialStatus: "healthy",
      credentialSource: "file",
      credentialLastError: null,
      data: {
        desktop: { enabled: true },
        ntfy: {
          enabled: true,
          baseUrl: "https://ntfy.example",
          topic: "alerts",
          credential: {
            credentialRef: "notification.ntfy.token",
            state: "configured",
            configured: true,
            source: "user",
            updatedAt: UPDATED_AT,
          },
        },
        bark: {
          enabled: false,
          baseUrl: "https://api.day.app",
          credential: {
            credentialRef: null,
            state: "missing",
            configured: false,
          },
        },
      },
    })
  })

  it("allows only the revision-zero default/missing baseline", () => {
    const fixture = envelopeFixture()
    fixture.revision = 0
    fixture.status = "missing"
    fixture.source = "default"
    fixture.section.revision = 0
    fixture.section.status = "missing"
    fixture.section.source_kind = "default"
    fixture.credential_revision = 0
    fixture.credential_status = "missing"
    fixture.credential_source = "default"
    fixture.credential_health.revision = 0
    fixture.credential_health.status = "missing"
    fixture.credential_health.source = "default"

    expect(() => parseNotificationConfigEnvelope(fixture)).toThrow(
      NotificationConfigContractError,
    )
    credential(fixture).state = "error"
    credential(fixture).configured = false
    Reflect.deleteProperty(credential(fixture), "source")
    Reflect.deleteProperty(credential(fixture), "updated_at")

    expect(parseNotificationConfigEnvelope(fixture)).toMatchObject({
      revision: 0,
      status: "missing",
      source: "default",
      credentialRevision: 0,
      credentialStatus: "missing",
      credentialSource: "default",
    })

    fixture.revision = 1
    fixture.section.revision = 1
    expect(() => parseNotificationConfigEnvelope(fixture)).toThrow(
      NotificationConfigContractError,
    )
  })

  it.each(["degraded", "invalid"] as const)("blocks %s section authority", (status) => {
    const fixture = envelopeFixture()
    fixture.status = status
    fixture.section.status = status
    Reflect.set(fixture, "last_error", "redacted authority failure")
    Reflect.set(fixture.section, "last_error", "redacted authority failure")

    expect(() => parseNotificationConfigEnvelope(fixture)).toThrow(
      NotificationConfigAuthorityError,
    )
  })

  it("accepts credential error as an explicit repair state", () => {
    const fixture = envelopeFixture()
    credential(fixture).state = "error"
    credential(fixture).configured = false
    Reflect.deleteProperty(credential(fixture), "source")
    Reflect.deleteProperty(credential(fixture), "updated_at")

    expect(parseNotificationConfigEnvelope(fixture).data.ntfy.credential).toEqual({
      credentialRef: "notification.ntfy.token",
      state: "error",
      configured: false,
      source: undefined,
      updatedAt: undefined,
    })
  })

  it("accepts environment metadata only through from_env", () => {
    const fixture = envelopeFixture()
    credential(fixture).state = "from_env"
    credential(fixture).source = "environment"

    expect(parseNotificationConfigEnvelope(fixture).data.ntfy.credential.state).toBe("from_env")
  })

  it.each([
    ["configured with environment source", (fixture: Fixture) => (credential(fixture).source = "environment")],
    ["from_env with user source", (fixture: Fixture) => (credential(fixture).state = "from_env")],
    [
      "error with stored-source metadata",
      (fixture: Fixture) => {
        credential(fixture).state = "error"
        credential(fixture).configured = false
      },
    ],
    [
      "missing with credential reference",
      (fixture: Fixture) => {
        credential(fixture).state = "missing"
        credential(fixture).configured = false
        Reflect.deleteProperty(credential(fixture), "source")
        Reflect.deleteProperty(credential(fixture), "updated_at")
      },
    ],
    [
      "error without credential reference",
      (fixture: Fixture) => {
        Reflect.set(credential(fixture), "credential_ref", null)
        credential(fixture).state = "error"
        credential(fixture).configured = false
        Reflect.deleteProperty(credential(fixture), "source")
        Reflect.deleteProperty(credential(fixture), "updated_at")
      },
    ],
  ])("rejects inconsistent credential metadata: %s", (_label, mutate) => {
    const fixture = envelopeFixture()
    mutate(fixture)
    expect(() => parseNotificationConfigEnvelope(fixture)).toThrow(
      NotificationConfigContractError,
    )
  })

  it.each([
    ["unsafe revision", (fixture: Fixture) => Reflect.set(fixture, "revision", 2 ** 53)],
    ["non-RFC3339 timestamp", (fixture: Fixture) => (fixture.loaded_at = "September 4, 2026")],
    [
      "impossible RFC3339 calendar date",
      (fixture: Fixture) => {
        fixture.loaded_at = "2026-02-30T12:00:00Z"
        fixture.section.loaded_at = "2026-02-30T12:00:00Z"
      },
    ],
    [
      "non-leap-year date",
      (fixture: Fixture) => (credential(fixture).updated_at = "2026-02-29T12:00:00Z"),
    ],
    [
      "impossible short-month date",
      (fixture: Fixture) => (credential(fixture).updated_at = "2026-04-31T12:00:00Z"),
    ],
    [
      "invalid 24-hour clock",
      (fixture: Fixture) => (credential(fixture).updated_at = "2026-09-04T24:00:00Z"),
    ],
    [
      "invalid timezone offset",
      (fixture: Fixture) => (credential(fixture).updated_at = "2026-09-04T12:00:00+24:00"),
    ],
    ["duplicated metadata mismatch", (fixture: Fixture) => (fixture.section.revision = 8)],
    ["unknown top-level field", (fixture: Fixture) => Reflect.set(fixture, "legacy", true)],
    [
      "unknown section-data field",
      (fixture: Fixture) => Reflect.set(fixture.section.data, "legacy", true),
    ],
    [
      "unknown notifications field",
      (fixture: Fixture) => Reflect.set(fixture.section.data.notifications, "legacy", true),
    ],
    [
      "unknown desktop field",
      (fixture: Fixture) => Reflect.set(fixture.section.data.notifications.desktop, "legacy", true),
    ],
    [
      "unknown secret-shaped nested field",
      (fixture: Fixture) => Reflect.set(sectionNtfy(fixture), "access_token", "plaintext"),
    ],
    [
      "contradictory section data",
      (fixture: Fixture) => (sectionNtfy(fixture).base_url = "https://stale.example"),
    ],
    [
      "secret-shaped camelCase field",
      (fixture: Fixture) => Reflect.set(sectionNtfy(fixture), "tokenEncrypted", "ciphertext"),
    ],
    ["credential mask", (fixture: Fixture) => (fixture.data.ntfy.topic = "****....")],
  ])("fails closed for %s", (_label, mutate) => {
    const fixture = envelopeFixture()
    mutate(fixture)
    expect(() => parseNotificationConfigEnvelope(fixture)).toThrow(
      NotificationConfigContractError,
    )
  })

  it("accepts a valid leap-day RFC3339 timestamp", () => {
    const fixture = envelopeFixture()
    fixture.loaded_at = "2024-02-29T12:00:00Z"
    fixture.section.loaded_at = "2024-02-29T12:00:00Z"

    expect(parseNotificationConfigEnvelope(fixture).loadedAt).toBe("2024-02-29T12:00:00Z")
  })

  it.each([
    ["empty", ""],
    ["whitespace", "   "],
    ["non-canonical whitespace", " https://ntfy.example"],
    ["relative", "/notification-endpoint"],
    ["non-HTTP", "ftp://ntfy.example"],
    ["username", "https://user@ntfy.example"],
    ["password", "https://user:plaintext-secret@ntfy.example"],
    ["query", "https://ntfy.example?token=plaintext-secret"],
    ["empty query", "https://ntfy.example?"],
    ["fragment", "https://ntfy.example#plaintext-secret"],
    ["empty fragment", "https://ntfy.example#"],
  ])("rejects %s notification authority URLs", (_label, value) => {
    const fixture = envelopeFixture()
    setNtfyBaseUrl(fixture, value)

    expect(() => parseNotificationConfigEnvelope(fixture)).toThrow(NotificationConfigContractError)
  })

  it("accepts a secret-free absolute HTTP URL with a path", () => {
    const fixture = envelopeFixture()
    setNtfyBaseUrl(fixture, "http://ntfy.example/custom/path")

    expect(parseNotificationConfigEnvelope(fixture).data.ntfy.baseUrl).toBe(
      "http://ntfy.example/custom/path",
    )
  })
})

describe("notification section requests", () => {
  const mutation: NotificationMutationData = {
    desktop: { enabled: true },
    ntfy: {
      enabled: true,
      base_url: "https://ntfy.example",
      topic: "alerts",
      credential_change: { action: "keep" },
    },
    bark: {
      enabled: false,
      base_url: "https://api.day.app",
      credential_change: { action: "keep" },
    },
  }
  const changedMutation = (): NotificationMutationData => ({
    ...mutation,
    ntfy: { ...mutation.ntfy, topic: "changed-alerts" },
  })
  const authority = () => parseNotificationConfigEnvelope(envelopeFixture())
  const responseFor = (revision: number, data: NotificationMutationData): Fixture => {
    const response = envelopeFixture()
    response.revision = revision
    response.section.revision = revision
    Reflect.set(response.data.desktop, "enabled", data.desktop.enabled)
    Reflect.set(response.section.data.notifications.desktop, "enabled", data.desktop.enabled)
    response.data.ntfy.enabled = data.ntfy.enabled
    response.data.ntfy.base_url = data.ntfy.base_url
    response.data.ntfy.topic = data.ntfy.topic
    response.section.data.notifications.ntfy.enabled = data.ntfy.enabled
    response.section.data.notifications.ntfy.base_url = data.ntfy.base_url
    response.section.data.notifications.ntfy.topic = data.ntfy.topic
    response.data.bark.enabled = data.bark.enabled
    response.data.bark.base_url = data.bark.base_url
    response.section.data.notifications.bark.enabled = data.bark.enabled
    response.section.data.notifications.bark.base_url = data.bark.base_url
    return response
  }
  const setNtfyMissing = (response: Fixture) => {
    Reflect.set(response.data.ntfy.credential, "credential_ref", null)
    response.data.ntfy.credential.state = "missing"
    response.data.ntfy.credential.configured = false
    Reflect.deleteProperty(response.data.ntfy.credential, "source")
    Reflect.deleteProperty(response.data.ntfy.credential, "updated_at")
    response.section.data.notifications.ntfy.configured = false
    Reflect.deleteProperty(response.section.data.notifications.ntfy, "credential_ref")
  }
  const setBarkConfigured = (response: Fixture) => {
    const value = response.data.bark.credential
    Reflect.set(value, "credential_ref", "notification.bark.device_key")
    value.state = "configured"
    value.configured = true
    Reflect.set(value, "source", "user")
    Reflect.set(value, "updated_at", UPDATED_AT)
    response.section.data.notifications.bark.configured = true
    Reflect.set(
      response.section.data.notifications.bark,
      "credential_ref",
      "notification.bark.device_key",
    )
  }

  it("uses the dedicated GET and forwards cancellation options", async () => {
    apiMock.get.mockResolvedValue(envelopeFixture())
    const controller = new AbortController()

    await expect(getNotificationChannelsConfig({ signal: controller.signal })).resolves.toMatchObject({
      revision: 7,
    })
    expect(apiMock.get).toHaveBeenCalledWith("bamboo/config/notifications", {
      signal: controller.signal,
    })
  })

  it("sends one exact full-section PUT and accepts the returned authority", async () => {
    const data = changedMutation()
    const response = responseFor(8, data)
    apiMock.putOnce.mockResolvedValue(response)

    await expect(putNotificationChannelsConfig(authority(), data)).resolves.toMatchObject({
      revision: 8,
    })
    expect(apiMock.putOnce).toHaveBeenCalledTimes(1)
    expect(apiMock.putOnce).toHaveBeenCalledWith("bamboo/config/notifications", {
      expected_revision: 7,
      data,
    })
    expect(apiMock.put).not.toHaveBeenCalled()
  })

  it.each(["network loss", "server error", "revision conflict"] as const)(
    "sends exactly one low-level fetch after %s through the real client and transport",
    async (failure) => {
      const code = "config_revision_conflict"
      const body = JSON.stringify({ error: { code, message: "server detail" } })
      const status = failure === "revision conflict" ? 409 : 503
      const fetchImplementation = vi.fn<FetchFunction>(() =>
        failure === "network loss"
          ? Promise.reject(new TypeError("connection lost after submission"))
          : Promise.resolve(new Response(body, { status })),
      )
      const client = new ApiClient({
        baseUrl: "https://api.example/api/v1",
        requestCredentials: "include",
        transport: new HttpTransport({ fetchImplementation, retryDelayMs: () => 0 }),
      })
      apiMock.putOnce.mockImplementation((path, data) => client.putOnce(path, data))

      const error = await putNotificationChannelsConfig(authority(), changedMutation()).catch(
        (caught: unknown) => caught,
      )

      expect(fetchImplementation).toHaveBeenCalledTimes(1)
      const [url, init] = fetchImplementation.mock.calls[0]
      expect(url).toBe("https://api.example/api/v1/bamboo/config/notifications")
      expect(init?.method).toBe("PUT")
      expect(init?.credentials).toBe("include")
      expect(JSON.parse(init?.body as string)).toEqual({
        expected_revision: 7,
        data: changedMutation(),
      })
      if (failure === "network loss") {
        expect(error).toBeInstanceOf(NetworkRequestError)
      } else {
        expect(error).toBeInstanceOf(ApiError)
        expect(error).toMatchObject({ status, body })
        expect(getNotificationConfigErrorCode(error)).toBe(status === 409 ? code : null)
      }
      expect(apiMock.put).not.toHaveBeenCalled()
      expect(apiMock.get).not.toHaveBeenCalled()
      expect(apiMock.post).not.toHaveBeenCalled()
    },
  )

  it("accepts Bamboo's same-revision semantic no-op authority", async () => {
    apiMock.putOnce.mockResolvedValue(envelopeFixture())

    await expect(putNotificationChannelsConfig(authority(), mutation)).resolves.toMatchObject({
      revision: 7,
    })
    expect(apiMock.putOnce).toHaveBeenCalledTimes(1)
  })

  describe.each(["ntfy", "bark"] as const)("%s credential intent", (channel) => {
    it.each([
      ["missing action", {}],
      ["missing intent", undefined],
      ["null intent", null],
      ["unknown action", { action: "future" }],
      ["replace without value", { action: "replace" }],
      ["replace null", { action: "replace", value: null }],
      ["replace non-string", { action: "replace", value: 123 }],
      ["replace empty", { action: "replace", value: "" }],
      ["replace whitespace", { action: "replace", value: " \t " }],
      ["replace mask", { action: "replace", value: " ****...**** " }],
      ["keep with plaintext", { action: "keep", value: "secret-sentinel" }],
      ["clear with null value", { action: "clear", value: null }],
      ["replace with extra field", { action: "replace", value: "secret-sentinel", token: "other" }],
    ])("rejects %s before sending any request", async (_label, change) => {
      const data = {
        ...mutation,
        [channel]: { ...mutation[channel], credential_change: change },
      } as NotificationMutationData
      await expect(putNotificationChannelsConfig(authority(), data)).rejects.toBeInstanceOf(
        NotificationConfigContractError,
      )
      expect(apiMock.putOnce).not.toHaveBeenCalled()
      expect(apiMock.get).not.toHaveBeenCalled()
      expect(apiMock.post).not.toHaveBeenCalled()
    })
  })

  it.each([
    ["whole-config field", (data: NotificationMutationData) => Reflect.set(data, "model_limits", [])],
    ["legacy plaintext", (data: NotificationMutationData) => Reflect.set(data.ntfy, "token", "secret-sentinel")],
    ["missing channel", (data: NotificationMutationData) => Reflect.deleteProperty(data, "bark")],
    ["invalid desktop", (data: NotificationMutationData) => Reflect.set(data.desktop, "enabled", "auto")],
    ["invalid enabled", (data: NotificationMutationData) => Reflect.set(data.bark, "enabled", "yes")],
    ["invalid topic", (data: NotificationMutationData) => Reflect.set(data.ntfy, "topic", null)],
  ])("rejects an incomplete or unsupported mutation: %s", async (_label, mutate) => {
    const data = structuredClone(mutation)
    mutate(data)
    await expect(putNotificationChannelsConfig(authority(), data)).rejects.toBeInstanceOf(
      NotificationConfigContractError,
    )
    expect(apiMock.putOnce).not.toHaveBeenCalled()
  })

  it("rejects a spurious revision advance for a semantic no-op", async () => {
    apiMock.putOnce.mockResolvedValue(responseFor(8, mutation))

    await expect(putNotificationChannelsConfig(authority(), mutation)).rejects.toBeInstanceOf(
      NotificationConfigContractError,
    )
  })

  it.each([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe advancing revision %s before issuing a PUT",
    async (revision) => {
      const before = { ...authority(), revision }
      await expect(putNotificationChannelsConfig(before, changedMutation())).rejects.toBeInstanceOf(
        NotificationConfigContractError,
      )
      expect(apiMock.putOnce).not.toHaveBeenCalled()
    },
  )

  it.each([6, 7, 9])("rejects an unrelated successful response revision %s", async (revision) => {
    const data = changedMutation()
    const response = responseFor(revision, data)
    apiMock.putOnce.mockResolvedValue(response)
    await expect(putNotificationChannelsConfig(authority(), data)).rejects.toBeInstanceOf(
      NotificationConfigContractError,
    )
  })

  it("rejects a successful response whose public authority does not match the mutation", async () => {
    const response = envelopeFixture()
    response.revision = 8
    response.section.revision = 8
    response.data.ntfy.topic = "server-returned-something-else"
    response.section.data.notifications.ntfy.topic = "server-returned-something-else"
    apiMock.putOnce.mockResolvedValue(response)

    await expect(putNotificationChannelsConfig(authority(), changedMutation())).rejects.toBeInstanceOf(
      NotificationConfigContractError,
    )
  })

  it("requires replace and clear responses to reflect the credential outcome", async () => {
    apiMock.putOnce.mockResolvedValue(responseFor(8, mutation))
    await expect(
      putNotificationChannelsConfig(authority(), {
        ...mutation,
        bark: {
          ...mutation.bark,
          credential_change: { action: "replace", value: "bark-device-key" },
        },
      }),
    ).rejects.toBeInstanceOf(NotificationConfigContractError)

    const configured = responseFor(8, mutation)
    configured.data.ntfy.credential.configured = true
    apiMock.putOnce.mockResolvedValue(configured)
    await expect(
      putNotificationChannelsConfig(authority(), {
        ...mutation,
        ntfy: { ...mutation.ntfy, credential_change: { action: "clear" } },
      }),
    ).rejects.toBeInstanceOf(NotificationConfigContractError)
  })

  it("accepts exact replace, clear, and already-missing clear outcomes", async () => {
    const replace = {
      ...mutation,
      bark: {
        ...mutation.bark,
        credential_change: { action: "replace", value: "bark-device-key" } as const,
      },
    }
    const replaced = responseFor(8, replace)
    setBarkConfigured(replaced)
    apiMock.putOnce.mockResolvedValueOnce(replaced)
    await expect(putNotificationChannelsConfig(authority(), replace)).resolves.toMatchObject({
      revision: 8,
      data: { bark: { credential: { state: "configured", source: "user" } } },
    })
    expect(apiMock.putOnce).toHaveBeenLastCalledWith("bamboo/config/notifications", {
      expected_revision: 7,
      data: replace,
    })

    const clear = {
      ...mutation,
      ntfy: { ...mutation.ntfy, credential_change: { action: "clear" } as const },
    }
    const cleared = responseFor(8, clear)
    setNtfyMissing(cleared)
    apiMock.putOnce.mockResolvedValueOnce(cleared)
    await expect(putNotificationChannelsConfig(authority(), clear)).resolves.toMatchObject({
      revision: 8,
      data: { ntfy: { credential: { state: "missing", credentialRef: null } } },
    })
    expect(apiMock.putOnce).toHaveBeenLastCalledWith("bamboo/config/notifications", {
      expected_revision: 7,
      data: clear,
    })

    const clearAlreadyMissing = {
      ...mutation,
      bark: { ...mutation.bark, credential_change: { action: "clear" } as const },
    }
    apiMock.putOnce.mockResolvedValueOnce(envelopeFixture())
    await expect(
      putNotificationChannelsConfig(authority(), clearAlreadyMissing),
    ).resolves.toMatchObject({ revision: 7 })
  })

  it.each([
    "",
    " https://ntfy.example",
    "ftp://ntfy.example",
    "https://user:secret@ntfy.example",
    "https://ntfy.example?token=secret",
    "https://ntfy.example?",
    "https://ntfy.example#secret",
    "https://ntfy.example#",
  ])("rejects unsafe mutation URL %s before issuing a PUT", async (baseUrl) => {
    await expect(
      putNotificationChannelsConfig(authority(), {
        ...mutation,
        ntfy: { ...mutation.ntfy, base_url: baseUrl },
      }),
    ).rejects.toBeInstanceOf(NotificationConfigContractError)
    expect(apiMock.putOnce).not.toHaveBeenCalled()
  })

  it("keeps notification delivery testing on its existing dedicated endpoint", async () => {
    apiMock.post.mockResolvedValue({ attempted: ["desktop"] })

    await expect(testNotificationChannels()).resolves.toEqual({
      attempted: ["desktop"],
    })
    expect(apiMock.post).toHaveBeenCalledWith("notifications/test")
  })

  it.each(["config_revision_conflict", "config_recovery_pending"] as const)(
    "preserves the original %s error without retries or fallback requests",
    async (code) => {
      const error = new ApiError(
        "server detail",
        409,
        "Conflict",
        JSON.stringify({ error: { code } }),
      )
      apiMock.get.mockRejectedValue(error)
      apiMock.putOnce.mockRejectedValue(error)

      await expect(getNotificationChannelsConfig()).rejects.toBe(error)
      await expect(putNotificationChannelsConfig(authority(), mutation)).rejects.toBe(error)
      expect(getNotificationConfigErrorCode(error)).toBe(code)
      expect(apiMock.get).toHaveBeenCalledTimes(1)
      expect(apiMock.putOnce).toHaveBeenCalledTimes(1)
      expect(apiMock.post).not.toHaveBeenCalled()
    },
  )
})

describe("notification section errors", () => {
  const conflict = (code: string, message = "server detail") =>
    new ApiError(
      message,
      409,
      "Conflict",
      JSON.stringify({ error: { message, type: "api_error", code } }),
    )

  it.each(["config_revision_conflict", "config_recovery_pending"] as const)(
    "reads only the supported nested 409 code %s",
    (code) => expect(getNotificationConfigErrorCode(conflict(code))).toBe(code),
  )

  it("does not classify generic, malformed, or non-409 errors as a CAS outcome", () => {
    expect(getNotificationConfigErrorCode(conflict("future_code"))).toBeNull()
    expect(getNotificationConfigErrorCode(new ApiError("x", 409, "Conflict", "not-json"))).toBeNull()
    expect(
      getNotificationConfigErrorCode(
        new ApiError(
          "x",
          400,
          "Bad Request",
          JSON.stringify({ error: { code: "config_revision_conflict" } }),
        ),
      ),
    ).toBeNull()
  })

  it("never reflects server, unknown-error, credential, or mask text", () => {
    const sentinel = "super-secret-device-key"
    const messages = [
      getSafeNotificationErrorMessage(conflict("config_revision_conflict", sentinel), [sentinel]),
      getSafeNotificationErrorMessage(new Error(sentinel), [sentinel]),
      getSafeNotificationErrorMessage(new Error("****....")),
    ]

    for (const message of messages) {
      expect(message).not.toContain(sentinel)
      expect(message).not.toContain("****")
    }
    expect(getSafeNotificationErrorMessage(new NetworkRequestError(sentinel))).toContain(
      "network error",
    )
  })
})
