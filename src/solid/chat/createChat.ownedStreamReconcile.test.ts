import { createRoot } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { agentClient, type ExecuteResponse, type GetSessionResponse, type SessionSummary } from "@services/chat/AgentService"
import { clearSessionCompatibilityObservations } from "@services/chat/sessionExecutionCompatibility"
import { appStore } from "@shared/store/appStore/state"
import { sessionSummaryToChatItem } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import { selectShouldObserve } from "@shared/store/appStore/selectors/executionSelectors"
import type { ChatItem } from "@shared/types/chatMessages"
import { resetCompletedAnswerHandoffsForTest } from "@/lib/completedAnswerHandoffRegistry"
import { createChat } from "./createChat"
import { settleChat } from "./chatInteractionTestHarness"

const id = "orphaned-owned-stream"
const at = "2026-10-06T10:00:00Z"
const absent = { has_pending_question: false } as const
const question = {
  has_pending_question: true as const, interaction_kind: "clarification" as const,
  question: "Which branch?", options: ["main", "dev"], allow_custom: true,
  tool_call_id: "clarification/a", permission_request: null,
}
let dispose: (() => void) | undefined

function detail(overrides: Partial<SessionSummary> = {}): GetSessionResponse {
  return { session: {
    id, kind: "root", title: id, title_version: 0, pinned: false, root_session_id: id,
    spawn_depth: 0, model: "test-model", created_at: at, updated_at: at, last_activity_at: at,
    message_count: 0, has_attachments: false, is_running: false, last_run_status: "completed",
    ...overrides,
  } }
}

const started: ExecuteResponse = { session_id: id, status: "started", run_id: "owned-fixture-run", events_url: "/v2/stream" }

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((done) => { resolve = done })
  return { promise, resolve }
}

function publish(patch: Partial<ChatItem>) {
  appStore.setState((state) => ({ chats: state.chats.map((chat) => chat.id === id ? { ...chat, ...patch } : chat) }))
}

const read = () => vi.mocked(agentClient.getSession)
const history = () => vi.mocked(appStore.getState().loadChatHistory)
const refresh = () => vi.mocked(appStore.getState().refreshChatsNow)
const subscriptions = () => vi.mocked(agentClient.subscribeToEvents).mock.calls
const advance = (milliseconds: number) => settleChat(() => vi.advanceTimersByTimeAsync(milliseconds))
function unmount() {
  dispose?.()
  dispose = undefined
}

async function start() {
  const chat = createRoot((cleanup) => {
    dispose = cleanup
    return createChat(() => id)
  })
  await settleChat()
  // Startup's compatibility read belongs to a separate authority check.
  expect(read()).toHaveBeenCalledExactlyOnceWith(id)
  read().mockClear()
  await settleChat(async () => {
    await expect(chat.send("inspect the worktree")).resolves.toMatchObject({ kind: "accepted", sessionId: id })
  })
  const subscription = subscriptions()[0]
  expect(subscription?.[2]).toBeInstanceOf(AbortController)
  return { chat, handlers: subscription[1], controller: subscription[2]! }
}

beforeEach(() => {
  vi.useFakeTimers()
  resetCompletedAnswerHandoffsForTest()
  clearSessionCompatibilityObservations()
  appStore.setState({ ...appStore.getInitialState(),
    chats: [sessionSummaryToChatItem(detail({ is_running: true }).session)],
    loadSubagentSessions: vi.fn(async () => {}),
    loadChatHistory: vi.fn(async () => {}),
    refreshChatsNow: vi.fn(async () => publish({ isRunning: false })),
  }, true)
  vi.spyOn(agentClient, "sendMessage").mockResolvedValue({ session_id: id, status: "success" })
  vi.spyOn(agentClient, "execute").mockResolvedValue(started)
  vi.spyOn(agentClient, "getSession").mockResolvedValue(detail())
  vi.spyOn(agentClient, "getPendingQuestion").mockResolvedValue(absent)
  vi.spyOn(agentClient, "getRunningSessions").mockResolvedValue({ sessions: [] })
  vi.spyOn(agentClient, "stopGeneration").mockResolvedValue(undefined)
  vi.spyOn(agentClient, "subscribeToEvents").mockImplementation((_id, _handlers, controller) =>
    new Promise<void>((resolve) => controller?.signal.addEventListener("abort", () => resolve(), { once: true })))
})

