import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ApiError, apiClient } from "@services/api"
import { beginRootModeOperation, finishRootModeOperation } from "@/lib/rootModeTransitionFence"
import { agentClient, type ChatRequest, type ChatResponse } from "@services/chat/AgentService"
import { useTicketIngress } from "./useTicketIngress"

vi.mock("@services/api", async (original) => ({ ...await original<typeof import("@services/api")>(), apiClient: { postOnce: vi.fn() } }))
vi.mock("@services/chat/AgentService", () => ({ agentClient: { execute: vi.fn() } }))
vi.mock("@shared/store/appStore", () => ({ useAppStore: { getState: () => ({ loadChatHistory: async () => {} }) } }))
let root: Root, container: HTMLDivElement, ingress: ReturnType<typeof useTicketIngress>
function Harness() { ingress = useTicketIngress("ticket-root"); return null }
const request: ChatRequest = { session_id: "ticket-root", model: "fixture", message: "创建报告", thread_id: "work-A", in_reply_to: "q-A" }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear(); localStorage.clear()
  const randomUUID = crypto.randomUUID.bind(crypto)
  vi.stubGlobal("crypto", { randomUUID, subtle: { digest: async (_algorithm: string, bytes: Uint8Array) => {
    const result = new Uint8Array(32); for (const [i, byte] of bytes.entries()) result[i % 32] ^= byte; return result.buffer
  } } })
  vi.mocked(apiClient.postOnce).mockImplementation(async (_path, value) => {
    const sent = value as ChatRequest
    return { session_id: sent.session_id, message_id: sent.message_id, ingress_seq: 1, status: "queued" } as ChatResponse
  })
  vi.mocked(agentClient.execute).mockResolvedValue({ session_id: "ticket-root", status: "already_running", events_url: "/events" })
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.resetAllMocks(); vi.unstubAllGlobals() })
const mount = async () => { await act(async () => root.render(<Harness />)) }

it("retains an uncertain exact Human identity across remount and refuses a changed instruction", async () => {
  await mount()
  vi.mocked(apiClient.postOnce).mockRejectedValueOnce(new Error("lost acknowledgement"))
  await act(async () => { expect((await ingress.send(request)).kind).toBe("unconfirmed") })
  const first = vi.mocked(apiClient.postOnce).mock.calls[0][1]
  const receipt = sessionStorage.getItem("lotus-next.ticket-human.ticket-root")!
  expect(receipt).not.toContain("创建报告")
  await act(async () => root.render(null)); await mount()
  expect(ingress.hasPending("ticket-root")).toBe(true)
  await act(async () => { expect((await ingress.send({ ...request, message: "different" })).kind).toBe("blocked") })
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
  await act(async () => { expect((await ingress.send(request)).kind).toBe("accepted") })
  expect(vi.mocked(apiClient.postOnce).mock.calls[1][1]).toEqual(first)
  expect(sessionStorage.getItem("lotus-next.ticket-human.ticket-root")).toBeNull()
  expect(agentClient.execute).toHaveBeenCalledTimes(1)
})

it("restores exact non-content references after reload even if the request has closed", async () => {
  await mount()
  vi.mocked(apiClient.postOnce).mockRejectedValueOnce(new Error("lost acknowledgement"))
  await act(async () => { expect((await ingress.send(request)).kind).toBe("unconfirmed") })
  const first = vi.mocked(apiClient.postOnce).mock.calls[0][1]
  await act(async () => root.render(null)); await mount()
  expect(ingress.references("ticket-root")).toEqual({ thread_id: "work-A", in_reply_to: "q-A" })
  await act(async () => { expect((await ingress.send({ ...request, in_reply_to: "q-B" })).kind).toBe("blocked") })
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
  const { thread_id: _thread, in_reply_to: _reply, ...draft } = request
  await act(async () => { expect((await ingress.send(draft)).kind).toBe("accepted") })
  expect(vi.mocked(apiClient.postOnce).mock.calls[1][1]).toEqual(first)
  expect(ingress.hasPending("ticket-root")).toBe(false)
})

it("does not send when the recovery receipt cannot be persisted", async () => {
  await mount()
  const storage = vi.spyOn(sessionStorage, "setItem").mockImplementation(() => { throw new Error("storage unavailable") })
  await act(async () => { expect((await ingress.send(request)).kind).toBe("unconfirmed") })
  expect(apiClient.postOnce).not.toHaveBeenCalled()
  storage.mockRestore()
})

