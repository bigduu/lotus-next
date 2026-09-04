import { beforeEach, describe, expect, it, vi } from "vitest"

import { ApiError, NetworkRequestError } from "../api/errors"

const apiMock = vi.hoisted(() => ({
  get: vi.fn<(path: string, options?: RequestInit) => Promise<unknown>>(),
  put: vi.fn<(path: string, data?: unknown) => Promise<unknown>>(),
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

beforeEach(() => {
  apiMock.get.mockReset()
  apiMock.put.mockReset()
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
          credential: { credentialRef: null, state: "missing", configured: false },
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
    ["duplicated metadata mismatch", (fixture: Fixture) => (fixture.section.revision = 8)],
    ["unknown top-level field", (fixture: Fixture) => Reflect.set(fixture, "legacy", true)],
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
})

describe("notification section requests", () => {
  const mutation: NotificationMutationData = {
    desktop: { enabled: null },
    ntfy: {
      enabled: true,
      base_url: "https://ntfy.example",
      topic: "alerts",
      credential_change: { action: "keep" },
    },
    bark: {
      enabled: false,
      base_url: "https://api.day.app",
      credential_change: { action: "replace", value: "bark-device-key" },
    },
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
    const response = envelopeFixture()
    response.revision = 8
    response.section.revision = 8
    apiMock.put.mockResolvedValue(response)

    await expect(putNotificationChannelsConfig(7, mutation)).resolves.toMatchObject({ revision: 8 })
    expect(apiMock.put).toHaveBeenCalledTimes(1)
    expect(apiMock.put).toHaveBeenCalledWith("bamboo/config/notifications", {
      expected_revision: 7,
      data: mutation,
    })
  })

  it.each([Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER + 1])(
    "rejects unsafe expected revision %s before issuing a PUT",
    async (revision) => {
      await expect(putNotificationChannelsConfig(revision, mutation)).rejects.toBeInstanceOf(
        NotificationConfigContractError,
      )
      expect(apiMock.put).not.toHaveBeenCalled()
    },
  )

  it.each([6, 7, 9])(
    "rejects an unrelated successful response revision %s",
    async (revision) => {
      const response = envelopeFixture()
      response.revision = revision
      response.section.revision = revision
      apiMock.put.mockResolvedValue(response)
      await expect(putNotificationChannelsConfig(7, mutation)).rejects.toBeInstanceOf(
        NotificationConfigContractError,
      )
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
