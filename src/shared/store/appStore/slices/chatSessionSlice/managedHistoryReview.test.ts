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

const fixture = currentUserManagedSessionsFixture()
const target = fixture.sessions[0]!.current_user_target!
const selection: ManagedSessionSelection = { supervisor: fixture.scope.supervisor, target }
const summary = (id: string): SessionSummary => ({ id, kind:"root", title:id, title_version:0, pinned:false,
  root_session_id:id, spawn_depth:0, model:"synthetic", created_at:target.created_at,
  updated_at:target.created_at, last_activity_at:target.created_at, message_count:0, has_attachments:false, is_running:false, project_id:null })
const usage = (total: number) => ({system_tokens:1,summary_tokens:0,window_tokens:total-1,total_tokens:total,budget_limit:100,truncation_occurred:false,segments_removed:0})
const bound = (text: string, total: number | null = null): HistoryResponse => ({ session_id:target.session_id,
  messages: text ? [{id:text,role:"assistant",content:text,created_at:target.created_at}] : [], bound_token_usage: total === null ? null : usage(total) })
const harness = () => {
  const store = createStore<AppState>()((set,get,api) => ({ ...createChatSlice(set,get,api), ...createTokenBudgetSlice(set,get,api),
    executionBySession:{}, clearPendingQuestion:vi.fn(), setPendingQuestion:vi.fn() } as unknown as AppState))
  store.setState({ chats:[sessionSummaryToChatItem(summary(target.session_id)),sessionSummaryToChatItem(summary("other"))],
    currentSessionId:"other", latestActiveSessionId:"other" })
  return store
}
const open = async (store: ReturnType<typeof harness>) => store.getState().loadChatHistory(target.session_id, {
  managedSelection: selection, beforeApply: async () => true, canApply: () => true, selectOnApply: true, throwOnError: true,
})
const conflict = () => new ApiError("changed",409,"Conflict",JSON.stringify({code:"target_observation_stale"}))
const page = (version: number, authority = target.authority_sha256) => {
  const observed={...target,metadata_version:version,authority_sha256:authority}
  return {...fixture,sessions:[{...fixture.sessions[0]!,target_metadata_version:version,current_user_target:observed}]}
}
afterEach(() => { vi.restoreAllMocks(); vi.useRealTimers() })

it("allows a non-current split pane to hydrate a bound session", async () => {
  const store=harness(), read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("initial")).mockResolvedValueOnce(bound("split"))
  await open(store);store.setState({currentSessionId:"other"})
  await store.getState().loadChatHistory(target.session_id,{throwOnError:true,signal:new AbortController().signal})
  expect(read).toHaveBeenCalledTimes(2)
  expect(store.getState().chats[0].messages[0]?.id).toBe("split")
  expect(store.getState().currentSessionId).toBe("other")
})

it("recovers a cleared managed session in the background", async () => {
  const store=harness(), read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("initial")).mockResolvedValueOnce(bound(""))
  await open(store);store.setState({currentSessionId:"other"});store.getState().reconcileClearedConversation(target.session_id)
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  await vi.waitFor(() => expect(store.getState().chats[0].messages).toHaveLength(0))
  expect(store.getState().currentSessionId).toBe("other")
})

it("refreshes only metadata revision after a rename and then a pin", async () => {
  const store=harness(), next=target.metadata_version+1
  const read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("initial"))
    .mockRejectedValueOnce(conflict()).mockResolvedValueOnce(bound("renamed"))
    .mockRejectedValueOnce(conflict()).mockResolvedValueOnce(bound("pinned"))
  const directory=vi.spyOn(managedSessionsClient,"read").mockResolvedValueOnce(page(next)).mockResolvedValueOnce(page(next+1))
  const generic=vi.spyOn(agentClient,"getHistory")
  await open(store)
  await store.getState().loadChatHistory(target.session_id,{throwOnError:true})
  expect(store.getState().managedHistoryBindings[target.session_id].selection.target.metadata_version).toBe(next)
  await store.getState().loadChatHistory(target.session_id,{throwOnError:true})
  expect(store.getState().managedHistoryBindings[target.session_id].selection.target.metadata_version).toBe(next+1)
  expect(store.getState().chats[0].messages[0]?.id).toBe("pinned")
  expect(directory).toHaveBeenCalledTimes(2);expect(read).toHaveBeenCalledTimes(5);expect(generic).not.toHaveBeenCalled()
})

