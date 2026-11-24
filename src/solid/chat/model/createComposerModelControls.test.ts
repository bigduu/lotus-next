import { createRoot, createSignal, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { DEFAULT_SUPERVISOR_SESSION_ID } from "@/lib/supervisor"
import { agentClient } from "@services/chat/AgentService"
import { clearSessionCompatibilityObservations, readSessionExecutionDetail } from "@services/chat/sessionExecutionCompatibility"
import { appStore } from "@shared/store/appStore/state"
import { providerStore } from "@shared/store/appStore/slices/providerState"
import type { ProviderInstance, ProviderInstancesConfig } from "@shared/types/providerConfig"
import type { ChatItem } from "@shared/types/chatMessages"
import type { createChat } from "../createChat"
import { createComposerModelControls } from "./createComposerModelControls"
import { createRootModeAuthority } from "./createRootModeAuthority"

let dispose: (() => void) | undefined

afterEach(() => {
  dispose?.()
  dispose = undefined
  appStore.setState(appStore.getInitialState(), true)
  providerStore.setState(providerStore.getInitialState(), true)
  clearSessionCompatibilityObservations()
  vi.restoreAllMocks()
})

function savedChat(id = "session-1", fields: Partial<ChatItem> = {}): ChatItem {
  return {
    id, kind: "root", title: id, createdAt: 1, messages: [],
    config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null },
    ...fields,
  }
}

function mountModels(initial: ChatItem | null = null) {
  const [current, setCurrent] = createSignal(initial)
  const sessionId = () => current()?.id ?? null
  const id = initial?.id
  if (id && initial?.kind === "root") {
    vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: {
      id, kind: "root", root_orchestration_only: false, thinking_mode: "standard",
      root_mode_transition_epoch: 0, root_mode_birth_token: "a".repeat(64), is_running: initial.isRunning,
    } } as Awaited<ReturnType<typeof agentClient.getSession>>)
  }
  const controls = createRoot((cleanup) => {
    dispose = cleanup
    type Chat = ReturnType<typeof createChat>
    const ports: Partial<Chat> = {
      get currentSessionId() { return sessionId() },
      get currentChat() { return current() },
      executionCompatibility: {
        blocked: false, observed: true, legacy: true, loading: false, readError: false, report: null, refresh: async () => {},
      },
    }
    const root = createRootModeAuthority(sessionId, () => current()?.kind)
    return createComposerModelControls({
      chat: ports as Chat, draftKey: () => sessionId() ?? "", disabled: () => false, root,
    })
  })
  flush()
  return { controls, setCurrent }
}

function provider(id: string, models: string[], config: ProviderInstance["config"] = {}, enabled = true): ProviderInstance {
  return { id, type: "openai", label: id, enabled, config: { runtime_models: models, ...config } }
}

function admit(instances: ProviderInstance[], chat?: NonNullable<ProviderInstancesConfig["defaults"]>["chat"]) {
  providerStore.setState({ providerStatus: "ready", providerSnapshot: {
    default_provider_instance_id: instances[0]?.id ?? null, instances, defaults: chat ? { chat } : undefined,
    features: { provider_model_ref: true },
  } })
}

it("keeps saved Work effort after a title update and binds it to its recorded lifetime", async () => {
  const id = `ticket-${"a".repeat(32)}`
  const createdAt = "2026-11-19T00:00:00Z"
  const chat: ChatItem = {
    id, kind: "child", title: "Work", createdAt: Date.parse(createdAt), createdAtExact: createdAt, updatedAt: createdAt,
    messages: [], config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null, reasoningEffort: "low" },
  }
  const read = vi.spyOn(agentClient, "getSession").mockResolvedValue({ session: {
    id, kind: "child", parent_session_id: DEFAULT_SUPERVISOR_SESSION_ID, created_at: createdAt, reasoning_effort: "max",
  } } as Awaited<ReturnType<typeof agentClient.getSession>>)
  const { controls: pane, setCurrent } = mountModels(chat)
  expect(pane.thinking.ordinaryValue).toBe("low")
  expect(read).not.toHaveBeenCalled()

  await readSessionExecutionDetail(id)
  flush()
  expect(pane.thinking.ordinaryValue).toBe("max")
  setCurrent({ ...chat, title: "Renamed Work", updatedAt: "2026-11-19T00:01:00Z" })
  flush()
  expect(pane.thinking.ordinaryValue).toBe("max")
  expect(read).toHaveBeenCalledExactlyOnceWith(id)

  setCurrent({ ...chat, createdAtExact: "2026-11-19T00:02:00Z" })
  flush()
  expect(pane.thinking.ordinaryValue).toBe("low")
})

it("keeps an existing Child's saved provider and model visible", () => {
  admit([provider("provider", ["root-model", "child-model"])], { provider: "provider", model: "root-model" })
  const chat = savedChat("child-session", { kind: "child" })
  chat.config.model_ref = { provider: "provider", model: "child-model" }
  const { controls } = mountModels(chat)
  expect(controls.model).toBe("child-model")
  expect(controls.modelProvider).toBe("provider")
})

