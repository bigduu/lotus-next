import { afterEach, expect, it, vi } from "vitest"
import { createStore } from "zustand/vanilla"
import { ApiError, NetworkRequestError } from "@services/api/errors"
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
const evidence = () => ({ full_message_count:0, execution_active:false, has_pending_question:false, has_pending_approval:false })
const bound = (text?:string) => ({session_id:target.session_id,bound_token_usage:null,is_delta:false,truncated:false,
  messages:text ? [{id:"original",role:"assistant" as const,content:text,created_at:target.created_at}] : []})
const checked = (patch:Record<string,unknown> = {}) => ({...bound(),bound_clear_evidence:{...evidence(),...patch}} as unknown as HistoryResponse)
const harness = () => {
  const store=createStore<AppState>()((set,get,api)=>({...createChatSlice(set,get,api),...createTokenBudgetSlice(set,get,api),
    executionBySession:{},clearPendingQuestion:vi.fn(),setPendingQuestion:vi.fn()} as unknown as AppState))
  store.setState({chats:[sessionSummaryToChatItem(summary())],currentSessionId:target.session_id,latestActiveSessionId:target.session_id})
  return store
}
const open = (store:ReturnType<typeof harness>) => store.getState().loadChatHistory(target.session_id,{
  managedSelection:selection,beforeApply:async()=>true,canApply:()=>true,selectOnApply:true,throwOnError:true,
})
const setupWrite = () => {
  const detail=vi.spyOn(agentClient,"getSession").mockResolvedValue({session:summary()})
  vi.spyOn(agentClient,"getPendingQuestion").mockResolvedValue({has_pending_question:false})
  const clear=vi.spyOn(agentClient,"clearSession").mockResolvedValue(undefined)
  return {detail,clear}
}
afterEach(()=>vi.restoreAllMocks())

it("confirms an acknowledged managed clear only after a complete bound readback", async () => {
  const store=harness(), read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original")).mockResolvedValueOnce(checked())
  const {detail,clear}=setupWrite(), generic=vi.spyOn(agentClient,"getHistory")
  await open(store);await store.getState().clearConversation(target.session_id)
  expect(clear).toHaveBeenCalledOnce();expect(detail).toHaveBeenCalledOnce();expect(generic).not.toHaveBeenCalled()
  expect(read).toHaveBeenNthCalledWith(2,selection,{clearReadback:true})
  expect(store.getState().conversationClears[target.session_id]).toMatchObject({busy:false,confirmed:true})
  expect(store.getState().chats[0].messages).toHaveLength(0)
})

it("can recheck an acknowledged managed clear without sending another write", async () => {
  const store=harness(), read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original"))
    .mockRejectedValueOnce(new Error("read unavailable")).mockResolvedValueOnce(checked())
  const {clear}=setupWrite();await open(store)
  await expect(store.getState().clearConversation(target.session_id)).rejects.toMatchObject({reason:"readback_failed"})
  await store.getState().verifyConversationClear(target.session_id)
  expect(store.getState().conversationClears[target.session_id]).toMatchObject({busy:false,confirmed:true})
  expect(clear).toHaveBeenCalledOnce();expect(read).toHaveBeenCalledTimes(3)
})

it("keeps an unknown write unknown after an otherwise complete readback", async () => {
  const store=harness();vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original")).mockResolvedValueOnce(checked())
  const {clear}=setupWrite();clear.mockRejectedValueOnce(new NetworkRequestError());await open(store)
  await expect(store.getState().clearConversation(target.session_id)).rejects.toMatchObject({reason:"unknown"})
  await store.getState().verifyConversationClear(target.session_id)
  expect(store.getState().conversationClears[target.session_id]).toMatchObject({busy:false,error:"unknown",readbackConfirmed:true})
  expect(store.getState().conversationClears[target.session_id].confirmed).not.toBe(true);expect(clear).toHaveBeenCalledOnce()
})

it("does not infer a write from a readback when no clear was acknowledged", async () => {
  const store=harness();vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original")).mockResolvedValueOnce(checked())
  const clear=vi.spyOn(agentClient,"clearSession");await open(store)
  await store.getState().verifyConversationClear(target.session_id)
  expect(store.getState().conversationClears[target.session_id]).toMatchObject({busy:false,error:"unknown",readbackConfirmed:true})
  expect(store.getState().conversationClears[target.session_id].confirmed).not.toBe(true);expect(clear).not.toHaveBeenCalled()
})

it.each([
  ["hidden runtime message",{full_message_count:1}],
  ["running execution",{execution_active:true}],
  ["pending question",{has_pending_question:true}],
  ["pending approval",{has_pending_approval:true}],
  ["missing full count",{full_message_count:undefined}],
  ["malformed running state",{execution_active:null}],
] as const)("does not confirm when bound evidence shows %s", async (_name, patch) => {
  const store=harness(),read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original")).mockResolvedValueOnce(checked(patch))
  const {clear}=setupWrite();await open(store)
  await expect(store.getState().clearConversation(target.session_id)).rejects.toMatchObject({reason:"readback_failed"})
  expect(store.getState().conversationClears[target.session_id]?.confirmed).not.toBe(true)
  expect(store.getState().chats[0].messages[0]?.id).toBe("original")
  expect(clear).toHaveBeenCalledOnce();expect(read).toHaveBeenCalledTimes(2)
})

