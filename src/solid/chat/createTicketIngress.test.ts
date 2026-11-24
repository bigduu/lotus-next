import { clearSessionCompatibilityObservations, observeSessionExecutionConflict } from "@services/chat/sessionExecutionCompatibility"
import { createRoot, createSignal, flush } from "solid-js"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ApiError, apiClient, RequestTimeoutError } from "@services/api"
import { beginRootModeOperation, finishRootModeOperation } from "@/lib/rootModeTransitionState"
import { agentClient, type ChatRequest, type ChatResponse } from "@services/chat/AgentService"
import { hasPendingTicketIngress } from "@services/tickets/ingress"
import { createTicketIngress } from "./createTicketIngress"

vi.mock("@services/api", async (original) => ({ ...await original<typeof import("@services/api")>(), apiClient: { postOnce: vi.fn() } }))
vi.mock("@services/chat/AgentService", () => ({ agentClient: { execute: vi.fn() } }))
vi.mock("@shared/store/appStore/state", () => ({ appStore: { getState: () => ({ loadChatHistory: async () => {} }) } }))
type Ingress = ReturnType<typeof createTicketIngress>
let ingress: Ingress
let owner: ReturnType<typeof createOwner> | undefined

function createOwner(initialSessionId: string, withPeer = false) {
  return createRoot((dispose) => {
    const [sessionId, select] = createSignal(initialSessionId)
    ingress = createTicketIngress(sessionId, () => false)
    const peer = withPeer ? createTicketIngress(sessionId, () => false) : undefined
    return { dispose, sessionId, select, peer }
  })
}
async function settle(action?: () => unknown) {
  const result = action?.()
  flush()
  await result
  await new Promise<void>((resolve) => setTimeout(resolve, 0))
  flush()
}
function unmount() {
  owner?.dispose()
  owner = undefined
}
const activeRecoverySession = () => ingress.activationPending ? owner?.sessionId() : null
const request: ChatRequest = { session_id: "ticket-root", model: "fixture", message: "创建报告", thread_id: "work-A", in_reply_to: "q-A" }
beforeEach(() => {
  clearSessionCompatibilityObservations()
  sessionStorage.clear()
  localStorage.clear()
  const randomUUID = crypto.randomUUID.bind(crypto)
  vi.stubGlobal("crypto", { randomUUID, subtle: { digest: async (_algorithm: string, bytes: Uint8Array) => {
    const result = new Uint8Array(32); for (const [i, byte] of bytes.entries()) result[i % 32] ^= byte; return result.buffer
  } } })
  vi.mocked(apiClient.postOnce).mockImplementation(async (_path, value) => {
    const sent = value as ChatRequest
    return { session_id: sent.session_id, message_id: sent.message_id, ingress_seq: 1, status: "queued" } as ChatResponse
  })
  vi.mocked(agentClient.execute).mockResolvedValue({ session_id: "ticket-root", status: "already_running", events_url: "/events" })
})
afterEach(() => { unmount(); vi.resetAllMocks(); vi.unstubAllGlobals() })
const navigate = (sessionId: string) => settle(() => {
  if (owner) owner.select(sessionId)
  else owner = createOwner(sessionId)
})
const mount = () => navigate("ticket-root")

it("retains an uncertain exact Human identity across remount and refuses a changed instruction", async () => {
  await mount()
  vi.mocked(apiClient.postOnce).mockRejectedValueOnce(new Error("lost acknowledgement"))
  await settle(async () => { expect((await ingress.send(request)).kind).toBe("unconfirmed") })
  const first = vi.mocked(apiClient.postOnce).mock.calls[0][1]
  const receipt = sessionStorage.getItem("lotus-next.ticket-human.ticket-root")!
  expect(receipt).not.toContain("创建报告")
  unmount(); await mount()
  expect(hasPendingTicketIngress("ticket-root")).toBe(true)
  await settle(async () => { expect((await ingress.send({ ...request, message: "different" })).kind).toBe("blocked") })
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
  await settle(async () => { expect((await ingress.send(request)).kind).toBe("accepted") })
  expect(vi.mocked(apiClient.postOnce).mock.calls[1][1]).toEqual(first)
  expect(sessionStorage.getItem("lotus-next.ticket-human.ticket-root")).toBeNull()
  expect(agentClient.execute).toHaveBeenCalledTimes(1)
})

