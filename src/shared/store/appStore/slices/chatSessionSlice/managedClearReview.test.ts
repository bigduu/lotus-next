import { afterEach, expect, it, vi } from "vitest"
import { createStore } from "zustand/vanilla"
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
const summary = (): SessionSummary => ({id:target.session_id,kind:"root",title:"synthetic",title_version:0,pinned:false,
  root_session_id:target.session_id,spawn_depth:0,model:"synthetic",created_at:target.created_at,updated_at:target.created_at,
  last_activity_at:target.created_at,message_count:0,has_attachments:false,is_running:false,project_id:null})
const bound = (content?: string): HistoryResponse => ({session_id:target.session_id,bound_token_usage:null,messages:content
  ? [{id:content,role:"assistant",content,created_at:target.created_at}] : []})
const deferred = <T,>() => {let resolve!: (value:T)=>void;const promise=new Promise<T>((done)=>{resolve=done});return {promise,resolve}}
const harness = () => {
  const store=createStore<AppState>()((set,get,api)=>({...createChatSlice(set,get,api),...createTokenBudgetSlice(set,get,api),
    executionBySession:{},clearPendingQuestion:vi.fn(),setPendingQuestion:vi.fn()} as unknown as AppState))
  store.setState({chats:[sessionSummaryToChatItem(summary())],currentSessionId:target.session_id,latestActiveSessionId:target.session_id})
  return store
}
const open = async (store:ReturnType<typeof harness>) => store.getState().loadChatHistory(target.session_id,{
  managedSelection:selection,beforeApply:async()=>true,canApply:()=>true,selectOnApply:true,throwOnError:true,
})
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers()})

it.each([
  ["hidden runtime message", {message_count:2,is_running:false,has_pending_question:false}],
  ["running session", {message_count:0,is_running:true,has_pending_question:false}],
  ["pending question", {message_count:0,is_running:false,has_pending_question:true}],
] as const)("does not confirm a managed clear from visible history alone with %s", async (_scenario, unboundFacts) => {
  const store=harness(), read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original")).mockResolvedValue(bound())
  const detail=vi.spyOn(agentClient,"getSession").mockResolvedValue({session:{...summary(),...unboundFacts}})
  const generic=vi.spyOn(agentClient,"getHistory").mockResolvedValue(bound())
  await open(store);const before=store.getState().chats[0]
  await expect(store.getState().verifyConversationClear(target.session_id)).rejects.toMatchObject({reason:"readback_failed"})
  expect(store.getState().conversationClears[target.session_id]).toMatchObject({busy:false,error:"readback_failed"})
  expect(store.getState().conversationClears[target.session_id]?.confirmed).not.toBe(true)
  expect(store.getState().chats[0]).toBe(before)
  expect(detail).not.toHaveBeenCalled();expect(generic).not.toHaveBeenCalled();expect(read).toHaveBeenCalled()
})

it("preserves new usage and truncation events received while an ordinary clear write is pending", async () => {
  const store=harness(), write=deferred<void>()
  vi.spyOn(agentClient,"getSession").mockResolvedValue({session:summary()})
  vi.spyOn(agentClient,"getPendingQuestion").mockResolvedValue({has_pending_question:false})
  const clear=vi.spyOn(agentClient,"clearSession").mockReturnValue(write.promise)
  vi.spyOn(agentClient,"getHistory").mockResolvedValue({session_id:target.session_id,messages:[]})
  store.getState().updateTokenUsage(target.session_id,{systemTokens:1,summaryTokens:0,windowTokens:4,totalTokens:5,budgetLimit:100})
  const action=store.getState().clearConversation(target.session_id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce())
  store.getState().updateTokenUsage(target.session_id,{systemTokens:1,summaryTokens:0,windowTokens:98,totalTokens:99,budgetLimit:100})
  store.getState().setTruncationInfo(target.session_id,true,3)
  write.resolve();await action
  expect(store.getState().tokenUsages[target.session_id]?.totalTokens).toBe(99)
  expect(store.getState().chats[0].config.tokenUsage?.totalTokens).toBe(99)
  expect(store.getState().truncationOccurred[target.session_id]).toBe(true)
  expect(store.getState().segmentsRemoved[target.session_id]).toBe(3)
  expect(store.getState().conversationClears[target.session_id]?.confirmed).toBe(true)
})