it("does not confirm an older bound response that lacks clear evidence", async () => {
  const store=harness(),read=vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original")).mockResolvedValueOnce(bound())
  setupWrite();await open(store)
  await expect(store.getState().clearConversation(target.session_id)).rejects.toMatchObject({reason:"readback_failed"})
  expect(store.getState().conversationClears[target.session_id]?.confirmed).not.toBe(true);expect(read).toHaveBeenCalledTimes(2)
})

it("preserves a token event delivered before the response when the clear event arrives later", async () => {
  const store=harness();let done!:()=>void;const write=new Promise<void>((resolve)=>{done=resolve})
  vi.spyOn(agentClient,"getSession").mockResolvedValue({session:summary()})
  vi.spyOn(agentClient,"getPendingQuestion").mockResolvedValue({has_pending_question:false})
  const clear=vi.spyOn(agentClient,"clearSession").mockReturnValue(write)
  const history=vi.spyOn(agentClient,"getHistory").mockResolvedValue(bound())
  const action=store.getState().clearConversation(target.session_id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce())
  store.getState().updateTokenUsage(target.session_id,{systemTokens:1,summaryTokens:0,windowTokens:98,totalTokens:99,budgetLimit:100})
  store.getState().setTruncationInfo(target.session_id,true,3)
  done();await action
  store.getState().reconcileClearedConversation(target.session_id)
  await vi.waitFor(()=>expect(history).toHaveBeenCalledTimes(2))
  await new Promise((resolve)=>setTimeout(resolve,0))
  expect(store.getState().tokenUsages[target.session_id]?.totalTokens).toBe(99)
  expect(store.getState().chats[0].config.tokenUsage?.totalTokens).toBe(99)
  expect(store.getState().truncationOccurred[target.session_id]).toBe(true)
  expect(store.getState().segmentsRemoved[target.session_id]).toBe(3)
})


it("accepts the one initial system message that C1 is allowed to retain", async () => {
  const store = harness(), system = { id:"system", role:"system" as const, content:"synthetic", created_at:target.created_at }
  vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original"))
    .mockResolvedValueOnce({ ...checked({full_message_count:1}), messages:[system] })
  setupWrite(); await open(store); await store.getState().clearConversation(target.session_id)
  expect(store.getState().conversationClears[target.session_id]?.confirmed).toBe(true)
})

it.each([
  ["truncated", { truncated:true }], ["incremental", { is_delta:true }],
  ["nonempty token", { bound_token_usage:{ total_tokens:42 } }],
] as const)("does not confirm a %s response", async (_name, patch) => {
  const store = harness()
  vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original"))
    .mockResolvedValueOnce({ ...checked(), ...patch } as HistoryResponse)
  setupWrite(); await open(store)
  await expect(store.getState().clearConversation(target.session_id)).rejects.toMatchObject({reason:"readback_failed"})
  expect(store.getState().chats[0].messages[0]?.id).toBe("original")
})

it("retains a newer live token while the identity-bound clear readback is pending", async () => {
  const store = harness(); let finish!: (value:HistoryResponse) => void
  const pending = new Promise<HistoryResponse>((resolve) => { finish = resolve })
  const read = vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original")).mockReturnValueOnce(pending)
  setupWrite(); await open(store)
  const action = store.getState().clearConversation(target.session_id)
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  store.getState().updateTokenUsage(target.session_id,{systemTokens:1,summaryTokens:0,windowTokens:98,totalTokens:99,budgetLimit:100})
  store.getState().setTruncationInfo(target.session_id,true,3)
  finish(checked()); await action
  expect(store.getState().conversationClears[target.session_id]?.confirmed).toBe(true)
  expect(store.getState().tokenUsages[target.session_id]?.totalTokens).toBe(99)
  expect(store.getState().chats[0].config.tokenUsage?.totalTokens).toBe(99)
  expect(store.getState().truncationOccurred[target.session_id]).toBe(true)
  expect(store.getState().segmentsRemoved[target.session_id]).toBe(3)
})

it("discards a bound readback if the selected lifetime changes before it returns", async () => {
  const store = harness(); let finish!: (value:HistoryResponse) => void
  const pending = new Promise<HistoryResponse>((resolve) => { finish = resolve })
  const read = vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original")).mockReturnValueOnce(pending)
  setupWrite(); await open(store)
  const action = store.getState().clearConversation(target.session_id)
  await vi.waitFor(() => expect(read).toHaveBeenCalledTimes(2))
  const different = { ...selection, target: { ...target, authority_sha256: "f".repeat(64) } }
  store.setState({ managedHistoryBindings: { [target.session_id]: { selection:different, status:"active" } } })
  finish(checked()); await expect(action).rejects.toMatchObject({reason:"readback_failed"})
  expect(store.getState().chats[0].messages[0]?.id).toBe("original")
  expect(store.getState().conversationClears[target.session_id]?.confirmed).not.toBe(true)
})


