import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest"

import { apiClient } from "@services/api"
import type { FetchModelsResponse } from "@services/config/SettingsService"
import { useProviderStore, type ProviderState } from "@shared/store/appStore/slices/providerSlice"
import {
  findProviderSnapshotRelationIssues,
  type ProviderInstance,
  type ProviderInstancesConfig,
} from "@shared/types/providerConfig"
import { SettingsProviders } from "../SettingsProviders"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"
import { DefaultsEditor } from "./DefaultsEditor"
import { InstanceEditor } from "./InstanceEditor"

const mountedRoots: Root[] = []
const initialStore = useProviderStore.getState()
const reactActEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}
const originalScrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")

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

const accessibleName = (element: Element): string => {
  const direct = element.getAttribute("aria-label")
  if (direct) return direct
  return (element.getAttribute("aria-labelledby") ?? "")
    .split(/\s+/)
    .map((id) => document.getElementById(id)?.textContent ?? "")
    .join(" ")
    .trim()
}

const roleByName = (role: string, name: string, scope: ParentNode = document): HTMLElement => {
  const element = [...scope.querySelectorAll(`[role="${role}"]`)].find(
    (candidate) => accessibleName(candidate) === name,
  )
  expect(element, `${role} named ${name}`).toBeDefined()
  return element as HTMLElement
}

const press = async (element: Element, key: string) => {
  await act(async () => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true }))
    await Promise.resolve()
  })
}

const chooseSelectOption = async (triggerName: string, optionText: string) => {
  const trigger = roleByName("combobox", triggerName)
  await press(trigger, "ArrowDown")
  const option = [...document.querySelectorAll('[role="option"]')].find(
    (candidate) => candidate.textContent === optionText,
  )
  expect(option, `option ${optionText}`).toBeDefined()
  await press(option!, "Enter")
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
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  })
})

afterAll(() => {
  Reflect.deleteProperty(reactActEnvironment, "IS_REACT_ACT_ENVIRONMENT")
  if (originalScrollIntoView) {
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", originalScrollIntoView)
  } else {
    Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
  }
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
    setStore({
      updateProviderInstance,
      setDefaultProviderInstance,
      deleteProviderInstance,
    })
    const container = await mount(<SettingsProviders />)

    await click(container.querySelector('button[role="switch"]'))
    expect(updateProviderInstance).toHaveBeenCalledWith(instance.id, {
      enabled: false,
    })

    await click(container.querySelector('button[aria-label="设为默认"]'))
    expect(setDefaultProviderInstance).toHaveBeenCalledWith(instance.id)

    await click(container.querySelector('button[aria-label="删除"]'))
    const confirm = [...document.querySelectorAll("button")].find((button) => button.textContent === "删除")
    await click(confirm ?? null)
    expect(deleteProviderInstance).toHaveBeenCalledWith(instance.id)
  })

  it("keeps every repair path visible while degraded defaults remain runtime-ineligible", async () => {
    const degraded: ProviderInstancesConfig = {
      ...snapshot(),
      default_provider_instance_id: "deleted-default",
      defaults: {
        chat: { provider: "deleted-chat", model: "chat-model" },
        planning: { provider: "deleted-planning", model: "planning-model" },
        subagent_models: {
          reviewer: { provider: "deleted-reviewer", model: "review-model" },
        },
      },
    }
    const setDefaultProviderInstance = vi.fn().mockResolvedValue(degraded)
    setStore({
      providerSnapshot: null,
      providerRepairSnapshot: degraded,
      providerRepairIssues: findProviderSnapshotRelationIssues(degraded),
      providerStatus: "degraded",
      setDefaultProviderInstance,
      loadProviderInstances: vi.fn().mockResolvedValue(degraded),
    })

    const container = await mount(<SettingsProviders />)

    expect(container.textContent).toContain("默认提供方引用已失效")
    expect(container.textContent).toContain("Primary OpenAI")
    expect(container.textContent).toContain("新增")
    expect(container.textContent).toContain("默认实例已失效")
    expect(container.textContent).toContain("deleted-chat(已失效，请替换)")
    expect(container.textContent).toContain("deleted-planning(已失效，请替换)")
    expect(container.textContent).toContain("reviewer")

    await click(container.querySelector('button[aria-label="设为默认"]'))
    expect(setDefaultProviderInstance).toHaveBeenCalledWith(instance.id)
  })
})

