import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { useAppStore } from "@shared/store/appStore"
import { mapHistoryMessagesToUi, sessionSummaryToChatItem } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import { agentClient, type SessionSummary } from "@services/chat/AgentService"
import { apiClient } from "@services/api"
import { NetworkRequestError } from "@services/api/errors"
import { QuestionDialog } from "@/components/chat/Dialogs"
import { currentPermission, exhaustedHistory, exhaustedMarker, legacyProgressQuestion,
  legacyQuestionId, progressAt, progressSessionId as sid, unfinishedSummary } from "@/test/fixtures/observationProgress"
import { useChat } from "./useChat"

vi.mock("@shared/store/appStore", async (original) => ({
  ...await original<typeof import("@shared/store/appStore")>(), initializeStore: vi.fn(async () => {}),
}))
let root: Root
let chat: ReturnType<typeof useChat>
const summary = (): SessionSummary => ({
  id: sid, kind: "root", title: "Progress consumer", title_version: 1, pinned: false, root_session_id: sid,
  spawn_depth: 0, model: "fixture-model", created_at: progressAt, updated_at: progressAt,
  last_activity_at: progressAt, message_count: 0, has_attachments: false,
  is_running: false, last_run_status: "completed", has_pending_question: false,
})
function Pane() {
  chat = useChat(sid)
  return chat.pendingQuestion ? <QuestionDialog q={chat.pendingQuestion}
    onAnswer={(value) => { void chat.answerQuestion(value) }} loading={chat.questionLoading}
    submitting={chat.questionSubmitting} unavailable={chat.questionUnavailable}
    error={chat.questionError} canRetry={chat.questionCanRetry}
    onRefresh={() => { void chat.refreshQuestion() }} onRetry={() => { void chat.retryQuestion() }} /> : null
}
const mount = () => act(async () => root.render(<Pane />))
const noWrites = () => {
  expect(apiClient.post).not.toHaveBeenCalled()
  expect(agentClient.submitPermissionDecision).not.toHaveBeenCalled()
  expect(agentClient.sendMessage).not.toHaveBeenCalled()
  expect(agentClient.execute).not.toHaveBeenCalled()
}
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  useAppStore.setState({ ...useAppStore.getInitialState(), currentSessionId: sid,
    chats: [sessionSummaryToChatItem(summary())], loadSubagentSessions: vi.fn(async () => {}),
    loadChatHistory: vi.fn(async () => {}), refreshChatsNow: vi.fn(async () => {}),
  }, true)
  vi.spyOn(agentClient, "getPendingQuestion").mockResolvedValue({ has_pending_question: false })
  vi.spyOn(agentClient, "submitPermissionDecision").mockResolvedValue({ replayed: false, autoResumeStatus: "completed", continuationConfirmed: true })
  vi.spyOn(agentClient, "sendMessage").mockRejectedValue(new Error("No chat admission in consumer fixtures"))
  vi.spyOn(agentClient, "execute").mockRejectedValue(new Error("No model or tool dispatch in consumer fixtures"))
  vi.spyOn(agentClient, "subscribeToEvents").mockImplementation(() => new Promise(() => {}))
  vi.spyOn(apiClient, "post").mockResolvedValue({ success: true, auto_resume_status: "completed" })
  root = createRoot(document.body.appendChild(document.createElement("div")))
})
afterEach(() => {
  act(() => root.unmount())
  document.body.replaceChildren()
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe("#2016 progress feedback consumer contract", () => {
  it("renders an ordinary honest runtime Assistant tail and preserves each actual call/result pair", () => {
    const messages = mapHistoryMessagesToUi(sid, exhaustedHistory())
    expect(messages.at(-1)).toMatchObject({ id: "runtime-unfinished-summary", role: "assistant", type: "text", content: unfinishedSummary })
    const calls = messages.filter((m) => m.role === "assistant" && m.type === "tool_call")
    const results = messages.filter((m) => m.role === "assistant" && m.type === "tool_result")
    expect(calls).toHaveLength(6); expect(results).toHaveLength(6)
    for (let i = 0; i < 6; i++) {
      expect(calls[i]).toMatchObject({ id: `assistant-read-${i}`, toolCalls: [{ toolCallId: `read-${i}` }] })
      expect(results[i]).toMatchObject({ id: `result-read-${i}`, toolCallId: `read-${i}`, result: { result: "Unchanged fixture evidence" } })
    }
    expect(messages.filter((m) => "content" in m && m.content === unfinishedSummary)).toHaveLength(1)
    noWrites()
  })
  it("canonical none stays none across old replay hints and exhaustion metadata without inventing Continue", async () => {
    await mount()
    await act(async () => {
      useAppStore.getState().setPendingQuestion(sid, { question: "stale observation_progress notification",
        options: ["Continue", "Stop"], allowCustom: true, toolCallId: legacyQuestionId })
    })
    const next = { ...summary(), metadata: { "runtime.completion_reason": exhaustedMarker } }
    await act(async () => { useAppStore.getState().applySessionSummary(sid, next) })
    expect(chat.pendingQuestion).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    noWrites()
  })
  it.each(["Continue", "Stop", "Inspect different evidence"])("retains persisted progress %s as one explicit guarded answer", async (answer) => {
    vi.mocked(agentClient.getPendingQuestion).mockResolvedValue(legacyProgressQuestion())
    await mount()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    noWrites()
    vi.mocked(agentClient.getPendingQuestion).mockResolvedValue({ has_pending_question: false })
    await act(async () => { await chat.answerQuestion(answer) })
    expect(apiClient.post).toHaveBeenCalledExactlyOnceWith(`respond/${sid}`, { response: answer, expected_tool_call_id: legacyQuestionId })
    expect(chat.pendingQuestion).toBeNull()
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.submitPermissionDecision).not.toHaveBeenCalled()
  })
  it("keeps a real persisted progress question when its canonical refresh fails", async () => {
    vi.mocked(agentClient.getPendingQuestion).mockResolvedValue(legacyProgressQuestion())
    await mount()
    vi.mocked(agentClient.getPendingQuestion).mockRejectedValueOnce(new NetworkRequestError())
    await act(async () => { await chat.refreshQuestion() })
    expect(chat.pendingQuestion).toEqual(legacyProgressQuestion())
    expect(chat.questionUnavailable).toBe(true)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await act(async () => { await chat.answerQuestion("Continue") })
    noWrites()
  })
  it("never treats completion metadata or an ordinary Continue label as a current typed approval", async () => {
    vi.mocked(agentClient.getPendingQuestion).mockResolvedValue(currentPermission())
    await mount()
    const next = { ...summary(), metadata: { "runtime.completion_reason": exhaustedMarker } }
    await act(async () => { useAppStore.getState().applySessionSummary(sid, next) })
    expect(chat.pendingQuestion).toEqual(currentPermission())
    expect(document.querySelector('[data-approval-presentation]')).not.toBeNull()
    await act(async () => { await chat.answerQuestion("Continue") })
    noWrites()
    vi.mocked(agentClient.getPendingQuestion).mockResolvedValue({ has_pending_question: false })
    await act(async () => { await chat.answerQuestion("deny_once") })
    expect(agentClient.submitPermissionDecision).toHaveBeenCalledExactlyOnceWith(sid, {
      request_id: "fixture-permission-2", request_generation: "opaque-generation-2", expected_policy_revision: 9, decision: "deny_once",
    })
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
  })
})