it("does not retry a metadata conflict when stable target authority changed", async () => {
  const store=harness(), read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("initial")).mockRejectedValueOnce(conflict())
  const directory=vi.spyOn(managedSessionsClient,"read").mockResolvedValue(page(target.metadata_version+1,"f".repeat(64)))
  await open(store)
  await expect(store.getState().loadChatHistory(target.session_id,{throwOnError:true})).rejects.toBeInstanceOf(ApiError)
  expect(directory).toHaveBeenCalledOnce();expect(read).toHaveBeenCalledTimes(2)
  expect(store.getState().managedHistoryBindings[target.session_id].status).toBe("stale")
  expect(store.getState().chats[0].messages[0]?.id).toBe("initial")
})

it("permits C1 clear and verifies its history through the same bound target", async () => {
  const store=harness(), read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("initial")).mockResolvedValueOnce(bound(""))
  const detail=vi.spyOn(agentClient,"getSession").mockResolvedValue({session:summary(target.session_id)})
  vi.spyOn(agentClient,"getPendingQuestion").mockResolvedValue({has_pending_question:false})
  const clear=vi.spyOn(agentClient,"clearSession").mockResolvedValue(undefined)
  const generic=vi.spyOn(agentClient,"getHistory")
  await open(store);await store.getState().clearConversation(target.session_id)
  expect(clear).toHaveBeenCalledOnce();expect(detail).toHaveBeenCalledOnce();expect(read).toHaveBeenCalledTimes(2)
  expect(generic).not.toHaveBeenCalled();expect(store.getState().chats[0].messages).toHaveLength(0)
  expect(store.getState().conversationClears[target.session_id].confirmed).toBe(true)
})

it("keeps an uncertain C1 outcome unknown after a bound readback", async () => {
  const store=harness(), read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("initial")).mockResolvedValueOnce(bound(""))
  const detail=vi.spyOn(agentClient,"getSession"), generic=vi.spyOn(agentClient,"getHistory"), clear=vi.spyOn(agentClient,"clearSession")
  await open(store);store.setState({conversationClears:{[target.session_id]:{busy:false,error:"unknown"}}})
  await store.getState().verifyConversationClear(target.session_id)
  expect(store.getState().conversationClears[target.session_id]).toMatchObject({busy:false,error:"unknown",readbackConfirmed:true})
  expect(read).toHaveBeenCalledTimes(2);expect(detail).not.toHaveBeenCalled();expect(generic).not.toHaveBeenCalled();expect(clear).not.toHaveBeenCalled()
})

it("restores the ordinary clear route when the session is explicitly selected from the sidebar", async () => {
  const store=harness();vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValue(bound("initial"))
  const detail=vi.spyOn(agentClient,"getSession").mockResolvedValue({session:summary(target.session_id)})
  vi.spyOn(agentClient,"getPendingQuestion").mockResolvedValue({has_pending_question:false})
  const clear=vi.spyOn(agentClient,"clearSession").mockResolvedValue(undefined)
  const generic=vi.spyOn(agentClient,"getHistory").mockResolvedValue({session_id:target.session_id,messages:[]})
  await open(store);store.getState().selectSession("other");store.getState().selectSession(target.session_id)
  await store.getState().clearConversation(target.session_id)
  expect(clear).toHaveBeenCalledOnce();expect(detail).toHaveBeenCalledTimes(2);expect(generic).toHaveBeenCalledOnce()
})

it("applies bound token usage even when a monotonic refresh has no message changes", async () => {
  const store=harness();vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("same",5)).mockResolvedValueOnce(bound("same",20))
  await open(store);await store.getState().loadChatHistory(target.session_id,{mode:"monotonic",throwOnError:true})
  expect(store.getState().tokenUsages[target.session_id]?.totalTokens).toBe(20)
  expect(store.getState().chats[0].config.tokenUsage?.totalTokens).toBe(20)
})

it("does not replace a newer live token event during a bound refresh", async () => {
  const store=harness();let resolve!: (value:HistoryResponse)=>void
  const delayed=new Promise<HistoryResponse>((done)=>{resolve=done})
  const read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("same",5)).mockReturnValueOnce(delayed)
  await open(store);const refresh=store.getState().loadChatHistory(target.session_id,{mode:"monotonic",throwOnError:true})
  await vi.waitFor(()=>expect(read).toHaveBeenCalledTimes(2))
  store.getState().updateTokenUsage(target.session_id,{systemTokens:1,summaryTokens:0,windowTokens:98,totalTokens:99,budgetLimit:100})
  resolve(bound("same",20));await refresh
  expect(store.getState().tokenUsages[target.session_id]?.totalTokens).toBe(99)
  expect(store.getState().chats[0].config.tokenUsage?.totalTokens).toBe(99)
})

