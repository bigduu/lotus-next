import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { apiClient } from "@services/api"
import { agentClient, type ChatRequest, type ChatResponse } from "@services/chat/AgentService"
import { useTicketIngress } from "./useTicketIngress"

vi.mock("@services/api", async (original) => ({ ...await original<typeof import("@services/api")>(), apiClient: { postOnce: vi.fn() } }))
vi.mock("@services/chat/AgentService", () => ({ agentClient: { execute: vi.fn() } }))
vi.mock("@shared/store/appStore", () => ({ useAppStore: { getState: () => ({ loadChatHistory: async () => {} }) } }))
let root: Root, container: HTMLDivElement, ingress: ReturnType<typeof useTicketIngress>
function Harness() { ingress = useTicketIngress(); return null }
const request: ChatRequest = { session_id: "ticket-root", model: "fixture", message: "创建报告", thread_id: "work-A", in_reply_to: "q-A" }
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); sessionStorage.clear()
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
  await act(async () => { expect((await ingress.send({ ...request, message: "different" })).kind).toBe("blocked") })
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
  await act(async () => { expect((await ingress.send(request)).kind).toBe("accepted") })
  expect(vi.mocked(apiClient.postOnce).mock.calls[1][1]).toEqual(first)
  expect(sessionStorage.getItem("lotus-next.ticket-human.ticket-root")).toBeNull()
  expect(agentClient.execute).toHaveBeenCalledTimes(1)
})

it("keeps a confirmed message accepted when execute fails and retries only the idempotent activation", async () => {
  await mount(); vi.mocked(agentClient.execute).mockRejectedValueOnce(new Error("activation timeout"))
  await act(async () => { expect((await ingress.send(request)).kind).toBe("accepted") })
  expect(ingress.executePending).toBe("ticket-root")
  await act(async () => { expect(await ingress.retryExecute()).toBe(true) })
  expect(apiClient.postOnce).toHaveBeenCalledTimes(1)
  expect(agentClient.execute).toHaveBeenCalledTimes(2)
})
