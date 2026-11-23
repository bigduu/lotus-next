import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from "vitest"
import { appStore } from "@shared/store/appStore/state"
import { sessionSummaryToChatItem } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import { applySessionsList } from "@shared/store/appStore/slices/chatSessionSlice/refreshChats"
import { agentClient, type ChildApprovalResponse, type PendingQuestionResponse, type PermissionDecisionResult, type SessionSummary } from "@services/chat/AgentService"
import { apiClient } from "@services/api"
import { NetworkRequestError } from "@services/api/errors"
import { clearSessionCompatibilityObservations, type SessionExecutionCompatibility } from "@services/chat/sessionExecutionCompatibility"
import { uiText } from "@shared/i18n/text"
import type { PendingQuestion } from "./createChat"
import { renderChatPane, settleChat } from "./chatInteractionTestHarness"

// Keep the real reactive store, recovery action and execution reducer. Only
// app bootstrap and network boundaries are replaced; the fixture uses the real Solid
// timeline, controller, and interaction surface.
vi.mock("@shared/store/appStore/state", async (original) => ({
  ...await original<typeof import("@shared/store/appStore/state")>(),
  initializeStore: vi.fn(async () => {}),
}))
// Vite compiles the package's JSX entry for production. Load the package's
// compiled entry under the scoped Vitest transform so the real modal mounts.
vi.mock("@kobalte/core/dialog", async () => {
  const { createRequire } = await vi.importActual<{
    createRequire: (url: string) => { resolve: (name: string) => string }
  }>("node:module")
  const entry = createRequire(import.meta.url).resolve("@kobalte/core/dialog")
  return vi.importActual(entry.replace(/\.jsx$/, ".js"))
})

const panes = new Map<string, ReturnType<typeof renderChatPane>>()
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
const optionalPendingSummary = (id: string, pending: boolean | undefined, status?: string): SessionSummary => {
  const next = { ...summary(id), last_run_status: status }
  if (pending === undefined) delete next.has_pending_question
  else next.has_pending_question = pending
  return next
}
// This is the actual summary refresh path, including both the unfiltered
// ChatItem status and the execution reducer's terminal-only backend status.
const publishSummary = (next: SessionSummary) => applySessionsList([next], appStore.setState, { kind: "upsert" })
const recover = (id = "session/a", callId = "call/a") => appStore.getState().setPendingQuestion(id, {
  question: "Legacy notification must not become the dialog", options: ["Approve forever"],
  allowCustom: true, toolCallId: callId,
})
function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}
const mount = (bound?: string | null, name = "pane") => settleChat(() => {
  const pane = panes.get(name)
  if (!pane) panes.set(name, renderChatPane(bound))
  else if (bound !== undefined) pane.rebind(bound)
})
const chat = () => panes.get("pane")!.chat
const approvalCards = () => [...document.querySelectorAll<HTMLElement>("[data-approval-presentation]")]
const pendingCard = () => document.querySelector('[data-approval-presentation][aria-label="需要操作授权"]')
const button = (label: string) => [...document.querySelectorAll<HTMLButtonElement>("button")]
  .find((element) => element.textContent?.trim() === label)
const click = async (label: string) => {
  const control = button(label)
  expect(control).toBeDefined()
  await settleChat(async () => control!.click())
}
const expectNoExecution = () => {
  expect(agentClient.execute).not.toHaveBeenCalled()
  expect(agentClient.sendMessage).not.toHaveBeenCalled()
}

