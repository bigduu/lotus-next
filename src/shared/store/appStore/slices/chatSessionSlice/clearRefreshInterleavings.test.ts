import { afterEach, expect, it, vi } from "vitest"
import { createStore } from "zustand/vanilla"
import { NetworkRequestError } from "@services/api/errors"
import { ApiError } from "@services/api"
import { agentClient, type HistoryResponse, type SessionSummary } from "@services/chat/AgentService"
import { managedSessionsClient, type ManagedSessionSelection } from "@services/supervisorScope/managedSessions"
import { currentUserManagedSessionsFixture } from "@services/supervisorScope/testFixtures"
import type { AppState } from "../.."
import { createChatSlice } from "../chatSessionSlice"
import { createTokenBudgetSlice } from "../tokenBudgetSlice"
import { sessionSummaryToChatItem } from "./messageMapping"

const fixture=currentUserManagedSessionsFixture(), target=fixture.sessions[0]!.current_user_target!
const selection:ManagedSessionSelection={supervisor:fixture.scope.supervisor,target}
const id=target.session_id
const summary=():SessionSummary=>({id,kind:"root",title:"synthetic",title_version:0,pinned:false,root_session_id:id,
  spawn_depth:0,model:"synthetic",created_at:target.created_at,updated_at:target.created_at,last_activity_at:target.created_at,
  message_count:0,has_attachments:false,is_running:false,project_id:null})
const token=(totalTokens:number)=>({systemTokens:1,summaryTokens:0,windowTokens:totalTokens-1,totalTokens,budgetLimit:100})
const snapshot=(text:string,total:number|null=null):HistoryResponse=>({session_id:id,messages:text
  ? [{id:text,role:"assistant",content:text,created_at:target.created_at}] : [],bound_token_usage:total===null ? null : {
    system_tokens:1,summary_tokens:0,window_tokens:total-1,total_tokens:total,budget_limit:100,truncation_occurred:false,segments_removed:0}})
const deferred=<T,>()=>{let resolve!:(v:T)=>void;let reject!:(v:Error)=>void
  const promise=new Promise<T>((ok,fail)=>{resolve=ok;reject=fail});return {promise,resolve,reject}}
const harness=()=>{const store=createStore<AppState>()((set,get,api)=>({...createChatSlice(set,get,api),...createTokenBudgetSlice(set,get,api),
  executionBySession:{},clearPendingQuestion:vi.fn(),setPendingQuestion:vi.fn()} as unknown as AppState))
  store.setState({chats:[sessionSummaryToChatItem(summary())],currentSessionId:id,latestActiveSessionId:id});return store}
const open=(store:ReturnType<typeof harness>, selected=selection)=>store.getState().loadChatHistory(id,{
  managedSelection:selected,beforeApply:async()=>true,canApply:()=>true,selectOnApply:true,throwOnError:true})
const writeSetup=()=>{vi.spyOn(agentClient,"getSession").mockResolvedValue({session:summary()})
  vi.spyOn(agentClient,"getPendingQuestion").mockResolvedValue({has_pending_question:false})
  const write=deferred<void>(), clear=vi.spyOn(agentClient,"clearSession").mockReturnValue(write.promise)
  return {write,clear}}
const live=(store:ReturnType<typeof harness>)=>{store.getState().updateTokenUsage(id,token(99));store.getState().setTruncationInfo(id,true,3)}
const expectLive=(store:ReturnType<typeof harness>)=>{
  expect(store.getState().tokenUsages[id]?.totalTokens).toBe(99)
  expect(store.getState().chats[0].config.tokenUsage?.totalTokens).toBe(99)
  expect(store.getState().truncationOccurred[id]).toBe(true);expect(store.getState().segmentsRemoved[id]).toBe(3)
}
afterEach(()=>{vi.restoreAllMocks();vi.useRealTimers()})

