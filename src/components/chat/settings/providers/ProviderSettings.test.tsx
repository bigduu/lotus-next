import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { apiClient } from "@services/api"
import { useProviderStore, type ProviderState } from "@shared/store/appStore/slices/providerSlice"
import type { ProviderInstance, ProviderInstancesConfig } from "@shared/types/providerConfig"
import { SettingsProviders } from "../SettingsProviders"
import { DefaultsEditor } from "./DefaultsEditor"
import { InstanceEditor } from "./InstanceEditor"

const mountedRoots: Root[] = []
const initialStore = useProviderStore.getState()
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

const instance: ProviderInstance = {
  id: "openai-primary",
  type: "openai",
  label: "Primary OpenAI",
  enabled: true,
  config: { api_key: "****...****", base_url: "https://api.openai.com/v1" },
}

const snapshot = (model = "gpt-5.4"): ProviderInstancesConfig => ({
  instances: [instance],
  default_provider_instance_id: instance.id,
  defaults: { chat: { provider: instance.id, model } },
  features: { provider_model_ref: true },
})

const mount = async (element: React.ReactNode) => {
  const container = document.createElement("div")
  document.body.appendChild(container)
  const root = createRoot(container)
  mountedRoots.push(root)
  await act(async () => {
    root.render(element)
    await Promise.resolve()
  })
  return container
}

const flush = async () => {
  await act(async () => {
    await Promise.resolve()
    await Promise.resolve()
  })
}

const click = async (element: Element | null) => {
  expect(element).not.toBeNull()
  await act(async () => {
    ;(element as HTMLElement).click()
    await Promise.resolve()
  })
}

const changeInput = async (input: HTMLInputElement, value: string) => {
  const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set
  await act(async () => {
    setter?.call(input, value)
    input.dispatchEvent(new Event("input", { bubbles: true }))
    await Promise.resolve()
  })
}

const setStore = (patch: Partial<ProviderState>) => {
  useProviderStore.setState({
    ...initialStore,
    providerSnapshot: snapshot(),
    providerStatus: "ready",
    providerError: null,
    loadProviderInstances: vi.fn().mockResolvedValue(snapshot()),
    loadCatalog: vi.fn().mockResolvedValue(undefined),
    fetchCatalogModels: vi.fn().mockResolvedValue(undefined),
    createProviderInstance: vi.fn().mockResolvedValue(snapshot()),
    updateProviderInstance: vi.fn().mockResolvedValue(snapshot()),
    deleteProviderInstance: vi.fn().mockResolvedValue(snapshot()),
    setDefaultProviderInstance: vi.fn().mockResolvedValue(snapshot()),
    ...patch,
  })
}

beforeAll(() => {
  reactActEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT")
})

