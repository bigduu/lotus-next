import { afterEach, expect, it, vi } from "vitest"
import { createStore } from "zustand/vanilla"
import { NetworkRequestError } from "@services/api/errors"
import { agentClient, type HistoryResponse, type SessionSummary } from "@services/chat/AgentService"
import type { AppState } from "../.."
import { createChatSlice } from "../chatSessionSlice"
import { createTokenBudgetSlice } from "../tokenBudgetSlice"
import { sessionSummaryToChatItem } from "./messageMapping"

const id="synthetic-clear"
const summary = (): SessionSummary => ({id,kind:"root",title:"synthetic",title_version:0,pinned:false,
  root_session_id:id,spawn_depth:0,model:"synthetic",created_at:"2026-10-30T00:00:00Z",updated_at:"2026-10-30T00:00:00Z",
  last_activity_at:"2026-10-30T00:00:00Z",message_count:0,has_attachments:false,is_running:false,project_id:null})
const cleared:HistoryResponse={session_id:id,messages:[]}
const harness = () => {
  const store=createStore<AppState>()((set,get,api)=>({...createChatSlice(set,get,api),...createTokenBudgetSlice(set,get,api),
    executionBySession:{},clearPendingQuestion:vi.fn(),setPendingQuestion:vi.fn()} as unknown as AppState))
  store.setState({chats:[sessionSummaryToChatItem(summary())],currentSessionId:id,latestActiveSessionId:id})
  return store
}
const token=(totalTokens:number)=>({systemTokens:1,summaryTokens:0,windowTokens:totalTokens-1,totalTokens,budgetLimit:100})
const setup=()=>{
  vi.spyOn(agentClient,"getSession").mockResolvedValue({session:summary()})
  vi.spyOn(agentClient,"getPendingQuestion").mockResolvedValue({has_pending_question:false})
  return vi.spyOn(agentClient,"getHistory").mockResolvedValue(cleared)
}
afterEach(()=>vi.restoreAllMocks())

it("preserves a newer token when SessionCleared arrives after the clear response", async () => {
  const store=harness(), history=setup();let done!:()=>void
  const write=new Promise<void>((resolve)=>{done=resolve})
  const clear=vi.spyOn(agentClient,"clearSession").mockReturnValue(write)
  const action=store.getState().clearConversation(id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce())
  store.getState().updateTokenUsage(id,token(99));store.getState().setTruncationInfo(id,true,3)
  done();await action
  store.getState().reconcileClearedConversation(id)
  await vi.waitFor(()=>expect(history).toHaveBeenCalledTimes(2));await new Promise((resolve)=>setTimeout(resolve,0))
  expect(store.getState().tokenUsages[id]?.totalTokens).toBe(99)
  expect(store.getState().chats[0].config.tokenUsage?.totalTokens).toBe(99)
  expect(store.getState().truncationOccurred[id]).toBe(true);expect(store.getState().segmentsRemoved[id]).toBe(3)
  // A later independent clear event must not inherit the first guard forever.
  store.getState().reconcileClearedConversation(id)
  await vi.waitFor(()=>expect(history).toHaveBeenCalledTimes(3));await new Promise((resolve)=>setTimeout(resolve,0))
  expect(store.getState().tokenUsages[id]).toBeUndefined();expect(store.getState().truncationOccurred[id]).toBeUndefined()
})

it("does not claim a write succeeded from a standalone readback", async () => {
  const store=harness();setup();const clear=vi.spyOn(agentClient,"clearSession")
  await store.getState().verifyConversationClear(id)
  expect(store.getState().conversationClears[id]).toMatchObject({busy:false,error:"unknown",readbackConfirmed:true})
  expect(store.getState().conversationClears[id].confirmed).not.toBe(true);expect(clear).not.toHaveBeenCalled()
})

it("does not retain a token guard after a definite preflight refusal", async () => {
  const store=harness(),history=setup()
  vi.mocked(agentClient.getSession).mockResolvedValueOnce({session:{...summary(),is_running:true}})
  const clear=vi.spyOn(agentClient,"clearSession");store.getState().updateTokenUsage(id,token(5))
  await expect(store.getState().clearConversation(id)).rejects.toMatchObject({reason:"active_run"})
  store.getState().updateTokenUsage(id,token(9));store.getState().reconcileClearedConversation(id)
  await vi.waitFor(()=>expect(history).toHaveBeenCalledOnce());await new Promise((resolve)=>setTimeout(resolve,0))
  expect(store.getState().tokenUsages[id]).toBeUndefined();expect(clear).not.toHaveBeenCalled()
})

it("retains an unknown outcome and newer token when its event is delivered late", async () => {
  const store=harness(),history=setup();let reject!:(error:Error)=>void
  const write=new Promise<void>((_resolve,fail)=>{reject=fail})
  const clear=vi.spyOn(agentClient,"clearSession").mockReturnValue(write)
  const action=store.getState().clearConversation(id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce())
  store.getState().updateTokenUsage(id,token(99));reject(new NetworkRequestError())
  await expect(action).rejects.toMatchObject({reason:"unknown"})
  store.getState().reconcileClearedConversation(id)
  await vi.waitFor(()=>expect(history).toHaveBeenCalledOnce());await new Promise((resolve)=>setTimeout(resolve,0))
  expect(store.getState().tokenUsages[id]?.totalTokens).toBe(99)
  expect(store.getState().conversationClears[id]).toMatchObject({busy:false,error:"unknown"})
  expect(store.getState().conversationClears[id].confirmed).not.toBe(true)
})

it("does not transfer a clear receipt to a later unbound view", async () => {
  const store=harness();setup();vi.spyOn(agentClient,"clearSession").mockResolvedValue(undefined)
  store.setState({managedHistoryBindings:{[id]:{selection:{} as never,status:"active"}}})
  await expect(store.getState().clearConversation(id)).rejects.toMatchObject({reason:"readback_failed"})
  store.setState({managedHistoryBindings:{}})
  await store.getState().verifyConversationClear(id)
  expect(store.getState().conversationClears[id]).toMatchObject({busy:false,error:"unknown",readbackConfirmed:true})
  expect(store.getState().conversationClears[id].confirmed).not.toBe(true)
})