it.each(["during write","after response","during refresh","after refresh"] as const)("preserves live token groups when they arrive %s before the clear event", async (when)=>{
  const store=harness(),held=deferred<HistoryResponse>()
  const read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(snapshot("original"))
    .mockImplementationOnce(()=>when==="during refresh" ? held.promise : Promise.resolve(snapshot("original")))
    .mockResolvedValueOnce(snapshot(""))
  const {write,clear}=writeSetup();await open(store)
  const clearing=store.getState().clearConversation(id);await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce())
  if(when==="during write") live(store)
  write.resolve();await expect(clearing).rejects.toMatchObject({reason:"readback_failed"})
  if(when==="after response") live(store)
  const refresh=store.getState().loadChatHistory(id,{mode:"monotonic",throwOnError:true})
  await vi.waitFor(()=>expect(read).toHaveBeenCalledTimes(2))
  if(when==="during refresh") {live(store);held.resolve(snapshot("original"))}
  await refresh
  if(when==="after refresh") live(store);else expectLive(store)
  store.getState().reconcileClearedConversation(id)
  await vi.waitFor(()=>expect(store.getState().chats[0].messages).toHaveLength(0));expectLive(store)
})

it("preserves a live token received after the clear event while its replacement read is pending", async ()=>{
  const store=harness(),held=deferred<HistoryResponse>()
  const read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(snapshot("original")).mockReturnValueOnce(held.promise)
  const {write,clear}=writeSetup();await open(store);const clearing=store.getState().clearConversation(id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce());write.resolve();await expect(clearing).rejects.toMatchObject({reason:"readback_failed"})
  store.getState().reconcileClearedConversation(id);await vi.waitFor(()=>expect(read).toHaveBeenCalledTimes(2))
  live(store);held.resolve(snapshot(""));await vi.waitFor(()=>expect(store.getState().chats[0].messages).toHaveLength(0));expectLive(store)
})

it("keeps the write-start token fence when the event arrives before the response", async ()=>{
  const store=harness(),read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(snapshot("original")).mockResolvedValueOnce(snapshot(""))
  const {write,clear}=writeSetup();await open(store);const clearing=store.getState().clearConversation(id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce());live(store);store.getState().reconcileClearedConversation(id)
  write.resolve();await expect(clearing).rejects.toMatchObject({reason:"readback_failed"})
  await vi.waitFor(()=>expect(read).toHaveBeenCalledTimes(2));await vi.waitFor(()=>expect(store.getState().chats[0].messages).toHaveLength(0));expectLive(store)
})

it("retires a refresh when the clear event arrives during it and preserves the live token in its replacement", async ()=>{
  const store=harness(),held=deferred<HistoryResponse>()
  const read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(snapshot("original"))
    .mockReturnValueOnce(held.promise).mockResolvedValueOnce(snapshot(""))
  const {write,clear}=writeSetup();await open(store);const clearing=store.getState().clearConversation(id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce());live(store);write.resolve()
  await expect(clearing).rejects.toMatchObject({reason:"readback_failed"})
  const refresh=store.getState().loadChatHistory(id,{mode:"monotonic"});await vi.waitFor(()=>expect(read).toHaveBeenCalledTimes(2))
  store.getState().reconcileClearedConversation(id);await vi.waitFor(()=>expect(read).toHaveBeenCalledTimes(3))
  await vi.waitFor(()=>expect(store.getState().chats[0].messages).toHaveLength(0))
  held.resolve(snapshot("late stale",1));await refresh;expectLive(store)
})

it("does not mistake a snapshot's own cache writes for a new live token before the event", async ()=>{
  const store=harness(),read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(snapshot("original",5))
    .mockResolvedValueOnce(snapshot("original")).mockResolvedValueOnce(snapshot("original",20))
  const {write,clear}=writeSetup();await open(store);const clearing=store.getState().clearConversation(id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce());write.resolve();await expect(clearing).rejects.toMatchObject({reason:"readback_failed"})
  await store.getState().loadChatHistory(id,{mode:"monotonic",throwOnError:true});expect(store.getState().tokenUsages[id]).toBeUndefined()
  await store.getState().loadChatHistory(id,{mode:"monotonic",throwOnError:true})
  expect(read).toHaveBeenCalledTimes(3);expect(store.getState().tokenUsages[id]?.totalTokens).toBe(20)
})