it("does not clear a new live token event while managed clear readback remains unconfirmed", async () => {
  const store=harness(), write=deferred<void>()
  vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original")).mockResolvedValue(bound())
  vi.spyOn(agentClient,"getSession").mockResolvedValue({session:summary()})
  vi.spyOn(agentClient,"getPendingQuestion").mockResolvedValue({has_pending_question:false})
  const clear=vi.spyOn(agentClient,"clearSession").mockReturnValue(write.promise)
  const generic=vi.spyOn(agentClient,"getHistory")
  await open(store);const before=store.getState().chats[0]
  const action=store.getState().clearConversation(target.session_id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce())
  store.getState().updateTokenUsage(target.session_id,{systemTokens:1,summaryTokens:0,windowTokens:98,totalTokens:99,budgetLimit:100})
  write.resolve();await expect(action).rejects.toMatchObject({reason:"readback_failed"})
  expect(store.getState().tokenUsages[target.session_id]?.totalTokens).toBe(99)
  expect(store.getState().chats[0]).toBe(before)
  expect(store.getState().conversationClears[target.session_id]?.confirmed).not.toBe(true)
  expect(generic).not.toHaveBeenCalled()
})


it("preserves token events when a clear feed is deferred while the write is pending", async () => {
  const store=harness(), write=deferred<void>()
  vi.spyOn(agentClient,"getSession").mockResolvedValue({session:summary()})
  vi.spyOn(agentClient,"getPendingQuestion").mockResolvedValue({has_pending_question:false})
  const clear=vi.spyOn(agentClient,"clearSession").mockReturnValue(write.promise)
  const history=vi.spyOn(agentClient,"getHistory").mockResolvedValue({session_id:target.session_id,messages:[]})
  const action=store.getState().clearConversation(target.session_id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce())
  store.getState().reconcileClearedConversation(target.session_id)
  store.getState().updateTokenUsage(target.session_id,{systemTokens:1,summaryTokens:0,windowTokens:98,totalTokens:99,budgetLimit:100})
  store.getState().setTruncationInfo(target.session_id,true,3)
  write.resolve();await action
  await vi.waitFor(()=>expect(history).toHaveBeenCalledTimes(2))
  await vi.waitFor(()=>expect(store.getState().tokenUsages[target.session_id]?.totalTokens).toBe(99))
  expect(store.getState().chats[0].config.tokenUsage?.totalTokens).toBe(99)
  expect(store.getState().truncationOccurred[target.session_id]).toBe(true)
  expect(store.getState().segmentsRemoved[target.session_id]).toBe(3)
})


it.each(["usage", "truncation"] as const)("only preserves the %s group updated during the clear write", async (updated) => {
  const store=harness(), write=deferred<void>()
  vi.spyOn(agentClient,"getSession").mockResolvedValue({session:summary()})
  vi.spyOn(agentClient,"getPendingQuestion").mockResolvedValue({has_pending_question:false})
  const clear=vi.spyOn(agentClient,"clearSession").mockReturnValue(write.promise)
  vi.spyOn(agentClient,"getHistory").mockResolvedValue({session_id:target.session_id,messages:[]})
  store.getState().updateTokenUsage(target.session_id,{systemTokens:1,summaryTokens:0,windowTokens:4,totalTokens:5,budgetLimit:100})
  store.getState().setTruncationInfo(target.session_id,true,9)
  const action=store.getState().clearConversation(target.session_id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce())
  if(updated==="usage") store.getState().updateTokenUsage(target.session_id,{systemTokens:1,summaryTokens:0,windowTokens:98,totalTokens:99,budgetLimit:100})
  else store.getState().setTruncationInfo(target.session_id,true,3)
  write.resolve();await action
  expect(store.getState().tokenUsages[target.session_id]?.totalTokens).toBe(updated==="usage" ? 99 : undefined)
  expect(store.getState().chats[0].config.tokenUsage?.totalTokens).toBe(updated==="usage" ? 99 : undefined)
  expect(store.getState().truncationOccurred[target.session_id]).toBe(updated==="truncation" ? true : undefined)
  expect(store.getState().segmentsRemoved[target.session_id]).toBe(updated==="truncation" ? 3 : undefined)
})