it("does not retry or restore a binding after an ordinary selection cancels directory revalidation", async () => {
  const store=harness();let resolve!: (value:ReturnType<typeof page>)=>void
  const delayed=new Promise<ReturnType<typeof page>>((done)=>{resolve=done})
  const read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("initial")).mockRejectedValueOnce(conflict())
  const directory=vi.spyOn(managedSessionsClient,"read").mockReturnValue(delayed)
  await open(store);const pending=store.getState().loadChatHistory(target.session_id,{throwOnError:true})
  await vi.waitFor(()=>expect(directory).toHaveBeenCalledOnce())
  store.getState().selectSession(target.session_id)
  resolve(page(target.metadata_version+1))
  await expect(pending).rejects.toMatchObject({name:"AbortError"})
  expect(read).toHaveBeenCalledTimes(2);expect(store.getState().managedHistoryBindings[target.session_id]).toBeUndefined()
  expect(store.getState().chats[0].messages[0]?.id).toBe("initial")
})

it("retains a refreshed metadata revision while waiting for an assistant checkpoint", async () => {
  const store=harness(), next=target.metadata_version+1
  const userTail: HistoryResponse={session_id:target.session_id,messages:[{id:"user",role:"user",content:"synthetic",created_at:target.created_at}],bound_token_usage:null}
  const read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("initial"))
    .mockRejectedValueOnce(conflict()).mockResolvedValueOnce(userTail).mockResolvedValueOnce(bound("answer"))
  vi.spyOn(managedSessionsClient,"read").mockResolvedValue(page(next))
  await open(store);await store.getState().loadChatHistory(target.session_id,{waitForAssistant:true,retries:1,retryDelayMs:1,throwOnError:true})
  expect(read).toHaveBeenCalledTimes(4)
  expect(store.getState().managedHistoryBindings[target.session_id].selection.target.metadata_version).toBe(next)
  expect(store.getState().chats[0].messages[0]?.id).toBe("answer")
})

it("preserves a newer live token event while a managed clear is verified", async () => {
  const store=harness();let resolve!: (value:HistoryResponse)=>void
  const delayed=new Promise<HistoryResponse>((done)=>{resolve=done})
  const read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("initial",5)).mockReturnValueOnce(delayed)
  await open(store);store.setState({conversationClears:{[target.session_id]:{busy:false,error:"unknown"}}})
  const verification=store.getState().verifyConversationClear(target.session_id)
  await vi.waitFor(()=>expect(read).toHaveBeenCalledTimes(2))
  store.getState().updateTokenUsage(target.session_id,{systemTokens:1,summaryTokens:0,windowTokens:98,totalTokens:99,budgetLimit:100})
  resolve(bound(""));await verification
  expect(store.getState().tokenUsages[target.session_id]?.totalTokens).toBe(99)
  expect(store.getState().chats[0].config.tokenUsage?.totalTokens).toBe(99)
  expect(store.getState().conversationClears[target.session_id].error).toBe("unknown")
})

it("keeps an uncertain clear and stale target when bound verification sees a different authority", async () => {
  const store=harness(),read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("initial")).mockRejectedValueOnce(conflict())
  vi.spyOn(managedSessionsClient,"read").mockResolvedValue(page(target.metadata_version+1,"f".repeat(64)))
  const generic=vi.spyOn(agentClient,"getHistory")
  await open(store);store.setState({conversationClears:{[target.session_id]:{busy:false,error:"unknown"}}})
  await expect(store.getState().verifyConversationClear(target.session_id)).rejects.toMatchObject({reason:"readback_failed"})
  expect(store.getState().conversationClears[target.session_id]).toMatchObject({error:"unknown",refreshFailed:true})
  expect(store.getState().managedHistoryBindings[target.session_id].status).toBe("stale")
  expect(store.getState().chats[0].messages[0]?.id).toBe("initial");expect(read).toHaveBeenCalledTimes(2);expect(generic).not.toHaveBeenCalled()
})