it("restores exact non-content references after reload even if the request has closed", async () => {
  await mount()
  vi.mocked(apiClient.postOnce).mockRejectedValueOnce(new Error("lost acknowledgement"))
  await settle(async () => { expect((await ingress.send(request)).kind).toBe("unconfirmed") })
  const first = vi.mocked(apiClient.postOnce).mock.calls[0][1]
  unmount(); await mount()
  expect(ingress.references).toEqual({ thread_id: "work-A", in_reply_to: "q-A" })
  await settle(async () => { expect((await ingress.send({ ...request, in_reply_to: "q-B" })).kind).toBe("blocked") })
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
  const { thread_id: _thread, in_reply_to: _reply, ...draft } = request
  await settle(async () => { expect((await ingress.send(draft)).kind).toBe("accepted") })
  expect(vi.mocked(apiClient.postOnce).mock.calls[1][1]).toEqual(first)
  expect(hasPendingTicketIngress("ticket-root")).toBe(false)
})

it("does not send when the recovery receipt cannot be persisted", async () => {
  await mount()
  const storage = vi.spyOn(sessionStorage, "setItem").mockImplementation(() => { throw new Error("storage unavailable") })
  await settle(async () => { expect((await ingress.send(request)).kind).toBe("unconfirmed") })
  expect(apiClient.postOnce).not.toHaveBeenCalled()
  storage.mockRestore()
})

it("acknowledges a saved Human message while activation is pending and keeps its admission locked", async () => {
  let confirm!: (value: Awaited<ReturnType<typeof agentClient.execute>>) => void
  vi.mocked(agentClient.execute).mockReturnValueOnce(new Promise((resolve) => { confirm = resolve }))
  await mount()
  let accepted: Awaited<ReturnType<typeof ingress.send>> | undefined
  await settle(async () => { void ingress.send(request).then((result) => { accepted = result }) })
  try {
    expect(accepted).toMatchObject({ kind: "accepted", sessionId: "ticket-root" })
    expect(ingress.busy).toBe(true)
    expect(ingress.starting).toBe(true)
    expect(ingress.error).toBeNull()
    expect(ingress.canRetryStart).toBe(false)
    expect(JSON.parse(sessionStorage.getItem("lotus-next.ticket-human.ticket-root")!).phase).toBe("activation")
    await settle(async () => { expect((await ingress.send({ ...request, message: "next instruction" })).kind).toBe("busy") })
    expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
    expect(agentClient.execute).toHaveBeenCalledTimes(1)
  } finally {
    await settle(async () => { confirm({ session_id: "ticket-root", status: "started", events_url: "/events" }) })
  }
  expect(ingress.busy).toBe(false)
  expect(ingress.starting).toBe(false)
  expect(hasPendingTicketIngress("ticket-root")).toBe(false)
})

it("shows an unconfirmed start only after the activation request times out and retries only activation", async () => {
  let reject!: (failure: Error) => void
  vi.mocked(agentClient.execute).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
  await mount()
  let sending!: ReturnType<typeof ingress.send>
  await settle(async () => { sending = ingress.send(request) })
  expect(ingress.starting).toBe(true)
  expect(ingress.error).toBeNull()
  expect(ingress.canRetryStart).toBe(false)
  await settle(async () => {
    reject(new RequestTimeoutError())
    expect((await sending).kind).toBe("accepted")
  })
  expect(ingress.starting).toBe(false)
  expect(ingress.error).not.toBeNull()
  expect(ingress.canRetryStart).toBe(true)
  expect(activeRecoverySession()).toBe("ticket-root")
  expect(JSON.parse(sessionStorage.getItem("lotus-next.ticket-human.ticket-root")!).phase).toBe("activation")
  unmount(); await mount()
  expect(activeRecoverySession()).toBe("ticket-root")
  await settle(async () => { expect((await ingress.send(request)).kind).toBe("blocked") })
  await settle(async () => { expect(await ingress.retryExecute()).toBe(true) })
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
  expect(agentClient.execute).toHaveBeenCalledTimes(2)
  expect(ingress.error).toBeNull()
  expect(hasPendingTicketIngress("ticket-root")).toBe(false)
})