it("keeps a confirmed message accepted when execute fails and retries only the idempotent activation", async () => {
  await mount(); vi.mocked(agentClient.execute).mockRejectedValueOnce(new Error("activation timeout"))
  await act(async () => { expect((await ingress.send(request)).kind).toBe("accepted") })
  expect(ingress.executePending).toBe("ticket-root")
  expect(JSON.parse(sessionStorage.getItem("lotus-next.ticket-human.ticket-root")!).phase).toBe("activation")
  await act(async () => root.render(null)); await mount()
  expect(ingress.executePending).toBe("ticket-root")
  await act(async () => { expect((await ingress.send(request)).kind).toBe("blocked") })
  await act(async () => { expect(await ingress.retryExecute()).toBe(true) })
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
  expect(agentClient.execute).toHaveBeenCalledTimes(2)
  expect(ingress.hasPending("ticket-root")).toBe(false)
})

it("admits one delivery across two panes before an asynchronous digest and retains its lost acknowledgement", async () => {
  let other!: ReturnType<typeof useTicketIngress>
  function Panes() { ingress = useTicketIngress("ticket-root"); other = useTicketIngress("ticket-root"); return null }
  await act(async () => root.render(<Panes />))
  let release!: (value: ArrayBuffer) => void
  vi.spyOn(crypto.subtle, "digest").mockReturnValueOnce(new Promise((resolve) => { release = resolve }))
  vi.mocked(apiClient.postOnce).mockRejectedValueOnce(new Error("lost acknowledgement"))
  let first!: Promise<Awaited<ReturnType<typeof ingress.send>>>
  act(() => { first = ingress.send(request) })
  await act(async () => { expect((await other.send({ ...request, message: "另一条工作" })).kind).toBe("busy") })
  await act(async () => { release(new Uint8Array(32).buffer); expect((await first).kind).toBe("unconfirmed") })
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
  const original = vi.mocked(apiClient.postOnce).mock.calls[0][1] as ChatRequest
  expect(JSON.parse(sessionStorage.getItem("lotus-next.ticket-human.ticket-root")!).id).toBe(original.message_id)
  // The next attempt recomputes the same fixture digest and reuses that identity.
  vi.spyOn(crypto.subtle, "digest").mockResolvedValueOnce(new Uint8Array(32).buffer)
  await act(async () => { expect((await other.send(request)).kind).toBe("accepted") })
  expect(vi.mocked(apiClient.postOnce).mock.calls[1][1]).toEqual(original)
})

it("retains the original delivery when activation recovery cannot be persisted after acknowledgement", async () => {
  await mount()
  const normal = sessionStorage.setItem.bind(sessionStorage)
  const storage = vi.spyOn(sessionStorage, "setItem")
    .mockImplementationOnce(normal)
    .mockImplementationOnce(() => { throw new Error("storage full after acknowledgement") })
  await act(async () => { expect((await ingress.send(request)).kind).toBe("unconfirmed") })
  const original = vi.mocked(apiClient.postOnce).mock.calls[0][1]
  expect(agentClient.execute).not.toHaveBeenCalled()
  storage.mockRestore()
  await act(async () => root.render(null)); await mount()
  await act(async () => { expect((await ingress.send(request)).kind).toBe("accepted") })
  expect(vi.mocked(apiClient.postOnce).mock.calls[1][1]).toEqual(original)
})

it("does not clear a different operation's recovery receipt on a rejected delivery", async () => {
  await mount()
  vi.mocked(apiClient.postOnce).mockImplementationOnce(async () => {
    const value = JSON.parse(sessionStorage.getItem("lotus-next.ticket-human.ticket-root")!)
    sessionStorage.setItem("lotus-next.ticket-human.ticket-root", JSON.stringify({ ...value, id: "newer-delivery" }))
    throw new ApiError("scope_denied", 403, "Forbidden")
  })
  await act(async () => { expect((await ingress.send(request)).kind).toBe("unconfirmed") })
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
  await act(async () => { expect((await ingress.send(request)).kind).toBe("accepted") })
  expect(agentClient.execute).not.toHaveBeenCalled()
  await act(async () => { expect(await ingress.retryExecute()).toBe(false) })
  finishRootModeOperation("ticket-root", fence)
  await act(async () => { expect(await ingress.retryExecute()).toBe(true) })
  expect(agentClient.execute).toHaveBeenCalledTimes(1)
})

it("preserves an ambiguous Human ID through an authentication rejection of its replay", async () => {
  await mount()
  vi.mocked(apiClient.postOnce).mockRejectedValueOnce(new Error("unknown outcome"))
  await act(async () => { expect((await ingress.send(request)).kind).toBe("unconfirmed") })
  const original = vi.mocked(apiClient.postOnce).mock.calls[0][1]
  vi.mocked(apiClient.postOnce).mockRejectedValueOnce(new ApiError("unauthorized", 401, "Unauthorized"))
  await act(async () => { expect((await ingress.send(request)).kind).toBe("unconfirmed") })
  await act(async () => root.render(null)); await mount()
  await act(async () => { expect((await ingress.send(request)).kind).toBe("accepted") })
  expect(vi.mocked(apiClient.postOnce).mock.calls.map(([, value]) => value)).toEqual([original, original, original])
})