it("never transfers a pending token fence to another target birth with the same ID", async ()=>{
  const store=harness(),read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(snapshot("original"))
    .mockResolvedValueOnce(snapshot("replacement",20))
  const {write,clear}=writeSetup();await open(store);const clearing=store.getState().clearConversation(id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce());live(store);write.resolve();await expect(clearing).rejects.toMatchObject({reason:"readback_failed"})
  const replacement={...selection,target:{...target,created_at:"2026-10-31T00:00:00Z"}}
  await open(store,replacement);expect(read).toHaveBeenCalledTimes(2)
  expect(store.getState().tokenUsages[id]?.totalTokens).toBe(20);expect(store.getState().truncationOccurred[id]).toBe(false)
})

it("keeps the token fence after an unknown write until its later event", async ()=>{
  const store=harness(),read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(snapshot("original"))
    .mockResolvedValueOnce(snapshot("original")).mockResolvedValueOnce(snapshot(""))
  const {write,clear}=writeSetup();await open(store);const clearing=store.getState().clearConversation(id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce());live(store);write.reject(new NetworkRequestError())
  await expect(clearing).rejects.toMatchObject({reason:"unknown"})
  await store.getState().loadChatHistory(id,{mode:"monotonic",throwOnError:true});expectLive(store)
  store.getState().reconcileClearedConversation(id);await vi.waitFor(()=>expect(read).toHaveBeenCalledTimes(3))
  await vi.waitFor(()=>expect(store.getState().chats[0].messages).toHaveLength(0));expectLive(store)
  expect(store.getState().conversationClears[id].error).toBe("unknown")
})

it("does not allow a refresh started before the write to publish afterwards", async ()=>{
  const store=harness(),held=deferred<HistoryResponse>()
  const read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(snapshot("original")).mockReturnValueOnce(held.promise)
  const {write,clear}=writeSetup();await open(store)
  const old=store.getState().loadChatHistory(id,{mode:"monotonic"});await vi.waitFor(()=>expect(read).toHaveBeenCalledTimes(2))
  const clearing=store.getState().clearConversation(id);await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce())
  live(store);write.resolve();await expect(clearing).rejects.toMatchObject({reason:"readback_failed"})
  held.resolve(snapshot("late stale",1));await old
  expect(store.getState().tokenUsages[id]?.totalTokens).toBe(99)
  expect(store.getState().truncationOccurred[id]).toBe(true);expect(store.getState().segmentsRemoved[id]).toBe(3)
  expect(store.getState().chats[0].messages[0]?.id).toBe("original")
})

it.each(["usage","truncation"] as const)("preserves only the %s group updated during the write", async (group)=>{
  const store=harness(),read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(snapshot("original",5))
    .mockResolvedValueOnce(snapshot("original")).mockResolvedValueOnce(snapshot(""))
  const {write,clear}=writeSetup();await open(store);const clearing=store.getState().clearConversation(id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce())
  if(group==="usage") store.getState().updateTokenUsage(id,token(99));else store.getState().setTruncationInfo(id,true,3)
  write.resolve();await expect(clearing).rejects.toMatchObject({reason:"readback_failed"})
  await store.getState().loadChatHistory(id,{mode:"monotonic",throwOnError:true})
  expect(store.getState().tokenUsages[id]?.totalTokens).toBe(group==="usage" ? 99 : undefined)
  expect(store.getState().truncationOccurred[id]).toBe(group==="truncation" ? true : undefined)
  store.getState().reconcileClearedConversation(id);await vi.waitFor(()=>expect(read).toHaveBeenCalledTimes(3))
  await vi.waitFor(()=>expect(store.getState().chats[0].messages).toHaveLength(0))
  expect(store.getState().tokenUsages[id]?.totalTokens).toBe(group==="usage" ? 99 : undefined)
  expect(store.getState().segmentsRemoved[id]).toBe(group==="truncation" ? 3 : undefined)
})

