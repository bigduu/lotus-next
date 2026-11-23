import { Show } from "solid-js"
import type { JSX } from "@solidjs/web"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { appStore } from "@shared/store/appStore/state"
import { mapHistoryMessagesToUi, sessionSummaryToChatItem } from "@shared/store/appStore/slices/chatSessionSlice/messageMapping"
import { agentClient, type SessionSummary } from "@services/chat/AgentService"
import { apiClient } from "@services/api"
import { NetworkRequestError } from "@services/api/errors"
import { currentPermission, exhaustedHistory, exhaustedMarker, legacyProgressQuestion,
  legacyQuestionId, progressAt, progressSessionId as sid, unfinishedSummary } from "@/test/fixtures/observationProgress"
import { renderChatPane, settleChat } from "./chatInteractionTestHarness"

vi.mock("@shared/store/appStore/state", async (original) => ({
  ...await original<typeof import("@shared/store/appStore/state")>(), initializeStore: vi.fn(async () => {}),
}))
// The package's uncompiled Kobalte JSX cannot supply its modal context in
// jsdom. The desktop and mobile browser specs use the actual portaled dialog.
vi.mock("../ui/responsive-dialog", () => ({
  ResponsiveDialog: (props: { open: boolean; children: JSX.Element }) =>
    <Show when={props.open}>{props.children}</Show>,
  ResponsiveDialogContent: (props: { children: JSX.Element }) =>
    <section role="dialog" aria-modal="true">{props.children}</section>,
  ResponsiveDialogTitle: (props: { children: JSX.Element }) => <h2>{props.children}</h2>,
  ResponsiveDialogDescription: (props: { children: JSX.Element }) => <p>{props.children}</p>,
}))

let pane: ReturnType<typeof renderChatPane> | undefined
const chat = () => pane!.chat
const summary = (): SessionSummary => ({
  id: sid, kind: "root", title: "Progress consumer", title_version: 1, pinned: false, root_session_id: sid,
  spawn_depth: 0, model: "fixture-model", created_at: progressAt, updated_at: progressAt,
  last_activity_at: progressAt, message_count: 0, has_attachments: false,
  is_running: false, last_run_status: "completed", has_pending_question: false,
})
const mount = () => settleChat(() => { pane = renderChatPane(sid) })
const noWrites = () => {
  expect(apiClient.post).not.toHaveBeenCalled()
  expect(agentClient.submitPermissionDecision).not.toHaveBeenCalled()
  expect(agentClient.sendMessage).not.toHaveBeenCalled()
  expect(agentClient.execute).not.toHaveBeenCalled()
}
beforeEach(() => {
  appStore.setState({ ...appStore.getInitialState(), currentSessionId: sid,
    chats: [sessionSummaryToChatItem(summary())], loadSubagentSessions: vi.fn(async () => {}),
    loadChatHistory: vi.fn(async () => {}), refreshChatsNow: vi.fn(async () => {}),
  }, true)
  vi.spyOn(agentClient, "getPendingQuestion").mockResolvedValue({ has_pending_question: false })
  vi.spyOn(agentClient, "submitPermissionDecision").mockResolvedValue({ replayed: false, autoResumeStatus: "completed", continuationConfirmed: true })
  vi.spyOn(agentClient, "sendMessage").mockRejectedValue(new Error("No chat admission in consumer fixtures"))
  vi.spyOn(agentClient, "execute").mockRejectedValue(new Error("No model or tool dispatch in consumer fixtures"))
  vi.spyOn(agentClient, "subscribeToEvents").mockImplementation(() => new Promise(() => {}))
  vi.spyOn(apiClient, "post").mockResolvedValue({ success: true, auto_resume_status: "completed" })
})
afterEach(() => {
  pane?.dispose()
  pane = undefined
  vi.restoreAllMocks()
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
    await settleChat(async () => {
      appStore.getState().setPendingQuestion(sid, { question: "stale observation_progress notification",
        options: ["Continue", "Stop"], allowCustom: true, toolCallId: legacyQuestionId })
    })
    const next = { ...summary(), metadata: { "runtime.completion_reason": exhaustedMarker } }
    await settleChat(async () => { appStore.getState().applySessionSummary(sid, next) })
    expect(chat().pendingQuestion).toBeNull()
    expect(document.querySelector('[role="dialog"]')).toBeNull()
    noWrites()
  })
  it.each(["Continue", "Stop", "Inspect different evidence"])("retains persisted progress %s as one explicit guarded answer", async (answer) => {
    vi.mocked(agentClient.getPendingQuestion).mockResolvedValue(legacyProgressQuestion())
    await mount()
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    noWrites()
    vi.mocked(agentClient.getPendingQuestion).mockResolvedValue({ has_pending_question: false })
    await settleChat(async () => { await chat().answerQuestion(answer) })
    expect(apiClient.post).toHaveBeenCalledExactlyOnceWith(`respond/${sid}`, { response: answer, expected_tool_call_id: legacyQuestionId })
    expect(chat().pendingQuestion).toBeNull()
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
    expect(agentClient.submitPermissionDecision).not.toHaveBeenCalled()
  })
  it("keeps a real persisted progress question when its canonical refresh fails", async () => {
    vi.mocked(agentClient.getPendingQuestion).mockResolvedValue(legacyProgressQuestion())
    await mount()
    vi.mocked(agentClient.getPendingQuestion).mockRejectedValueOnce(new NetworkRequestError())
    await settleChat(async () => { await chat().refreshQuestion() })
    expect(chat().pendingQuestion).toEqual(legacyProgressQuestion())
    expect(chat().questionUnavailable).toBe(true)
    expect(document.querySelector('[role="dialog"]')).not.toBeNull()
    await settleChat(async () => { await chat().answerQuestion("Continue") })
    noWrites()
  })
  it("never treats completion metadata or an ordinary Continue label as a current typed approval", async () => {
    vi.mocked(agentClient.getPendingQuestion).mockResolvedValue(currentPermission())
    await mount()
    const next = { ...summary(), metadata: { "runtime.completion_reason": exhaustedMarker } }
    await settleChat(async () => {
      appStore.setState((state) => ({ chats: state.chats.map((item) => item.id === sid
        ? { ...item, messages: mapHistoryMessagesToUi(sid, exhaustedHistory()) } : item) }))
      appStore.getState().applySessionSummary(sid, next)
    })
    expect(chat().pendingQuestion).toEqual(currentPermission())
    expect(document.querySelector('[data-approval-presentation]')).not.toBeNull()
    await settleChat(async () => { await chat().answerQuestion("Continue") })
    noWrites()
    vi.mocked(agentClient.getPendingQuestion).mockResolvedValue({ has_pending_question: false })
    await settleChat(async () => { await chat().answerQuestion("deny_once") })
    expect(agentClient.submitPermissionDecision).toHaveBeenCalledExactlyOnceWith(sid, {
      request_id: "fixture-permission-2", request_generation: "opaque-generation-2", expected_policy_revision: 9, decision: "deny_once",
    })
    expect(apiClient.post).not.toHaveBeenCalled()
    expect(agentClient.execute).not.toHaveBeenCalled()
    expect(agentClient.sendMessage).not.toHaveBeenCalled()
  })
})