afterEach(() => {
  for (const root of mountedRoots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
  useProviderStore.setState(initialStore, true)
  vi.restoreAllMocks()
  vi.useRealTimers()
})

describe("Provider Settings authority states", () => {
  it.each([
    ["unavailable", "提供方设置当前不可用。"],
    ["incompatible", "提供方配置格式与 Lotus Next 不兼容。"],
  ] as const)("renders %s as an explicit failure instead of an empty provider list", async (status, message) => {
    setStore({
      providerSnapshot: null,
      providerStatus: status,
      providerError: status === "unavailable" ? "Provider settings are unavailable" : "Invalid payload",
    })

    const container = await mount(<SettingsProviders />)

    expect(container.querySelector('[role="alert"]')?.textContent).toContain(message)
    expect(container.textContent).not.toContain("暂无提供方实例")
    expect(container.textContent).not.toContain("新增")
  })

  it("routes list mutations through the canonical store actions", async () => {
    const updateProviderInstance = vi.fn().mockResolvedValue(snapshot())
    const setDefaultProviderInstance = vi.fn().mockResolvedValue(snapshot())
    const deleteProviderInstance = vi.fn().mockResolvedValue(snapshot())
    setStore({ updateProviderInstance, setDefaultProviderInstance, deleteProviderInstance })
    const container = await mount(<SettingsProviders />)

    await click(container.querySelector('button[role="switch"]'))
    expect(updateProviderInstance).toHaveBeenCalledWith(instance.id, { enabled: false })

    await click(container.querySelector('button[aria-label="设为默认"]'))
    expect(setDefaultProviderInstance).toHaveBeenCalledWith(instance.id)

    await click(container.querySelector('button[aria-label="删除"]'))
    const confirm = [...document.querySelectorAll("button")].find((button) => button.textContent === "删除")
    await click(confirm ?? null)
    expect(deleteProviderInstance).toHaveBeenCalledWith(instance.id)
  })
})

describe("Provider instance credential handling", () => {
  it("never prefills or writes back a stored credential mask", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const container = await mount(
      <InstanceEditor instance={instance} onSave={onSave} onCancel={vi.fn()} />,
    )
    const apiKey = container.querySelector<HTMLInputElement>('input[type="password"]')

    expect(apiKey?.value).toBe("")
    expect(apiKey?.placeholder).toContain("留空保持不变")
    await click([...container.querySelectorAll("button")].find((button) => button.textContent === "保存") ?? null)
    await flush()

    expect(onSave).toHaveBeenCalledTimes(1)
    expect(onSave.mock.calls[0]?.[0].config).not.toHaveProperty("api_key")
  })

  it("redacts both a submitted secret and a credential mask from mutation errors", async () => {
    const secret = "sk-super-secret-value"
    const mask = "****...****"
    const onSave = vi.fn().mockRejectedValue(new Error(`backend echoed ${secret} and ${mask}`))
    const container = await mount(
      <InstanceEditor instance={instance} onSave={onSave} onCancel={vi.fn()} />,
    )
    const apiKey = container.querySelector<HTMLInputElement>('input[type="password"]')!
    await changeInput(apiKey, secret)
    await click([...container.querySelectorAll("button")].find((button) => button.textContent === "保存") ?? null)
    await flush()

    expect(container.textContent).toContain("[REDACTED]")
    expect(container.textContent).not.toContain(secret)
    expect(container.textContent).not.toContain(mask)
    expect(onSave.mock.calls[0]?.[0].config.api_key).toBe(secret)
  })

  it("rejects a mask as a new credential", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const container = await mount(
      <InstanceEditor instance={null} onSave={onSave} onCancel={vi.fn()} />,
    )
    const apiKey = container.querySelector<HTMLInputElement>('input[type="password"]')!
    await changeInput(apiKey, "****...****")
    await click([...container.querySelectorAll("button")].find((button) => button.textContent === "保存") ?? null)

    expect(onSave).not.toHaveBeenCalled()
    expect(container.textContent).toContain("API Key 不能使用掩码")
  })
})

describe("Provider defaults authoritative refresh", () => {
  it("does not report success until the canonical snapshot reload completes", async () => {
    vi.useFakeTimers()
    let resolveRefresh!: (value: ProviderInstancesConfig) => void
    const refresh = new Promise<ProviderInstancesConfig>((resolve) => {
      resolveRefresh = resolve
    })
    const loadProviderInstances = vi.fn(() => refresh)
    setStore({ loadProviderInstances })
    vi.spyOn(apiClient, "get").mockResolvedValue({ model_limits: { default: 4096 } })
    vi.spyOn(apiClient, "post").mockResolvedValue(undefined)
    const container = await mount(<DefaultsEditor />)
    const chatModel = container.querySelector<HTMLInputElement>('input[value="gpt-5.4"]')!
    await changeInput(chatModel, "gpt-5.6")

    await click([...container.querySelectorAll("button")].find((button) => button.textContent === "保存偏好") ?? null)
    await flush()
    expect(loadProviderInstances).toHaveBeenCalledTimes(1)
    expect(container.textContent).not.toContain("已保存")

    resolveRefresh(snapshot("gpt-5.6"))
    await flush()
    expect(container.textContent).toContain("已保存")
    expect(chatModel.value).toBe("gpt-5.6")
  })
})