it("saves a same-name model from a different provider and locks admission until its acknowledgement", async () => {
  let acknowledge!: () => void
  const pending = new Promise<void>((resolve) => { acknowledge = resolve })
  const save = vi.spyOn(appStore.getState(), "changeSessionModel").mockReturnValue(pending)
  const draftModel = { provider: "first", model: "draft-model" }
  appStore.setState({ selectedModel: draftModel })
  admit([provider("first", ["same-model"]), provider("other", ["same-model"])],
    { provider: "first", model: "same-model" })
  const chat = savedChat()
  chat.config.model_ref = { provider: "first", model: "same-model" }
  const { controls } = mountModels(chat)
  const selected = { provider: "other", model: "same-model" }
  const saving = controls.chooseModel(selected)
  flush()
  try {
    expect(save).toHaveBeenCalledExactlyOnceWith(chat.id, selected)
    expect(controls.model).toBe("same-model")
    expect(controls.modelProvider).toBe("first")
    expect(controls.modelDisabled).toBe(true)
    expect(controls.busy).toBe(true)
    expect(appStore.getState().selectedModel).toEqual(draftModel)
    await controls.chooseModel(selected)
    expect(save).toHaveBeenCalledOnce()
  } finally {
    acknowledge()
  }
  await saving
  flush()
  expect(controls.modelDisabled).toBe(false)
  expect(controls.busy).toBe(false)
})

it("lists saved enabled models while keeping a historical bound model visible", () => {
  admit([provider("work", ["new-model", "vendor:custom-name"]), provider("other", ["other-model"]),
    provider("disabled", ["hidden"], {}, false)], { provider: "other", model: "other-model" })
  const chat = savedChat()
  chat.config.model_ref = { provider: "work", model: "historical-removed" }
  const { controls } = mountModels(chat)
  expect(controls.modelGroups).toEqual([
    { provider: "work", label: "work", models: ["new-model", "vendor:custom-name"] },
    { provider: "other", label: "other", models: ["other-model"] },
  ])
  expect(controls.model).toBe("historical-removed")
  expect(controls.modelProvider).toBe("work")
})

it("falls back for a disabled draft provider without overwriting its cached preference", () => {
  const pinnedDraft = { provider: "old", model: "old-model" }
  appStore.setState({ selectedModel: pinnedDraft })
  const other = provider("other", ["other-model", "other-custom"])
  admit([provider("old", ["old-model"]), other], pinnedDraft)
  const { controls } = mountModels()
  expect(controls.model).toBe("old-model")
  admit([provider("old", ["old-model"], {}, false), other], { provider: "other", model: "other-model" })
  flush()
  expect(appStore.getState().selectedModel).toEqual(pinnedDraft)
  expect(controls.modelGroups).toEqual([{ provider: "other", label: "other", models: ["other-model", "other-custom"] }])
  expect(controls.model).toBe("other-model")
})

it("offers and selects the first provider's saved admission before Chat defaults exist", () => {
  admit([provider("first", ["first-model", "second-model", "third-model"], { model: "first-model" })])
  const { controls } = mountModels()
  expect(controls.modelGroups).toEqual([{ provider: "first", label: "first", models: ["first-model", "second-model", "third-model"] }])
  expect(controls.model).toBe("first-model")
})

it.each(["empty", "unavailable"] as const)("omits model options when admission is %s", (mode) => {
  admit([provider("first", mode === "empty" ? [] : ["previously-admitted"])])
  if (mode === "unavailable") providerStore.setState({ providerStatus: "unavailable" })
  const { controls } = mountModels()
  expect(controls.modelGroups).toEqual([])
})

it("does not write a model choice during an active run", async () => {
  const draftModel = { provider: "first", model: "first-model" }
  appStore.setState({ selectedModel: draftModel })
  const save = vi.spyOn(appStore.getState(), "changeSessionModel").mockResolvedValue(undefined)
  admit([provider("first", ["first-model", "second-model"])], draftModel)
  const { controls } = mountModels(savedChat("running", { isRunning: true }))
  expect(controls.modelDisabled).toBe(true)
  await controls.chooseModel({ provider: "first", model: "second-model" })
  expect(save).not.toHaveBeenCalled()
  expect(appStore.getState().selectedModel).toEqual(draftModel)
})

it("discards an old model error after navigation away and back to the same session", async () => {
  let reject!: (error: Error) => void
  const pending = new Promise<void>((_resolve, fail) => { reject = fail })
  const save = vi.spyOn(appStore.getState(), "changeSessionModel").mockReturnValueOnce(pending)
  const current = { provider: "provider", model: "first-model" }
  const desired = { provider: "provider", model: "second-model" }
  admit([provider("provider", ["first-model", "second-model"])], current)
  const origin = savedChat("A", { kind: "child" })
  origin.config.model_ref = current
  const { controls, setCurrent } = mountModels(origin)
  const changing = controls.chooseModel(desired)
  flush()
  expect(save).toHaveBeenCalledExactlyOnceWith("A", desired)
  expect(controls.busy).toBe(true)
  setCurrent(savedChat("B", { kind: "child" }))
  flush()
  setCurrent(origin)
  flush()
  reject(new Error("A's old model save failed"))
  await changing
  flush()
  expect(controls.modelError).toBeNull()
  expect(controls.model).toBe("first-model")
  expect(controls.busy).toBe(false)
})
