import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { changeLocale } from "@shared/i18n"
import { configShareService, ConfigShareError } from "@services/config/ConfigShareService"
import { apiClient } from "@services/api"
import { settingsService } from "@services/config/SettingsService"
import { AgentClient } from "@services/chat/AgentService"
import { modelService } from "@services/chat/ModelService"
import { serviceFactory } from "@services/common/ServiceFactory"
import type { FetchModelsResponse } from "@services/config/SettingsService"
import type { ProviderCatalog } from "@shared/types/providerModelRef"
import { useAppStore } from "@shared/store/appStore"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import { PROVIDER_DEFAULT_MODEL_REF_KEYS } from "@shared/types/providerConfig"
import type { ShareInventory, SharePreviewResponse, ShareOperation } from "@shared/types/configShare"
import { SettingsConfigShare } from "./SettingsConfigShare"

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
environment.IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
const source = "BAMBOO-SHARE:1:PRIVATE_SYNTHETIC_BUNDLE"
const passphrase = "PRIVATE_SYNTHETIC_PASSPHRASE"
const initialProviderState = useProviderStore.getState()
const savedSnapshot = (model = "imported-model", provider = "imported-provider") => ({
  default_provider_instance_id: provider, features: { provider_model_ref: true },
  instances: [{ id: provider, label: "Sample", type: "openai" as const, enabled: true, config: { runtime_models: [model, "custom-model"] } }],
  defaults: { chat: { provider, model } },
})
const committedRevisions = { providers: 8, env: 9, credentials: 10 }
const liveHealth = () => ({
  providers: { status: "healthy", revision: 8 },
  application: {
    sections: { providers: { revision: 8 }, env: { revision: 9 }, credentials: { revision: 10 } },
    consumers: [{ id: "provider-runtime", state: "in_sync", applied_dependencies: { providers: 8, credentials: 10 }, credential_source: { status: "observed_inputs", revision: 10 } }],
  },
})
const inventory = (): ShareInventory => ({
  providers: [{ id: "sample", label: "Sample", type: "openai" }],
  scenarios: PROVIDER_DEFAULT_MODEL_REF_KEYS.map((name) => ({ name, provider: "sample", model: "fake-model" })),
  subagent_models: [{ name: "helper", provider: "sample", model: "fake-model" }],
  env: [{ name: "SAMPLE_TOKEN", has_value: true, secret: true }],
})
const preview = (): SharePreviewResponse => ({
  apply_blocked: false, warnings: [],
  preview_token: "fixture-token", expected_revisions: { providers: 7, env: 8, credentials: 9 },
  preview: {
    contains_secrets: true,
    providers: [{ id: "sample", label: "Sample", provider_type: "openai", has_api_key: true, has_base_url: true, conflict: true, replace_allowed: true, source_origin: "https://imported.example:8443", target_origin: "https://current.example:9443", retains_existing_api_key: false, credential_origin_risk: true }],
    scenarios: [{ scenario: "chat", provider: "sample", model: "fake-model", conflict: true }],
    subagent_models: [{ name: "helper", provider: "sample", model: "fake-model", conflict: false }],
    env: [{ name: "SAMPLE_TOKEN", has_value: true, secret: true, conflict: false }],
  },
})
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const button = (text: string) => {
  const found = [...document.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === text)
  expect(found).toBeDefined()
  return found!
}
const control = (label: string) => {
  const el = [...document.querySelectorAll<HTMLLabelElement>("label")].find((item) => item.textContent?.trim() === label)
  expect(el).toBeDefined()
  return document.getElementById(el!.htmlFor) as HTMLInputElement | HTMLTextAreaElement
}
const fill = async (label: string, value: string) => act(async () => {
  const input = control(label)
  Object.getOwnPropertyDescriptor(input.tagName === "TEXTAREA" ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(input, value)
  input.dispatchEvent(new Event("input", { bubbles: true }))
})
const check = async (label: string) => act(async () => {
  const el = [...document.querySelectorAll<HTMLLabelElement>("label")].find((item) => item.textContent?.trim() === label)
  expect(el).toBeDefined()
  el!.querySelector<HTMLInputElement>("input[type=checkbox]")!.click()
})
const click = async (label: string) => act(async () => button(label).click())
async function mount() {
  const root = createRoot(document.body.appendChild(document.createElement("div")))
  roots.push(root)
  await act(async () => root.render(<SettingsConfigShare />))
}
async function preparedPreview() {
  await fill("Paste sharing string", source)
  await fill("Import passphrase (if protected)", passphrase)
  await click("Preview import")
}

beforeEach(async () => {
  await changeLocale("en-US")
  vi.spyOn(configShareService, "inventory").mockResolvedValue(inventory())
  vi.spyOn(configShareService, "export").mockResolvedValue(source)
  vi.spyOn(configShareService, "preview").mockResolvedValue(preview())
  vi.spyOn(configShareService, "apply").mockImplementation(async (request) => ({ operation_id: request.operation_id, state: "committed", revisions: committedRevisions }))
  vi.spyOn(configShareService, "operation")
  useProviderStore.setState({ ...initialProviderState, providerSnapshot: savedSnapshot("old-model", "old-provider"), providerStatus: "ready" }, true)
  useAppStore.setState({ models: ["old-model"], selectedModel: "old-model", modelsError: null })
  vi.spyOn(settingsService, "getProviderInstances").mockResolvedValue(savedSnapshot())
  vi.spyOn(settingsService, "getProviderCatalog").mockResolvedValue({ providers: [], models: [] })
  vi.spyOn(settingsService, "fetchCatalogModels")
  vi.spyOn(useAppStore.getState(), "fetchModels")
  vi.spyOn(apiClient, "get").mockResolvedValue(liveHealth())
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

describe("SettingsConfigShare", () => {
  it.each(["direct", "receipt"])("adopts saved defaults and model options after %s Committed without provider discovery", async (path) => {
    if (path === "receipt") vi.mocked(configShareService.apply).mockRejectedValue(new ConfigShareError("unconfirmed"))
    vi.mocked(configShareService.operation).mockImplementation(async (operation_id) => ({ operation_id, state: "committed", revisions: committedRevisions }))
    const create = vi.spyOn(AgentClient.prototype, "createSession").mockRejectedValue(new Error("synthetic-stop-before-session-write"))
    const pinnedConfig = { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, model: "pinned-model", model_ref: { provider: "pinned-provider", model: "pinned-model" } }
    useAppStore.setState({ chats: [{ id: "existing-chat", title: "Existing chat", messages: [], createdAt: 1, config: pinnedConfig }], currentSessionId: "existing-chat" })
    const existing = useAppStore.getState().chats
    await mount(); await preparedPreview()
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    if (path === "receipt") await click("Check import result")
    expect(useProviderStore.getState().providerSnapshot?.defaults?.chat).toEqual({ provider: "imported-provider", model: "imported-model" })
    expect(useAppStore.getState().models).toEqual(["custom-model", "imported-model"])
    await expect(useAppStore.getState().addChat({ title: "Synthetic new chat", messages: [], createdAt: 2, config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null } })).rejects.toThrow("synthetic-stop-before-session-write")
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ model: "imported-model", model_ref: { provider: "imported-provider", model: "imported-model" }, provider: "imported-provider" }))
    expect(useAppStore.getState().chats).toBe(existing)
    expect(useAppStore.getState().chats[0].config).toBe(pinnedConfig)
    expect(settingsService.getProviderCatalog).not.toHaveBeenCalled()
    expect(settingsService.fetchCatalogModels).not.toHaveBeenCalled()
    expect(useAppStore.getState().fetchModels).not.toHaveBeenCalled()
    expect(configShareService.apply).toHaveBeenCalledTimes(1)
  })

  it("retains a committed receipt when authority refresh fails and retries only reads", async () => {
    vi.mocked(settingsService.getProviderInstances).mockRejectedValueOnce(new Error("PRIVATE_REFRESH_ERROR"))
    await mount(); await preparedPreview()
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    const id = vi.mocked(configShareService.apply).mock.calls[0][0].operation_id
    expect(document.body.textContent).toContain(`Import receipt: ${id}`)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("saved, but the client settings could not be refreshed")
    expect(document.body.textContent).not.toContain("PRIVATE_REFRESH_ERROR")
    expect(useProviderStore.getState().providerSnapshot).toBeNull()
    expect(useAppStore.getState().models).toEqual([])
    await click("Cancel and clear sharing data")
    expect(document.body.textContent).toContain(`Import receipt: ${id}`)
    await act(async () => { button("Refresh saved settings").click(); button("Refresh saved settings").click() })
    expect(settingsService.getProviderInstances).toHaveBeenCalledTimes(2)
    expect(useProviderStore.getState().providerSnapshot?.defaults?.chat.model).toBe("imported-model")
    expect(configShareService.apply).toHaveBeenCalledTimes(1)
    expect(configShareService.operation).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain(`Import receipt: ${id}`)
  })

  it.each(["direct", "receipt"])("adopts a %s Committed result even after the sharing tab unmounts", async (path) => {
    const committed = deferred<ShareOperation>()
    if (path === "direct") vi.mocked(configShareService.apply).mockReturnValueOnce(committed.promise)
    else {
      vi.mocked(configShareService.apply).mockRejectedValueOnce(new ConfigShareError("unconfirmed"))
      vi.mocked(configShareService.operation).mockReturnValueOnce(committed.promise)
    }
    const create = vi.spyOn(AgentClient.prototype, "createSession").mockRejectedValue(new Error("synthetic-stop-before-session-write"))
    await mount(); await preparedPreview()
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    if (path === "receipt") await click("Check import result")
    expect.soft(useProviderStore.getState().providerSnapshot).toBeNull()
    expect.soft(useAppStore.getState().models).toEqual([])
    act(() => { for (const root of roots.splice(0)) root.unmount() })
    const id = vi.mocked(configShareService.apply).mock.calls[0][0].operation_id
    await act(async () => committed.resolve({ operation_id: id, state: "committed", revisions: committedRevisions }))
    await expect(useAppStore.getState().addChat({ title: "Synthetic new chat", messages: [], createdAt: 2, config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null } })).rejects.toThrow("synthetic-stop-before-session-write")
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ model: "imported-model", model_ref: { provider: "imported-provider", model: "imported-model" }, provider: "imported-provider" }))
    expect(useAppStore.getState().models).toEqual(["custom-model", "imported-model"])
    expect(settingsService.getProviderCatalog).not.toHaveBeenCalled()
    expect(settingsService.fetchCatalogModels).not.toHaveBeenCalled()
    expect(configShareService.apply).toHaveBeenCalledTimes(1)
  })

  it("keeps uncertain authority revoked when the sharing tab leaves before a lost apply response", async () => {
    const apply = deferred<ShareOperation>()
    vi.mocked(configShareService.apply).mockReturnValueOnce(apply.promise)
    await mount(); await preparedPreview()
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    act(() => { for (const root of roots.splice(0)) root.unmount() })
    await act(async () => apply.reject(new ConfigShareError("unconfirmed")))
    expect(useProviderStore.getState().providerSnapshot).toBeNull()
    expect(useProviderStore.getState().providerStatus).not.toBe("ready")
    expect(useAppStore.getState().models).toEqual([])
    expect(settingsService.getProviderInstances).not.toHaveBeenCalled()
    expect(apiClient.get).not.toHaveBeenCalled()
    expect(configShareService.apply).toHaveBeenCalledTimes(1)
  })

  it.each(["pending", "not_found"] as const)("keeps authority revoked without refreshing providers for %s outcomes", async (state) => {
    vi.mocked(configShareService.apply).mockImplementation(async (request) => ({ operation_id: request.operation_id, state }))
    await mount(); await preparedPreview()
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    expect(settingsService.getProviderInstances).not.toHaveBeenCalled()
    expect(apiClient.get).not.toHaveBeenCalled()
    expect(useProviderStore.getState().providerSnapshot).toBeNull()
    expect(useProviderStore.getState().providerStatus).not.toBe("ready")
    expect(useAppStore.getState().models).toEqual([])
  })

  it.each(["invalid", "rejected", "receipt-rejected"])("recovers current authority through reads after a known unwritten %s result", async (kind) => {
    vi.mocked(settingsService.getProviderInstances).mockResolvedValue(savedSnapshot("current-model", "current-provider"))
    if (kind === "invalid") vi.mocked(configShareService.apply).mockRejectedValueOnce(new ConfigShareError("invalid"))
    else if (kind === "rejected") vi.mocked(configShareService.apply).mockImplementationOnce(async ({ operation_id }) => ({ operation_id, state: "rejected" }))
    else {
      vi.mocked(configShareService.apply).mockRejectedValueOnce(new ConfigShareError("unconfirmed"))
      vi.mocked(configShareService.operation).mockImplementationOnce(async (operation_id) => ({ operation_id, state: "rejected" }))
    }
    const create = vi.spyOn(AgentClient.prototype, "createSession").mockRejectedValue(new Error("synthetic-stop-before-session-write"))
    await mount(); await preparedPreview()
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    if (kind === "receipt-rejected") await click("Check import result")
    expect(useProviderStore.getState().providerStatus).toBe("ready")
    expect(useProviderStore.getState().providerSnapshot?.defaults?.chat).toEqual({ provider: "current-provider", model: "current-model" })
    expect(useAppStore.getState().models).toEqual(["current-model", "custom-model"])
    await expect(useAppStore.getState().addChat({ title: "Synthetic new chat", messages: [], createdAt: 2, config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null } })).rejects.toThrow("synthetic-stop-before-session-write")
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ model: "current-model", model_ref: { provider: "current-provider", model: "current-model" }, provider: "current-provider" }))
    expect(document.body.textContent).not.toContain("Imported settings are saved")
    expect(configShareService.apply).toHaveBeenCalledTimes(1)
    expect(settingsService.getProviderCatalog).not.toHaveBeenCalled()
    expect(settingsService.fetchCatalogModels).not.toHaveBeenCalled()
  })

  it.each(["stale", "rejected"])("offers readonly recovery retry after %s without claiming an import was saved", async (kind) => {
    vi.mocked(settingsService.getProviderInstances).mockRejectedValueOnce(new Error("PRIVATE_RECOVERY_ERROR")).mockResolvedValue(savedSnapshot("current-model", "current-provider"))
    const create = vi.spyOn(AgentClient.prototype, "createSession").mockRejectedValue(new Error("synthetic-stop-before-session-write"))
    if (kind === "stale") vi.mocked(configShareService.apply).mockRejectedValueOnce(new ConfigShareError("stale"))
    else vi.mocked(configShareService.apply).mockImplementationOnce(async ({ operation_id }) => ({ operation_id, state: "rejected" }))
    await mount(); await preparedPreview()
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("The import was not saved, and the current client settings could not be refreshed")
    expect(document.body.textContent).not.toContain("Imported settings are saved")
    expect(document.body.textContent).not.toContain("PRIVATE_RECOVERY_ERROR")
    expect(useProviderStore.getState().providerSnapshot).toBeNull()
    await click("Cancel and clear sharing data")
    expect(button("Refresh current settings").disabled).toBe(false)
    await act(async () => { button("Refresh current settings").click(); button("Refresh current settings").click() })
    expect(useProviderStore.getState().providerStatus).toBe("ready")
    expect(useProviderStore.getState().providerSnapshot?.defaults?.chat.model).toBe("current-model")
    expect(settingsService.getProviderInstances).toHaveBeenCalledTimes(2)
    expect(configShareService.apply).toHaveBeenCalledTimes(1)
    expect(configShareService.operation).not.toHaveBeenCalled()
    expect(document.body.textContent).not.toContain("Imported settings are saved")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain(kind === "stale" ? "Settings changed after this preview" : "The import was rejected")
    await expect(useAppStore.getState().addChat({ title: "Synthetic new chat", messages: [], createdAt: 2, config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null } })).rejects.toThrow("synthetic-stop-before-session-write")
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ model: "current-model", model_ref: { provider: "current-provider", model: "current-model" }, provider: "current-provider" }))
    expect(settingsService.getProviderCatalog).not.toHaveBeenCalled()
    expect(settingsService.fetchCatalogModels).not.toHaveBeenCalled()
  })

  it.each(["stale", "rejected"])("recovers a known unwritten %s outcome globally after the sharing tab unmounts", async (kind) => {
    const apply = deferred<ShareOperation>()
    vi.mocked(configShareService.apply).mockReturnValueOnce(apply.promise)
    vi.mocked(settingsService.getProviderInstances).mockResolvedValue(savedSnapshot("current-model", "current-provider"))
    const create = vi.spyOn(AgentClient.prototype, "createSession").mockRejectedValue(new Error("synthetic-stop-before-session-write"))
    await mount(); await preparedPreview()
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    act(() => { for (const root of roots.splice(0)) root.unmount() })
    const id = vi.mocked(configShareService.apply).mock.calls[0][0].operation_id
    await act(async () => {
      if (kind === "stale") apply.reject(new ConfigShareError("stale"))
      else apply.resolve({ operation_id: id, state: "rejected" })
    })
    expect(useProviderStore.getState().providerStatus).toBe("ready")
    await expect(useAppStore.getState().addChat({ title: "Synthetic new chat", messages: [], createdAt: 2, config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null } })).rejects.toThrow("synthetic-stop-before-session-write")
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ model: "current-model", model_ref: { provider: "current-provider", model: "current-model" }, provider: "current-provider" }))
    expect(configShareService.apply).toHaveBeenCalledTimes(1)
    expect(settingsService.getProviderCatalog).not.toHaveBeenCalled()
  })

  it("revokes old defaults while waiting for the committed generation and keeps the receipt visible", async () => {
    const health = deferred<unknown>()
    vi.mocked(apiClient.get).mockReturnValueOnce(health.promise)
    await mount(); await preparedPreview()
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    expect(useProviderStore.getState().providerSnapshot).toBeNull()
    expect(useAppStore.getState().models).toEqual([])
    expect(settingsService.getProviderInstances).not.toHaveBeenCalled()
    const id = vi.mocked(configShareService.apply).mock.calls[0][0].operation_id
    expect(document.body.textContent).toContain(`Import receipt: ${id}`)
    await act(async () => health.resolve(liveHealth()))
    expect(useProviderStore.getState().providerSnapshot?.defaults?.chat.model).toBe("imported-model")
  })

  it("keeps a Committed receipt without revisions as saved but refresh-unconfirmed", async () => {
    vi.mocked(configShareService.apply).mockImplementation(async ({ operation_id }) => ({ operation_id, state: "committed" }))
    await mount(); await preparedPreview()
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    expect(document.body.textContent).toContain("Imported settings are saved")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("saved, but the client settings could not be refreshed")
    expect(apiClient.get).not.toHaveBeenCalled()
    expect(settingsService.getProviderInstances).not.toHaveBeenCalled()
    expect(useProviderStore.getState().providerSnapshot).toBeNull()
    expect(configShareService.apply).toHaveBeenCalledTimes(1)
  })

  it("discards provider, catalog, discovery and model reads that started before the import", async () => {
    const provider = deferred<unknown>()
    const catalog = deferred<ProviderCatalog>()
    const discovery = deferred<FetchModelsResponse>()
    const models = deferred<string[]>()
    vi.mocked(settingsService.getProviderInstances).mockReturnValueOnce(provider.promise)
    vi.mocked(settingsService.getProviderCatalog).mockReturnValueOnce(catalog.promise)
    vi.mocked(settingsService.fetchCatalogModels).mockReturnValueOnce(discovery.promise)
    vi.spyOn(serviceFactory, "getSetupStatus").mockResolvedValue({ is_complete: true } as Awaited<ReturnType<typeof serviceFactory.getSetupStatus>>)
    vi.spyOn(modelService, "getModels").mockReturnValueOnce(models.promise)
    const oldProvider = useProviderStore.getState().loadProviderInstances()
    const oldCatalog = useProviderStore.getState().loadCatalog()
    const oldDiscovery = useProviderStore.getState().fetchCatalogModels("sample")
    const oldModels = useAppStore.getState().fetchModels()
    await Promise.resolve()
    await mount(); await preparedPreview()
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    await act(async () => {
      provider.resolve(savedSnapshot("late-old-model"))
      catalog.resolve({ providers: [], models: [] })
      discovery.resolve({ fetched: [{ provider: "sample", models: [] }] })
      models.resolve(["late-old-model"])
      await Promise.all([oldProvider, oldCatalog, oldDiscovery, oldModels])
    })
    expect.soft(useProviderStore.getState().providerSnapshot?.defaults?.chat.model).toBe("imported-model")
    expect.soft(useProviderStore.getState().catalog).toBeNull()
    expect.soft(useProviderStore.getState().discoveredModelsByProvider).toEqual({})
    expect.soft(useAppStore.getState().models).toEqual(["custom-model", "imported-model"])
    expect(modelService.getModels).toHaveBeenCalledTimes(1)
    expect(settingsService.getProviderCatalog).toHaveBeenCalledTimes(1)
    expect(settingsService.fetchCatalogModels).toHaveBeenCalledTimes(1)
  })

  it("does not confirm client adoption when another authority read supersedes its response", async () => {
    const imported = deferred<unknown>()
    vi.mocked(settingsService.getProviderInstances).mockReturnValueOnce(imported.promise).mockResolvedValueOnce(savedSnapshot("concurrent-model"))
    await mount(); await preparedPreview()
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    await act(async () => { await useProviderStore.getState().loadProviderInstances() })
    await act(async () => imported.resolve(savedSnapshot()))
    expect(useProviderStore.getState().providerSnapshot?.defaults?.chat.model).toBe("concurrent-model")
    expect(useAppStore.getState().models).toEqual([])
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("saved, but the client settings could not be refreshed")
    expect(document.body.textContent).toContain("Import receipt:")
    expect(configShareService.apply).toHaveBeenCalledTimes(1)
    expect(settingsService.getProviderCatalog).not.toHaveBeenCalled()
  })

  it("starts with no secrets, URLs or values selected and preserves all nine scenario choices", async () => {
    await mount()
    expect(document.body.textContent).toContain("Base URLs with embedded credentials, query strings or fragments")
    expect(document.body.textContent).toContain("Known environment controls for commands, plugins, startup scripts and tool configuration are blocked")
    expect(document.body.textContent).toContain("Version-control tool environment namespaces are reserved")
    expect(document.body.textContent).toContain("Environment variable names that differ only in case count as conflicts.")
    expect(document.body.textContent).toContain("When importing role mappings into a setup without chat defaults, include the Chat mapping.")
    expect([...document.querySelectorAll<HTMLInputElement>('input[type="checkbox"]')].every((input) => !input.checked)).toBe(true)
    for (const name of PROVIDER_DEFAULT_MODEL_REF_KEYS) expect(document.body.textContent).toContain(`${name}: sample / fake-model`)
    await check("Sample (sample)")
    await check("SAMPLE_TOKEN")
    await click("Generate sharing string")
    expect(configShareService.export).toHaveBeenCalledExactlyOnceWith({
      providers: ["sample"], provider_base_urls: [], provider_api_keys: [], scenarios: [], subagent_models: [], env: { SAMPLE_TOKEN: false },
    }, false, undefined, expect.any(AbortSignal))
    expect(configShareService.apply).not.toHaveBeenCalled()
  })

  it("requires explicit credentials and a bounded passphrase, and copy happens only on click", async () => {
    const clipboard = { writeText: vi.fn().mockResolvedValue(undefined) }
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: clipboard })
    await mount()
    await check("Sample (sample)")
    await check("Allow the selected API keys and environment values in this export")
    await check("Include API key")
    expect(button("Generate sharing string").disabled).toBe(true)
    await fill("Export passphrase (required for keys or values)", "elevenbytes")
    expect(button("Generate sharing string").disabled).toBe(true)
    await fill("Export passphrase (required for keys or values)", passphrase)
    await check("Include base URL")
    await click("Generate sharing string")
    expect(configShareService.export).toHaveBeenCalledWith(expect.objectContaining({ provider_api_keys: ["sample"], provider_base_urls: ["sample"] }), true, passphrase, expect.any(AbortSignal))
    expect(control("Export passphrase (required for keys or values)").value).toBe("")
    expect(clipboard.writeText).not.toHaveBeenCalled()
    await click("Copy sharing string")
    expect(clipboard.writeText).toHaveBeenCalledExactlyOnceWith(source)
  })

  it("checks an optional metadata passphrase before metadata-only export", async () => {
    await mount()
    await check("Sample (sample)")
    expect(button("Generate sharing string").disabled).toBe(false)
    for (const value of ["short", "界".repeat(3), " ".repeat(12), "界".repeat(342)]) {
      await fill("Export passphrase (required for keys or values)", value)
      expect(button("Generate sharing string").disabled).toBe(true)
      await click("Generate sharing string")
    }
    expect(configShareService.export).not.toHaveBeenCalled()
    await fill("Export passphrase (required for keys or values)", "界".repeat(4))
    expect(button("Generate sharing string").disabled).toBe(false)
    await click("Generate sharing string")
    expect(configShareService.export).toHaveBeenCalledExactlyOnceWith({
      providers: ["sample"], provider_base_urls: [], provider_api_keys: [], scenarios: [], subagent_models: [], env: {},
    }, false, "界".repeat(4), expect.any(AbortSignal))
  })

  it("keeps Copilot sign-in credentials unavailable while permitting its non-secret configuration selection", async () => {
    vi.mocked(configShareService.inventory).mockResolvedValue({ ...inventory(), providers: [{ id: "sample", label: "Sample", type: "copilot" }] })
    await mount()
    await check("Sample (sample)")
    await check("Allow the selected API keys and environment values in this export")
    const apiKey = [...document.querySelectorAll<HTMLLabelElement>("label")].find((item) => item.textContent?.trim() === "Include API key")!.querySelector<HTMLInputElement>('input[type="checkbox"]')!
    expect(apiKey.disabled).toBe(true)
    expect(apiKey.checked).toBe(false)
    expect(document.body.textContent).toContain("Copilot sign-in credentials cannot be shared")
    await click("Generate sharing string")
    expect(configShareService.export).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ providers: ["sample"], provider_api_keys: [] }), true, undefined, expect.any(AbortSignal))
  })

  it("previews on explicit request, defaults conflicts to skip and submits one stable CAS operation on double click", async () => {
    const pending = deferred<ShareOperation>()
    vi.mocked(configShareService.apply).mockReturnValue(pending.promise)
    const storage = [vi.spyOn(localStorage, "setItem"), vi.spyOn(sessionStorage, "setItem")]
    const logs = [vi.spyOn(console, "log"), vi.spyOn(console, "warn"), vi.spyOn(console, "error")]
    await mount()
    await fill("Paste sharing string", source)
    expect(configShareService.preview).not.toHaveBeenCalled()
    await fill("Import passphrase (if protected)", passphrase)
    await click("Preview import")
    expect(configShareService.preview).toHaveBeenCalledExactlyOnceWith({ share_string: source, passphrase }, expect.any(AbortSignal))
    expect(document.querySelector<HTMLSelectElement>('[aria-label="Import action providers:sample"]')?.value).toBe("skip")
    const region = document.querySelector('[aria-label="Preview import"]')!
    expect(region.textContent).not.toContain(source)
    expect(region.textContent).not.toContain(passphrase)
    expect(region.textContent).toContain("Skipping it also skips its imported references")
    await check("I reviewed the entries and conflict choices")
    await act(async () => { button("Save imported settings").click(); button("Save imported settings").click() })
    expect(configShareService.apply).toHaveBeenCalledTimes(1)
    const request = vi.mocked(configShareService.apply).mock.calls[0][0]
    expect(request).toMatchObject({ share_string: source, passphrase, preview_token: "fixture-token", expected_revisions: { providers: 7, env: 8, credentials: 9 }, choices: { providers: { sample: { action: "skip" } }, scenarios: { chat: { action: "skip" } } } })
    expect(request.operation_id).toMatch(/^[a-f0-9-]{36}$/)
    expect(control("Paste sharing string").value).toBe("")
    expect(control("Import passphrase (if protected)").value).toBe("")
    expect(button("Cancel and clear sharing data").disabled).toBe(true)
    await act(async () => pending.resolve({ operation_id: request.operation_id, state: "committed" }))
    expect(document.body.textContent).toContain("Imported settings are saved. Runtime use may require the next request or a restart.")
    for (const spy of [...storage, ...logs]) expect(JSON.stringify(spy.mock.calls)).not.toContain("PRIVATE_SYNTHETIC")
  })

  it("cancel aborts an in-flight preview, clears inputs and ignores its late result", async () => {
    const pending = deferred<SharePreviewResponse>()
    vi.mocked(configShareService.preview).mockReturnValue(pending.promise)
    await mount()
    await fill("Paste sharing string", source)
    await fill("Import passphrase (if protected)", passphrase)
    await click("Preview import")
    const signal = vi.mocked(configShareService.preview).mock.calls[0][1]!
    await click("Cancel and clear sharing data")
    expect(signal.aborted).toBe(true)
    expect(control("Paste sharing string").value).toBe("")
    expect(control("Import passphrase (if protected)").value).toBe("")
    await act(async () => pending.resolve(preview()))
    expect(document.querySelector('[aria-label="Preview import"]')).toBeNull()
    expect(configShareService.apply).not.toHaveBeenCalled()
  })

  it("invalidates the preview on input or choice edits and requires reviewing changes again", async () => {
    await mount(); await preparedPreview()
    await check("I reviewed the entries and conflict choices")
    await act(async () => {
      const input = document.querySelector<HTMLSelectElement>('[aria-label="Import action providers:sample"]')!
      input.value = "rename"; input.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(button("Save imported settings").disabled).toBe(true)
    await act(async () => {
      const input = document.querySelector<HTMLInputElement>('[aria-label="New name providers:sample"]')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "SAMPLE")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await check("I reviewed the entries and conflict choices")
    expect(button("Save imported settings").disabled).toBe(false)
    await fill("Import passphrase (if protected)", "changed-passphrase")
    expect(document.querySelector('[aria-label="Preview import"]')).toBeNull()
    expect(configShareService.apply).not.toHaveBeenCalled()
  })

  it("shows both provider origins and re-reviews retained-key risk even when a key was included", async () => {
    const response = preview()
    response.preview.providers[0] = { ...response.preview.providers[0], has_api_key: true, retains_existing_api_key: true, credential_origin_risk: true }
    vi.mocked(configShareService.preview).mockResolvedValue(response)
    await mount(); await preparedPreview()
    const region = document.querySelector('[aria-label="Preview import"]')!
    expect(region.textContent).toContain("Imported origin: https://imported.example:8443")
    expect(region.textContent).toContain("Current origin: https://current.example:9443")
    expect(region.querySelectorAll('a[href*="imported.example"]')).toHaveLength(0)
    expect(region.textContent).not.toContain("Replacing changes the provider origin")
    await check("I reviewed the entries and conflict choices")
    await act(async () => {
      const action = document.querySelector<HTMLSelectElement>('[aria-label="Import action providers:sample"]')!
      action.value = "replace"; action.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(region.querySelector('[role="alert"]')?.textContent).toContain("Future requests to https://imported.example:8443 may send retained credentials or request settings.")
    expect(region.querySelector('[role="alert"]')?.textContent).toContain("An included key may not override existing request settings.")
    expect(button("Save imported settings").disabled).toBe(true)
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    expect(vi.mocked(configShareService.apply).mock.calls[0][0].choices.providers).toEqual({ sample: { action: "replace" } })
  })

  it("does not imply retention of an existing provider key when choosing Skip or Rename", async () => {
    const response = preview()
    response.preview.providers[0] = { ...response.preview.providers[0], has_api_key: false, retains_existing_api_key: true, credential_origin_risk: true }
    vi.mocked(configShareService.preview).mockResolvedValue(response)
    await mount(); await preparedPreview()
    expect(document.body.textContent).not.toContain("Replacing changes the provider origin")
    for (const choice of ["replace", "rename", "skip"]) {
      await act(async () => {
        const action = document.querySelector<HTMLSelectElement>('[aria-label="Import action providers:sample"]')!
        action.value = choice; action.dispatchEvent(new Event("change", { bubbles: true }))
      })
      expect(document.body.textContent?.includes("Replacing changes the provider origin")).toBe(choice === "replace")
    }
    expect(configShareService.apply).not.toHaveBeenCalled()
  })

  it.each([false, true])("warns on changed origin without reported retained-key metadata (included key=%s)", async (hasApiKey) => {
    const response = preview()
    response.preview.providers[0] = { ...response.preview.providers[0], has_api_key: hasApiKey, retains_existing_api_key: false, credential_origin_risk: true }
    vi.mocked(configShareService.preview).mockResolvedValue(response)
    await mount(); await preparedPreview()
    await act(async () => {
      const action = document.querySelector<HTMLSelectElement>('[aria-label="Import action providers:sample"]')!
      action.value = "replace"; action.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Future requests to https://imported.example:8443 may send retained credentials or request settings.")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("An included key may not override existing request settings.")
    expect(configShareService.apply).not.toHaveBeenCalled()
  })

  it("shows keep-current and default-or-unknown fallbacks when no provider origin was included", async () => {
    const response = preview()
    response.preview.providers[0] = { ...response.preview.providers[0], has_api_key: false, has_base_url: false, source_origin: undefined, target_origin: undefined, retains_existing_api_key: true, credential_origin_risk: false }
    vi.mocked(configShareService.preview).mockResolvedValue(response)
    await mount(); await preparedPreview()
    expect(document.body.textContent).toContain("Imported origin: Not included; keep current")
    expect(document.body.textContent).toContain("Current origin: Default or unknown")
    expect(document.body.textContent).not.toContain("Replacing changes the provider origin")
  })

  it("warns about the imported origin on Replace even when the current origin is unknown", async () => {
    const response = preview()
    response.preview.providers[0] = { ...response.preview.providers[0], has_api_key: false, target_origin: undefined, retains_existing_api_key: true, credential_origin_risk: true }
    vi.mocked(configShareService.preview).mockResolvedValue(response)
    await mount(); await preparedPreview()
    await act(async () => {
      const action = document.querySelector<HTMLSelectElement>('[aria-label="Import action providers:sample"]')!
      action.value = "replace"; action.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(document.body.textContent).toContain("Current origin: Default or unknown")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Future requests to https://imported.example:8443 may send retained credentials or request settings.")
  })

  it("disables type-mismatch Replace and guards apply even if that disabled choice is set programmatically", async () => {
    const response = preview()
    response.preview.providers[0] = { ...response.preview.providers[0], provider_type: "anthropic", replace_allowed: false, has_base_url: false, source_origin: undefined, credential_origin_risk: false }
    vi.mocked(configShareService.preview).mockResolvedValue(response)
    await mount(); await preparedPreview()
    const action = document.querySelector<HTMLSelectElement>('[aria-label="Import action providers:sample"]')!
    expect(action.querySelector<HTMLOptionElement>('option[value="replace"]')?.disabled).toBe(true)
    expect(action.value).toBe("skip")
    expect(document.body.textContent).toContain("Imported provider type: anthropic")
    expect(document.body.textContent).toContain("Provider types differ. Skip this entry or import it with a new name.")
    await check("I reviewed the entries and conflict choices")
    await act(async () => { action.value = "replace"; action.dispatchEvent(new Event("change", { bubbles: true })) })
    await check("I reviewed the entries and conflict choices")
    expect(button("Save imported settings").disabled).toBe(true)
    await click("Save imported settings")
    expect(configShareService.apply).not.toHaveBeenCalled()
    await act(async () => { action.value = "skip"; action.dispatchEvent(new Event("change", { bubbles: true })) })
    expect(button("Save imported settings").disabled).toBe(true)
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    expect(vi.mocked(configShareService.apply).mock.calls[0][0].choices.providers).toEqual({ sample: { action: "skip" } })
  })

  it("allows type-mismatch Rename with a provider-default URL after renewed review", async () => {
    const response = preview()
    response.preview.providers[0] = { ...response.preview.providers[0], provider_type: "anthropic", replace_allowed: false, has_base_url: false, source_origin: undefined, credential_origin_risk: false }
    vi.mocked(configShareService.preview).mockResolvedValue(response)
    await mount(); await preparedPreview()
    expect(document.body.textContent).toContain("Imported origin: Not included; keep current")
    await check("I reviewed the entries and conflict choices")
    await act(async () => {
      const action = document.querySelector<HTMLSelectElement>('[aria-label="Import action providers:sample"]')!
      expect(action.querySelector<HTMLOptionElement>('option[value="rename"]')?.disabled).toBe(false)
      action.value = "rename"; action.dispatchEvent(new Event("change", { bubbles: true }))
    })
    expect(document.body.textContent).toContain("Imported origin: Not included; provider default")
    await act(async () => {
      const name = document.querySelector<HTMLInputElement>('[aria-label="New name providers:sample"]')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(name, "anthropic-shared")
      name.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(button("Save imported settings").disabled).toBe(true)
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    expect(vi.mocked(configShareService.apply).mock.calls[0][0].choices.providers).toEqual({ sample: { action: "rename", target: "anthropic-shared" } })
  })

  it("shows the provider-default URL fallback for a new provider with no imported origin", async () => {
    const response = preview()
    response.preview.providers[0] = { ...response.preview.providers[0], conflict: false, replace_allowed: true, has_base_url: false, source_origin: undefined, target_origin: undefined, credential_origin_risk: false }
    vi.mocked(configShareService.preview).mockResolvedValue(response)
    await mount(); await preparedPreview()
    expect(document.body.textContent).toContain("Imported origin: Not included; provider default")
    expect(document.body.textContent).not.toContain("Imported origin: Not included; keep current")
    expect(document.body.textContent).not.toContain("Provider types differ.")
  })

  it("discards stale CAS previews and exposes only a safe message", async () => {
    vi.mocked(configShareService.apply).mockRejectedValue(new ConfigShareError("stale"))
    vi.mocked(settingsService.getProviderInstances).mockResolvedValue(savedSnapshot("current-model", "current-provider"))
    const create = vi.spyOn(AgentClient.prototype, "createSession").mockRejectedValue(new Error("synthetic-stop-before-session-write"))
    await mount(); await preparedPreview()
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Settings changed after this preview")
    expect(document.querySelector('[aria-label="Preview import"]')).toBeNull()
    expect(button("Preview import").disabled).toBe(true)
    expect(configShareService.apply).toHaveBeenCalledTimes(1)
    expect(useProviderStore.getState().providerStatus).toBe("ready")
    expect(useProviderStore.getState().providerSnapshot?.defaults?.chat.model).toBe("current-model")
    await expect(useAppStore.getState().addChat({ title: "Synthetic new chat", messages: [], createdAt: 2, config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null } })).rejects.toThrow("synthetic-stop-before-session-write")
    expect(create).toHaveBeenLastCalledWith(expect.objectContaining({ model: "current-model", model_ref: { provider: "current-provider", model: "current-model" }, provider: "current-provider" }))
    expect(document.body.textContent).not.toContain("Imported settings are saved")
  })

  it("blocks importing a target with automatic provider authentication or an uninitialized credential key", async () => {
    vi.mocked(configShareService.preview).mockResolvedValue({ ...preview(), apply_blocked: true, warnings: ["automatic_provider_authentication_blocked", "credential_key_uninitialized"] })
    await mount(); await preparedPreview()
    await check("I reviewed the entries and conflict choices")
    expect(button("Save imported settings").disabled).toBe(true)
    expect(document.body.textContent).toContain("automatic sign-in")
    expect(document.body.textContent).toContain("credential storage has not been initialized")
    expect(configShareService.apply).not.toHaveBeenCalled()
  })

  it("defaults a case-conflicting environment entry to Skip and preserves its source spelling in the decision key", async () => {
    const response = preview()
    response.preview.env = [{ name: "Token", has_value: true, secret: true, conflict: true }]
    vi.mocked(configShareService.preview).mockResolvedValue(response)
    await mount(); await preparedPreview()
    expect(document.querySelector<HTMLSelectElement>('[aria-label="Import action env:Token"]')?.value).toBe("skip")
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    const choices = vi.mocked(configShareService.apply).mock.calls[0][0].choices
    expect(choices.env).toEqual({ Token: { action: "skip" } })
    expect(Object.hasOwn(choices.env, "TOKEN")).toBe(false)
  })

  it("rejects a case-only environment rename and permits a distinct name only after renewed review", async () => {
    const response = preview()
    response.preview.env = [{ name: "Token", has_value: true, secret: true, conflict: true }]
    vi.mocked(configShareService.preview).mockResolvedValue(response)
    await mount(); await preparedPreview()
    await act(async () => {
      const input = document.querySelector<HTMLSelectElement>('[aria-label="Import action env:Token"]')!
      input.value = "rename"; input.dispatchEvent(new Event("change", { bubbles: true }))
    })
    const rename = async (target: string) => act(async () => {
      const input = document.querySelector<HTMLInputElement>('[aria-label="New name env:Token"]')!
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, target)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await rename("TOKEN")
    await check("I reviewed the entries and conflict choices")
    expect(button("Save imported settings").disabled).toBe(true)
    await click("Save imported settings")
    expect(configShareService.apply).not.toHaveBeenCalled()
    await rename("OtherToken")
    expect(button("Save imported settings").disabled).toBe(true)
    await check("I reviewed the entries and conflict choices")
    expect(button("Save imported settings").disabled).toBe(false)
    await click("Save imported settings")
    expect(configShareService.apply).toHaveBeenCalledTimes(1)
    expect(vi.mocked(configShareService.apply).mock.calls[0][0].choices.env).toEqual({ Token: { action: "rename", target: "OtherToken" } })
  })

  it("blocks a case-conflicting environment import for an uninitialized credential key alone", async () => {
    const response = preview()
    response.apply_blocked = true
    response.warnings = ["credential_key_uninitialized"]
    response.preview.env = [{ name: "Token", has_value: true, secret: true, conflict: true }]
    vi.mocked(configShareService.preview).mockResolvedValue(response)
    await mount(); await preparedPreview()
    expect(document.querySelector<HTMLSelectElement>('[aria-label="Import action env:Token"]')?.value).toBe("skip")
    expect(document.body.textContent).toContain("credential storage has not been initialized")
    expect(document.body.textContent).not.toContain("Import could trigger automatic sign-in for Copilot")
    await check("I reviewed the entries and conflict choices")
    expect(button("Save imported settings").disabled).toBe(true)
    await click("Save imported settings")
    expect(configShareService.apply).not.toHaveBeenCalled()
  })

  it("reconciles an uncertain apply by its original receipt without retaining draft secrets or replaying the write", async () => {
    vi.mocked(configShareService.apply).mockRejectedValue(new Error("PRIVATE_BACKEND_MARKER"))
    vi.mocked(configShareService.operation).mockImplementation(async (operation_id) => ({ operation_id, state: "committed" }))
    await mount(); await preparedPreview()
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("The import result is unconfirmed")
    expect(document.body.textContent).not.toContain("PRIVATE_BACKEND_MARKER")
    expect(control("Paste sharing string").value).toBe("")
    expect(control("Import passphrase (if protected)").value).toBe("")
    await click("Check import result")
    const id = vi.mocked(configShareService.apply).mock.calls[0][0].operation_id
    expect(configShareService.operation).toHaveBeenCalledExactlyOnceWith(id)
    expect(configShareService.apply).toHaveBeenCalledTimes(1)
    expect(document.body.textContent).toContain("Imported settings are saved")
  })
})
