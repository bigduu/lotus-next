import { afterEach, expect, it, vi } from "vitest"
import { createStore } from "zustand/vanilla"
import { ApiError } from "@services/api"
import { agentClient, type HistoryResponse, type SessionSummary } from "@services/chat/AgentService"
import { managedSessionsClient, type ManagedSessionSelection } from "@services/supervisorScope/managedSessions"
import { currentUserManagedSessionsFixture } from "@services/supervisorScope/testFixtures"
import type { AppState } from "../.."
import { createChatSlice } from "../chatSessionSlice"
import { createTokenBudgetSlice } from "../tokenBudgetSlice"
import { sessionSummaryToChatItem } from "./messageMapping"
import { mergeSessionsList } from "./refreshChats"

const fixture = currentUserManagedSessionsFixture()
const target = fixture.sessions[0]!.current_user_target!
const selection: ManagedSessionSelection = { supervisor: fixture.scope.supervisor, target }
const summary = (id: string): SessionSummary => ({ id, kind:"root", title:id, title_version:0, pinned:false,
  root_session_id:id, spawn_depth:0, model:"synthetic", created_at:target.created_at,
  updated_at:target.created_at, last_activity_at:target.created_at, message_count:1, has_attachments:false, is_running:false, project_id:null })
const history = (content: string): HistoryResponse => ({ session_id:target.session_id, messages:[
  { id:content, role:"assistant", content, created_at:target.created_at },
] })
const bound = (content: string) => ({ ...history(content), bound_token_usage: null })
const harness = () => {
  const store = createStore<AppState>()((set,get,api) => ({ ...createChatSlice(set,get,api),
    ...createTokenBudgetSlice(set,get,api), executionBySession:{}, clearPendingQuestion:vi.fn(), setPendingQuestion:vi.fn() } as unknown as AppState))
  store.setState({ chats:[sessionSummaryToChatItem(summary(target.session_id)),sessionSummaryToChatItem(summary("other"))],
    currentSessionId:"other", latestActiveSessionId:"other" })
  return store
}
const open = async (store: ReturnType<typeof harness>) => {
  await store.getState().loadChatHistory(target.session_id, {
    readHistory: () => managedSessionsClient.readBoundHistory(selection),
    managedSelection: selection,
    beforeApply: async () => true, canApply: () => true, selectOnApply: true, throwOnError: true,
  })
}
const bindings = (store: ReturnType<typeof harness>) => (store.getState() as unknown as {
  managedHistoryBindings: Record<string, { status:string } | undefined>
}).managedHistoryBindings

afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it("replaces preexisting token state with the first bound snapshot", async () => {
  const store=harness(), usage={system_tokens:2,summary_tokens:0,window_tokens:3,total_tokens:5,budget_limit:100,truncation_occurred:false,segments_removed:0}
  store.getState().updateTokenUsage(target.session_id, {systemTokens:1,summaryTokens:0,windowTokens:98,totalTokens:99,budgetLimit:100})
  vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValue({ ...history("original"), bound_token_usage:usage })
  await open(store)
  expect(store.getState().tokenUsages[target.session_id]?.totalTokens).toBe(5)
  expect(store.getState().chats[0].config.tokenUsage?.totalTokens).toBe(5)
})

it("keeps automatic account-feed history reads bound to the selected target", async () => {
  const store=harness(), boundRead=vi.spyOn(managedSessionsClient,"readBoundHistory")
    .mockResolvedValueOnce(bound("original")).mockResolvedValueOnce(bound("new same target"))
  const generic=vi.spyOn(agentClient,"getHistory").mockResolvedValue({ ...history("foreign replacement"),
    messages:[...history("foreign replacement").messages,...history("foreign extra").messages] })
  vi.spyOn(agentClient,"getPendingQuestion").mockResolvedValue({has_pending_question:false})
  await open(store)
  vi.useFakeTimers()
  store.getState().reconcileOpenSession(target.session_id,"message_appended")
  await vi.advanceTimersByTimeAsync(300)
  expect(boundRead).toHaveBeenCalledTimes(2)
  expect(generic).not.toHaveBeenCalled()
  expect(store.getState().chats[0].messages.map((m) => m.id)).toEqual(["new same target"])
})