it("does not start a bound refresh while the clear request is still busy", async ()=>{
  const store=harness(),read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(snapshot("original"))
  const {write,clear}=writeSetup();await open(store);const clearing=store.getState().clearConversation(id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce())
  await expect(store.getState().loadChatHistory(id,{throwOnError:true})).rejects.toMatchObject({name:"AbortError"})
  expect(read).toHaveBeenCalledOnce();write.resolve();await expect(clearing).rejects.toMatchObject({reason:"readback_failed"})
})

it("keeps the same fence through a metadata-only revalidation", async ()=>{
  const store=harness(),next=target.metadata_version+1
  const conflict=new ApiError("changed",409,"Conflict",JSON.stringify({code:"target_observation_stale"}))
  const read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(snapshot("original"))
    .mockRejectedValueOnce(conflict).mockResolvedValueOnce(snapshot("original"))
  const updated={...target,metadata_version:next}
  vi.spyOn(managedSessionsClient,"read").mockResolvedValue({...fixture,sessions:[{...fixture.sessions[0]!,target_metadata_version:next,current_user_target:updated}]})
  const {write,clear}=writeSetup();await open(store);const clearing=store.getState().clearConversation(id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce());live(store);write.resolve()
  await expect(clearing).rejects.toMatchObject({reason:"readback_failed"})
  await store.getState().loadChatHistory(id,{mode:"monotonic",throwOnError:true})
  expect(read).toHaveBeenCalledTimes(3);expectLive(store)
  expect(store.getState().managedHistoryBindings[id].selection.target.metadata_version).toBe(next)
})

it("keeps the fence after a failed refresh and permits a fresh snapshot after event reconciliation", async ()=>{
  const store=harness(),read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(snapshot("original"))
    .mockRejectedValueOnce(new Error("synthetic read failure")).mockResolvedValueOnce(snapshot(""))
    .mockResolvedValueOnce(snapshot("",20))
  const {write,clear}=writeSetup();await open(store);const clearing=store.getState().clearConversation(id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce());live(store);write.resolve()
  await expect(clearing).rejects.toMatchObject({reason:"readback_failed"})
  await expect(store.getState().loadChatHistory(id,{mode:"monotonic",throwOnError:true})).rejects.toThrow("synthetic read failure")
  expect(store.getState().tokenUsages[id]?.totalTokens).toBe(99)
  expect(store.getState().truncationOccurred[id]).toBe(true);store.getState().reconcileClearedConversation(id)
  await vi.waitFor(()=>expect(store.getState().chats[0].messages).toHaveLength(0));expectLive(store)
  await store.getState().loadChatHistory(id,{mode:"monotonic",throwOnError:true})
  expect(read).toHaveBeenCalledTimes(4);expect(store.getState().tokenUsages[id]?.totalTokens).toBe(20)
})

it("retains the event-reload fence until a failed replacement read succeeds", async ()=>{
  const store=harness(),read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(snapshot("original"))
    .mockRejectedValueOnce(new Error("synthetic event read failure")).mockResolvedValueOnce(snapshot(""))
  vi.spyOn(console,"warn").mockImplementation(()=>{})
  const {write,clear}=writeSetup();await open(store);const clearing=store.getState().clearConversation(id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce());live(store);write.resolve()
  await expect(clearing).rejects.toMatchObject({reason:"readback_failed"})
  store.getState().reconcileClearedConversation(id);await vi.waitFor(()=>expect(read).toHaveBeenCalledTimes(2))
  await vi.waitFor(()=>expect(console.warn).toHaveBeenCalled())
  expect(store.getState().tokenUsages[id]?.totalTokens).toBe(99)
  await store.getState().loadChatHistory(id,{mode:"monotonic",throwOnError:true})
  expect(read).toHaveBeenCalledTimes(3);expectLive(store)
})
