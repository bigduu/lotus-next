import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { useAppStore } from "@shared/store/appStore"
import { sessionSummaryToChatItem } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import { agentClient, type PendingQuestionResponse, type PermissionDecisionResult, type SessionSummary } from "@services/chat/AgentService"
import { NetworkRequestError } from "@services/api/errors"
import { QuestionDialog } from "@/components/chat/Dialogs"
import { useChat, type PendingQuestion } from "./useChat"

// Keep the real reactive store, recovery action and execution reducer. Only
// app bootstrap and network boundaries are replaced; the rendered dialog uses
// the same hook outputs and callbacks as ChatPane.
vi.mock("@shared/store/appStore", async (original) => ({
  ...await original<typeof import("@shared/store/appStore")>(),
  initializeStore: vi.fn(async () => {}),
}))

type Chat = ReturnType<typeof useChat>
const values = new Map<string, Chat>()
let root: Root
let container: HTMLDivElement
let getPending: MockInstance<typeof agentClient.getPendingQuestion>
let submit: MockInstance<typeof agentClient.submitPermissionDecision>
const absent = { has_pending_question: false } as const
const permission = (sessionId = "session/a", generation = "generation/a", revision = 7): PendingQuestion => ({
  has_pending_question: true, interaction_kind: "permission",
  question: `Canonical approval for ${sessionId}`, options: ["untyped approve"], allow_custom: true,
  tool_call_id: "call/a", permission_request: {
    session_id: sessionId, request_id: "call/a", request_generation: generation,
    policy_revision: revision, tool_name: "Bash", permission_type: "execute_command",
    resource: "test workspace", operation_summary: "Run the gated command",
    allowed_decisions: ["allow_once", "deny_once"],
  },
})
const summary = (id = "session/a", pending = false, terminal = false): SessionSummary => ({
  id, kind: "root", title: id, title_version: 0, pinned: false,
  root_session_id: id, spawn_depth: 0, model: "test-model",
  created_at: "2026-10-11T00:00:00Z", updated_at: "2026-10-11T00:00:00Z",
  last_activity_at: "2026-10-11T00:00:00Z", message_count: 0, has_attachments: false,
  is_running: false, has_pending_question: pending,
  last_run_status: terminal ? "completed" : pending ? "suspended" : undefined,
})
const recover = (id = "session/a", callId = "call/a") => useAppStore.getState().setPendingQuestion(id, {
  question: "Legacy notification must not become the dialog", options: ["Approve forever"],
  allowCustom: true, toolCallId: callId,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
function Pane({ bound, name = "pane" }: { bound?: string | null; name?: string }) {
  const chat = useChat(bound)
  values.set(name, chat)
  return chat.pendingQuestion ? <QuestionDialog q={chat.pendingQuestion}
    onAnswer={(choice) => { void chat.answerQuestion(choice) }}
    loading={chat.questionLoading} submitting={chat.questionSubmitting}
    unavailable={chat.questionUnavailable} error={chat.questionError}
    canRetry={chat.questionCanRetry} onRefresh={() => { void chat.refreshQuestion() }}
    onRetry={() => { void chat.retryQuestion() }} /> : null
}
const mount = async (bound?: string | null) => {
  await act(async () => root.render(<Pane bound={bound} />))
}
const chat = () => values.get("pane")!
const dialog = () => document.querySelector('[role="dialog"]')
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((element) => element.textContent?.trim() === label)
const click = async (label: string) => {
  const control = button(label)
  expect(control).toBeDefined()
  await act(async () => control!.click())
}
const expectNoExecution = () => {
  expect(agentClient.execute).not.toHaveBeenCalled()
  expect(agentClient.sendMessage).not.toHaveBeenCalled()
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  values.clear()
  useAppStore.setState({ ...useAppStore.getInitialState(),
    currentSessionId: "session/a",
    chats: [sessionSummaryToChatItem(summary()), sessionSummaryToChatItem(summary("session/b"))],
    loadSubagentSessions: vi.fn(async () => {}), loadChatHistory: vi.fn(async () => {}),
    refreshChatsNow: vi.fn(async () => {}),
  }, true)
  getPending = vi.spyOn(agentClient, "getPendingQuestion").mockResolvedValue(absent)
  submit = vi.spyOn(agentClient, "submitPermissionDecision")
  vi.spyOn(agentClient, "execute").mockRejectedValue(new Error("Recovery must not execute"))
  vi.spyOn(agentClient, "sendMessage").mockRejectedValue(new Error("Recovery must not send"))
  vi.spyOn(agentClient, "subscribeToEvents").mockImplementation(() => new Promise(() => {}))
  container = document.body.appendChild(document.createElement("div"))
  root = createRoot(container)
})
afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("useChat recovered pending approval dialog", () => {
  it("reopens the active pane through the account-feed recovery action after its initial absent read", async () => {
    vi.useFakeTimers()
    await mount()
    expect(dialog()).toBeNull()
    expect(getPending).toHaveBeenCalledTimes(1)
    getPending.mockResolvedValue(permission())
    await act(async () => {
      useAppStore.getState().reconcileOpenSession("session/a", "ws_reconnected")
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(useAppStore.getState().executionBySession["session/a"].interaction.pendingQuestion).not.toBeNull()
    expect(dialog()).not.toBeNull()
    expect(getPending).toHaveBeenCalledTimes(3) // entry, feed snapshot, canonical hook read
    expect(dialog()?.textContent).toContain("Canonical approval for session/a")
    expect(button("仅本次允许")?.disabled).toBe(false)
    expect(button("仅本次拒绝")?.disabled).toBe(false)
    expect(dialog()?.querySelector("textarea")).toBeNull()
    expect(submit).not.toHaveBeenCalled()
    expect(agentClient.subscribeToEvents).not.toHaveBeenCalled()
    expectNoExecution()
  })

  it.each([undefined, "session/a"])("reads typed authority from a recovered store notification in pane %s", async (bound) => {
    if (bound) useAppStore.setState({ currentSessionId: "session/b" })
    await mount(bound)
    getPending.mockResolvedValue(permission())
    await act(async () => recover())
    expect(dialog()).not.toBeNull()
    expect(dialog()?.textContent).toContain("Canonical approval for session/a")
    expect(dialog()?.textContent).not.toContain("Legacy notification")
    expect(dialog()?.textContent).not.toContain("Approve forever")
    expect(getPending).toHaveBeenLastCalledWith("session/a")
    expect(submit).not.toHaveBeenCalled()
    getPending.mockResolvedValue(absent)
    submit.mockResolvedValue({ replayed: false, autoResumeStatus: "completed", continuationConfirmed: true })
    await click("仅本次拒绝")
    expect(submit).toHaveBeenCalledExactlyOnceWith("session/a", {
      request_id: "call/a", request_generation: "generation/a", expected_policy_revision: 7, decision: "deny_once",
    })
    expect(dialog()).toBeNull()
    expectNoExecution()
  })

  it("recovers a bound pane from a summary without a legacy pending payload and leaves the main pane alone", async () => {
    await act(async () => root.render(<><Pane name="main" /><Pane name="pane" bound="session/b" /></>))
    getPending.mockClear().mockResolvedValue(permission("session/b"))
    await act(async () => useAppStore.getState().applySessionSummary("session/b", summary("session/b", true)))
    expect(values.get("main")?.pendingQuestion).toBeNull()
    expect(chat().pendingQuestion).toEqual(permission("session/b"))
    expect(getPending).toHaveBeenCalledExactlyOnceWith("session/b")
    expect(dialog()?.textContent).toContain("Canonical approval for session/b")
    expect(submit).not.toHaveBeenCalled()
    expectNoExecution()
  })

  it("does not repeatedly read on unrelated store updates or unchanged no-pending summaries", async () => {
    await mount("session/a")
    await act(async () => useAppStore.getState().applySessionSummary("session/a", summary()))
    getPending.mockClear()
    await act(async () => {
      useAppStore.getState().applySessionSummary("session/a", summary())
      recover("session/b")
      useAppStore.getState().applyChildProgress("session/a", "child/a", { title: "Child update" })
    })
    expect(getPending).not.toHaveBeenCalled()
    expect(dialog()).toBeNull()
    expectNoExecution()
  })

  it.each(["main", "bound"])("rejects an earlier visit's recovery GET after A to B to A in the %s pane", async (mode) => {
    const bound = mode === "bound"
    await mount(bound ? "session/a" : undefined)
    const older = deferred<PendingQuestionResponse>()
    getPending.mockReturnValueOnce(older.promise)
    await act(async () => recover())
    getPending.mockResolvedValueOnce(absent).mockResolvedValue(permission("session/a", "generation/new"))
    if (bound) {
      await mount("session/b")
      await mount("session/a")
    } else {
      await act(async () => useAppStore.setState({ currentSessionId: "session/b" }))
      await act(async () => useAppStore.setState({ currentSessionId: "session/a" }))
    }
    await act(async () => { older.resolve(permission()); await older.promise })
    expect(chat().pendingQuestion).toEqual(permission("session/a", "generation/new"))
    expect(chat().questionLoading).toBe(false)
    expect(submit).not.toHaveBeenCalled()
    expectNoExecution()
  })

  it("discards an older recovery GET after a newer canonical request is displayed", async () => {
    await mount("session/a")
    const older = deferred<PendingQuestionResponse>()
    getPending.mockReturnValueOnce(older.promise)
    await act(async () => recover())
    getPending.mockResolvedValue(permission("session/a", "generation/new"))
    await act(async () => recover("session/a", "new-notification"))
    await act(async () => { older.resolve(permission()); await older.promise })
    expect(chat().pendingQuestion).toEqual(permission("session/a", "generation/new"))
    expect(submit).not.toHaveBeenCalled()
    expectNoExecution()
  })

  it.each(["generation", "revision", "allowed choices"])("fresh pending summaries update %s without resetting an uncertain submission", async (change) => {
    vi.useFakeTimers()
    getPending.mockResolvedValue(permission())
    await mount("session/a")
    await act(async () => useAppStore.getState().applySessionSummary("session/a", summary("session/a", true)))
    submit.mockRejectedValueOnce(new NetworkRequestError())
    await click("仅本次允许")
    expect(chat().questionCanRetry).toBe(true)
    const oldClick = chat().answerQuestion
    const next = permission("session/a", change === "generation" ? "generation/new" : "generation/a", change === "revision" ? 8 : 7)
    if (next.interaction_kind === "permission") next.permission_request.allowed_decisions = ["deny_once"]
    getPending.mockResolvedValue(next)
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1)
      useAppStore.getState().applySessionSummary("session/a", summary("session/a", true))
    })
    expect(chat().pendingQuestion).toEqual(next)
    expect(chat().questionCanRetry).toBe(false)
    expect(button("仅本次允许")).toBeUndefined()
    expect(button("仅本次拒绝")?.disabled).toBe(false)
    await act(async () => { await oldClick("allow_once"); await chat().retryQuestion() })
    expect(submit).toHaveBeenCalledTimes(1)
    expectNoExecution()
  })

  it("keeps the exact uncertain retry across same-question recovery and canonical absence", async () => {
    getPending.mockResolvedValue(permission())
    await mount("session/a")
    submit.mockRejectedValueOnce(new NetworkRequestError())
    await click("仅本次允许")
    const submitted = submit.mock.calls[0]
    await act(async () => recover())
    expect(chat().questionCanRetry).toBe(true)
    expect(button("仅本次允许")?.disabled).toBe(true)
    expect(button("仅本次拒绝")?.disabled).toBe(true)
    getPending.mockResolvedValue(absent)
    await act(async () => useAppStore.getState().clearPendingQuestion("session/a"))
    expect(dialog()).not.toBeNull()
    expect(chat().questionCanRetry).toBe(true)
    await click("仅本次拒绝")
    expect(submit).toHaveBeenCalledTimes(1)
    submit.mockResolvedValueOnce({ replayed: true, autoResumeStatus: "completed", continuationConfirmed: true })
    await click("重试上次提交")
    expect(submit.mock.calls).toEqual([submitted, submitted])
    expect(dialog()).toBeNull()
    expectNoExecution()
  })

  it("keeps an in-flight decision fenced when recovered absence arrives before its receipt", async () => {
    getPending.mockResolvedValue(permission())
    await mount("session/a")
    const response = deferred<PermissionDecisionResult>()
    submit.mockReturnValue(response.promise)
    await click("仅本次允许")
    getPending.mockResolvedValue(absent)
    await act(async () => useAppStore.getState().applySessionSummary("session/a", summary("session/a", false, true)))
    expect(chat().questionSubmitting).toBe(true)
    expect(dialog()).not.toBeNull()
    expect(button("仅本次拒绝")?.disabled).toBe(true)
    await act(async () => { response.resolve({ replayed: false, autoResumeStatus: "completed", continuationConfirmed: true }); await response.promise })
    expect(dialog()).toBeNull()
    expect(chat().questionSubmitting).toBe(false)
    expect(submit).toHaveBeenCalledTimes(1)
    expectNoExecution()
  })

  it("does not reopen a recorded decision when recovery reports the same request", async () => {
    getPending.mockResolvedValue(permission())
    await mount("session/a")
    submit.mockResolvedValue({ replayed: false, continuationConfirmed: false })
    await click("仅本次允许")
    await act(async () => recover())
    expect(chat().questionUnavailable).toBe(true)
    expect(chat().questionError).toContain("已记录")
    expect(button("仅本次拒绝")?.disabled).toBe(true)
    await click("仅本次拒绝")
    expect(submit).toHaveBeenCalledTimes(1)
    expectNoExecution()
  })

  it("an old receipt cannot settle a newly recovered generation or its decision", async () => {
    getPending.mockResolvedValue(permission())
    await mount("session/a")
    const oldResponse = deferred<PermissionDecisionResult>()
    const newResponse = deferred<PermissionDecisionResult>()
    submit.mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(newResponse.promise)
    await click("仅本次允许")
    getPending.mockResolvedValue(permission("session/a", "generation/new"))
    await act(async () => recover())
    await click("仅本次拒绝")
    await act(async () => { oldResponse.resolve({ replayed: false, autoResumeStatus: "started", continuationConfirmed: true }); await oldResponse.promise })
    expect(chat().pendingQuestion).toEqual(permission("session/a", "generation/new"))
    expect(chat().questionSubmitting).toBe(true)
    expect(agentClient.subscribeToEvents).not.toHaveBeenCalled()
    getPending.mockResolvedValue(absent)
    await act(async () => { newResponse.resolve({ replayed: false, autoResumeStatus: "completed", continuationConfirmed: true }); await newResponse.promise })
    expect(dialog()).toBeNull()
    expect(chat().questionSubmitting).toBe(false)
    expect(submit).toHaveBeenLastCalledWith("session/a", {
      request_id: "call/a", request_generation: "generation/new", expected_policy_revision: 7, decision: "deny_once",
    })
    expectNoExecution()
  })

  it.each(["clear", "terminal"])("closes a displayed approval only after canonical absence on %s", async (signal) => {
    getPending.mockResolvedValue(permission())
    await mount("session/a")
    await act(async () => recover())
    expect(dialog()).not.toBeNull()
    getPending.mockResolvedValue(absent)
    await act(async () => {
      if (signal === "clear") useAppStore.getState().clearPendingQuestion("session/a")
      else useAppStore.getState().applySessionSummary("session/a", summary("session/a", false, true))
    })
    expect(dialog()).toBeNull()
    expect(chat().pendingQuestion).toBeNull()
    expect(submit).not.toHaveBeenCalled()
    expectNoExecution()
  })

  it("never displays the legacy notification when the canonical recovery read has no pending request", async () => {
    await mount("session/a")
    await act(async () => recover())
    expect(getPending).toHaveBeenCalledTimes(2)
    expect(dialog()).toBeNull()
    expect(chat().pendingQuestion).toBeNull()
    expect(submit).not.toHaveBeenCalled()
    expectNoExecution()
  })

  it.each(["clear", "terminal"])("canonical absence after %s prevents a late recovery GET from reopening the dialog", async (signal) => {
    await mount("session/a")
    const older = deferred<PendingQuestionResponse>()
    getPending.mockReturnValueOnce(older.promise)
    await act(async () => recover())
    getPending.mockResolvedValue(absent)
    await act(async () => {
      if (signal === "clear") useAppStore.getState().clearPendingQuestion("session/a")
      else useAppStore.getState().applySessionSummary("session/a", summary("session/a", false, true))
    })
    await act(async () => { older.resolve(permission()); await older.promise })
    expect(chat().pendingQuestion).toBeNull()
    expect(chat().questionLoading).toBe(false)
    expect(dialog()).toBeNull()
    expect(submit).not.toHaveBeenCalled()
    expectNoExecution()
  })

  it("leaves decisions disabled on failed recovery and recovers through explicit refresh", async () => {
    getPending.mockResolvedValue(permission())
    await mount("session/a")
    getPending.mockRejectedValueOnce(new NetworkRequestError())
    await act(async () => recover())
    expect(chat().questionUnavailable).toBe(true)
    expect(button("仅本次允许")?.disabled).toBe(true)
    expect(button("仅本次拒绝")?.disabled).toBe(true)
    getPending.mockResolvedValue(permission())
    await click("刷新请求")
    expect(chat().questionUnavailable).toBe(false)
    expect(button("仅本次允许")?.disabled).toBe(false)
    expect(submit).not.toHaveBeenCalled()
    expectNoExecution()
  })
})