afterEach(async () => {
  unmount()
  await settleChat()
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe("Solid owned streams without a terminal frame", () => {
  it("clears an owned run after two idle reads without trusting an old completed status", async () => {
    const { chat, controller } = await start()
    expect(chat.sending).toBe(true)
    await advance(5_000)
    expect(controller.signal.aborted).toBe(false)
    expect(read()).toHaveBeenCalledTimes(1)
    await advance(2_000)
    expect(controller.signal.aborted).toBe(true)
    expect(chat.sending).toBe(false)
    expect(chat.streaming).toBeNull()
    expect(chat.sendFailure).toMatchObject({ kind: "generation-failed", sessionId: id })
    expect(history()).toHaveBeenLastCalledWith(id, { mode: "monotonic", throwOnError: true })
    const count = read().mock.calls.length
    await advance(20_000)
    expect(read()).toHaveBeenCalledTimes(count)
  })

  it("does not read an idle pre-start summary until Execute acknowledges admission", async () => {
    const execution = deferred<ExecuteResponse>()
    vi.mocked(agentClient.execute).mockReturnValueOnce(execution.promise)
    const { chat, controller } = await start()
    await advance(15_000)
    expect(read()).not.toHaveBeenCalled()
    expect(controller.signal.aborted).toBe(false)
    await settleChat(() => execution.resolve(started))
    await advance(7_000)
    expect(controller.signal.aborted).toBe(true)
    expect(chat.sending).toBe(false)
  })

  it("restarts idle confirmation when a fresh status read fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { chat, controller } = await start()
    await advance(5_000)
    read().mockRejectedValueOnce(new Error("status offline"))
    await advance(2_000)
    expect(controller.signal.aborted).toBe(false)
    expect(chat.sendFailure).toBeNull()
    await advance(5_000)
    expect(read()).toHaveBeenCalledTimes(3)
    expect(refresh()).not.toHaveBeenCalled()
    expect(controller.signal.aborted).toBe(false)
    await advance(2_000)
    expect(controller.signal.aborted).toBe(true)
    expect(chat.sendFailure).toMatchObject({ kind: "generation-failed", sessionId: id })
  })

  it("keeps a successor and a suspended question alive after the first idle read", async () => {
    const { chat, controller } = await start()
    await advance(5_000)
    read().mockResolvedValue(detail({ is_running: true }))
    await advance(2_000)
    expect(controller.signal.aborted).toBe(false)
    read().mockResolvedValue(detail({ has_pending_question: true }))
    await advance(10_000)
    expect(controller.signal.aborted).toBe(false)
    expect(chat.sending).toBe(true)
    expect(chat.sendFailure).toBeNull()
    expect(refresh()).not.toHaveBeenCalled()
  })

  function suspendForChild() {
    read().mockResolvedValue(detail({ last_run_status: "suspended", has_pending_question: false }))
    refresh().mockImplementation(async () => publish({ isRunning: false, lastRunStatus: "suspended" }))
  }

  it("releases a child-wait suspension without a terminal frame and accepts another message", async () => {
    const { chat, controller, handlers } = await start()
    suspendForChild()
    const response = "Waiting for the background agent."
    await settleChat(() => handlers.onToken?.(response))
    history().mockImplementation(async () => publish({ messages: [
      { id: "waiting-reply", role: "assistant", type: "text", content: response, createdAt: at },
    ] }))
    await advance(5_000)
    expect(controller.signal.aborted).toBe(false)
    await advance(2_000)
    expect(controller.signal.aborted).toBe(true)
    expect(chat.sending).toBe(false)
    expect(chat.streamPhase).toBeNull()
    expect(chat.streaming).toBeNull()
    expect(chat.sendFailure).toBeNull()
    expect(agentClient.stopGeneration).not.toHaveBeenCalled()

    // An independently busy execution rail does not make a suspended parent eligible to attach.
    await settleChat(() => appStore.getState().markForceSubscribe(id))
    expect(selectShouldObserve(id)(appStore.getState())).toBe(true)
    await advance(10_000)
    expect(subscriptions()).toHaveLength(1)
    await settleChat(async () => {
      await expect(chat.send("How is the work going?")).resolves.toMatchObject({ kind: "accepted" })
    })
    expect(agentClient.sendMessage).toHaveBeenCalledTimes(2)
    expect(agentClient.execute).toHaveBeenCalledTimes(2)
  })

  it("passively observes a parent that resumes after its child-wait suspension", async () => {
    const { chat, controller } = await start()
    suspendForChild()
    await advance(7_000)
    expect(controller.signal.aborted).toBe(true)
    await settleChat(() => {
      publish({ isRunning: true })
      appStore.getState().markForceSubscribe(id)
    })
    expect(subscriptions()).toHaveLength(2)
    expect(agentClient.execute).toHaveBeenCalledTimes(1)
    await settleChat(() => subscriptions()[1][1].onToken?.("The background result is ready."))
    await advance(20)
    expect(chat.streaming).toBe("The background result is ready.")
    expect(chat.sendFailure).toBeNull()
  })

  it("retains a suspended question and retries an unavailable suspension history", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {})
    const { chat, controller } = await start()
    read().mockResolvedValue(detail({ last_run_status: "suspended", has_pending_question: true }))
    await advance(10_000)
    expect(controller.signal.aborted).toBe(false)
    expect(chat.sending).toBe(true)
    suspendForChild()
    history().mockRejectedValue(new Error("offline"))
    await advance(7_000)
    expect(controller.signal.aborted).toBe(false)
    expect(chat.sendFailure).toBeNull()
    history().mockResolvedValue(undefined)
    await advance(5_000)
    expect(controller.signal.aborted).toBe(true)
    expect(chat.sending).toBe(false)
    expect(chat.sendFailure).toBeNull()
  })

  it.each(["pending", "unavailable"] as const)("confirms canonical question absence before settling a suspension (%s)", async (answer) => {
    const { chat, controller } = await start()
    suspendForChild()
    const pending = vi.mocked(agentClient.getPendingQuestion)
    if (answer === "pending") pending.mockResolvedValue(question)
    else pending.mockRejectedValue(new Error("offline"))
    await advance(7_000)
    expect(controller.signal.aborted).toBe(false)
    expect(chat.sending).toBe(true)
    expect(chat.sendFailure).toBeNull()
    if (answer === "pending") expect(chat.pendingQuestion).toEqual(question)
    else expect(chat.questionUnavailable).toBe(true)
    pending.mockResolvedValue(absent)
    await advance(5_000)
    expect(controller.signal.aborted).toBe(true)
    expect(chat.sending).toBe(false)
    expect(chat.sendFailure).toBeNull()
  })

  it("preserves a running successor admitted while history is being read", async () => {
    const { chat, controller } = await start()
    history().mockImplementation(async () => publish({ isRunning: true }))
    await advance(7_000)
    expect(controller.signal.aborted).toBe(false)
    expect(chat.sending).toBe(true)
    expect(chat.sendFailure).toBeNull()
  })

  it("settles a successfully persisted reply without a false interruption", async () => {
    const { chat, controller, handlers } = await start()
    const response = "durable final reply"
    await settleChat(() => handlers.onToken?.(response))
    history().mockImplementation(async () => publish({ messages: [
      { id: "final-message", role: "assistant", type: "text", content: response, createdAt: at },
    ] }))
    await advance(7_000)
    expect(controller.signal.aborted).toBe(true)
    expect(chat.sending).toBe(false)
    expect(chat.sendFailure).toBeNull()
    expect(chat.streaming).toBeNull()
  })

  it("ignores a status response after the owning pane has unmounted", async () => {
    const { controller } = await start()
    const status = deferred<GetSessionResponse>()
    read().mockReturnValueOnce(status.promise)
    await advance(5_000)
    unmount()
    await settleChat(() => status.resolve(detail()))
    expect(controller.signal.aborted).toBe(true)
    expect(refresh()).not.toHaveBeenCalled()
    await advance(10_000)
    expect(read()).toHaveBeenCalledTimes(1)
  })

  it("closes on Complete and ignores an idle status response still in flight", async () => {
    const { chat, controller, handlers } = await start()
    const status = deferred<GetSessionResponse>()
    read().mockReturnValueOnce(status.promise)
    await advance(5_000)
    await settleChat(() => handlers.onComplete?.(undefined))
    const count = history().mock.calls.length
    await settleChat(() => status.resolve(detail()))
    await advance(10_000)
    expect(read()).toHaveBeenCalledTimes(1)
    expect(history()).toHaveBeenCalledTimes(count)
    expect(refresh()).not.toHaveBeenCalled()
    expect(chat.sendFailure).toBeNull()
    expect(chat.sending).toBe(false)
    expect(controller.signal.aborted).toBe(true)
    expect(agentClient.stopGeneration).not.toHaveBeenCalled()
  })
})
