import { describe, expect, it, vi } from "vitest"
import { apiClient, ApiError } from "@services/api"
import { emptyShareSelection, emptyShareDecisions, MAX_SHARE_STRING_BYTES, type ShareApplyRequest } from "@shared/types/configShare"
import { ConfigShareError, ConfigShareService } from "./ConfigShareService"
import { settingsService } from "./SettingsService"

const service = new ConfigShareService()
const operationId = "01234567-89ab-4cde-8f01-23456789abcd"
const shareString = "BAMBOO-SHARE:1:synthetic"
const preview = () => ({
  apply_blocked: false, warnings: [],
  preview_token: "fixture-token", expected_revisions: { providers: 3, env: 4, credentials: 5 },
  preview: { contains_secrets: true, providers: [{ id: "sample", provider_type: "openai", has_api_key: true, has_base_url: true, conflict: true }], scenarios: [], subagent_models: [], env: [{ name: "SAMPLE_TOKEN", has_value: true, secret: true, conflict: false }] },
})
const applyRequest = (): ShareApplyRequest => ({
  share_string: shareString, passphrase: "FAKE_TEST_PASSPHRASE", choices: emptyShareDecisions(),
  preview_token: "fixture-token", expected_revisions: { providers: 3, env: 4, credentials: 5 }, operation_id: operationId,
})