it("admits one delivery across two panes before an asynchronous digest and retains its lost acknowledgement", async () => {
  await settle(() => { owner = createOwner("ticket-root", true) })
  const other = owner!.peer!
  let release!: (value: ArrayBuffer) => void
  vi.spyOn(crypto.subtle, "digest").mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
  vi.mocked(apiClient.postOnce).mockRejectedValueOnce(new Error("lost acknowledgement"))
  let first!: Promise<Awaited<ReturnType<typeof ingress.send>>>
  await settle(() => { first = ingress.send(request) })
  await settle(async () => { expect((await other.send({ ...request, message: "另一条工作" })).kind).toBe("busy") })
  await settle(async () => { release(new Uint8Array(32).buffer); expect((await first).kind).toBe("unconfirmed") })
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
  const original = vi.mocked(apiClient.postOnce).mock.calls[0][1] as ChatRequest
  expect(JSON.parse(sessionStorage.getItem("lotus-next.ticket-human.ticket-root")!).id).toBe(original.message_id)
  // The next attempt recomputes the same fixture digest and reuses that identity.
  vi.spyOn(crypto.subtle, "digest").mockResolvedValueOnce(new Uint8Array(32).buffer)
  await settle(async () => { expect((await other.send(request)).kind).toBe("accepted") })
  expect(vi.mocked(apiClient.postOnce).mock.calls[1][1]).toEqual(original)
})

it("retains the original delivery when activation recovery cannot be persisted after acknowledgement", async () => {
  await mount()
  const normal = sessionStorage.setItem.bind(sessionStorage)
  const storage = vi.spyOn(sessionStorage, "setItem")
    .mockImplementationOnce(normal)
    .mockImplementationOnce(() => { throw new Error("storage full after acknowledgement") })
  await settle(async () => { expect((await ingress.send(request)).kind).toBe("unconfirmed") })
  const original = vi.mocked(apiClient.postOnce).mock.calls[0][1]
  expect(agentClient.execute).not.toHaveBeenCalled()
  storage.mockRestore()
  unmount(); await mount()
  await settle(async () => { expect((await ingress.send(request)).kind).toBe("accepted") })
  expect(vi.mocked(apiClient.postOnce).mock.calls[1][1]).toEqual(original)
})

it("does not clear a different operation's recovery receipt on a rejected delivery", async () => {
  await mount()
  vi.mocked(apiClient.postOnce).mockImplementationOnce(async () => {
    const value = JSON.parse(sessionStorage.getItem("lotus-next.ticket-human.ticket-root")!)
    sessionStorage.setItem("lotus-next.ticket-human.ticket-root", JSON.stringify({ ...value, id: "newer-delivery" }))
    throw new ApiError("scope_denied", 403, "Forbidden")
  })
  await settle(async () => { expect((await ingress.send(request)).kind).toBe("unconfirmed") })
  expect(JSON.parse(sessionStorage.getItem("lotus-next.ticket-human.ticket-root")!).id).toBe("newer-delivery")
})

it("rechecks the Root fence after chat acknowledgement and before every activation retry", async () => {
  await mount()
  const normal = vi.mocked(apiClient.postOnce).getMockImplementation()!
  let fence!: NonNullable<ReturnType<typeof beginRootModeOperation>>
  vi.mocked(apiClient.postOnce).mockImplementationOnce(async (...args) => {
    fence = beginRootModeOperation("ticket-root", 1, "birth", true)!
    return normal(...args)
  })
  await settle(async () => { expect((await ingress.send(request)).kind).toBe("accepted") })
  expect(agentClient.execute).not.toHaveBeenCalled()
  await settle(async () => { expect(await ingress.retryExecute()).toBe(false) })
  finishRootModeOperation("ticket-root", fence)
  await settle(async () => { expect(await ingress.retryExecute()).toBe(true) })
  expect(agentClient.execute).toHaveBeenCalledTimes(1)
})

