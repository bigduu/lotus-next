import { createRoot, createSignal } from "solid-js"
import { afterEach, beforeEach, expect, vi } from "vitest"
import { apiClient } from "@services/api"
import { agentClient, type AgentEventHandlers, type ExecuteResponse } from "@services/chat/AgentService"
import { clearSessionCompatibilityObservations } from "@services/chat/sessionExecutionCompatibility"
import { appStore } from "@shared/store/appStore/state"
import type { AssistantTextMessage, ChatItem, Message, UserMessage } from "@shared/types/chatMessages"
import { resetCompletedAnswerHandoffsForTest } from "@/lib/completedAnswerHandoffRegistry"
import { createChat } from "./createChat"
import { settleChat } from "./chatInteractionTestHarness"

export type Chat = ReturnType<typeof createChat>

const model = "test-model"
const at = "2026-10-27T00:00:00Z"

export function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

export function session(id: string, messages: Message[] = []): ChatItem {
  return {
    id, title: id, createdAt: 1, messages,
    config: { model, systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null },
  }
}

export function user(id: string, content: string, createdAt = at): UserMessage {
  return { id, role: "user", content, createdAt }
}

export function assistant(id: string, content: string, isCompressed?: boolean, createdAt = at): AssistantTextMessage {
  return { id, role: "assistant", type: "text", content, isCompressed, createdAt }
}

export const feedSessions = (chats: ChatItem[]) => appStore.setState({ chats })
export function savedSession(id: string) {
  const chat = appStore.getState().chats.find((item) => item.id === id)
  if (!chat) throw new Error(`Missing session fixture: ${id}`)
  return chat
}
export const history = () => vi.mocked(appStore.getState().loadChatHistory)
export const patchSession = (id: string, patch: Partial<ChatItem>) => appStore.setState((state) => ({
  chats: state.chats.map((item) => item.id === id ? { ...item, ...patch } : item),
}))
export const feedMessages = (id: string, messages: Message[]) => patchSession(id, { messages })

export const appendPersistedUser = (id: string, content: string, messageId: string) =>
  feedMessages(id, [...savedSession(id).messages, user(messageId, content)])

export function queueStream(sessionId: string, messageId: string | null = `${sessionId}-user`) {
  const subscription = deferred<void>()
  let handlers!: Required<AgentEventHandlers>
  let controller!: AbortController
  vi.mocked(agentClient.sendMessage).mockResolvedValueOnce({
    session_id: sessionId, status: "success", ...(messageId === null ? {} : { message_id: messageId }),
  })
  vi.mocked(agentClient.subscribeToEvents).mockImplementationOnce((id, supplied, ac) => {
    expect(id).toBe(sessionId)
    expect(ac).toBeInstanceOf(AbortController)
    handlers = supplied as Required<AgentEventHandlers>
    controller = ac!
    controller.signal.addEventListener("abort", () => subscription.resolve(), { once: true })
    return subscription.promise
  })
  return { subscription, get handlers() { return handlers }, get controller() { return controller } }
}

export function startedRun(sessionId: string, runId: string): ExecuteResponse {
  return { session_id: sessionId, status: "started", run_id: runId, events_url: "/v2/stream" }
}

export function useChatStreamFixture() {
  const roots = new Set<() => void>()
  beforeEach(() => {
    localStorage.clear()
    sessionStorage.clear()
    resetCompletedAnswerHandoffsForTest()
    clearSessionCompatibilityObservations()
    appStore.setState({ ...appStore.getInitialState(),
      loadSubagentSessions: vi.fn(async () => {}),
      loadChatHistory: vi.fn(async () => {}),
      refreshChatsNow: vi.fn(async () => {}),
    }, true)
    vi.spyOn(apiClient, "get").mockImplementation(async (path) => {
      if (path === "execute/defaults") return { model: null, system_prompt: "", base_system_prompt: "" }
      throw new Error(`Unexpected fixture GET ${path}`)
    })
    vi.spyOn(apiClient, "post").mockRejectedValue(new Error("Unexpected fixture write"))
    vi.spyOn(agentClient, "sendMessage").mockRejectedValue(new Error("No chat acknowledgement fixture"))
    vi.spyOn(agentClient, "execute").mockImplementation(async (id) => startedRun(id, "synthetic-default-run"))
    vi.spyOn(agentClient, "subscribeToEvents").mockImplementation((_id, _handlers, controller) =>
      new Promise<void>((resolve) => controller?.signal.addEventListener("abort", () => resolve(), { once: true })))
    vi.spyOn(agentClient, "stopGeneration").mockRejectedValue(new Error("No Stop acknowledgement fixture"))
    vi.spyOn(agentClient, "truncateSessionMessages").mockRejectedValue(new Error("No truncate acknowledgement fixture"))
    vi.spyOn(agentClient, "deleteSessionMessage").mockRejectedValue(new Error("No delete acknowledgement fixture"))
    vi.spyOn(agentClient, "getPendingQuestion").mockResolvedValue({ has_pending_question: false })
    vi.spyOn(agentClient, "getRunningSessions").mockResolvedValue({ sessions: [] })
    vi.spyOn(agentClient, "getSession").mockRejectedValue(new Error("No session detail fixture"))
  })
  afterEach(async () => {
    for (const dispose of roots) dispose()
    roots.clear()
    await settleChat()
    vi.useRealTimers()
    vi.restoreAllMocks()
  })

  return async function mount(bound?: string | null, options: {
    observe?: (chat: Chat) => void
    pageVisible?: () => boolean
    onSessionCreated?: (id: string) => void
  } = {}) {
    const pane = createRoot((dispose) => {
      roots.add(dispose)
      const [id, setId] = createSignal(bound ?? null)
      const chat = createChat(bound === undefined ? undefined : id, options.onSessionCreated, { pageVisible: options.pageVisible })
      options.observe?.(chat)
      return {
        chat,
        rebind: (next: string | null) => settleChat(() => setId(next)),
        unmount: () => { if (roots.delete(dispose)) dispose() },
      }
    })
    await settleChat()
    return pane
  }
}