describe("Provider add and model discovery", () => {
  const discoveredModel = {
    reference: { provider: "created-provider", model: "claude-discovered" },
    display_name: "Claude Discovered",
    provider_display_name: "Created provider",
    capabilities: {
      supports_tools: true,
      supports_vision: false,
      supports_reasoning: true,
    },
  }

  const created: ProviderInstance = {
    id: "created-provider",
    type: "anthropic",
    label: "Anthropic",
    enabled: true,
    config: { api_key: "****...****" },
  }

  const arrangeCreate = (fetchCatalogModels: ProviderState["fetchCatalogModels"]) => {
    const createdSnapshot = { ...snapshot(), instances: [instance, created] }
    const createProviderInstance = vi.fn().mockImplementation(async () => {
      useProviderStore.setState({
        providerSnapshot: createdSnapshot,
        providerStatus: "ready",
      })
      return {
        instance: created,
        responseValid: true,
        authorityRefreshed: true,
        instanceConfirmed: true,
      }
    })
    const updateProviderInstance = vi.fn().mockResolvedValue(createdSnapshot)
    setStore({
      createProviderInstance,
      updateProviderInstance,
      fetchCatalogModels,
    })
    return { createProviderInstance, updateProviderInstance, createdSnapshot }
  }

  const submitNewProvider = async (container: HTMLElement) => {
    await click(
      [...container.querySelectorAll("button")].find((button) => button.textContent?.includes("新增")) ?? null,
    )
    const apiKey = container.querySelector<HTMLInputElement>('input[type="password"]')!
    await changeInput(apiKey, "submitted-secret")
    await click([...container.querySelectorAll("button")].find((button) => button.textContent === "保存") ?? null)
    await flush()
  }

  it("uses the exact created id, exposes discovered choices, and persists the selection", async () => {
    const fetchCatalogModels = vi.fn().mockImplementation(async (provider: string) => {
      expect(provider).toBe(created.id)
      useProviderStore.setState({
        catalog: { providers: [], models: [discoveredModel] },
      })
      return { fetched: [{ provider, models: [discoveredModel] }] }
    })
    const { createProviderInstance, updateProviderInstance } = arrangeCreate(fetchCatalogModels)
    const container = await mount(<SettingsProviders />)

    await submitNewProvider(container)

    expect(createProviderInstance).toHaveBeenCalledTimes(1)
    expect(fetchCatalogModels).toHaveBeenCalledExactlyOnceWith(created.id)
    expect(container.textContent).toContain("实例已保存，并发现 1 个模型")

    const modelInput = roleByName("combobox", "默认模型(可选)", container) as HTMLInputElement
    await act(async () => modelInput.focus())
    const option = [...container.querySelectorAll('[role="option"]')].find((candidate) =>
      candidate.textContent?.includes("claude-discovered"),
    )
    await click(option ?? null)
    expect(modelInput.value).toBe("claude-discovered")

    await click([...container.querySelectorAll("button")].find((button) => button.textContent === "保存") ?? null)
    await flush()
    expect(updateProviderInstance).toHaveBeenCalledWith(
      created.id,
      expect.objectContaining({
        config: expect.objectContaining({ model: "claude-discovered" }),
      }),
    )
  })

  it("does not repeat the full catalog load across the create reload transition", async () => {
    const createdSnapshot = { ...snapshot(), instances: [instance, created] }
    const loadCatalog = vi.fn().mockResolvedValue(undefined)
    const fetchCatalogModels = vi.fn().mockResolvedValue({
      fetched: [{ provider: created.id, models: [] }],
    })
    let finishCreate!: () => void
    const createProviderInstance = vi.fn().mockImplementation(async () => {
      useProviderStore.setState({ providerStatus: "loading" })
      return new Promise((resolve) => {
        finishCreate = () => {
          useProviderStore.setState({
            providerSnapshot: createdSnapshot,
            providerStatus: "ready",
          })
          resolve({
            instance: created,
            responseValid: true,
            authorityRefreshed: true,
            instanceConfirmed: true,
          })
        }
      })
    })
    setStore({ loadCatalog, createProviderInstance, fetchCatalogModels })
    const container = await mount(<SettingsProviders />)

    expect(loadCatalog).toHaveBeenCalledOnce()
    await submitNewProvider(container)
    expect(useProviderStore.getState().providerStatus).toBe("loading")
    expect(loadCatalog).toHaveBeenCalledOnce()

    await act(async () => finishCreate())
    await flush()

    expect(fetchCatalogModels).toHaveBeenCalledExactlyOnceWith(created.id)
    expect(loadCatalog).toHaveBeenCalledOnce()
  })

  it("reports saved partial success without leaking discovery errors and accepts a custom id", async () => {
    const canary = "upstream-secret-canary"
    const fetchCatalogModels = vi.fn().mockRejectedValue(new Error(canary))
    const { updateProviderInstance } = arrangeCreate(fetchCatalogModels)
    const container = await mount(<SettingsProviders />)

    await submitNewProvider(container)

    expect(container.textContent).toContain("实例已保存，但模型发现失败")
    expect(document.body.textContent).not.toContain(canary)
    const modelInput = roleByName("combobox", "默认模型(可选)", container) as HTMLInputElement
    await changeInput(modelInput, "vendor/custom-model")
    await click([...container.querySelectorAll("button")].find((button) => button.textContent === "保存") ?? null)
    await flush()

    expect(updateProviderInstance).toHaveBeenCalledWith(
      created.id,
      expect.objectContaining({
        config: expect.objectContaining({ model: "vendor/custom-model" }),
      }),
    )
  })

  it("keeps the saved editor open and gives custom-id guidance for an empty catalog", async () => {
    const fetchCatalogModels = vi.fn().mockResolvedValue({
      fetched: [{ provider: created.id, models: [] }],
    })
    arrangeCreate(fetchCatalogModels)
    const container = await mount(<SettingsProviders />)

    await submitNewProvider(container)

    expect(container.textContent).toContain("实例已保存，但未发现模型")
    expect(roleByName("combobox", "默认模型(可选)", container)).toBeDefined()
  })

  it("shows in-progress discovery after save before the targeted request settles", async () => {
    let finishDiscovery!: (response: FetchModelsResponse) => void
    const discovery = new Promise<FetchModelsResponse>((resolve) => {
      finishDiscovery = resolve
    })
    const fetchCatalogModels = vi.fn(() => discovery)
    arrangeCreate(fetchCatalogModels)
    const container = await mount(<SettingsProviders />)

    await submitNewProvider(container)
    expect(container.textContent).toContain("实例已保存，正在获取模型…")

    await act(async () => finishDiscovery({ fetched: [{ provider: created.id, models: [] }] }))
    await flush()
    expect(container.textContent).toContain("实例已保存，但未发现模型")
  })

  it("blocks duplicate creation after a malformed successful create response", async () => {
    const fetchCatalogModels = vi.fn()
    const createdSnapshot = { ...snapshot(), instances: [instance, created] }
    const createProviderInstance = vi.fn().mockImplementation(async () => {
      useProviderStore.setState({
        providerSnapshot: createdSnapshot,
        providerStatus: "ready",
      })
      return {
        instance: null,
        responseValid: false,
        authorityRefreshed: true,
        instanceConfirmed: false,
      }
    })
    const loadProviderInstances = vi.fn().mockResolvedValue(createdSnapshot)
    setStore({
      createProviderInstance,
      fetchCatalogModels,
      loadProviderInstances,
    })
    const container = await mount(<SettingsProviders />)

    await submitNewProvider(container)

    expect(container.textContent).toContain("实例已保存且列表已重新加载")
    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("新增"))).toBe(false)
    expect(fetchCatalogModels).not.toHaveBeenCalled()

    await click([...container.querySelectorAll("button")].find((button) => button.textContent === "重新加载") ?? null)
    await flush()
    expect(loadProviderInstances).toHaveBeenCalled()
    expect(container.textContent).toContain("请从列表中选择刚保存的实例继续")
    expect([...container.querySelectorAll("button")].some((button) => button.textContent?.includes("新增"))).toBe(false)

    const createdRow = [...container.querySelectorAll("li")].find((row) => row.textContent?.includes(created.label))
    await click(createdRow?.querySelector('button[aria-label="编辑"]') ?? null)
    expect(container.textContent).not.toContain("创建响应缺少有效实例 ID")
    expect(roleByName("combobox", "默认模型(可选)", container)).toBeDefined()
  })
})