it("preserves an ambiguous Human ID through an authentication rejection of its replay", async () => {
  await mount()
  vi.mocked(apiClient.postOnce).mockRejectedValueOnce(new Error("unknown outcome"))
  await settle(async () => { expect((await ingress.send(request)).kind).toBe("unconfirmed") })
  const original = vi.mocked(apiClient.postOnce).mock.calls[0][1]
  vi.mocked(apiClient.postOnce).mockRejectedValueOnce(new ApiError("unauthorized", 401, "Unauthorized"))
  await settle(async () => { expect((await ingress.send(request)).kind).toBe("unconfirmed") })
  unmount(); await mount()
  await settle(async () => { expect((await ingress.send(request)).kind).toBe("accepted") })
  expect(vi.mocked(apiClient.postOnce).mock.calls.map(([, value]) => value)).toEqual([original, original, original])
})

const activationReceipt = (sessionId: string) => sessionStorage.setItem(`lotus-next.ticket-human.${sessionId}`,
  JSON.stringify({ id: `${sessionId}-delivery`, fingerprint: "0".repeat(64), fingerprint_version: 2, phase: "activation" }))

it("isolates a late A activation from B recovery and its own pending activation", async () => {
  activationReceipt("B")
  let releaseA!: (value: Awaited<ReturnType<typeof agentClient.execute>>) => void
  let releaseB!: (value: Awaited<ReturnType<typeof agentClient.execute>>) => void
  vi.mocked(agentClient.execute)
    .mockReturnValueOnce(new Promise((resolve) => { releaseA = resolve }))
    .mockReturnValueOnce(new Promise((resolve) => { releaseB = resolve }))
  await navigate("ticket-root")
  let sending!: ReturnType<typeof ingress.send>
  await settle(async () => { sending = ingress.send(request) })
  await navigate("B")
  expect(activeRecoverySession()).toBe("B")
  let retrying!: ReturnType<typeof ingress.retryExecute>
  await settle(async () => { retrying = ingress.retryExecute() })
  expect(ingress.busy).toBe(true)
  const error = ingress.error
  await settle(async () => {
    releaseA({ session_id: "ticket-root", status: "already_running", events_url: "/events" })
    expect((await sending).kind).toBe("accepted")
  })
  expect(activeRecoverySession()).toBe("B")
  expect(ingress.error).toBe(error)
  expect(ingress.busy).toBe(true)
  expect(hasPendingTicketIngress("ticket-root")).toBe(false)
  expect(JSON.parse(sessionStorage.getItem("lotus-next.ticket-human.B")!).phase).toBe("activation")
  await settle(async () => {
    releaseB({ session_id: "B", status: "started", events_url: "/events" })
    expect(await retrying).toBe(true)
  })
  expect(activeRecoverySession()).toBeNull()
  expect(ingress.busy).toBe(false)
  expect(hasPendingTicketIngress("B")).toBe(false)
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
})

it("isolates a late A ingress error from the newly selected B recovery view", async () => {
  activationReceipt("B")
  let reject!: (failure: Error) => void
  vi.mocked(apiClient.postOnce).mockReturnValueOnce(new Promise((_resolve, rejectPromise) => { reject = rejectPromise }))
  await navigate("ticket-root")
  let sending!: ReturnType<typeof ingress.send>
  await settle(async () => { sending = ingress.send(request) })
  await navigate("B")
  const error = ingress.error
  await settle(async () => { reject(new Error("A acknowledgement unavailable")); expect((await sending).kind).toBe("unconfirmed") })
  expect(activeRecoverySession()).toBe("B")
  expect(ingress.error).toBe(error)
  expect(ingress.busy).toBe(false)
  expect(hasPendingTicketIngress("ticket-root")).toBe(true)
})