beforeEach(() => {
  clearSessionCompatibilityObservations()
  appStore.setState({ ...appStore.getInitialState(),
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
})
afterEach(() => {
  for (const pane of panes.values()) pane.dispose()
  panes.clear()
  vi.useRealTimers()
  vi.restoreAllMocks()
  clearSessionCompatibilityObservations()
})

describe("createChat recovered pending approval", () => {
  describe("suspended summaries with an optional pending flag", () => {
    it.each([
      ["main", true], ["main", false], ["main", undefined],
      ["bound", true], ["bound", false], ["bound", undefined],
    ] as const)("recovers the %s pane when suspended arrives with has_pending_question=%s", async (mode, flag) => {
      vi.useFakeTimers()
      const sessionId = mode === "main" ? "session/a" : "session/b"
      publishSummary(optionalPendingSummary(sessionId, flag))
      await mount(mode === "main" ? undefined : sessionId)
      expect(pendingCard()).toBeNull()
      getPending.mockClear().mockResolvedValue(permission(sessionId))
      const suspended = optionalPendingSummary(sessionId, flag, "suspended")
      if (flag === undefined) expect(suspended).not.toHaveProperty("has_pending_question")
      await settleChat(async () => {
        await vi.advanceTimersByTimeAsync(1)
        publishSummary(suspended)
      })
      expect(appStore.getState().executionBySession[sessionId].backend.lastRunStatus).toBeNull()
      expect(appStore.getState().chats.find((item) => item.id === sessionId)?.lastRunStatus).toBe("suspended")
      expect(pendingCard()).not.toBeNull()
      expect(chat().pendingQuestion).toEqual(permission(sessionId))
      expect(getPending).toHaveBeenCalledExactlyOnceWith(sessionId)
      expect(submit).not.toHaveBeenCalled()
      expectNoExecution()
    })

    it.each([true, false, undefined])("same-millisecond suspended snapshots with flag %s retry publication without supplying authority or looping", async (flag) => {
      vi.useFakeTimers()
      const suspended = optionalPendingSummary("session/b", flag, "suspended")
      publishSummary(suspended)
      const firstSyncedAt = appStore.getState().executionBySession["session/b"].backend.syncedAt
      await mount("session/b")
      expect(pendingCard()).toBeNull()
      getPending.mockClear()
      // No clock advance: every real summary must signal, even within one ms.
      await settleChat(async () => publishSummary(suspended))
      expect(getPending).toHaveBeenCalledExactlyOnceWith("session/b")
      expect(pendingCard()).toBeNull() // Canonical absence overrides every summary hint.
      getPending.mockClear().mockResolvedValue(permission("session/b"))
      await settleChat(async () => publishSummary(suspended))
      expect(appStore.getState().executionBySession["session/b"].backend.syncedAt).toBe(firstSyncedAt)
      expect(pendingCard()).not.toBeNull()
      expect(chat().pendingQuestion).toEqual(permission("session/b"))
      expect(getPending).toHaveBeenCalledExactlyOnceWith("session/b")
      getPending.mockClear()
      await mount("session/b")
      await settleChat(async () => {
        publishSummary(optionalPendingSummary("session/a", true, "suspended"))
        appStore.getState().applyChildProgress("session/b", "child/b", { title: "Unrelated progress" })
      })
      expect(getPending).not.toHaveBeenCalled()
      expect(chat().pendingQuestion).toEqual(permission("session/b"))
      expect(submit).not.toHaveBeenCalled()
      expectNoExecution()
    })

    it.each(["main", "bound"])("fences a suspended-summary recovery GET across A to B to A in the %s pane", async (mode) => {
      const bound = mode === "bound"
      await mount(bound ? "session/a" : undefined)
      const older = deferred<PendingQuestionResponse>()
      getPending.mockReturnValueOnce(older.promise)
      await settleChat(async () => publishSummary(optionalPendingSummary("session/a", undefined, "suspended")))
      expect(chat().questionLoading).toBe(true)
      getPending.mockResolvedValueOnce(absent).mockResolvedValue(permission("session/a", "generation/new"))
      if (bound) await mount("session/b")
      else await settleChat(async () => appStore.setState({ currentSessionId: "session/b" }))
      const readsInB = getPending.mock.calls.length
      await settleChat(async () => publishSummary(optionalPendingSummary("session/a", undefined, "suspended")))
      expect(getPending).toHaveBeenCalledTimes(readsInB)
      expect(pendingCard()).toBeNull()
      if (bound) await mount("session/a")
      else await settleChat(async () => appStore.setState({ currentSessionId: "session/a" }))
      await settleChat(async () => { older.resolve(permission()); await older.promise })
      expect(chat().pendingQuestion).toEqual(permission("session/a", "generation/new"))
      expect(chat().questionLoading).toBe(false)
      expect(submit).not.toHaveBeenCalled()
      expectNoExecution()
    })

    it("does not reopen a late suspended read after a terminal summary confirms canonical absence", async () => {
      await mount("session/b")
      const older = deferred<PendingQuestionResponse>()
      getPending.mockReturnValueOnce(older.promise)
      await settleChat(async () => publishSummary(optionalPendingSummary("session/b", undefined, "suspended")))
      expect(chat().questionLoading).toBe(true)
      getPending.mockResolvedValue(absent)
      await settleChat(async () => publishSummary(optionalPendingSummary("session/b", false, "completed")))
      await settleChat(async () => { older.resolve(permission("session/b")); await older.promise })
      expect(chat().pendingQuestion).toBeNull()
      expect(chat().questionLoading).toBe(false)
      expect(pendingCard()).toBeNull()
      expect(submit).not.toHaveBeenCalled()
      expectNoExecution()
    })

    it("preserves an uncertain retry when a suspended summary explicitly says no pending question", async () => {
      getPending.mockResolvedValue(permission("session/b"))
      await mount("session/b")
      submit.mockRejectedValueOnce(new NetworkRequestError())
      await click("仅本次允许")
      getPending.mockClear().mockResolvedValue(absent)
      await settleChat(async () => publishSummary(optionalPendingSummary("session/b", false, "suspended")))
      expect(getPending).toHaveBeenCalledExactlyOnceWith("session/b")
      expect(chat().questionCanRetry).toBe(true)
      expect(button("仅本次允许")?.disabled).toBe(true)
      expect(button("仅本次拒绝")?.disabled).toBe(true)
      expect(submit).toHaveBeenCalledTimes(1)
      expectNoExecution()
    })
  })

  it("reopens the active pane through the account-feed recovery action after its initial absent read", async () => {
    vi.useFakeTimers()
    await mount()
    expect(pendingCard()).toBeNull()
    expect(getPending).toHaveBeenCalledTimes(1)
    getPending.mockResolvedValue(permission())
    await settleChat(async () => {
      appStore.getState().reconcileOpenSession("session/a", "ws_reconnected")
      await vi.advanceTimersByTimeAsync(300)
    })
    expect(appStore.getState().executionBySession["session/a"].interaction.pendingQuestion).not.toBeNull()
    expect(pendingCard()).not.toBeNull()
    expect(getPending).toHaveBeenCalledTimes(3) // entry, feed snapshot, canonical controller read
    expect(pendingCard()?.textContent).toContain("Canonical approval for session/a")
    expect(button("仅本次允许")?.disabled).toBe(false)
    expect(button("仅本次拒绝")?.disabled).toBe(false)
    expect(pendingCard()?.querySelector("textarea")).toBeNull()
    expect(submit).not.toHaveBeenCalled()
    expect(agentClient.subscribeToEvents).not.toHaveBeenCalled()
    expectNoExecution()
  })

  it.each([undefined, "session/a"])("reads typed authority from a recovered store notification in pane %s", async (bound) => {
    if (bound) appStore.setState({ currentSessionId: "session/b" })
    await mount(bound)
    getPending.mockResolvedValue(permission())
    await settleChat(async () => recover())
    expect(pendingCard()).not.toBeNull()
    expect(pendingCard()?.textContent).toContain("Canonical approval for session/a")
    expect(pendingCard()?.textContent).not.toContain("Legacy notification")
    expect(pendingCard()?.textContent).not.toContain("Approve forever")
    expect(getPending).toHaveBeenLastCalledWith("session/a")
    expect(submit).not.toHaveBeenCalled()
    getPending.mockResolvedValue(absent)
    submit.mockResolvedValue({ replayed: false, autoResumeStatus: "completed", continuationConfirmed: true })
    await click("仅本次拒绝")
    expect(submit).toHaveBeenCalledExactlyOnceWith("session/a", {
      request_id: "call/a", request_generation: "generation/a", expected_policy_revision: 7, decision: "deny_once",
    })
    expect(pendingCard()).toBeNull()
    expect(approvalCards().map((card) => card.getAttribute("aria-label"))).toEqual(["已拒绝 · 会话已继续"])
    expectNoExecution()
  })

  it("recovers a bound pane from a summary without a legacy pending payload and leaves the main pane alone", async () => {
    await mount(undefined, "main")
    await mount("session/b")
    getPending.mockClear().mockResolvedValue(permission("session/b"))
    await settleChat(async () => appStore.getState().applySessionSummary("session/b", summary("session/b", true)))
    expect(panes.get("main")?.chat.pendingQuestion).toBeNull()
    expect(chat().pendingQuestion).toEqual(permission("session/b"))
    expect(getPending).toHaveBeenCalledExactlyOnceWith("session/b")
    expect(pendingCard()?.textContent).toContain("Canonical approval for session/b")
    expect(submit).not.toHaveBeenCalled()
    expectNoExecution()
  })

  it("does not repeatedly read on unrelated store updates or unchanged no-pending summaries", async () => {
    await mount("session/a")
    await settleChat(async () => appStore.getState().applySessionSummary("session/a", summary()))
    getPending.mockClear()
    await settleChat(async () => {
      appStore.getState().applySessionSummary("session/a", summary())
      recover("session/b")
      appStore.getState().applyChildProgress("session/a", "child/a", { title: "Child update" })
    })
    expect(getPending).not.toHaveBeenCalled()
    expect(pendingCard()).toBeNull()
    expectNoExecution()
  })

  it.each(["main", "bound"])("rejects an earlier visit's recovery GET after A to B to A in the %s pane", async (mode) => {
    const bound = mode === "bound"
    await mount(bound ? "session/a" : undefined)
    const older = deferred<PendingQuestionResponse>()
    getPending.mockReturnValueOnce(older.promise)
    await settleChat(async () => recover())
    getPending.mockResolvedValueOnce(absent).mockResolvedValue(permission("session/a", "generation/new"))
    if (bound) {
      await mount("session/b")
      await mount("session/a")
    } else {
      await settleChat(async () => appStore.setState({ currentSessionId: "session/b" }))
      await settleChat(async () => appStore.setState({ currentSessionId: "session/a" }))
    }
    await settleChat(async () => { older.resolve(permission()); await older.promise })
    expect(chat().pendingQuestion).toEqual(permission("session/a", "generation/new"))
    expect(chat().questionLoading).toBe(false)
    expect(submit).not.toHaveBeenCalled()
    expectNoExecution()
  })

  it("discards an older recovery GET after a newer canonical request is displayed", async () => {
    await mount("session/a")
    const older = deferred<PendingQuestionResponse>()
    getPending.mockReturnValueOnce(older.promise)
    await settleChat(async () => recover())
    getPending.mockResolvedValue(permission("session/a", "generation/new"))
    await settleChat(async () => recover("session/a", "new-notification"))
    await settleChat(async () => { older.resolve(permission()); await older.promise })
    expect(chat().pendingQuestion).toEqual(permission("session/a", "generation/new"))
    expect(submit).not.toHaveBeenCalled()
    expectNoExecution()
  })

  it.each(["generation", "revision", "allowed choices"])("fresh pending summaries update %s without resetting an uncertain submission", async (change) => {
    vi.useFakeTimers()
    getPending.mockResolvedValue(permission())
    await mount("session/a")
    await settleChat(async () => appStore.getState().applySessionSummary("session/a", summary("session/a", true)))
    submit.mockRejectedValueOnce(new NetworkRequestError())
    await click("仅本次允许")
    expect(chat().questionCanRetry).toBe(true)
    const oldClick = chat().answerQuestion
    const next = permission("session/a", change === "generation" ? "generation/new" : "generation/a", change === "revision" ? 8 : 7)
    if (next.interaction_kind === "permission") next.permission_request.allowed_decisions = ["deny_once"]
    getPending.mockResolvedValue(next)
    await settleChat(async () => {
      await vi.advanceTimersByTimeAsync(1)
      appStore.getState().applySessionSummary("session/a", summary("session/a", true))
    })
    expect(chat().pendingQuestion).toEqual(next)
    expect(chat().questionCanRetry).toBe(false)
    expect(button("仅本次允许")).toBeUndefined()
    expect(button("仅本次拒绝")?.disabled).toBe(false)
    await settleChat(async () => { await oldClick("allow_once"); await chat().retryQuestion() })
    expect(submit).toHaveBeenCalledTimes(1)
    expectNoExecution()
  })

  it("keeps the exact uncertain retry across same-question recovery and canonical absence", async () => {
    getPending.mockResolvedValue(permission())
    await mount("session/a")
    submit.mockRejectedValueOnce(new NetworkRequestError())
    await click("仅本次允许")
    const submitted = submit.mock.calls[0]
    await settleChat(async () => recover())
    expect(chat().questionCanRetry).toBe(true)
    expect(button("仅本次允许")?.disabled).toBe(true)
    expect(button("仅本次拒绝")?.disabled).toBe(true)
    getPending.mockResolvedValue(absent)
    await settleChat(async () => appStore.getState().clearPendingQuestion("session/a"))
    expect(pendingCard()).not.toBeNull()
    expect(chat().questionCanRetry).toBe(true)
    await click("仅本次拒绝")
    expect(submit).toHaveBeenCalledTimes(1)
    submit.mockResolvedValueOnce({ replayed: true, autoResumeStatus: "completed", continuationConfirmed: true })
    await click("重试上次提交")
    expect(submit.mock.calls).toEqual([submitted, submitted])
    expect(pendingCard()).toBeNull()
    expectNoExecution()
  })

  it("keeps an in-flight decision fenced when recovered absence arrives before its receipt", async () => {
    getPending.mockResolvedValue(permission())
    await mount("session/a")
    const response = deferred<PermissionDecisionResult>()
    submit.mockReturnValue(response.promise)
    await click("仅本次允许")
    getPending.mockResolvedValue(absent)
    await settleChat(async () => appStore.getState().applySessionSummary("session/a", summary("session/a", false, true)))
    expect(chat().questionSubmitting).toBe(true)
    expect(pendingCard()).not.toBeNull()
    expect(button("仅本次拒绝")?.disabled).toBe(true)
    await settleChat(async () => { response.resolve({ replayed: false, autoResumeStatus: "completed", continuationConfirmed: true }); await response.promise })
    expect(pendingCard()).toBeNull()
    expect(chat().questionSubmitting).toBe(false)
    expect(submit).toHaveBeenCalledTimes(1)
    expectNoExecution()
  })

  it("does not reopen a recorded decision when recovery reports the same request", async () => {
    getPending.mockResolvedValue(permission())
    await mount("session/a")
    submit.mockResolvedValue({ replayed: false, continuationConfirmed: false })
    await click("仅本次允许")
    await settleChat(async () => recover())
    expect(chat().questionUnavailable).toBe(true)
    expect(chat().questionError).toContain("已记录")
    expect(pendingCard()).toBeNull()
    expect(button("仅本次拒绝")).toBeUndefined()
    expect(approvalCards().map((card) => card.getAttribute("aria-label"))).toEqual(["已记录批准"])
    await settleChat(() => chat().answerQuestion("deny_once"))
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
    await settleChat(async () => recover())
    await click("仅本次拒绝")
    await settleChat(async () => { oldResponse.resolve({ replayed: false, autoResumeStatus: "started", continuationConfirmed: true }); await oldResponse.promise })
    expect(chat().pendingQuestion).toEqual(permission("session/a", "generation/new"))
    expect(chat().questionSubmitting).toBe(true)
    expect(agentClient.subscribeToEvents).not.toHaveBeenCalled()
    getPending.mockResolvedValue(absent)
    await settleChat(async () => { newResponse.resolve({ replayed: false, autoResumeStatus: "completed", continuationConfirmed: true }); await newResponse.promise })
    expect(pendingCard()).toBeNull()
    expect(chat().questionSubmitting).toBe(false)
    expect(submit).toHaveBeenLastCalledWith("session/a", {
      request_id: "call/a", request_generation: "generation/new", expected_policy_revision: 7, decision: "deny_once",
    })
    expectNoExecution()
  })

  it.each(["clear", "terminal"])("closes a displayed approval only after canonical absence on %s", async (signal) => {
    getPending.mockResolvedValue(permission())
    await mount("session/a")
    await settleChat(async () => recover())
    expect(pendingCard()).not.toBeNull()
    getPending.mockResolvedValue(absent)
    await settleChat(async () => {
      if (signal === "clear") appStore.getState().clearPendingQuestion("session/a")
      else appStore.getState().applySessionSummary("session/a", summary("session/a", false, true))
    })
    expect(pendingCard()).toBeNull()
    expect(chat().pendingQuestion).toBeNull()
    expect(submit).not.toHaveBeenCalled()
    expectNoExecution()
  })

  it("never displays the legacy notification when the canonical recovery read has no pending request", async () => {
    await mount("session/a")
    await settleChat(async () => recover())
    expect(getPending).toHaveBeenCalledTimes(2)
    expect(pendingCard()).toBeNull()
    expect(chat().pendingQuestion).toBeNull()
    expect(submit).not.toHaveBeenCalled()
    expectNoExecution()
  })

  it.each(["clear", "terminal"])("canonical absence after %s prevents a late recovery GET from reopening the dialog", async (signal) => {
    await mount("session/a")
    const older = deferred<PendingQuestionResponse>()
    getPending.mockReturnValueOnce(older.promise)
    await settleChat(async () => recover())
    getPending.mockResolvedValue(absent)
    await settleChat(async () => {
      if (signal === "clear") appStore.getState().clearPendingQuestion("session/a")
      else appStore.getState().applySessionSummary("session/a", summary("session/a", false, true))
    })
    await settleChat(async () => { older.resolve(permission()); await older.promise })
    expect(chat().pendingQuestion).toBeNull()
    expect(chat().questionLoading).toBe(false)
    expect(pendingCard()).toBeNull()
    expect(submit).not.toHaveBeenCalled()
    expectNoExecution()
  })

  it("leaves decisions disabled on failed recovery and recovers through explicit refresh", async () => {
    getPending.mockResolvedValue(permission())
    await mount("session/a")
    getPending.mockRejectedValueOnce(new NetworkRequestError())
    await settleChat(async () => recover())
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

describe("Solid approval and clarification presentation", () => {
  const parentId = "session/a"
  const childId = "approval-child"
  const requestId = "child-request-7"
  const childTitle = () => uiText("subagent_approval_request_4321e83b")
  const approve = () => uiText("approve_8cbe697b")
  const deny = () => uiText("deny_136de7a8")
  const request = () => approvalCards().find((card) => card.getAttribute("aria-label") === childTitle())
  const childConflict = () => [...document.querySelectorAll<HTMLElement>("[aria-label]")]
    .find((region) => region.getAttribute("aria-label") === childTitle()
      && region.querySelector('[data-session-execution-blocked="true"]'))

  type Status = SessionExecutionCompatibility["status"]
  function report(status: Status): SessionExecutionCompatibility {
    return {
      session_version: status === "conflict" ? 99 : status === "compatible" ? 1 : null,
      current_session_version: 1, status, history_readable: true, execution_allowed: status !== "conflict",
      conflicts: status === "conflict" ? [{ code: "unsupported_session_version", message: "Unsupported version" }] : [],
    }
  }

  async function presentChild(parentStatus: Status, childStatus: Status | null) {
    let childReport = childStatus
    vi.spyOn(agentClient, "getSession").mockImplementation(async (id) => {
      const status = id === childId ? childReport : parentStatus
      return { session: { ...summary(id), ...(status ? { execution_compatibility: report(status) } : {}) } }
    })
    const decide = vi.spyOn(agentClient, "respondToChildApproval").mockResolvedValue({ delivered: true })
    appStore.getState().markForceSubscribe(parentId)
    await mount(parentId)
    const notify = vi.mocked(agentClient.subscribeToEvents).mock.calls[0]?.[1].onChildApprovalRequested
    if (!notify) throw new Error("Expected Child request listener")
    await settleChat(() => notify(childId, requestId, { toolName: "Write", permission: "write" }))
    return { decide, allow: () => { childReport = "compatible" } }
  }

  it.each(["compatible", "legacy_compatible", null] as const)("keeps %s Child approval actionable when only its parent conflicts", async (status) => {
    const { decide } = await presentChild("conflict", status)
    expect(request()).toBeDefined()
    expect(chat().executionCompatibility.blocked).toBe(true)
    expect(decide).not.toHaveBeenCalled()
    await click(approve())
    expect(decide).toHaveBeenCalledExactlyOnceWith(childId, requestId, true)
    expectNoExecution()
  })

  it("keeps the genuine parent question available while only the Child conflicts", async () => {
    vi.spyOn(window, "scrollTo").mockImplementation(() => {})
    getPending.mockResolvedValue({
      has_pending_question: true, interaction_kind: "clarification", question: "Parent still needs Human input",
      options: ["main answer"], allow_custom: false, tool_call_id: "parent-question",
    })
    const answer = vi.spyOn(apiClient, "post").mockResolvedValue({ success: true, auto_resume_status: "completed" })
    const { decide } = await presentChild("compatible", "conflict")
    expect(request()).toBeUndefined()
    expect(childConflict()).toBeDefined()
    expect(chat().executionCompatibility.blocked).toBe(false)
    expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Parent still needs Human input")
    expect(decide).not.toHaveBeenCalled()
    expect(answer).not.toHaveBeenCalled()
    getPending.mockResolvedValue(absent)
    await click("main answer")
    expect(answer).toHaveBeenCalledExactlyOnceWith("respond/session%2Fa", {
      response: "main answer", expected_tool_call_id: "parent-question",
    })
    expect(decide).not.toHaveBeenCalled()
    expectNoExecution()
  })

  it("disables a submitting Child approval and shows an unconfirmed delivery error", async () => {
    const { decide } = await presentChild("compatible", "compatible")
    const pending = deferred<ChildApprovalResponse>()
    decide.mockReturnValueOnce(pending.promise)
    await click(approve())
    expect(button(approve())?.disabled).toBe(true)
    expect(button(deny())?.disabled).toBe(true)
    await click(deny())
    expect(decide).toHaveBeenCalledExactlyOnceWith(childId, requestId, true)
    await settleChat(() => pending.reject(new NetworkRequestError()))
    expect(request()?.querySelector('[role="alert"]')?.textContent).toContain(
      uiText("submission_is_unconfirmed_refresh_or_retry_the_last_sub_f3127c94"),
    )
    expect(button(approve())?.disabled).toBe(false)
    expect(decide).toHaveBeenCalledTimes(1)
    expectNoExecution()
  })

  it("blocks only the Child's explicit conflict and restores its card after canonical recovery", async () => {
    const { decide, allow } = await presentChild("compatible", "conflict")
    expect(request()).toBeUndefined()
    expect(childConflict()).toBeDefined()
    expect(chat().executionCompatibility.blocked).toBe(false)
    expect(decide).not.toHaveBeenCalled()
    allow()
    const refresh = childConflict()?.querySelector("button")
    expect(refresh).toBeInstanceOf(HTMLButtonElement)
    await settleChat(() => refresh?.click())
    expect(request()).toBeDefined()
    expect(decide).not.toHaveBeenCalled()
    await click(deny())
    expect(decide).toHaveBeenCalledExactlyOnceWith(childId, requestId, false)
    expectNoExecution()
  })

  it("shows an unreadable request with a working refresh control outside the dialog", async () => {
    getPending.mockRejectedValueOnce(new NetworkRequestError())
    await mount(parentId)
    const alert = document.querySelector('[role="alert"]')
    expect(alert?.textContent).toContain("无法读取确认请求")
    const refresh = alert?.querySelector("button")
    expect(refresh?.textContent).toBe("刷新请求")
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    expect(pendingCard()).toBeNull()
    getPending.mockClear().mockResolvedValue(permission())
    await settleChat(() => refresh?.click())
    expect(getPending).toHaveBeenCalledExactlyOnceWith(parentId)
    expect(pendingCard()).not.toBeNull()
    expect(submit).not.toHaveBeenCalled()
    expectNoExecution()
  })
})