describe("ConfigShareService", () => {
  it("resolves legacy type aliases before scenario selection without retaining config values", async () => {
    vi.spyOn(settingsService, "getProviderInstances").mockResolvedValue({
      default_provider_instance_id: "openai-work", instances: [
        { id: "openai-other", type: "openai", label: "Other", enabled: true, config: { api_key: "PRIVATE_MARKER" } },
        { id: "openai-work", type: "openai", label: "Work", enabled: true, config: {} },
      ], defaults: { chat: { provider: "openai", model: "fake-model" }, subagent_models: { helper: { provider: "openai", model: "fake-child" } } },
    })
    vi.spyOn(settingsService, "getEnvVars").mockResolvedValue({ revision: 4, entries: [{ name: "SAMPLE_TOKEN", secret: false, has_value: true, value: "PRIVATE_MARKER" }] })
    const result = await service.inventory()
    expect(result.scenarios).toEqual([{ name: "chat", provider: "openai-work", model: "fake-model" }])
    expect(result.subagent_models).toEqual([{ name: "helper", provider: "openai-work", model: "fake-child" }])
    expect(JSON.stringify(result)).not.toContain("PRIVATE_MARKER")
  })

  it("requires an explicit secret choice and passphrase before export", async () => {
    const post = vi.spyOn(apiClient, "postOnce").mockResolvedValue({ share_string: shareString })
    const selection = { ...emptyShareSelection(), providers: ["sample"], provider_api_keys: ["sample"] }
    await expect(service.export(selection, false, "FAKE_TEST_PASSPHRASE")).rejects.toMatchObject({ kind: "invalid" })
    await expect(service.export(selection, true)).rejects.toMatchObject({ kind: "invalid" })
    await expect(service.export(selection, true, "short")).rejects.toMatchObject({ kind: "invalid" })
    expect(post).not.toHaveBeenCalled()
    await expect(service.export(selection, true, "FAKE_TEST_PASSPHRASE")).resolves.toBe(shareString)
    expect(post).toHaveBeenCalledExactlyOnceWith("/bamboo/config/share/export", {
      selection, include_secrets: true, passphrase: "FAKE_TEST_PASSPHRASE",
    }, expect.objectContaining({ cache: "no-store", headers: { "Cache-Control": "no-store" } }))
  })

  it("bounds payload bytes and versions without decoding or making a request", async () => {
    const post = vi.spyOn(apiClient, "postOnce")
    for (const share_string of ["BAMBOO-SHARE:2:synthetic", shareString + "x".repeat(MAX_SHARE_STRING_BYTES), "BAMBOO-SHARE:1:" + "界".repeat(MAX_SHARE_STRING_BYTES / 2)]) {
      await expect(service.preview({ share_string })).rejects.toMatchObject({ kind: "invalid" })
    }
    await expect(service.preview({ share_string: shareString, passphrase: "x".repeat(1025) })).rejects.toMatchObject({ kind: "invalid" })
    expect(post).not.toHaveBeenCalled()
  })

  it("retains only the redacted preview allowlist and passes cancellation signal", async () => {
    const body = preview()
    const withAccidentalValues = { ...body, api_key: "PRIVATE_MARKER", preview: { ...body.preview, providers: body.preview.providers.map((row) => ({ ...row, api_key: "PRIVATE_MARKER", base_url: "PRIVATE_MARKER" })), env: body.preview.env.map((row) => ({ ...row, value: "PRIVATE_MARKER" })) } }
    const post = vi.spyOn(apiClient, "postOnce").mockResolvedValue(withAccidentalValues)
    const controller = new AbortController()
    const result = await service.preview({ share_string: shareString }, controller.signal)
    expect(result).toEqual(body)
    expect(JSON.stringify(result)).not.toContain("PRIVATE_MARKER")
    expect(post).toHaveBeenCalledWith("/bamboo/config/share/preview", { share_string: shareString }, expect.objectContaining({ signal: controller.signal, cache: "no-store" }))
  })

  it("rejects malformed preview metadata and discards raw API error details", async () => {
    const post = vi.spyOn(apiClient, "postOnce").mockResolvedValue({ ...preview(), expected_revisions: { providers: -1, env: 4, credentials: 5 } })
    await expect(service.preview({ share_string: shareString })).rejects.toMatchObject({ kind: "unavailable" })
    post.mockRejectedValue(new ApiError("PRIVATE_MARKER", 400, "PRIVATE_MARKER", "PRIVATE_MARKER"))
    const result = await service.preview({ share_string: shareString }).catch((error) => error)
    expect(result).toBeInstanceOf(ConfigShareError)
    expect(JSON.stringify(result)).not.toContain("PRIVATE_MARKER")
    expect(result.message).not.toContain("PRIVATE_MARKER")
    expect(result.cause).toBeUndefined()
  })

  it("fails closed without an apply boundary status and retains only known warning codes", async () => {
    const post = vi.spyOn(apiClient, "postOnce").mockResolvedValue({ ...preview(), apply_blocked: undefined })
    await expect(service.preview({ share_string: shareString })).rejects.toMatchObject({ kind: "unavailable" })
    post.mockResolvedValue({ ...preview(), apply_blocked: true, warnings: ["automatic_provider_authentication_blocked", "PRIVATE_UNKNOWN_WARNING"], expected_revisions: { ...preview().expected_revisions, private_extra: "PRIVATE_MARKER" } })
    const value = await service.preview({ share_string: shareString })
    expect(value.apply_blocked).toBe(true)
    expect(value.warnings).toEqual(["automatic_provider_authentication_blocked"])
    expect(JSON.stringify(value)).not.toContain("PRIVATE_")
  })

  it("sends one apply with CAS and receipt id, and reads its exact operation afterward", async () => {
    const result = { operation_id: operationId, state: "committed", revisions: { providers: 4, env: 5, credentials: 6 } }
    const post = vi.spyOn(apiClient, "postOnce").mockResolvedValue(result)
    const put = vi.spyOn(apiClient, "put")
    const get = vi.spyOn(apiClient, "get").mockResolvedValue(result)
    const request = applyRequest()
    await expect(service.apply(request)).resolves.toEqual(result)
    expect(post).toHaveBeenCalledExactlyOnceWith("/bamboo/config/share/apply", request, expect.objectContaining({ cache: "no-store" }))
    expect(put).not.toHaveBeenCalled()
    await expect(service.operation(operationId)).resolves.toEqual(result)
    expect(get).toHaveBeenCalledExactlyOnceWith(`/bamboo/config/share/operations/${operationId}`, expect.objectContaining({ cache: "no-store" }))
    await expect(service.operation("../PRIVATE_MARKER")).rejects.toMatchObject({ kind: "invalid" })
    expect(get).toHaveBeenCalledTimes(1)
  })

  it("distinguishes stale CAS from an uncertain write without retrying either", async () => {
    const post = vi.spyOn(apiClient, "postOnce").mockRejectedValueOnce(new ApiError("PRIVATE_MARKER", 409, "Conflict"))
    await expect(service.apply(applyRequest())).rejects.toMatchObject({ kind: "stale" })
    post.mockRejectedValueOnce(new Error("PRIVATE_MARKER"))
    await expect(service.apply(applyRequest())).rejects.toMatchObject({ kind: "unconfirmed" })
    post.mockRejectedValueOnce(new ApiError("PRIVATE_MARKER", 429, "Busy"))
    await expect(service.apply(applyRequest())).rejects.toMatchObject({ kind: "invalid" })
    expect(post).toHaveBeenCalledTimes(3)
  })
})