describe("Provider instance credential handling", () => {
  it("never prefills or writes back a stored credential mask", async () => {
    const onSave = vi.fn().mockResolvedValue(undefined)
    const container = await mount(<InstanceEditor instance={instance} onSave={onSave} onCancel={vi.fn()} />)
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
    const container = await mount(<InstanceEditor instance={instance} onSave={onSave} onCancel={vi.fn()} />)
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
    const container = await mount(<InstanceEditor instance={null} onSave={onSave} onCancel={vi.fn()} />)
    const apiKey = container.querySelector<HTMLInputElement>('input[type="password"]')!
    await changeInput(apiKey, "****...****")
    await click([...container.querySelectorAll("button")].find((button) => button.textContent === "保存") ?? null)

    expect(onSave).not.toHaveBeenCalled()
    expect(container.textContent).toContain("API Key 不能使用掩码")
  })
})

describe("Editable provider model combobox", () => {
  it("supports keyboard selection, scrolls long lists, and consumes Escape before the dialog", async () => {
    const onOpenChange = vi.fn()
    const escapeObservations: unknown[] = []
    const onEscapeKeyDown = vi.fn((event: KeyboardEvent) => {
      const target = event.target as Element | null
      const active = document.activeElement
      escapeObservations.push({
        targetRole: target?.getAttribute?.("role"),
        targetExpanded: target?.getAttribute?.("aria-expanded"),
        activeRole: active?.getAttribute?.("role"),
        activeExpanded: active?.getAttribute?.("aria-expanded"),
        hasListbox: document.querySelector('[role="listbox"]') !== null,
        defaultPrevented: event.defaultPrevented,
      })
    })
    const scrollIntoView = HTMLElement.prototype.scrollIntoView as ReturnType<typeof vi.fn>
    scrollIntoView.mockClear()
    const models = Array.from({ length: 120 }, (_, index) => ({
      reference: {
        provider: instance.id,
        model: `model-${String(index).padStart(3, "0")}`,
      },
      display_name: `Model ${index}`,
      provider_display_name: instance.label,
      capabilities: {
        supports_tools: true,
        supports_vision: false,
        supports_reasoning: true,
      },
    }))
    await mount(
      <ResponsiveDialog open onOpenChange={onOpenChange}>
        <ResponsiveDialogContent onEscapeKeyDown={onEscapeKeyDown}>
          <ResponsiveDialogTitle>编辑提供方</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>选择或输入模型</ResponsiveDialogDescription>
          <InstanceEditor
            instance={instance}
            modelOptions={models}
            onSave={vi.fn().mockResolvedValue(undefined)}
            onCancel={vi.fn()}
          />
        </ResponsiveDialogContent>
      </ResponsiveDialog>,
    )
    const modelInput = roleByName("combobox", "默认模型(可选)") as HTMLInputElement

    await act(async () => modelInput.focus())
    await press(modelInput, "ArrowDown")
    expect(scrollIntoView).toHaveBeenCalled()
    await press(modelInput, "Enter")
    expect(modelInput.value).toBe("model-000")

    await press(modelInput, "ArrowDown")
    expect(document.querySelector('[role="listbox"]')).not.toBeNull()
    expect(modelInput.getAttribute("aria-expanded")).toBe("true")
    expect(document.activeElement).toBe(modelInput)
    onOpenChange.mockClear()
    await press(modelInput, "Escape")
    expect(document.querySelector('[role="listbox"]')).toBeNull()
    expect(onEscapeKeyDown).toHaveBeenCalledOnce()
    expect(escapeObservations).toEqual([
      {
        targetRole: "combobox",
        targetExpanded: "true",
        activeRole: "combobox",
        activeExpanded: "true",
        hasListbox: true,
        defaultPrevented: true,
      },
    ])
    expect(onOpenChange).not.toHaveBeenCalled()
    expect(document.querySelector('[data-slot="responsive-dialog-content"]')).not.toBeNull()
  })

  it("does not let an unrelated expanded combobox block dialog dismissal", async () => {
    const unrelated = document.createElement("input")
    unrelated.setAttribute("role", "combobox")
    unrelated.setAttribute("aria-expanded", "true")
    document.body.appendChild(unrelated)
    const onOpenChange = vi.fn()
    await mount(
      <ResponsiveDialog open onOpenChange={onOpenChange}>
        <ResponsiveDialogContent>
          <ResponsiveDialogTitle>测试对话框</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>测试局部 Escape 处理</ResponsiveDialogDescription>
          <button type="button">对话框按钮</button>
        </ResponsiveDialogContent>
      </ResponsiveDialog>,
    )
    const button = [...document.querySelectorAll("button")].find((candidate) => candidate.textContent === "对话框按钮")!
    await act(async () => button.focus())
    await press(button, "Escape")

    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false)
  })
})

