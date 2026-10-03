import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useTicketWork } from "./useTicketWork"
import { TicketWorkPanel } from "@/components/chat/TicketWorkPanel"
import { ticketClient } from "@services/tickets/client"
import { ticketSnapshot } from "@services/tickets/testFixtures"
import type { ResponseCommand } from "@services/tickets/types"
import { ApiError } from "@services/api"

vi.mock("@services/tickets/client", () => ({ ticketClient: { load: vi.fn(), changes: vi.fn(), respond: vi.fn(), artifact: vi.fn() } }))
let root: Root, container: HTMLDivElement, controller: ReturnType<typeof useTicketWork>
let snapshot = ticketSnapshot()
let loseAck = false
const receipts = new Map<string, ResponseCommand>()
function Harness({ session = "root" }: { session?: string }) {
  controller = useTicketWork(session)
  return <TicketWorkPanel controller={controller} onReference={() => {}} />
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  snapshot = ticketSnapshot(); loseAck = false; receipts.clear()
  vi.mocked(ticketClient.load).mockImplementation(async () => structuredClone(snapshot))
  vi.mocked(ticketClient.changes).mockResolvedValue({ ...snapshot.scope.overview, data: [] })
  vi.mocked(ticketClient.respond).mockImplementation(async (command) => {
    if (!receipts.has(command.operation_id)) {
      const q = snapshot.views.flatMap((v) => v.requests).find((q) => q.id === command.target.request_id)!
      expect(q.work_id).toBe(command.target.work_id)
      expect(q.generation).toBe(command.target.generation)
      expect(q.prompt_revision).toBe(command.target.prompt_revision)
      expect(q.status).toBe("open")
      q.status = command.decision.kind === "question" ? "answered" : command.decision.approve ? "approved" : "denied"
      q.answer = command.decision.kind === "question" ? command.decision.answer : null
      snapshot.snapshot.seq += 1; snapshot.snapshot.commit = "commit-" + snapshot.snapshot.seq
      snapshot.scope.overview.snapshot = snapshot.snapshot
      snapshot.scope.overview.index_seq = snapshot.snapshot.seq
      snapshot.scope.overview.data.open_questions -= 1
      q.updated_seq = snapshot.snapshot.seq
      receipts.set(command.operation_id, structuredClone(command))
    }
    if (loseAck) { loseAck = false; throw new Error("connection lost after commit") }
    return { operation_id: command.operation_id, committed_seq: snapshot.snapshot.seq }
  })
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.resetAllMocks() })
const mount = async (session = "root") => { await act(async () => root.render(<Harness session={session} />)) }

it("rebases one known pre-commit question conflict only while its exact identity remains open", async () => {
  await mount()
  const q = controller.state!.requests["q-E"]
  snapshot.snapshot.seq = 11; snapshot.snapshot.commit = "commit-11"
  vi.mocked(ticketClient.respond).mockRejectedValueOnce(new ApiError("revision_conflict", 409, "Conflict"))
  await act(async () => { expect(await controller.respond(q, { kind: "question", answer: "答案 E" })).toBe(true) })
  const calls = vi.mocked(ticketClient.respond).mock.calls
  expect(calls).toHaveLength(2)
  expect(calls[0][0].target).toEqual(calls[1][0].target)
  expect(calls[0][0].operation_id).not.toBe(calls[1][0].operation_id)
  expect(calls[1][0].expected_seq).toBe(11)
})

it("never rebases an approval conflict or an ordinary answer after its generation changes", async () => {
  snapshot.views[0].requests[0].kind = { kind: "approval", fingerprint: "a", action: { kind: "payment", target: "A", data_hash: "a", amount: "100", permissions: [], risk: "test" } }
  await mount()
  vi.mocked(ticketClient.respond).mockRejectedValueOnce(new ApiError("revision_conflict", 409, "Conflict"))
  await act(async () => { expect(await controller.respond(controller.state!.requests["q-A"], { kind: "approval", fingerprint: "a", approve: true })).toBe(false) })
  expect(ticketClient.respond).toHaveBeenCalledTimes(1)
  const q = controller.state!.requests["q-E"]
  snapshot.snapshot.seq = 11; snapshot.snapshot.commit = "commit-11"; snapshot.views[4].ticket.generation = 2
  vi.mocked(ticketClient.respond).mockRejectedValueOnce(new ApiError("revision_conflict", 409, "Conflict"))
  await act(async () => { expect(await controller.respond(q, { kind: "question", answer: "old" })).toBe(false) })
  expect(ticketClient.respond).toHaveBeenCalledTimes(2)
})

