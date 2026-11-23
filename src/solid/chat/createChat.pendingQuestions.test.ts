import { createRoot, createSignal } from "solid-js"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { apiClient } from "@services/api"
import { ApiError, NetworkRequestError } from "@services/api/errors"
import { agentClient, type AgentEvent, type AgentEventHandlers, type PermissionDecisionResult,
  type SessionSummary } from "@services/chat/AgentService"
import { clearSessionCompatibilityObservations } from "@services/chat/sessionExecutionCompatibility"
import { appStore } from "@shared/store/appStore/state"
import { sessionSummaryToChatItem } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import { resetCompletedAnswerHandoffsForTest } from "@/lib/completedAnswerHandoffRegistry"
import { createChat } from "./createChat"
import { settleChat } from "./chatInteractionTestHarness"

const sessionA = "session/a"
const sessionB = "session/b"
const at = "2026-10-06T10:00:00Z"
const disposers = new Set<() => void>()

function deferred<T>() {
  let resolve!: (value: T) => void
  let reject!: (reason: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

function summary(id: string): SessionSummary {
  return { id, kind: "root", title: id, title_version: 0, pinned: false, root_session_id: id,
    spawn_depth: 0, model: "test-model", created_at: at, updated_at: at, last_activity_at: at,
    message_count: 0, has_attachments: false, is_running: false }
}

function markRunning(id: string) {
  appStore.setState((state) => ({
    chats: state.chats.map((chat) => chat.id === id ? { ...chat, isRunning: true } : chat),
  }))
}

async function mountPane(initialSession: string) {
  const pane = createRoot((dispose) => {
    disposers.add(dispose)
    const [selected, setSelected] = createSignal(initialSession)
    return { chat: createChat(selected), rebind: (id: string) => settleChat(() => setSelected(id)) }
  })
  await settleChat()
  return pane
}

const getPending = () => vi.mocked(agentClient.getPendingQuestion)
const submit = () => vi.mocked(agentClient.submitPermissionDecision)
const subscribe = () => vi.mocked(agentClient.subscribeToEvents)
const history = () => vi.mocked(appStore.getState().loadChatHistory)
const post = () => vi.mocked(apiClient.post)

beforeEach(() => {
  resetCompletedAnswerHandoffsForTest()
  clearSessionCompatibilityObservations()
  appStore.setState({ ...appStore.getInitialState(),
    chats: [sessionSummaryToChatItem(summary(sessionA)), sessionSummaryToChatItem(summary(sessionB))],
    loadSubagentSessions: vi.fn(async () => {}),
    loadChatHistory: vi.fn(async () => {}),
    refreshChatsNow: vi.fn(async () => {}),
  }, true)
  vi.spyOn(agentClient, "getPendingQuestion").mockResolvedValue(noQuestion)
  vi.spyOn(agentClient, "submitPermissionDecision").mockRejectedValue(new Error("No permission receipt fixture"))
  vi.spyOn(agentClient, "getSession").mockImplementation(async (id) => ({ session: summary(id) }))
  vi.spyOn(agentClient, "getRunningSessions").mockResolvedValue({ sessions: [] })
  vi.spyOn(agentClient, "execute").mockRejectedValue(new Error("Question handling must not execute"))
  vi.spyOn(agentClient, "sendMessage").mockRejectedValue(new Error("Question handling must not send"))
  vi.spyOn(agentClient, "subscribeToEvents").mockImplementation((_id, _handlers, controller) =>
    new Promise<void>((resolve) => controller?.signal.addEventListener("abort", () => resolve(), { once: true })))
  vi.spyOn(apiClient, "post").mockRejectedValue(new Error("No clarification receipt fixture"))
})

afterEach(async () => {
  for (const dispose of disposers) dispose()
  disposers.clear()
  await settleChat()
  const sends = vi.mocked(agentClient.sendMessage).mock.calls.length
  vi.restoreAllMocks()
  expect(sends).toBe(0)
})

const permissionQuestion = (generation = "generation/a", revision = 7, callId = "call/a", sessionId = sessionA) => ({
  has_pending_question: true as const, interaction_kind: "permission" as const,
  question: "Allow this followup?", options: ["Approve", "Deny"], allow_custom: false,
  tool_call_id: callId, permission_request: {
    session_id: sessionId, request_id: callId, request_generation: generation,
    policy_revision: revision, tool_name: "session_control", permission_type: "execute_command",
    resource: "root-a", operation_summary: "Follow up with the existing Root",
    allowed_decisions: ["allow_once", "deny_once"],
  },
})
const clarificationQuestion = (callId = "clarification/a") => ({
  has_pending_question: true as const, interaction_kind: "clarification" as const,
  question: "Which branch?", options: ["main", "dev"], allow_custom: true,
  tool_call_id: callId, permission_request: null,
})
const noQuestion = { has_pending_question: false as const }
const confirmedDecision = (status?: string, replayed = false): PermissionDecisionResult => ({
  replayed, autoResumeStatus: status, continuationConfirmed: true,
})
const expectedDecision = { request_id: "call/a", request_generation: "generation/a",
  decision: "allow_once", expected_policy_revision: 7 }
const legacyNotification: AgentEvent = { type: "need_clarification" }

async function mountPermission() {
  getPending().mockResolvedValue(permissionQuestion())
  return mountPane(sessionA)
}

async function mountObservedSession() {
  markRunning(sessionA)
  appStore.getState().markForceSubscribe(sessionA)
  const stream = deferred<void>()
  subscribe().mockImplementation((_id, _handlers, controller) => {
    controller?.signal.addEventListener("abort", () => stream.resolve(), { once: true })
    return stream.promise
  })
  const pane = await mountPane(sessionA)
  const subscription = subscribe().mock.calls[0]
  expect(subscription).toBeDefined()
  return { pane, stream, handlers: subscription[1] as Required<AgentEventHandlers> }
}

describe("Solid typed permission approval", () => {
  it("submits once synchronously and keeps the question until its matching acknowledgement", async () => {
    const response = deferred<PermissionDecisionResult>()
    submit().mockReturnValue(response.promise)
    const pane = await mountPermission()
    const answering = pane.chat.answerQuestion("allow_once")
    void pane.chat.answerQuestion("allow_once")
    void pane.chat.answerQuestion("deny_once")
    expect(submit()).toHaveBeenCalledExactlyOnceWith("session/a", expectedDecision)
    await settleChat()
    expect(post()).not.toHaveBeenCalled()
    expect(pane.chat.pendingQuestion).toEqual(permissionQuestion())
    expect(pane.chat.questionSubmitting).toBe(true)
    getPending().mockResolvedValue(noQuestion)
    await settleChat(async () => { response.resolve(confirmedDecision("completed")); await answering })
    expect(pane.chat.pendingQuestion).toBeNull()
    expect(pane.chat.questionSubmitting).toBe(false)
    expect(pane.chat.questionError).toBeNull()
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(subscribe()).not.toHaveBeenCalled()
  })

  it("uses the exact typed DenyOnce and rejects text and remembered choices", async () => {
    const pane = await mountPermission()
    await settleChat(async () => {
      await pane.chat.answerQuestion("Approve")
      await pane.chat.answerQuestion("allow_session")
    })
    expect(submit()).not.toHaveBeenCalled()
    submit().mockResolvedValue(confirmedDecision("completed"))
    getPending().mockResolvedValue(noQuestion)
    await settleChat(async () => { await pane.chat.answerQuestion("deny_once") })
    expect(submit()).toHaveBeenCalledExactlyOnceWith("session/a", {
      ...expectedDecision, decision: "deny_once",
    })
    expect(post()).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
  })

  it.each(["started", "already_running"])("observes a confirmed %s continuation without executing again", async (status) => {
    const pane = await mountPermission()
    markRunning(sessionA)
    submit().mockResolvedValue(confirmedDecision(status))
    getPending().mockResolvedValue(noQuestion)
    await settleChat(async () => { await pane.chat.answerQuestion("allow_once") })
    expect(subscribe()).toHaveBeenCalledTimes(1)
    expect(subscribe().mock.calls[0][0]).toBe("session/a")
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(pane.chat.pendingQuestion).toBeNull()
  })

  it("keeps the existing subscription when the server continues the original session", async () => {
    getPending().mockResolvedValue(permissionQuestion())
    const { pane } = await mountObservedSession()
    const originalController = subscribe().mock.calls[0][2]
    expect(originalController).toBeInstanceOf(AbortController)
    submit().mockResolvedValue(confirmedDecision("started"))
    getPending().mockResolvedValue(noQuestion)
    await settleChat(async () => { await pane.chat.answerQuestion("allow_once") })
    expect(subscribe()).toHaveBeenCalledTimes(1)
    expect(originalController?.signal.aborted).toBe(false)
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(pane.chat.pendingQuestion).toBeNull()
  })

  it("settles a matching replay without inventing a continuation", async () => {
    const pane = await mountPermission()
    submit().mockResolvedValue(confirmedDecision(undefined, true))
    getPending().mockResolvedValue(noQuestion)
    await settleChat(async () => { await pane.chat.answerQuestion("allow_once") })
    expect(pane.chat.pendingQuestion).toBeNull()
    expect(pane.chat.questionError).toBeNull()
    expect(history()).toHaveBeenCalledWith("session/a")
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(subscribe()).not.toHaveBeenCalled()
  })

  it("retains recorded-decision evidence when continuation is malformed, without retry or execute", async () => {
    const pane = await mountPermission()
    submit().mockResolvedValue({ replayed: false, autoResumeStatus: "started", continuationConfirmed: false })
    getPending().mockResolvedValue(noQuestion)
    await settleChat(async () => { await pane.chat.answerQuestion("allow_once") })
    expect(pane.chat.pendingQuestion).toBeNull()
    expect(pane.chat.questionError).toContain("已记录")
    expect(pane.chat.questionCanRetry).toBe(false)
    await settleChat(async () => { await pane.chat.refreshQuestion(); await pane.chat.retryQuestion() })
    expect(pane.chat.questionError).toContain("已记录")
    expect(submit()).toHaveBeenCalledTimes(1)
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(subscribe()).not.toHaveBeenCalled()
  })

  it.each([new NetworkRequestError(), new ApiError("unavailable", 503, "Unavailable"), new Error("mismatched receipt")])(
    "does not treat an empty GET as acknowledgement of an uncertain POST: %s", async (error) => {
      const pane = await mountPermission()
      submit().mockRejectedValue(error)
      getPending().mockResolvedValue(noQuestion)
      await settleChat(async () => { await pane.chat.answerQuestion("allow_once") })
      expect(pane.chat.pendingQuestion).toEqual(permissionQuestion())
      expect(pane.chat.questionError).toContain("尚未确认")
      expect(pane.chat.questionCanRetry).toBe(true)
      await settleChat(async () => { await pane.chat.answerQuestion("deny_once"); await pane.chat.refreshQuestion() })
      expect(submit()).toHaveBeenCalledTimes(1)
      expect(pane.chat.questionCanRetry).toBe(true)
      expect(post()).not.toHaveBeenCalled()
      expect(agentClient.execute).not.toHaveBeenCalled()
      expect(subscribe()).not.toHaveBeenCalled()
    },
  )

  it("replays only the identical user-selected tuple after a lost reply", async () => {
    const pane = await mountPermission()
    submit().mockRejectedValueOnce(new NetworkRequestError())
      .mockResolvedValueOnce(confirmedDecision(undefined, true))
    getPending().mockResolvedValue(noQuestion)
    await settleChat(async () => { await pane.chat.answerQuestion("allow_once") })
    expect(submit()).toHaveBeenCalledTimes(1)
    await settleChat(async () => { await pane.chat.retryQuestion() })
    expect(submit().mock.calls).toEqual([
      ["session/a", expectedDecision], ["session/a", expectedDecision],
    ])
    expect(pane.chat.pendingQuestion).toBeNull()
    expect(pane.chat.questionError).toBeNull()
    expect(pane.chat.questionCanRetry).toBe(false)
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(subscribe()).not.toHaveBeenCalled()
  })

  it.each([403, 409])("refreshes a %s into the narrowed policy and requires a fresh explicit decision", async (status) => {
    const pane = await mountPermission()
    const changed = permissionQuestion("generation/a", 8)
    changed.permission_request.allowed_decisions = ["deny_once", "deny_session"]
    getPending().mockResolvedValue(changed)
    submit().mockRejectedValueOnce(new ApiError("changed", status, "Rejected"))
    await settleChat(async () => { await pane.chat.answerQuestion("allow_once") })
    expect(pane.chat.pendingQuestion).toEqual(changed)
    expect(pane.chat.questionError).toContain("已变化")
    expect(pane.chat.questionCanRetry).toBe(false)
    await settleChat(async () => { await pane.chat.retryQuestion(); await pane.chat.answerQuestion("allow_once") })
    expect(submit()).toHaveBeenCalledTimes(1)
    submit().mockResolvedValueOnce(confirmedDecision("completed"))
    getPending().mockResolvedValue(noQuestion)
    await settleChat(async () => { await pane.chat.answerQuestion("deny_once") })
    expect(submit()).toHaveBeenLastCalledWith("session/a", {
      ...expectedDecision, decision: "deny_once", expected_policy_revision: 8,
    })
    expect(agentClient.execute).not.toHaveBeenCalled()
  })

  it.each([["generation/b", 7], ["generation/a", 8]] as const)("does not carry an uncertain approval onto %s revision %s", async (generation, revision) => {
    const pane = await mountPermission()
    submit().mockRejectedValueOnce(new NetworkRequestError())
    getPending().mockResolvedValue(noQuestion)
    await settleChat(async () => { await pane.chat.answerQuestion("allow_once") })
    const next = permissionQuestion(generation, revision)
    getPending().mockResolvedValue(next)
    await settleChat(async () => { await pane.chat.refreshQuestion(); await pane.chat.retryQuestion() })
    expect(pane.chat.pendingQuestion).toEqual(next)
    expect(pane.chat.questionCanRetry).toBe(false)
    expect(submit()).toHaveBeenCalledTimes(1)
  })

  it.each([["generation/b", 7], ["generation/a", 8]] as const)("rejects a stale visible click after refreshing to %s revision %s", async (generation, revision) => {
    const pane = await mountPermission()
    const oldClick = pane.chat.answerQuestion
    const next = permissionQuestion(generation, revision)
    getPending().mockResolvedValue(next)
    await settleChat(async () => { await pane.chat.refreshQuestion() })
    await settleChat(async () => { await oldClick("allow_once") })
    expect(submit()).not.toHaveBeenCalled()
    expect(pane.chat.pendingQuestion).toEqual(next)
    submit().mockResolvedValue(confirmedDecision("completed"))
    getPending().mockResolvedValue(noQuestion)
    await settleChat(async () => { await pane.chat.answerQuestion("allow_once") })
    expect(submit()).toHaveBeenCalledExactlyOnceWith("session/a", {
      ...expectedDecision, request_generation: generation, expected_policy_revision: revision,
    })
  })
})

describe("Solid pending question ownership", () => {
  it("discards an earlier GET after a newer canonical question is displayed", async () => {
    const pane = await mountPermission()
    const older = deferred<typeof noQuestion>()
    const next = permissionQuestion("generation/b")
    getPending().mockReturnValueOnce(older.promise).mockResolvedValueOnce(next)
    const firstRead = pane.chat.refreshQuestion()
    await settleChat(async () => { await pane.chat.refreshQuestion() })
    await settleChat(async () => { older.resolve(noQuestion); await firstRead })
    expect(pane.chat.pendingQuestion).toEqual(next)
    expect(pane.chat.questionLoading).toBe(false)
    expect(submit()).not.toHaveBeenCalled()
  })

  it("discards a previous visit's GET after A to B to A navigation", async () => {
    const older = deferred<ReturnType<typeof permissionQuestion>>()
    const next = permissionQuestion("generation/b")
    getPending().mockReturnValueOnce(older.promise)
      .mockResolvedValueOnce(permissionQuestion("generation/b", 7, "call/b", "session/b"))
      .mockResolvedValueOnce(next)
    const pane = await mountPane(sessionA)
    await pane.rebind(sessionB)
    await pane.rebind(sessionA)
    await settleChat(async () => { older.resolve(permissionQuestion()); await older.promise })
    expect(pane.chat.pendingQuestion).toEqual(next)
    expect(pane.chat.questionLoading).toBe(false)
    expect(getPending()).toHaveBeenCalledTimes(3)
  })

  it("discards old submission and click callbacks after A to B to A, even with the same question identity", async () => {
    const response = deferred<PermissionDecisionResult>()
    submit().mockReturnValue(response.promise)
    const pane = await mountPermission()
    const oldClick = pane.chat.answerQuestion
    const submission = oldClick("allow_once")
    getPending().mockResolvedValueOnce(permissionQuestion("generation/b", 7, "call/b", "session/b"))
      .mockResolvedValueOnce(permissionQuestion())
    await pane.rebind(sessionB)
    await pane.rebind(sessionA)
    await settleChat(async () => { response.resolve(confirmedDecision("started")); await submission; await oldClick("deny_once") })
    expect(pane.chat.pendingQuestion).toEqual(permissionQuestion())
    expect(pane.chat.questionSubmitting).toBe(false)
    expect(submit()).toHaveBeenCalledTimes(1)
    expect(getPending()).toHaveBeenCalledTimes(3)
    expect(history()).not.toHaveBeenCalled()
    expect(subscribe()).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
  })

  it.each([["generation/b", 7], ["generation/a", 8]] as const)("an old POST cannot settle a new submission for %s revision %s", async (generation, revision) => {
    const oldResponse = deferred<PermissionDecisionResult>()
    const newResponse = deferred<PermissionDecisionResult>()
    submit().mockReturnValueOnce(oldResponse.promise).mockReturnValueOnce(newResponse.promise)
    const pane = await mountPermission()
    const oldSubmission = pane.chat.answerQuestion("allow_once")
    const next = permissionQuestion(generation, revision)
    getPending().mockResolvedValue(next)
    await settleChat(async () => { await pane.chat.refreshQuestion() })
    const newSubmission = pane.chat.answerQuestion("deny_once")
    await settleChat(async () => { oldResponse.resolve(confirmedDecision("started")); await oldSubmission })
    expect(pane.chat.pendingQuestion).toEqual(next)
    expect(pane.chat.questionSubmitting).toBe(true)
    expect(getPending()).toHaveBeenCalledTimes(2)
    expect(subscribe()).not.toHaveBeenCalled()
    getPending().mockResolvedValue(noQuestion)
    await settleChat(async () => { newResponse.resolve(confirmedDecision("completed")); await newSubmission })
    expect(pane.chat.pendingQuestion).toBeNull()
    expect(pane.chat.questionSubmitting).toBe(false)
    expect(submit()).toHaveBeenLastCalledWith("session/a", {
      ...expectedDecision, request_generation: generation, expected_policy_revision: revision, decision: "deny_once",
    })
  })

  it("keeps an unavailable initial read visible until an explicit refresh confirms the question", async () => {
    getPending().mockRejectedValueOnce(new NetworkRequestError())
    const pane = await mountPane(sessionA)
    expect(pane.chat.pendingQuestion).toBeNull()
    expect(pane.chat.questionUnavailable).toBe(true)
    expect(pane.chat.questionError).toContain("无法读取")
    getPending().mockResolvedValue(permissionQuestion())
    await settleChat(async () => { await pane.chat.refreshQuestion() })
    expect(pane.chat.pendingQuestion).toEqual(permissionQuestion())
    expect(pane.chat.questionUnavailable).toBe(false)
    expect(pane.chat.questionError).toBeNull()
    expect(submit()).not.toHaveBeenCalled()
  })

  it("does not offer a different decision if a matching receipt is followed by the same pending question", async () => {
    const pane = await mountPermission()
    submit().mockResolvedValue({ replayed: false, continuationConfirmed: false })
    await settleChat(async () => { await pane.chat.answerQuestion("allow_once") })
    expect(pane.chat.pendingQuestion).toEqual(permissionQuestion())
    expect(pane.chat.questionUnavailable).toBe(true)
    expect(pane.chat.questionError).toContain("已记录")
    await settleChat(async () => { await pane.chat.answerQuestion("deny_once"); await pane.chat.retryQuestion() })
    expect(submit()).toHaveBeenCalledTimes(1)
    expect(agentClient.execute).not.toHaveBeenCalled()
  })
})

describe("Solid permission wait and ordinary clarification", () => {
  it("rehydrates canonical permission after Complete without using notification display text", async () => {
    const { pane, stream, handlers } = await mountObservedSession()
    const pending = deferred<ReturnType<typeof permissionQuestion>>()
    getPending().mockReturnValueOnce(pending.promise)
    await settleChat(async () => {
      handlers.onNeedClarification({ ...legacyNotification, question: "untrusted old text", options: ["Approve"], allow_custom: true })
      handlers.onComplete(undefined)
      stream.resolve()
      await stream.promise
    })
    await settleChat(async () => { pending.resolve(permissionQuestion()); await pending.promise })
    expect(pane.chat.pendingQuestion).toEqual(permissionQuestion())
    expect(pane.chat.sendFailure).toBeNull()
    expect(submit()).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
  })

  it("settles a stream's permission wait without reporting interrupted generation", async () => {
    const { pane, stream, handlers } = await mountObservedSession()
    getPending().mockResolvedValueOnce(permissionQuestion())
    await settleChat(async () => { handlers.onNeedClarification(legacyNotification); stream.resolve(); await stream.promise })
    await settleChat()
    expect(pane.chat.pendingQuestion).toEqual(permissionQuestion())
    expect(pane.chat.sendFailure).toBeNull()
    expect(pane.chat.streaming).toBeNull()
    expect(agentClient.execute).not.toHaveBeenCalled()
  })

  it("does not turn a superseded pending read into absence or a generation failure", async () => {
    const { pane, stream, handlers } = await mountObservedSession()
    const older = deferred<typeof noQuestion>()
    getPending().mockReturnValueOnce(older.promise).mockResolvedValueOnce(permissionQuestion())
    handlers.onNeedClarification(legacyNotification)
    await settleChat(async () => { await pane.chat.refreshQuestion() })
    await settleChat(async () => { older.resolve(noQuestion); stream.resolve(); await stream.promise })
    await settleChat()
    expect(pane.chat.pendingQuestion).toEqual(permissionQuestion())
    expect(pane.chat.sendFailure).toBeNull()
    expect(getPending()).toHaveBeenCalledTimes(3)
  })

  it("follows an event with one additional read only when publication is absent", async () => {
    const { pane, stream, handlers } = await mountObservedSession()
    getPending().mockResolvedValueOnce(noQuestion).mockResolvedValueOnce(permissionQuestion())
    await settleChat(async () => { handlers.onNeedClarification(legacyNotification); stream.resolve(); await stream.promise })
    await settleChat()
    expect(getPending()).toHaveBeenCalledTimes(3)
    expect(pane.chat.pendingQuestion).toEqual(permissionQuestion())
    expect(pane.chat.sendFailure).toBeNull()
  })

  it("keeps a real stream error visible even when a permission is pending", async () => {
    getPending().mockResolvedValue(permissionQuestion())
    const { pane, stream, handlers } = await mountObservedSession()
    await settleChat(async () => { handlers.onError("generation failed"); stream.resolve(); await stream.promise })
    expect(pane.chat.sendFailure?.kind).toBe("generation-failed")
    expect(pane.chat.sendFailure?.message).toBe("generation failed")
    expect(pane.chat.pendingQuestion).toEqual(permissionQuestion())
  })

  it("submits ordinary clarification text with its expected call ID and waits for acknowledgement", async () => {
    const question = clarificationQuestion()
    getPending().mockResolvedValue(question)
    const response = deferred<{ success: boolean; auto_resume_status: string }>()
    post().mockReturnValue(response.promise)
    const pane = await mountPane(sessionA)
    const answering = pane.chat.answerQuestion("release/next")
    expect(post()).toHaveBeenCalledExactlyOnceWith("respond/session%2Fa", {
      response: "release/next", expected_tool_call_id: "clarification/a",
    })
    expect(pane.chat.pendingQuestion).toEqual(question)
    getPending().mockResolvedValue(noQuestion)
    await settleChat(async () => { response.resolve({ success: true, auto_resume_status: "completed" }); await answering })
    expect(pane.chat.pendingQuestion).toBeNull()
    expect(submit()).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(subscribe()).not.toHaveBeenCalled()
  })

  it("preserves a failed clarification and does not observe an unacknowledged answer", async () => {
    const question = { ...clarificationQuestion(), allow_custom: false }
    getPending().mockResolvedValue(question)
    post().mockRejectedValueOnce(new NetworkRequestError())
    const pane = await mountPane(sessionA)
    await settleChat(async () => { await pane.chat.answerQuestion("not offered") })
    expect(post()).not.toHaveBeenCalled()
    await settleChat(async () => { await pane.chat.answerQuestion("dev") })
    expect(pane.chat.pendingQuestion).toEqual(question)
    expect(pane.chat.questionError).toContain("尚未确认")
    expect(post()).toHaveBeenCalledExactlyOnceWith("respond/session%2Fa", {
      response: "dev", expected_tool_call_id: "clarification/a",
    })
    expect(submit()).not.toHaveBeenCalled()
    expect(subscribe()).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
  })
})

describe("Solid pending reads during permission submission", () => {
  it("retains the submitted question when an event reads absence before the matching receipt arrives", async () => {
    getPending().mockResolvedValue(permissionQuestion())
    const { pane, handlers } = await mountObservedSession()
    const response = deferred<PermissionDecisionResult>()
    submit().mockReturnValue(response.promise)
    const submission = pane.chat.answerQuestion("allow_once")
    getPending().mockResolvedValue(noQuestion)
    handlers.onNeedClarification(legacyNotification)
    await settleChat()
    expect(pane.chat.pendingQuestion).toEqual(permissionQuestion())
    expect(pane.chat.questionSubmitting).toBe(true)
    expect(pane.chat.questionError).toBeNull()
    await settleChat(async () => { response.resolve(confirmedDecision("completed")); await submission })
    expect(pane.chat.pendingQuestion).toBeNull()
    expect(pane.chat.questionSubmitting).toBe(false)
    expect(pane.chat.questionError).toBeNull()
    expect(history()).toHaveBeenCalledWith("session/a")
    expect(submit()).toHaveBeenCalledExactlyOnceWith("session/a", expectedDecision)
    expect(subscribe()).toHaveBeenCalledTimes(1)
    expect(agentClient.execute).not.toHaveBeenCalled()
  })

  it.each([new NetworkRequestError(), new ApiError("unavailable", 503, "Unavailable")])(
    "retains exact retry after an event reads absence before the POST rejects: %s", async (error) => {
      getPending().mockResolvedValue(permissionQuestion())
      const { pane, handlers } = await mountObservedSession()
      const response = deferred<PermissionDecisionResult>()
      submit().mockReturnValueOnce(response.promise)
      const submission = pane.chat.answerQuestion("allow_once")
      getPending().mockResolvedValue(noQuestion)
      handlers.onNeedClarification(legacyNotification)
      await settleChat()
      expect(pane.chat.pendingQuestion).toEqual(permissionQuestion())
      expect(pane.chat.questionSubmitting).toBe(true)
      await settleChat(async () => { response.reject(error); await submission })
      expect(pane.chat.pendingQuestion).toEqual(permissionQuestion())
      expect(pane.chat.questionSubmitting).toBe(false)
      expect(pane.chat.questionError).toContain("尚未确认")
      expect(pane.chat.questionCanRetry).toBe(true)
      submit().mockResolvedValueOnce(confirmedDecision(undefined, true))
      await settleChat(async () => { await pane.chat.retryQuestion() })
      expect(submit().mock.calls).toEqual([
        ["session/a", expectedDecision], ["session/a", expectedDecision],
      ])
      expect(pane.chat.pendingQuestion).toBeNull()
      expect(pane.chat.questionCanRetry).toBe(false)
      expect(pane.chat.questionError).toBeNull()
      expect(subscribe()).toHaveBeenCalledTimes(1)
      expect(agentClient.execute).not.toHaveBeenCalled()
    },
  )

  it.each([403, 409])("allows canonical absence to clear a definite %s rejection", async (status) => {
    getPending().mockResolvedValue(permissionQuestion())
    const { pane, handlers } = await mountObservedSession()
    const response = deferred<PermissionDecisionResult>()
    submit().mockReturnValueOnce(response.promise)
    const submission = pane.chat.answerQuestion("allow_once")
    getPending().mockResolvedValue(noQuestion)
    handlers.onNeedClarification(legacyNotification)
    await settleChat()
    await settleChat(async () => { response.reject(new ApiError("rejected", status, "Rejected")); await submission })
    expect(pane.chat.pendingQuestion).toBeNull()
    expect(pane.chat.questionCanRetry).toBe(false)
    expect(pane.chat.questionSubmitting).toBe(false)
    expect(pane.chat.questionError).toContain("已变化")
    expect(submit()).toHaveBeenCalledTimes(1)
    expect(subscribe()).toHaveBeenCalledTimes(1)
    expect(agentClient.execute).not.toHaveBeenCalled()
  })
})