describe("Provider defaults authoritative refresh", () => {
  it("keeps save feedback through the full Settings loading transition", async () => {
    vi.useFakeTimers()
    let resolveRefresh!: (value: ProviderInstancesConfig) => void
    const refresh = new Promise<ProviderInstancesConfig>((resolve) => {
      resolveRefresh = resolve
    })
    const loadProviderInstances = vi
      .fn<ProviderState["loadProviderInstances"]>()
      .mockResolvedValueOnce(snapshot())
      .mockImplementationOnce(() => {
        useProviderStore.setState({
          providerSnapshot: null,
          providerRepairSnapshot: null,
          providerRepairIssues: [],
          providerStatus: "loading",
        })
        return refresh.then((value) => {
          useProviderStore.setState({
            providerSnapshot: value,
            providerRepairSnapshot: null,
            providerRepairIssues: [],
            providerStatus: "ready",
          })
          return value
        })
      })
    setStore({ loadProviderInstances })
    vi.spyOn(apiClient, "get").mockResolvedValue({
      model_limits: { default: 4096 },
    })
    vi.spyOn(apiClient, "post").mockResolvedValue(undefined)
    const container = await mount(<SettingsProviders />)
    await flush()
    const chatModel = roleByName("combobox", "对话(必填)模型", container) as HTMLInputElement
    await changeInput(chatModel, "gpt-5.6")

    await click([...container.querySelectorAll("button")].find((button) => button.textContent === "保存偏好") ?? null)
    await flush()
    expect(loadProviderInstances).toHaveBeenCalledTimes(2)
    expect(useProviderStore.getState().providerStatus).toBe("loading")
    expect(container.textContent).not.toContain("已保存")

    resolveRefresh(snapshot("gpt-5.6"))
    await flush()
    expect(useProviderStore.getState().providerStatus).toBe("ready")
    expect(container.textContent).toContain("已保存")
    expect((roleByName("combobox", "对话(必填)模型", container) as HTMLInputElement).value).toBe("gpt-5.6")
  })

  it("does not report success until the canonical snapshot reload completes", async () => {
    vi.useFakeTimers()
    let resolveRefresh!: (value: ProviderInstancesConfig) => void
    const refresh = new Promise<ProviderInstancesConfig>((resolve) => {
      resolveRefresh = resolve
    })
    const loadProviderInstances = vi.fn(() => refresh)
    setStore({ loadProviderInstances })
    vi.spyOn(apiClient, "get").mockResolvedValue({
      model_limits: { default: 4096 },
    })
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

  it("repairs unknown role and subagent references only through explicit replacements", async () => {
    const degraded: ProviderInstancesConfig = {
      ...snapshot(),
      default_provider_instance_id: instance.id,
      defaults: {
        chat: { provider: "deleted-chat", model: "old-chat" },
        planning: { provider: "deleted-planning", model: "old-planning" },
        subagent_models: {
          reviewer: { provider: "deleted-reviewer", model: "old-review" },
        },
      },
    }
    const repaired: ProviderInstancesConfig = {
      ...degraded,
      defaults: {
        chat: { provider: instance.id, model: "new-chat" },
        planning: { provider: instance.id, model: "new-planning" },
        subagent_models: {
          reviewer: { provider: instance.id, model: "new-review" },
        },
      },
    }
    setStore({
      providerSnapshot: null,
      providerRepairSnapshot: degraded,
      providerRepairIssues: findProviderSnapshotRelationIssues(degraded),
      providerStatus: "degraded",
      loadProviderInstances: vi.fn().mockResolvedValue(repaired),
    })
    vi.spyOn(apiClient, "get").mockResolvedValue({
      model_limits: { default: 4096 },
    })
    const post = vi.spyOn(apiClient, "post").mockResolvedValue(undefined)
    const container = await mount(<DefaultsEditor />)

    await chooseSelectOption("对话(必填)提供方", "Primary OpenAI · 默认")
    await changeInput(roleByName("combobox", "对话(必填)模型", container) as HTMLInputElement, "new-chat")
    await chooseSelectOption("规划提供方", "Primary OpenAI · 默认")
    await changeInput(roleByName("combobox", "规划模型", container) as HTMLInputElement, "new-planning")
    await chooseSelectOption("子代理 reviewer 提供方", "Primary OpenAI · 默认")
    await changeInput(roleByName("combobox", "子代理 reviewer 模型", container) as HTMLInputElement, "new-review")
    await click([...container.querySelectorAll("button")].find((button) => button.textContent === "保存偏好") ?? null)
    await flush()

    expect(post).toHaveBeenCalledWith(
      "/bamboo/config",
      expect.objectContaining({
        defaults: expect.objectContaining({
          chat: { provider: instance.id, model: "new-chat" },
          planning: { provider: instance.id, model: "new-planning" },
          subagent_models: {
            reviewer: { provider: instance.id, model: "new-review" },
          },
        }),
      }),
    )
    expect(container.querySelector(".text-emerald-500")?.textContent).toBe("已保存")
  })

  it("reports partial defaults save while another relation issue remains", async () => {
    const degraded: ProviderInstancesConfig = {
      ...snapshot(),
      default_provider_instance_id: "deleted-default",
      defaults: { chat: { provider: "deleted-chat", model: "old-chat" } },
    }
    const chatRepaired: ProviderInstancesConfig = {
      ...degraded,
      defaults: { chat: { provider: instance.id, model: "new-chat" } },
    }
    setStore({
      providerSnapshot: null,
      providerRepairSnapshot: degraded,
      providerRepairIssues: findProviderSnapshotRelationIssues(degraded),
      providerStatus: "degraded",
      loadProviderInstances: vi.fn().mockResolvedValue(chatRepaired),
    })
    vi.spyOn(apiClient, "get").mockResolvedValue({})
    vi.spyOn(apiClient, "post").mockResolvedValue(undefined)
    const container = await mount(<DefaultsEditor />)

    await chooseSelectOption("对话(必填)提供方", "Primary OpenAI")
    await changeInput(roleByName("combobox", "对话(必填)模型", container) as HTMLInputElement, "new-chat")
    await click([...container.querySelectorAll("button")].find((button) => button.textContent === "保存偏好") ?? null)
    await flush()

    expect(container.textContent).toContain("偏好已保存，但仍有 1 处失效引用")
    expect(container.querySelector(".text-emerald-500")).toBeNull()
  })
})