it("keeps a known answer conflict visible through polling and allows a fresh explicit retry", async () => {
  await mount()
  const q = controller.state!.requests["q-E"]
  snapshot.snapshot.seq = 11; snapshot.snapshot.commit = "commit-11"
  vi.mocked(ticketClient.respond)
    .mockRejectedValueOnce(new ApiError("revision_conflict", 409, "Conflict"))
    .mockRejectedValueOnce(new ApiError("revision_conflict", 409, "Conflict"))
  await act(async () => { expect(await controller.respond(q, { kind: "question", answer: "答案 E" })).toBe(false) })
  expect(controller.uncertain["q-E"]).toBeUndefined()
  await act(async () => controller.refresh())
  expect(controller.error).toBe("工作已更新，请核对当前问题后再次提交。")
  expect(controller.state!.requests["q-E"].status).toBe("open")
  await act(async () => { expect(await controller.respond(controller.state!.requests["q-E"], { kind: "question", answer: "答案 E" })).toBe(true) })
  expect(ticketClient.respond).toHaveBeenCalledTimes(3)
  expect(controller.error).toBeNull()
  expect(receipts.size).toBe(1)
})

it("renders five concurrent cards and answers E/B/D/A/C without removing unresolved peers", async () => {
  await mount()
  expect(container.querySelectorAll('input[aria-label^="回答"]')).toHaveLength(5)
  for (const [index, id] of ["E", "B", "D", "A", "C"].entries()) {
    const input = container.querySelector<HTMLInputElement>(`input[aria-label="回答 报告${id}"]`)!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "答案 " + id)
      input.dispatchEvent(new Event("input", { bubbles: true }))
    })
    await act(async () => input.closest("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true })))
    expect(controller.state?.requests["q-" + id].answer).toBe("答案 " + id)
    expect(container.querySelectorAll('input[aria-label^="回答"]')).toHaveLength(4 - index)
  }
  expect(container.textContent).toContain("已处理和失效请求（5）")
  expect(receipts.size).toBe(5)
})

it("recovers an unknown decision acknowledgement using the identical operation and does not revive the closed card", async () => {
  await mount(); loseAck = true
  const q = controller.state!.requests["q-E"]
  await act(async () => { expect(await controller.respond(q, { kind: "question", answer: "答案 E" })).toBe(false) })
  const first = vi.mocked(ticketClient.respond).mock.calls[0][0]
  await act(async () => controller.refresh())
  expect(controller.state?.requests["q-E"].status).toBe("answered")
  const retry = [...container.querySelectorAll("button")].find((button) => button.textContent === "确认同一请求的发送结果")!
  await act(async () => retry.click())
  expect(vi.mocked(ticketClient.respond).mock.calls[1][0]).toEqual(first)
  expect(controller.uncertain["q-E"]).toBeUndefined()
  expect(container.querySelectorAll('input[aria-label^="回答"]')).toHaveLength(4)
  expect(receipts.size).toBe(1)
})

it("disables decisions while disconnected and ignores an old scope response after A/B/A navigation", async () => {
  await mount()
  let release!: () => void
  vi.mocked(ticketClient.respond).mockReturnValueOnce(new Promise((resolve) => { release = () => resolve({ operation_id: "old", committed_seq: 11 }) }))
  let pending!: Promise<boolean>
  act(() => { pending = controller.respond(controller.state!.requests["q-A"], { kind: "question", answer: "old" }) })
  await mount("other"); await mount("root")
  release()
  await act(async () => { expect(await pending).toBe(false) })
  vi.mocked(ticketClient.load).mockRejectedValueOnce(new Error("offline"))
  await act(async () => controller.refresh())
  expect(controller.canRespond).toBe(false)
  expect(container.textContent).toContain("连接未确认")
  expect([...container.querySelectorAll('button[type="submit"]')].every((button) => (button as HTMLButtonElement).disabled)).toBe(true)
})