it("marks the managed view stale on a 409 and never applies or retries a replacement", async () => {
  const store=harness(), boundRead=vi.spyOn(managedSessionsClient,"readBoundHistory")
    .mockResolvedValueOnce(bound("original")).mockRejectedValue(new ApiError("changed",409,"Conflict"))
  const generic=vi.spyOn(agentClient,"getHistory").mockResolvedValue({ ...history("foreign replacement"),
    messages:[...history("foreign replacement").messages,...history("foreign extra").messages] })
  const pending=vi.spyOn(agentClient,"getPendingQuestion").mockResolvedValue({has_pending_question:false})
  await open(store); const before=store.getState().chats[0].messages
  vi.useFakeTimers(); store.getState().reconcileOpenSession(target.session_id,"message_appended")
  await vi.advanceTimersByTimeAsync(300)
  expect(boundRead).toHaveBeenCalledTimes(2); expect(generic).not.toHaveBeenCalled()
  expect(store.getState().chats[0].messages).toEqual(before)
  expect(bindings(store)[target.session_id]?.status).toBe("stale")
  expect(pending).not.toHaveBeenCalled()
  store.getState().reconcileOpenSession(target.session_id,"message_appended")
  await vi.advanceTimersByTimeAsync(1000)
  expect(boundRead).toHaveBeenCalledTimes(2)
})

it("uses token state from the same bound snapshot after a clear, never unbound session detail", async () => {
  const store=harness(), usage={system_tokens:2,summary_tokens:0,window_tokens:3,total_tokens:5,budget_limit:100,truncation_occurred:false,segments_removed:0}
  const boundRead=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original"))
    .mockResolvedValueOnce({ ...history("after-clear"), bound_token_usage:usage })
  vi.spyOn(agentClient,"getHistory").mockResolvedValue(history("foreign replacement"))
  const detail=vi.spyOn(agentClient,"getSession").mockResolvedValue({session:{...summary(target.session_id),token_usage:{...usage,total_tokens:99}}})
  await open(store);store.getState().reconcileClearedConversation(target.session_id)
  await vi.waitFor(() => expect(boundRead).toHaveBeenCalledTimes(2))
  await vi.waitFor(() => expect(store.getState().chats[0].messages[0]?.id).toBe("after-clear"))
  expect(detail).not.toHaveBeenCalled()
  expect(store.getState().tokenUsages[target.session_id]?.totalTokens).toBe(5)
})


it("does not apply a delayed managed refresh after switching and opening the target again", async () => {
  const store=harness()
  let resolve!: (value: HistoryResponse) => void
  const delayed=new Promise<HistoryResponse>((done) => { resolve=done })
  const read=vi.spyOn(managedSessionsClient,"readBoundHistory")
    .mockResolvedValueOnce(bound("original")).mockReturnValueOnce(delayed).mockResolvedValueOnce(bound("new opening"))
  const generic=vi.spyOn(agentClient,"getHistory")
  await open(store)
  const old=store.getState().loadChatHistory(target.session_id, { mode:"replace" })
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  store.setState({currentSessionId:"other"})
  await open(store)
  resolve(bound("late old result")); await old
  expect(store.getState().currentSessionId).toBe(target.session_id)
  expect(store.getState().chats[0].messages[0]?.id).toBe("new opening")
  expect(bindings(store)[target.session_id]?.status).toBe("active")
  expect(generic).not.toHaveBeenCalled()
})

it("keeps a clear pending if a bound token snapshot is unavailable", async () => {
  const store=harness()
  const read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original"))
    .mockResolvedValueOnce(history("incomplete"))
    .mockResolvedValueOnce(bound("confirmed"))
  const detail=vi.spyOn(agentClient,"getSession")
  const generic=vi.spyOn(agentClient,"getHistory")
  await open(store);store.getState().reconcileClearedConversation(target.session_id)
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  await Promise.resolve(); await Promise.resolve()
  expect(store.getState().chats[0].messages[0]?.id).toBe("original")
  await store.getState().loadChatHistory(target.session_id, {mode:"monotonic",throwOnError:true})
  expect(store.getState().chats[0].messages[0]?.id).toBe("confirmed")
  expect(detail).not.toHaveBeenCalled();expect(generic).not.toHaveBeenCalled()
})

it("preserves a newer token event received while an initial bound read is in flight", async () => {
  const store=harness()
  let resolve!: (value: HistoryResponse) => void
  const delayed=new Promise<HistoryResponse>((done) => { resolve=done })
  const read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockReturnValue(delayed)
  const opening=open(store)
  await vi.waitFor(() => expect(read).toHaveBeenCalledOnce())
  store.getState().updateTokenUsage(target.session_id, {systemTokens:1,summaryTokens:0,windowTokens:11,totalTokens:12,budgetLimit:100})
  resolve({ ...history("original"), bound_token_usage:{system_tokens:2,summary_tokens:0,window_tokens:3,total_tokens:5,budget_limit:100,truncation_occurred:false,segments_removed:0} })
  await opening
  expect(store.getState().tokenUsages[target.session_id]?.totalTokens).toBe(12)
  expect(store.getState().chats[0].config.tokenUsage?.totalTokens).toBe(12)
})

it("does not replace bound token state with an unbound list summary", async () => {
  const store=harness(), usage={system_tokens:2,summary_tokens:0,window_tokens:3,total_tokens:5,budget_limit:100,truncation_occurred:false,segments_removed:0}
  vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValue({ ...history("original"), bound_token_usage:usage })
  await open(store)
  const unbound={...summary(target.session_id), token_usage:{...usage,total_tokens:99}}
  const merged=mergeSessionsList(store.getState(), [unbound], {kind:"upsert"})
  expect(merged.chats[0].config.tokenUsage?.totalTokens).toBe(5)
})

