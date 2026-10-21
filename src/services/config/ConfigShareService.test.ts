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
  preview: { contains_secrets: true, providers: [{ id: "sample", provider_type: "openai", has_api_key: true, has_base_url: true, conflict: true, replace_allowed: true, source_origin: "https://imported.example:8443", target_origin: "https://current.example:9443", retains_existing_api_key: false, credential_origin_risk: true }], scenarios: [], subagent_models: [], env: [{ name: "SAMPLE_TOKEN", has_value: true, secret: true, conflict: false }] },
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

  it("rejects an invalid optional metadata passphrase before making a request", async () => {
    const post = vi.spyOn(apiClient, "postOnce").mockResolvedValue({ share_string: shareString })
    const selection = { ...emptyShareSelection(), providers: ["sample"] }
    for (const value of ["short", "x".repeat(11), "界".repeat(3), " ".repeat(12), "x".repeat(1025), "界".repeat(342)]) {
      await expect(service.export(selection, false, value)).rejects.toMatchObject({ kind: "invalid" })
    }
    expect(post).not.toHaveBeenCalled()
    await expect(service.export(selection, false)).resolves.toBe(shareString)
    expect(post).toHaveBeenLastCalledWith("/bamboo/config/share/export", {
      selection, include_secrets: false,
    }, expect.objectContaining({ cache: "no-store" }))
    for (const value of ["x".repeat(12), "界".repeat(4), "x".repeat(1024), "界".repeat(341)]) {
      await expect(service.export(selection, false, value)).resolves.toBe(shareString)
      expect(post).toHaveBeenLastCalledWith("/bamboo/config/share/export", {
        selection, include_secrets: false, passphrase: value,
      }, expect.objectContaining({ cache: "no-store" }))
    }
    expect(post).toHaveBeenCalledTimes(5)
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

  it("projects canonical HTTP(S) origins, including ports, and retains the unknown-target risk", async () => {
    const response = preview()
    const provider = { ...response.preview.providers[0], has_api_key: false, source_origin: "http://127.0.0.1:8080", target_origin: undefined, retains_existing_api_key: true, credential_origin_risk: true }
    const post = vi.spyOn(apiClient, "postOnce").mockResolvedValue({ ...response, preview: { ...response.preview, providers: [provider] } })
    const result = await service.preview({ share_string: shareString })
    expect(result.preview.providers[0]).toMatchObject({ source_origin: "http://127.0.0.1:8080", retains_existing_api_key: true, credential_origin_risk: true })
    expect(Object.hasOwn(result.preview.providers[0], "target_origin")).toBe(false)
    post.mockResolvedValue({ ...response, preview: { ...response.preview, providers: [{ ...provider, target_origin: "https://[::1]:9443" }] } })
    expect((await service.preview({ share_string: shareString })).preview.providers[0].target_origin).toBe("https://[::1]:9443")
  })

  it.each([
    { has_api_key: false, retains_existing_api_key: false },
    { has_api_key: false, retains_existing_api_key: true },
    { has_api_key: true, retains_existing_api_key: false },
    { has_api_key: true, retains_existing_api_key: true },
  ])("accepts conservative origin risk with credential metadata %j", async (fields) => {
    const response = preview()
    response.preview.providers[0] = { ...response.preview.providers[0], ...fields, credential_origin_risk: true }
    vi.spyOn(apiClient, "postOnce").mockResolvedValue(response)
    expect((await service.preview({ share_string: shareString })).preview.providers[0]).toMatchObject({
      ...fields, credential_origin_risk: true,
    })
  })

  it("rejects sensitive, non-HTTP(S) or noncanonical origin metadata without retaining it in errors", async () => {
    const response = preview()
    const post = vi.spyOn(apiClient, "postOnce")
    const invalidOrigins = [
      "https://user:FAKE_PRIVATE_KEY@safe.example", "https://safe.example/private", "https://safe.example?token=FAKE_PRIVATE_KEY",
      "https://safe.example#FAKE_PRIVATE_KEY", "https://safe.example?", "https://safe.example/", "https://safe.example:443",
      "https://SAFE.example", " https://safe.example", "https://safe.example\n", "file:///FAKE_PRIVATE_KEY", "javascript:void(0)", null,
    ]
    for (const origin of invalidOrigins) {
      for (const field of ["source_origin", "target_origin"]) {
        post.mockResolvedValue({ ...response, preview: { ...response.preview, providers: [{ ...response.preview.providers[0], [field]: origin }] } })
        const result = await service.preview({ share_string: shareString }).catch((error) => error)
        expect(result).toBeInstanceOf(ConfigShareError)
        expect(result.kind).toBe("unavailable")
        expect(result.message).not.toContain("FAKE_PRIVATE_KEY")
        expect(result.cause).toBeUndefined()
      }
    }
  })

  it("rejects old backend fields and inconsistent credential retention or origin risk metadata", async () => {
    const response = preview()
    const post = vi.spyOn(apiClient, "postOnce")
    const invalid = [
      { retains_existing_api_key: undefined }, { credential_origin_risk: undefined }, { source_origin: undefined },
      { has_base_url: false }, { conflict: false },
      { conflict: false, has_api_key: false, retains_existing_api_key: true, credential_origin_risk: true },
      { has_api_key: false, retains_existing_api_key: true, credential_origin_risk: false },
      { credential_origin_risk: false },
      { has_api_key: false, retains_existing_api_key: true, target_origin: "https://imported.example:8443", credential_origin_risk: true },
    ]
    for (const fields of invalid) {
      post.mockResolvedValue({ ...response, preview: { ...response.preview, providers: [{ ...response.preview.providers[0], ...fields }] } })
      await expect(service.preview({ share_string: shareString })).rejects.toMatchObject({ kind: "unavailable" })
    }
    const provider = { ...response.preview.providers[0], has_api_key: false, has_base_url: false, source_origin: undefined, target_origin: undefined, retains_existing_api_key: true, credential_origin_risk: false }
    post.mockResolvedValue({ ...response, preview: { ...response.preview, providers: [provider] } })
    const valid = await service.preview({ share_string: shareString })
    expect(valid.preview.providers[0].retains_existing_api_key).toBe(true)
    expect(valid.preview.providers[0].credential_origin_risk).toBe(false)
    expect(Object.hasOwn(valid.preview.providers[0], "source_origin")).toBe(false)
  })

  it("requires a consistent replacement permission and projects type-mismatch restrictions", async () => {
    const response = preview()
    const provider = response.preview.providers[0]
    const post = vi.spyOn(apiClient, "postOnce")
    for (const fields of [{ replace_allowed: undefined }, { replace_allowed: false, conflict: false, credential_origin_risk: false }]) {
      post.mockResolvedValue({ ...response, preview: { ...response.preview, providers: [{ ...provider, ...fields }] } })
      await expect(service.preview({ share_string: shareString })).rejects.toMatchObject({ kind: "unavailable" })
    }
    post.mockResolvedValue({ ...response, preview: { ...response.preview, providers: [{ ...provider, provider_type: "anthropic", replace_allowed: false }] } })
    expect((await service.preview({ share_string: shareString })).preview.providers[0]).toMatchObject({ provider_type: "anthropic", conflict: true, replace_allowed: false })
    post.mockResolvedValue({ ...response, preview: { ...response.preview, providers: [{ ...provider, conflict: false, replace_allowed: true, target_origin: undefined, credential_origin_risk: false }] } })
    expect((await service.preview({ share_string: shareString })).preview.providers[0].replace_allowed).toBe(true)
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