it("preserves a live token event received between assistant checkpoint retries", async () => {
  const store=harness()
  const userTail:HistoryResponse={session_id:target.session_id,messages:[{id:"user",role:"user",content:"synthetic",created_at:target.created_at}],bound_token_usage:null}
  const read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("initial",5)).mockResolvedValueOnce(userTail).mockResolvedValueOnce(bound("answer",20))
  await open(store);vi.useFakeTimers()
  const pending=store.getState().loadChatHistory(target.session_id,{waitForAssistant:true,retries:1,retryDelayMs:1,throwOnError:true})
  await vi.advanceTimersByTimeAsync(0);expect(read).toHaveBeenCalledTimes(2)
  store.getState().updateTokenUsage(target.session_id,{systemTokens:1,summaryTokens:0,windowTokens:98,totalTokens:99,budgetLimit:100})
  await vi.advanceTimersByTimeAsync(2);await pending
  expect(store.getState().tokenUsages[target.session_id]?.totalTokens).toBe(99)
  expect(store.getState().chats[0].config.tokenUsage?.totalTokens).toBe(99)
})

it.each([
  ["birth", {created_at:"2026-10-28T00:00:00Z"}],
  ["authority", {authority_sha256:"f".repeat(64)}],
  ["ancestry", {ancestry_sha256:"e".repeat(64)}],
  ["project", {project_id:"another-project"}],
  ["root", {root_session_id:"another-root"}],
  ["parent", {parent_session_id:"another-parent"}],
] as const)("requires explicit reselection when stable %s changes", async (_label, change) => {
  const store=harness(), read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("initial")).mockRejectedValueOnce(conflict())
  const changed={...page(target.metadata_version+1),sessions:[{...fixture.sessions[0]!,current_user_target:{...target,metadata_version:target.metadata_version+1,...change}}]}
  const directory=vi.spyOn(managedSessionsClient,"read").mockResolvedValue(changed)
  await open(store);await expect(store.getState().loadChatHistory(target.session_id,{throwOnError:true})).rejects.toBeInstanceOf(ApiError)
  expect(directory).toHaveBeenCalledOnce();expect(read).toHaveBeenCalledTimes(2)
  expect(store.getState().managedHistoryBindings[target.session_id].status).toBe("stale")
  expect(store.getState().chats[0].messages[0]?.id).toBe("initial")
})

it("does not retry a different conflict as a metadata change", async () => {
  const store=harness(), read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("initial"))
    .mockRejectedValueOnce(new ApiError("changed",409,"Conflict",JSON.stringify({code:"supervisor_observation_stale"})))
  const directory=vi.spyOn(managedSessionsClient,"read")
  await open(store);await expect(store.getState().loadChatHistory(target.session_id,{throwOnError:true})).rejects.toBeInstanceOf(ApiError)
  expect(directory).not.toHaveBeenCalled();expect(read).toHaveBeenCalledTimes(2)
  expect(store.getState().managedHistoryBindings[target.session_id].status).toBe("stale")
})

it("does not apply a secondary-pane response after its signal is cancelled", async () => {
  const store=harness();let resolve!: (value:HistoryResponse)=>void
  const delayed=new Promise<HistoryResponse>((done)=>{resolve=done})
  const read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("initial")).mockReturnValueOnce(delayed)
  await open(store);store.setState({currentSessionId:"other"})
  const controller=new AbortController(),pending=store.getState().loadChatHistory(target.session_id,{signal:controller.signal,throwOnError:true})
  await vi.waitFor(()=>expect(read).toHaveBeenCalledTimes(2));controller.abort();resolve(bound("late"))
  await expect(pending).rejects.toMatchObject({name:"AbortError"})
  expect(store.getState().chats[0].messages[0]?.id).toBe("initial")
})

it("keeps a clear outcome unknown if its managed binding is abandoned while the write is pending", async () => {
  const store=harness();let finish!:()=>void
  const delayed=new Promise<void>((done)=>{finish=done})
  vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValue(bound("initial"))
  vi.spyOn(agentClient,"getSession").mockResolvedValue({session:summary(target.session_id)})
  vi.spyOn(agentClient,"getPendingQuestion").mockResolvedValue({has_pending_question:false})
  const clear=vi.spyOn(agentClient,"clearSession").mockReturnValue(delayed)
  const generic=vi.spyOn(agentClient,"getHistory").mockResolvedValue({session_id:target.session_id,messages:[]})
  await open(store);const pending=store.getState().clearConversation(target.session_id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce())
  store.getState().selectSession(target.session_id);finish()
  await expect(pending).rejects.toMatchObject({reason:"unknown"})
  expect(store.getState().conversationClears[target.session_id].error).toBe("unknown")
  expect(generic).not.toHaveBeenCalled()
})