it("does not fetch an ID-only pending question if a managed open wins during an older reconcile", async () => {
  const store=harness();store.setState({currentSessionId:target.session_id})
  let resolve!: (value: HistoryResponse) => void
  const older=new Promise<HistoryResponse>((done) => {resolve=done})
  const generic=vi.spyOn(agentClient,"getHistory").mockReturnValue(older)
  const pending=vi.spyOn(agentClient,"getPendingQuestion").mockResolvedValue({has_pending_question:false})
  vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValue(bound("managed"))
  vi.useFakeTimers();store.getState().reconcileOpenSession(target.session_id,"message_appended")
  await vi.advanceTimersByTimeAsync(300)
  expect(generic).toHaveBeenCalledOnce()
  await open(store)
  resolve(history("obsolete"));await Promise.resolve();await Promise.resolve();await Promise.resolve()
  expect(pending).not.toHaveBeenCalled()
  expect(store.getState().chats[0].messages[0]?.id).toBe("managed")
})

it("discards an older ID-only pending-question response after a managed open", async () => {
  const store=harness();store.setState({currentSessionId:target.session_id})
  type Pending = Awaited<ReturnType<typeof agentClient.getPendingQuestion>>
  let resolve!: (value: Pending) => void
  const older=new Promise<Pending>((done) => {resolve=done})
  vi.spyOn(agentClient,"getHistory").mockResolvedValue(history("generic"))
  const pending=vi.spyOn(agentClient,"getPendingQuestion").mockReturnValue(older)
  vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValue(bound("managed"))
  vi.useFakeTimers();store.getState().reconcileOpenSession(target.session_id,"message_appended")
  await vi.advanceTimersByTimeAsync(300)
  expect(pending).toHaveBeenCalledOnce()
  await open(store)
  resolve({has_pending_question:true,interaction_kind:"clarification",question:"foreign question",options:[],allow_custom:true,tool_call_id:"synthetic"})
  await Promise.resolve();await Promise.resolve();await Promise.resolve()
  expect(store.getState().setPendingQuestion).not.toHaveBeenCalled()
})

it("refuses an ID-only clear request for a managed session", async () => {
  const store=harness()
  vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValue(bound("original"))
  const detail=vi.spyOn(agentClient,"getSession").mockResolvedValue({session:summary(target.session_id)})
  const pending=vi.spyOn(agentClient,"getPendingQuestion").mockResolvedValue({has_pending_question:false})
  const clear=vi.spyOn(agentClient,"clearSession").mockResolvedValue(undefined)
  const generic=vi.spyOn(agentClient,"getHistory").mockResolvedValue({session_id:target.session_id,messages:[]})
  await open(store);const before=store.getState().chats[0]
  await expect(store.getState().clearConversation(target.session_id)).rejects.toMatchObject({reason:"unsupported"})
  expect(store.getState().chats[0]).toBe(before)
  expect(detail).not.toHaveBeenCalled();expect(pending).not.toHaveBeenCalled()
  expect(clear).not.toHaveBeenCalled();expect(generic).not.toHaveBeenCalled()
})

it("does not apply an ID-only clear readback to a managed session", async () => {
  const store=harness()
  vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValue(bound("original"))
  const detail=vi.spyOn(agentClient,"getSession").mockResolvedValue({session:{...summary(target.session_id),message_count:0}})
  const generic=vi.spyOn(agentClient,"getHistory").mockResolvedValue({session_id:target.session_id,messages:[]})
  await open(store);const before=store.getState().chats[0]
  await expect(store.getState().verifyConversationClear(target.session_id)).rejects.toMatchObject({reason:"unsupported"})
  expect(store.getState().chats[0]).toBe(before)
  expect(detail).not.toHaveBeenCalled();expect(generic).not.toHaveBeenCalled()
})

it("preserves an uncertain clear while refusing ID-only managed readback", async () => {
  const store=harness()
  vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValue(bound("original"))
  const detail=vi.spyOn(agentClient,"getSession")
  const generic=vi.spyOn(agentClient,"getHistory")
  await open(store);const before=store.getState().chats[0]
  store.setState({conversationClears:{[target.session_id]:{busy:false,error:"unknown"}}})
  await expect(store.getState().verifyConversationClear(target.session_id)).rejects.toMatchObject({reason:"unknown"})
  expect(store.getState().conversationClears[target.session_id]).toMatchObject({busy:false,error:"unknown",refreshFailed:true})
  expect(store.getState().chats[0]).toBe(before)
  expect(detail).not.toHaveBeenCalled();expect(generic).not.toHaveBeenCalled()
})