it("refreshes the owned receipt and admission after navigating A to B to A", async () => {
  activationReceipt("B")
  let release!: (value: Awaited<ReturnType<typeof agentClient.execute>>) => void
  vi.mocked(agentClient.execute).mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
  await navigate("ticket-root")
  let sending!: ReturnType<typeof ingress.send>
  await settle(async () => { sending = ingress.send(request) })
  await navigate("B"); expect(activeRecoverySession()).toBe("B")
  expect(ingress.starting).toBe(false)
  expect(ingress.canRetryStart).toBe(true)
  await navigate("ticket-root")
  expect(activeRecoverySession()).toBe("ticket-root")
  expect(ingress.busy).toBe(true)
  expect(ingress.starting).toBe(true)
  expect(ingress.error).toBeNull()
  await settle(async () => {
    release({ session_id: "ticket-root", status: "already_running", events_url: "/events" })
    expect((await sending).kind).toBe("accepted")
  })
  expect(activeRecoverySession()).toBeNull()
  expect(ingress.error).toBeNull()
  expect(ingress.starting).toBe(false)
  expect(ingress.busy).toBe(false)
  expect(hasPendingTicketIngress("ticket-root")).toBe(false)
  await navigate("B")
  expect(activeRecoverySession()).toBe("B")
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
})

it.each(["started", "already_running", "completed"] as const)("retains activation recovery when a %s acknowledgement belongs to another session", async (status) => {
  await mount()
  vi.mocked(agentClient.execute).mockResolvedValueOnce({ session_id: "other-session", status, events_url: "/events" })
  await settle(async () => { expect((await ingress.send(request)).kind).toBe("accepted") })
  const receipt = sessionStorage.getItem("lotus-next.ticket-human.ticket-root")
  expect(receipt).not.toBeNull()
  expect(activeRecoverySession()).toBe("ticket-root")
  vi.mocked(agentClient.execute).mockResolvedValueOnce({ session_id: "other-session", status, events_url: "/events" })
  await settle(async () => { expect(await ingress.retryExecute()).toBe(false) })
  expect(sessionStorage.getItem("lotus-next.ticket-human.ticket-root")).toBe(receipt)
  unmount(); await mount()
  await settle(async () => { expect(await ingress.retryExecute()).toBe(true) })
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
  expect(agentClient.execute).toHaveBeenCalledTimes(3)
  expect(hasPendingTicketIngress("ticket-root")).toBe(false)
})

const versionRefusal = () => new ApiError("incompatible", 409, "", JSON.stringify({ session_id: "ticket-root",
  error: { code: "session_execution_incompatible" }, compatibility: { session_version: null, current_session_version: 1,
    status: "conflict", history_readable: true, execution_allowed: false,
    conflicts: [{ code: "unsupported_runtime_state_version", message: "Unsupported runtime" }] } }))
it("blocks Human ingress before submission for an explicit compatibility conflict", async () => {
  await mount(); observeSessionExecutionConflict("ticket-root", versionRefusal())
  await settle(async () => { expect((await ingress.send(request)).kind).toBe("blocked") })
  expect(apiClient.postOnce).not.toHaveBeenCalled(); expect(agentClient.execute).not.toHaveBeenCalled()
  expect(sessionStorage.getItem("lotus-next.ticket-human.ticket-root")).toBeNull()
})
it("preserves acknowledged Human ingress when activation has a typed version conflict and never retries it", async () => {
  await mount(); vi.mocked(agentClient.execute).mockRejectedValueOnce(versionRefusal())
  await settle(async () => { expect((await ingress.send(request)).kind).toBe("accepted") })
  expect(activeRecoverySession()).toBe("ticket-root")
  expect(ingress.canRetryStart).toBe(false)
  await settle(async () => { expect(await ingress.retryExecute()).toBe(false) })
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1); expect(agentClient.execute).toHaveBeenCalledTimes(1)
})
