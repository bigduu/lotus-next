import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { changeLocale } from "@shared/i18n"
import { configShareService, ConfigShareError } from "@services/config/ConfigShareService"
import { PROVIDER_DEFAULT_MODEL_REF_KEYS } from "@shared/types/providerConfig"
import type { ShareInventory, SharePreviewResponse, ShareOperation } from "@shared/types/configShare"
import { SettingsConfigShare } from "./SettingsConfigShare"

const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
environment.IS_REACT_ACT_ENVIRONMENT = true
const roots: Root[] = []
const source = "BAMBOO-SHARE:1:PRIVATE_SYNTHETIC_BUNDLE"
const passphrase = "PRIVATE_SYNTHETIC_PASSPHRASE"
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
    providers: [{ id: "sample", label: "Sample", provider_type: "openai", has_api_key: true, has_base_url: true, conflict: true }],
    scenarios: [{ scenario: "chat", provider: "sample", model: "fake-model", conflict: true }],
    subagent_models: [{ name: "helper", provider: "sample", model: "fake-model", conflict: false }],
    env: [{ name: "SAMPLE_TOKEN", has_value: true, secret: true, conflict: false }],
  },
})
const deferred = <T,>() => {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
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
  vi.spyOn(configShareService, "apply").mockImplementation(async (request) => ({ operation_id: request.operation_id, state: "committed" }))
  vi.spyOn(configShareService, "operation")
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})

describe("SettingsConfigShare", () => {
  it("starts with no secrets, URLs or values selected and preserves all nine scenario choices", async () => {
    await mount()
    expect(document.body.textContent).toContain("Base URLs with embedded credentials, query strings or fragments")
    expect(document.body.textContent).toContain("runtime, loader or Git control environment variables (such as PATH, NODE_OPTIONS or GIT_ASKPASS)")
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
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "sample-copy")
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await check("I reviewed the entries and conflict choices")
    expect(button("Save imported settings").disabled).toBe(false)
    await fill("Import passphrase (if protected)", "changed-passphrase")
    expect(document.querySelector('[aria-label="Preview import"]')).toBeNull()
    expect(configShareService.apply).not.toHaveBeenCalled()
  })

  it("discards stale CAS previews and exposes only a safe message", async () => {
    vi.mocked(configShareService.apply).mockRejectedValue(new ConfigShareError("stale"))
    await mount(); await preparedPreview()
    await check("I reviewed the entries and conflict choices")
    await click("Save imported settings")
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Settings changed after this preview")
    expect(document.querySelector('[aria-label="Preview import"]')).toBeNull()
    expect(button("Preview import").disabled).toBe(true)
    expect(configShareService.apply).toHaveBeenCalledTimes(1)
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