it("rechecks a benign metadata revision using the same identity and the full clear request", async () => {
  const store = harness(), version = target.metadata_version + 1
  const conflict = new ApiError("changed",409,"Conflict",JSON.stringify({code:"target_observation_stale"}))
  const read = vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original"))
    .mockRejectedValueOnce(conflict).mockResolvedValueOnce(checked())
  const observed = { ...target, metadata_version:version }
  vi.spyOn(managedSessionsClient,"read").mockResolvedValue({ ...fixture,
    sessions:[{ ...fixture.sessions[0]!, target_metadata_version:version, current_user_target:observed }] })
  setupWrite(); await open(store); await store.getState().clearConversation(target.session_id)
  expect(read).toHaveBeenLastCalledWith({ ...selection, target:observed },{clearReadback:true})
  expect(store.getState().managedHistoryBindings[target.session_id].selection.target.metadata_version).toBe(version)
  expect(store.getState().conversationClears[target.session_id]?.confirmed).toBe(true)
})

it("keeps newer token evidence across readback, ordinary refresh and the delayed clear event", async () => {
  const store = harness(); let finish!:()=>void
  const pending = new Promise<void>((resolve)=>{finish=resolve})
  const read = vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original"))
    .mockResolvedValueOnce(checked()).mockResolvedValueOnce(bound()).mockResolvedValueOnce(bound())
  const { clear } = setupWrite(); clear.mockReturnValueOnce(pending); await open(store)
  const action=store.getState().clearConversation(target.session_id)
  await vi.waitFor(()=>expect(clear).toHaveBeenCalledOnce())
  store.getState().updateTokenUsage(target.session_id,{systemTokens:1,summaryTokens:0,windowTokens:98,totalTokens:99,budgetLimit:100})
  store.getState().setTruncationInfo(target.session_id,true,3)
  finish(); await action
  await store.getState().loadChatHistory(target.session_id,{throwOnError:true})
  expect(store.getState().tokenUsages[target.session_id]?.totalTokens).toBe(99)
  expect(store.getState().truncationOccurred[target.session_id]).toBe(true)
  store.getState().reconcileClearedConversation(target.session_id)
  await vi.waitFor(()=>expect(read).toHaveBeenCalledTimes(4))
  await vi.waitFor(()=>expect(store.getState().chats[0].config.tokenUsage?.totalTokens).toBe(99))
  expect(store.getState().tokenUsages[target.session_id]?.totalTokens).toBe(99)
  expect(store.getState().truncationOccurred[target.session_id]).toBe(true)
  expect(store.getState().segmentsRemoved[target.session_id]).toBe(3)
})


it("retains a clear acknowledgement across a same-identity metadata refresh", async () => {
  const store = harness(), version = target.metadata_version + 1
  const conflict = new ApiError("changed",409,"Conflict",JSON.stringify({code:"target_observation_stale"}))
  const read = vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original"))
    .mockRejectedValueOnce(new Error("synthetic readback unavailable")).mockRejectedValueOnce(conflict)
    .mockResolvedValueOnce(bound("original")).mockResolvedValueOnce(checked())
  const observed = { ...target, metadata_version:version }
  vi.spyOn(managedSessionsClient,"read").mockResolvedValue({ ...fixture,
    sessions:[{ ...fixture.sessions[0]!, target_metadata_version:version, current_user_target:observed }] })
  const { clear } = setupWrite(); await open(store)
  await expect(store.getState().clearConversation(target.session_id)).rejects.toMatchObject({reason:"readback_failed"})
  await store.getState().loadChatHistory(target.session_id,{throwOnError:true})
  await store.getState().verifyConversationClear(target.session_id)
  expect(clear).toHaveBeenCalledOnce()
  expect(read).toHaveBeenLastCalledWith({ ...selection, target:observed },{clearReadback:true})
  expect(store.getState().conversationClears[target.session_id]?.confirmed).toBe(true)
})


it("does not transfer a clear acknowledgement to a different target lifetime", async () => {
  const store = harness(), replacement = { ...selection, target: { ...target, authority_sha256:"f".repeat(64) } }
  const read = vi.spyOn(managedSessionsClient,"readBoundHistory").mockResolvedValueOnce(bound("original"))
    .mockRejectedValueOnce(new Error("synthetic readback unavailable")).mockResolvedValueOnce(bound("replacement"))
    .mockResolvedValueOnce(checked())
  const { clear } = setupWrite(); await open(store)
  await expect(store.getState().clearConversation(target.session_id)).rejects.toMatchObject({reason:"readback_failed"})
  await store.getState().loadChatHistory(target.session_id,{
    managedSelection:replacement,beforeApply:async()=>true,canApply:()=>true,selectOnApply:true,throwOnError:true,
  })
  await store.getState().verifyConversationClear(target.session_id)
  expect(clear).toHaveBeenCalledOnce()
  expect(read).toHaveBeenLastCalledWith(replacement,{clearReadback:true})
  expect(store.getState().conversationClears[target.session_id]).toMatchObject({busy:false,error:"unknown",readbackConfirmed:true})
})
