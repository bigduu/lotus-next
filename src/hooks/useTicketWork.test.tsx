import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useTicketWork } from "./useTicketWork"
import { OwnerAccessContext } from "./ownerAccessContext"
import { TicketWorkAvailability } from "@/components/chat/TicketWorkAvailability"
import { TicketWorkPanel } from "@/components/chat/TicketWorkPanel"
import { scopeAvailability, TicketScopeUnavailableError } from "@services/tickets/availability"
import { ticketClient } from "@services/tickets/client"
import { initializableTicketScope, readyTicketScopeV1, ticketSnapshot } from "@services/tickets/testFixtures"
import type { ResponseCommand, TicketSnapshot } from "@services/tickets/types"
import { ApiError } from "@services/api"
import { changeLocale } from "@shared/i18n"

vi.mock("@services/tickets/client", () => ({ ticketClient: { load: vi.fn(), scope: vi.fn(), changes: vi.fn(), respond: vi.fn(), initialize: vi.fn(), artifact: vi.fn() } }))
let root: Root, container: HTMLDivElement, controller: ReturnType<typeof useTicketWork>
let snapshot = ticketSnapshot()
let loseAck = false
const receipts = new Map<string, ResponseCommand>()
function Harness({ session = "root", authorityKey = "", authorityBlocked = false, deferRead = false }: { session?: string; authorityKey?: string; authorityBlocked?: boolean; deferRead?: boolean }) {
  controller = useTicketWork(session, authorityKey, authorityBlocked, deferRead)
  return controller.state ? <TicketWorkPanel controller={controller} onReference={() => {}} />
    : <TicketWorkAvailability availability={controller.availability} refreshing={controller.refreshing} canRefresh={controller.canRefresh}
      onRefresh={() => void controller.refresh()} canInitialize={controller.canInitialize} initializing={controller.initializing}
      initializationError={controller.initializationError} onInitialize={() => void controller.initialize()} />
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  snapshot = ticketSnapshot(); loseAck = false; receipts.clear(); sessionStorage.clear()
  vi.mocked(ticketClient.load).mockImplementation(async () => structuredClone(snapshot))
  vi.mocked(ticketClient.scope).mockImplementation(async () => structuredClone(snapshot.scope))
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
afterEach(() => { act(() => root.unmount()); container.remove(); vi.resetAllMocks(); vi.useRealTimers() })
const mount = async (session = "root", ownerAccess = true, authorityKey = "", authorityBlocked = false, deferRead = false) => {
  await act(async () => root.render(<OwnerAccessContext value={ownerAccess}><Harness session={session} authorityKey={authorityKey} authorityBlocked={authorityBlocked} deferRead={deferRead} /></OwnerAccessContext>))
}

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

it.each<[string, (value: TicketSnapshot) => void]>([
  ["partial coverage", (value) => { value.complete = false }],
  ["mutation disabled", (value) => { value.scope.mutation_enabled = false }],
  ["readonly authority", (value) => { value.scope.health = "readonly" }],
  ["different scope", (value) => { value.scope.binding.scope_id = "replacement" }],
  ["different binding", (value) => { value.scope.binding.binding_revision += 1 }],
  ["different Supervisor", (value) => { value.scope.binding.supervisor_session_id = "other" }],
])("does not rebase a question after a conflict refresh reports %s", async (_label, change) => {
  await mount()
  const q = controller.state!.requests["q-E"]
  snapshot.snapshot.seq = 11; snapshot.snapshot.commit = "commit-11"
  change(snapshot)
  vi.mocked(ticketClient.respond).mockRejectedValueOnce(new ApiError("revision_conflict", 409, "Conflict"))
  await act(async () => { expect(await controller.respond(q, { kind: "question", answer: "答案 E" })).toBe(false) })
  expect(ticketClient.respond).toHaveBeenCalledTimes(1)
})

it("does not rebase from a newer cached snapshot when the conflict refresh loses connection", async () => {
  await mount()
  let reject!: (failure: Error) => void
  vi.mocked(ticketClient.respond).mockReturnValueOnce(new Promise((_resolve, fail) => { reject = fail }))
  let pending!: Promise<boolean>
  act(() => { pending = controller.respond(controller.state!.requests["q-E"], { kind: "question", answer: "答案 E" }) })
  snapshot.snapshot.seq = 11; snapshot.snapshot.commit = "commit-11"
  await act(async () => controller.refresh())
  vi.mocked(ticketClient.load).mockRejectedValueOnce(new Error("offline during conflict refresh"))
  await act(async () => { reject(new ApiError("revision_conflict", 409, "Conflict")); expect(await pending).toBe(false) })
  expect(ticketClient.respond).toHaveBeenCalledTimes(1)
})

it("keeps negotiation pending until loading establishes an available or absent scope", async () => {
  let finish!: (value: TicketSnapshot | null) => void
  vi.mocked(ticketClient.load).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  await mount()
  expect(controller.negotiated).toBe(false)
  expect(controller.canSendIngress).toBe(false)
  await act(async () => finish(null))
  expect(controller.negotiated).toBe(true)
  expect(controller.state).toBeNull()
})

it("resynchronizes a fixed snapshot after the server expires its changes watermark", async () => {
  vi.useFakeTimers(); await mount()
  snapshot.snapshot.seq = 11; snapshot.snapshot.commit = "commit-11"
  snapshot.scope.overview.snapshot = snapshot.snapshot; snapshot.scope.overview.index_seq = 11
  vi.mocked(ticketClient.changes).mockRejectedValueOnce(new ApiError("resync_required", 410, "Gone"))
  await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
  expect(ticketClient.load).toHaveBeenCalledTimes(2)
  expect(controller.state!.current.snapshot.seq).toBe(11)
  expect(controller.canRespond).toBe(true)
  expect(controller.error).toBeNull()
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

it("keeps an ambiguous approval identity across navigation, reload, and rejected replays", async () => {
  const q = snapshot.views[0].requests[0]
  q.kind = { kind: "approval", fingerprint: "a", action: { kind: "payment", target: "A", data_hash: "a", amount: "100", permissions: [], risk: "test" } }
  await mount()
  vi.mocked(ticketClient.respond).mockRejectedValueOnce(new Error("unknown outcome"))
  const decision = { kind: "approval" as const, fingerprint: "a", approve: true }
  await act(async () => { expect(await controller.respond(q, decision)).toBe(false) })
  const original = vi.mocked(ticketClient.respond).mock.calls[0][0]
  await mount("other"); await mount("root")
  expect(controller.uncertain[q.id]).toEqual(original)
  await act(async () => { expect(await controller.respond(q, { ...decision, approve: false })).toBe(false) })
  vi.mocked(ticketClient.respond).mockRejectedValueOnce(new ApiError("unauthorized", 401, "Unauthorized"))
  await act(async () => { expect(await controller.respond(q, decision)).toBe(false) })
  await act(async () => root.render(null)); await mount()
  expect(controller.uncertain[q.id]).toEqual(original)
  await act(async () => { expect(await controller.respond(q, decision)).toBe(true) })
  expect(vi.mocked(ticketClient.respond).mock.calls.map(([value]) => value)).toEqual([original, original, original])
  expect(controller.uncertain[q.id]).toBeUndefined()
})

it("blocks mutations on an incomplete snapshot and hides unsupported reference actions", async () => {
  snapshot.complete = false
  await mount()
  expect(controller.canRespond).toBe(false)
  expect(controller.canSendIngress).toBe(true)
  await act(async () => { expect(await controller.respond(controller.state!.requests["q-A"], { kind: "question", answer: "partial" })).toBe(false) })
  expect(ticketClient.respond).not.toHaveBeenCalled()
  await act(async () => root.render(<TicketWorkPanel controller={controller} />))
  expect(container.textContent).not.toContain("在普通输入中引用此请求")
})

it("refreshes negotiated write capabilities without a ticket content commit", async () => {
  vi.useFakeTimers()
  await mount()
  expect(controller.canSendIngress).toBe(true)
  expect(controller.canRespond).toBe(true)
  snapshot.scope.mutation_enabled = false
  await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
  expect(controller.canSendIngress).toBe(false)
  expect(controller.canRespond).toBe(false)
  snapshot.scope.mutation_enabled = true
  await act(async () => { await vi.advanceTimersByTimeAsync(2500) })
  expect(controller.canSendIngress).toBe(true)
  expect(controller.canRespond).toBe(true)
  expect(ticketClient.load).toHaveBeenCalledTimes(1)
})

it.each(["operation", "negative", "fractional", "unsafe", "not-advanced"])("preserves approval recovery on malformed %s acknowledgement", async (kind) => {
  const q = snapshot.views[0].requests[0]
  q.kind = { kind: "approval", fingerprint: "a", action: { kind: "payment", target: "A", data_hash: "a", amount: "100", permissions: [], risk: "test" } }
  await mount()
  vi.mocked(ticketClient.respond).mockImplementationOnce(async (command) => ({
    operation_id: kind === "operation" ? "different-operation" : command.operation_id,
    committed_seq: kind === "negative" ? -1 : kind === "fractional" ? 10.5 : kind === "unsafe" ? Number.MAX_SAFE_INTEGER + 1 : kind === "not-advanced" ? command.expected_seq : command.expected_seq + 1,
  }))
  const decision = { kind: "approval" as const, fingerprint: "a", approve: true }
  await act(async () => { expect(await controller.respond(q, decision)).toBe(false) })
  const original = vi.mocked(ticketClient.respond).mock.calls[0][0]
  expect(controller.uncertain[q.id]).toEqual(original)
  await mount("other"); await mount("root")
  expect(controller.uncertain[q.id]).toEqual(original)
  await act(async () => { expect(await controller.respond(q, { ...decision, approve: false })).toBe(false) })
  expect(ticketClient.respond).toHaveBeenCalledTimes(1)
  await act(async () => { expect(await controller.respond(q, decision)).toBe(true) })
  expect(vi.mocked(ticketClient.respond).mock.calls[1][0]).toEqual(original)
  expect(controller.uncertain[q.id]).toBeUndefined()
})

it.each([null, "other-result"])("shows accepted evidence via its pointer while current submission is %s", async (currentSubmission) => {
  const view = snapshot.views[0]; view.ticket.state = "accepted"
  view.ticket.accepted_submission = "accepted-result"; view.ticket.current_submission = currentSubmission
  const result = (id: string, evidence: string) => ({ id, work_id: "A", generation: 1, contract_revision: 1, stale: false, artifacts: [], evidence: [evidence], updated_seq: 10 })
  view.submissions = [result("accepted-result", "canonical accepted evidence"), result("other-result", "current pending evidence")]
  await mount()
  const accepted = [...container.querySelectorAll("p")].find((node) => node.textContent === "已验收成果")!
  expect(accepted.parentElement!.textContent).toContain("canonical accepted evidence")
  expect(accepted.parentElement!.textContent).not.toContain("current pending evidence")
  if (currentSubmission) expect(container.textContent).toContain("已提交成果，等待验收")
  else expect(container.textContent).not.toContain("current pending evidence")
})

it.each(["generation", "prompt_revision", "assignment_id"])("clears a definitely uncommitted receipt when conflict refresh changes %s", async (field) => {
  await mount()
  const old = controller.state!.requests["q-E"]
  const view = snapshot.views[4]; const revised = view.requests[0]
  snapshot.snapshot.seq = 11; snapshot.snapshot.commit = "commit-11"
  revised.updated_seq = 11
  if (field === "generation") { view.ticket.generation = 2; revised.generation = 2 }
  else if (field === "prompt_revision") revised.prompt_revision = 2
  else revised.assignment_id = "replacement-assignment"
  vi.mocked(ticketClient.respond).mockRejectedValueOnce(new ApiError("revision_conflict", 409, "Conflict"))
  await act(async () => { expect(await controller.respond(old, { kind: "question", answer: "old answer" })).toBe(false) })
  expect(controller.uncertain[old.id]).toBeUndefined()
  expect(sessionStorage.getItem("lotus-next.ticket-decision.root.q-E")).toBeNull()
  await act(async () => { expect(await controller.respond(controller.state!.requests[old.id], { kind: "question", answer: "revised answer" })).toBe(true) })
  expect(vi.mocked(ticketClient.respond).mock.calls[1][0].target).toEqual(expect.objectContaining({ generation: revised.generation, prompt_revision: revised.prompt_revision, assignment_id: revised.assignment_id }))
})

it("switches ticket labels and plural counts without changing request data or the answer input", async () => {
  await mount()
  const input = container.querySelector("input")!
  const rawPrompt = controller.state!.requests["q-E"].prompt
  await act(async () => { await changeLocale("en-US") })
  expect(container.querySelector('[data-testid="ticket-work-overview"]')?.getAttribute("aria-label")).toBe("Work overview")
  expect(container.textContent).toContain("unanswered question")
  expect(input.getAttribute("aria-label")).toBe("Answer 报告A")
  expect(container.textContent).toContain(rawPrompt)
  expect(container.querySelector("input")).toBe(input)
  await act(async () => { await changeLocale("zh-CN") })
  expect(container.querySelector('[data-testid="ticket-work-overview"]')?.getAttribute("aria-label")).toBe("工作总览")
  expect(container.textContent).toContain(rawPrompt)
  expect(container.querySelector("input")).toBe(input)
})

it("shows the objective while keeping generated evidence and execution paths in closed diagnostics", async () => {
  const view = snapshot.views[0]
  view.ticket.state = "accepted"; view.ticket.accepted_submission = "opaque-submission"
  view.ticket.contract.objective = "Deliver reviewed code with acceptance evidence"
  view.submissions = [{ id: "opaque-submission", work_id: "A", generation: 1, contract_revision: 1,
    stale: false, updated_seq: 10, artifacts: [{ uri: "managed:result", sha256: "a".repeat(64) }],
    evidence: ["Read /private/internal/worktree/answer.rs", "canonical Child 63f417ee-0828-41b6-a40d-21f0ac37cf96; run opaque-run; sha256 " + "b".repeat(64)] }]
  await mount()
  const objective = [...container.querySelectorAll("p")].find((p) => p.textContent === view.ticket.contract.objective)!
  expect(objective.closest("details")).toBeNull()
  for (const text of [view.submissions[0].id, ...view.submissions[0].evidence]) {
    const node = [...container.querySelectorAll("p")].find((p) => p.textContent === text)!
    expect(node.closest("details")).not.toBeNull()
    expect(node.closest("details")!.open).toBe(false)
  }
  const result = [...container.querySelectorAll("button")].find((button) => button.textContent === "读取成果 1")!
  expect(result).toBeDefined()
  expect(result.closest("details")).toBeNull()
  expect(container.textContent).toContain("1 份成果可查看")
})


it("denies owner-only requests when Root access is absent or explicitly denied", async () => {
  await act(async () => root.render(<Harness />))
  expect(controller.negotiated).toBe(true)
  expect(controller.state).toBeNull()
  await mount("root", false)
  await act(async () => {
    window.dispatchEvent(new Event("focus"))
    window.dispatchEvent(new Event("online"))
    await controller.refresh()
    expect(await controller.respond(snapshot.views[0].requests[0], { kind: "question", answer: "denied" })).toBe(false)
  })
  expect(controller.canRefresh).toBe(false)
  expect(ticketClient.load).not.toHaveBeenCalled()
  expect(ticketClient.scope).not.toHaveBeenCalled()
  expect(ticketClient.changes).not.toHaveBeenCalled()
  expect(ticketClient.respond).not.toHaveBeenCalled()
  expect(controller.canSendIngress).toBe(false)
  expect(controller.canRespond).toBe(false)
})

it("revokes pending owner reads and reloads only after fresh access admission", async () => {
  let finish!: (value: TicketSnapshot) => void
  vi.mocked(ticketClient.load).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  await mount("root", true)
  const signal = vi.mocked(ticketClient.load).mock.calls[0][1]!
  await mount("root", false)
  expect(signal.aborted).toBe(true)
  await act(async () => { finish(structuredClone(snapshot)) })
  expect(controller.state).toBeNull()
  expect(controller.canRespond).toBe(false)
  await act(async () => controller.refresh())
  expect(ticketClient.load).toHaveBeenCalledTimes(1)
  await mount("root", true)
  expect(ticketClient.load).toHaveBeenCalledTimes(2)
  expect(controller.state?.current.scope.binding.supervisor_session_id).toBe("root")
})

it.each(["acknowledged", "conflict", "unknown"] as const)("ignores a late %s decision after owner access is revoked and readmitted", async (outcome) => {
  await mount()
  let finish!: () => void
  vi.mocked(ticketClient.respond).mockImplementationOnce((command) => new Promise((resolve, reject) => {
    finish = () => outcome === "acknowledged"
      ? resolve({ operation_id: command.operation_id, committed_seq: command.expected_seq + 1 })
      : reject(outcome === "conflict" ? new ApiError("revision_conflict", 409, "Conflict") : new Error("unknown outcome"))
  }))
  let pending!: Promise<boolean>
  act(() => { pending = controller.respond(controller.state!.requests["q-A"], { kind: "question", answer: "before revocation" }) })
  await mount("root", false)
  expect(controller.state).toBeNull()
  expect(controller.negotiated).toBe(true)
  expect(controller.canRespond).toBe(false)
  expect(controller.canSendIngress).toBe(false)
  await act(async () => {
    window.dispatchEvent(new Event("focus"))
    window.dispatchEvent(new Event("online"))
    await controller.refresh()
  })
  expect(ticketClient.load).toHaveBeenCalledTimes(1)
  await mount("root", true)
  const readmittedState = controller.state
  await act(async () => { finish(); expect(await pending).toBe(false) })
  expect(controller.state).toEqual(readmittedState)
  expect(controller.state?.requests["q-A"].status).toBe("open")
  expect(controller.error).toBeNull()
  expect(controller.busy).toEqual({})
  expect(ticketClient.respond).toHaveBeenCalledTimes(1)
  expect(controller.canRespond).toBe(true)
})


it.each(["disabled", "uninitialized", "unbound", "unsupported", "error"] as const)("exposes initial %s with its reason and permits explicit re-read", async (kind) => {
  vi.mocked(ticketClient.load).mockRejectedValueOnce(new TicketScopeUnavailableError(kind, "exact service reason"))
  await mount()
  expect(controller.availability).toEqual({ kind, detail: "exact service reason" })
  expect(controller.state).toBeNull()
  expect(controller.negotiated).toBe(true)
  expect(controller.canRespond).toBe(false)
  expect(controller.canSendIngress).toBe(false)
  await act(async () => controller.refresh())
  expect(controller.availability.kind).toBe("ready")
  expect(controller.state).not.toBeNull()
})

it.each([401, 403, 503])("exposes initial HTTP %s instead of indefinite loading", async (status) => {
  vi.mocked(ticketClient.load).mockRejectedValueOnce(new ApiError("service failure", status, "failure"))
  await mount()
  expect(controller.availability.kind).toBe(status === 503 ? "error" : "forbidden")
  expect(controller.state).toBeNull()
  expect(controller.canRespond).toBe(false)
  await act(async () => controller.refresh())
  expect(controller.availability.kind).toBe("ready")
})

it("shows ready empty Work and does not infer missing access from zero records", async () => {
  snapshot.views = []
  snapshot.scope.overview.data = { ticket_count: 0, work_count: 0, states: {}, open_questions: 0, open_approvals: 0, needs_acceptance: 0 }
  await mount()
  expect(controller.availability.kind).toBe("ready")
  expect(controller.canRespond).toBe(true)
  expect(container.textContent).toContain("此工作范围还没有记录工作")
})

it("clears revoked scope data but retains disconnected data through transient read failures", async () => {
  await mount()
  vi.mocked(ticketClient.load).mockRejectedValueOnce(new Error("network failure"))
  await act(async () => controller.refresh())
  expect(controller.availability).toEqual({ kind: "error", detail: "network failure" })
  expect(controller.state).not.toBeNull()
  expect(controller.canRespond).toBe(false)
  vi.mocked(ticketClient.load).mockRejectedValueOnce(new ApiError("owner revoked", 403, "Forbidden"))
  await act(async () => controller.refresh())
  expect(controller.availability.kind).toBe("forbidden")
  expect(controller.state).toBeNull()
})

it("does not start duplicate refreshes or accept a late status after navigation", async () => {
  await mount()
  let finish!: (value: TicketSnapshot) => void
  vi.mocked(ticketClient.load).mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
  let pending!: Promise<void>
  act(() => { pending = controller.refresh() })
  expect(controller.refreshing).toBe(true)
  await act(async () => controller.refresh())
  expect(ticketClient.load).toHaveBeenCalledTimes(2)
  await mount("other")
  await act(async () => { finish(structuredClone(snapshot)); await pending })
  expect(controller.availability.kind).toBe("ready")
  expect(controller.refreshing).toBe(false)
})

function offerInitialization() {
  const scope = initializableTicketScope()
  const presentation = scopeAvailability(scope, "root")!
  vi.mocked(ticketClient.load).mockRejectedValueOnce(new TicketScopeUnavailableError("uninitialized", "", presentation))
  snapshot.scope = readyTicketScopeV1(); snapshot.views = []
  snapshot.scope.overview.data = { ticket_count: 0, work_count: 0, states: {}, open_questions: 0, open_approvals: 0, needs_acceptance: 0 }
  return scope.initialization!
}

it.each([true, false])("initializes once, waits for a canonical read and accepts created=%s", async (created) => {
  const confirmation = offerInitialization()
  await mount()
  expect(controller.canInitialize).toBe(true)
  expect(container.textContent).toContain("初始化空工作范围")
  let acknowledge!: () => void
  vi.mocked(ticketClient.initialize).mockReturnValueOnce(new Promise((resolve) => {
    acknowledge = () => resolve({ created, scope: readyTicketScopeV1() })
  }))
  let pending!: Promise<boolean>
  act(() => { pending = controller.initialize() })
  expect(controller.initializing).toBe(true)
  await act(async () => {
    expect(await controller.initialize()).toBe(false)
    await controller.refresh(); window.dispatchEvent(new Event("focus")); window.dispatchEvent(new Event("online"))
  })
  expect(ticketClient.initialize).toHaveBeenCalledExactlyOnceWith(confirmation)
  expect(ticketClient.load).toHaveBeenCalledTimes(1)
  let read!: () => void
  vi.mocked(ticketClient.load).mockReturnValueOnce(new Promise((resolve) => { read = () => resolve(structuredClone(snapshot)) }))
  await act(async () => acknowledge())
  expect(controller.state).toBeNull()
  expect(controller.initializing).toBe(true)
  expect(controller.canInitialize).toBe(false)
  await act(async () => { read(); expect(await pending).toBe(true) })
  expect(controller.state).not.toBeNull()
  expect(controller.availability.kind).toBe("ready")
  expect(controller.initializationError).toBeNull()
  expect(controller.initializing).toBe(false)
})

it.each(["initialization_conflict", "scope_requires_recovery", "scope_binding_mismatch"])("re-reads a readable scope after 409/%s without replaying initialization", async (code) => {
  offerInitialization(); await mount()
  snapshot.scope.mutation_enabled = false; snapshot.scope.dispatch_enabled = false
  vi.mocked(ticketClient.initialize).mockRejectedValueOnce(new ApiError("known refusal", 409, "Conflict", JSON.stringify({ error: "known refusal", code, scope: snapshot.scope })))
  await act(async () => { expect(await controller.initialize()).toBe(false) })
  expect(controller.state).not.toBeNull()
  expect(controller.availability.kind).toBe("ready")
  expect(controller.error).toContain("known refusal")
  expect(controller.initializationError).toContain("初始化期间工作范围已变化")
  expect(controller.initializationError).not.toContain("离线")
  expect(controller.canInitialize).toBe(false)
  expect(controller.canRespond).toBe(false)
  expect(ticketClient.initialize).toHaveBeenCalledTimes(1)
  expect(ticketClient.load).toHaveBeenCalledTimes(2)
})

it.each([new Error("lost acknowledgement"), new ApiError("unexpected server failure", 503, "Unavailable"), new Error("malformed acknowledgement")])("does not claim or replay an unconfirmed initialization: %s", async (failure) => {
  offerInitialization(); await mount()
  vi.mocked(ticketClient.initialize).mockRejectedValueOnce(failure)
  await act(async () => { expect(await controller.initialize()).toBe(false) })
  expect(controller.state).not.toBeNull()
  expect(controller.initializationError).toContain("无法确认初始化响应")
  expect(ticketClient.initialize).toHaveBeenCalledTimes(1)
  expect(ticketClient.load).toHaveBeenCalledTimes(2)
})

it.each([401, 403])("revokes the initialization offer after owner denial HTTP %s", async (status) => {
  offerInitialization(); await mount()
  vi.mocked(ticketClient.initialize).mockRejectedValueOnce(new ApiError("denied", status, "Denied"))
  await act(async () => { expect(await controller.initialize()).toBe(false) })
  expect(controller.availability.kind).toBe("forbidden")
  expect(controller.state).toBeNull()
  expect(controller.canInitialize).toBe(false)
  expect(controller.initializing).toBe(false)
  expect(ticketClient.load).toHaveBeenCalledTimes(1)
})

it.each((["navigation", "mode", "owner"] as const).flatMap((change) => (["ack", "error"] as const).map((outcome) => [change, outcome] as const)))("ignores late initialization after %s changes / %s", async (change, outcome) => {
  offerInitialization(); await mount()
  let finish!: () => void
  vi.mocked(ticketClient.initialize).mockReturnValueOnce(new Promise((resolve, reject) => {
    finish = () => outcome === "ack" ? resolve({ created: true, scope: readyTicketScopeV1() }) : reject(new Error("late unconfirmed response"))
  }))
  let pending!: Promise<boolean>
  act(() => { pending = controller.initialize() })
  if (change === "navigation") {
    const other = ticketSnapshot(); other.scope.binding.supervisor_session_id = "other"
    vi.mocked(ticketClient.load).mockResolvedValueOnce(other)
  }
  await mount(change === "navigation" ? "other" : "root", change !== "owner", change === "mode" ? "standard:2" : "", change === "mode")
  const nextState = controller.state, nextAvailability = controller.availability
  const readsBeforeReceipt = vi.mocked(ticketClient.load).mock.calls.length
  expect(controller.canInitialize).toBe(false)
  await act(async () => { finish(); expect(await pending).toBe(false) })
  expect(controller.state).toEqual(nextState)
  expect(controller.availability).toEqual(nextAvailability)
  expect(controller.initializationError).toBeNull()
  expect(controller.initializing).toBe(false)
  expect(ticketClient.load).toHaveBeenCalledTimes(readsBeforeReceipt)
  expect(ticketClient.initialize).toHaveBeenCalledTimes(1)
})

it("keeps initialization unconfirmed when the matching success is followed by a failed canonical read", async () => {
  offerInitialization(); await mount()
  vi.mocked(ticketClient.initialize).mockResolvedValueOnce({ created: true, scope: readyTicketScopeV1() })
  vi.mocked(ticketClient.load).mockRejectedValueOnce(new Error("canonical read failed"))
  await act(async () => { expect(await controller.initialize()).toBe(false) })
  expect(controller.state).toBeNull()
  expect(controller.availability.kind).toBe("error")
  expect(controller.initializationError).toContain("无法确认初始化响应")
  expect(controller.error).toContain("canonical read failed")
  expect(controller.canInitialize).toBe(false)
})

it("gets a fresh offer after a completed mode change and never substitutes its epoch for binding revision", async () => {
  const confirmation = offerInitialization(); await mount()
  await mount("root", true, "mode-changing", true)
  expect(controller.canInitialize).toBe(false)
  const scope = initializableTicketScope(); scope.initialization!.binding_revision = 91
  const presentation = scopeAvailability(scope, "root")!
  vi.mocked(ticketClient.load).mockRejectedValueOnce(new TicketScopeUnavailableError("uninitialized", "", presentation))
  await mount("root", true, "ultra:3")
  expect(controller.canInitialize).toBe(true)
  vi.mocked(ticketClient.initialize).mockRejectedValueOnce(new ApiError("conflict", 409, "Conflict"))
  await act(async () => controller.initialize())
  expect(ticketClient.initialize).toHaveBeenCalledExactlyOnceWith({ ...confirmation, binding_revision: 91 })
})

it.each((["ack", "error"] as const).flatMap((outcome) => (["A-first", "B-first"] as const).map((order) => [outcome, order] as const)))("keeps initialization locks scoped across A/B navigation (%s, %s)", async (outcome, order) => {
  const a = `initialization-A-${outcome}-${order}`, b = `initialization-B-${outcome}-${order}`
  const incarnation = (id: string) => id === a ? "11111111-1111-4111-8111-111111111111" : "22222222-2222-4222-8222-222222222222"
  const offer = (id: string) => {
    const value = initializableTicketScope()
    value.initialization = { ...value.initialization!, supervisor_session_id: id, incarnation_id: incarnation(id) }
    return value
  }
  const ready = (id: string) => {
    const value = ticketSnapshot()
    value.views = []; value.scope = readyTicketScopeV1()
    value.scope.binding = { ...value.scope.binding, supervisor_session_id: id, scope_id: "supervisor/" + incarnation(id) }
    return value
  }
  const completed = new Set<string>()
  vi.mocked(ticketClient.load).mockImplementation(async (id) => {
    if (completed.has(id)) return ready(id)
    throw new TicketScopeUnavailableError("uninitialized", "", scopeAvailability(offer(id), id)!)
  })
  let finishA!: () => void, finishB!: () => void
  vi.mocked(ticketClient.initialize).mockReturnValueOnce(new Promise((resolve, reject) => {
    finishA = () => {
      if (outcome === "ack") { completed.add(a); resolve({ created: true, scope: ready(a).scope }) }
      else reject(new Error("late A response unavailable"))
    }
  })).mockReturnValueOnce(new Promise((resolve) => {
    finishB = () => { completed.add(b); resolve({ created: true, scope: ready(b).scope }) }
  }))
  await mount(a)
  let pendingA!: Promise<boolean>, pendingB: Promise<boolean> | undefined
  act(() => { pendingA = controller.initialize() })
  try {
    await mount(b)
    expect(controller.canInitialize).toBe(true)
    act(() => { pendingB = controller.initialize() })
    expect(ticketClient.initialize).toHaveBeenCalledTimes(2)
    expect(vi.mocked(ticketClient.initialize).mock.calls.map(([command]) => command)).toEqual([offer(a).initialization, offer(b).initialization])
    expect(controller.initializing).toBe(true)
    await act(async () => { expect(await controller.initialize()).toBe(false) })
    if (order === "A-first") {
      await act(async () => { finishA(); expect(await pendingA).toBe(false) })
      expect(controller.initializing).toBe(true)
      expect(controller.initializationError).toBeNull()
      await act(async () => { expect(await controller.initialize()).toBe(false) })
      await act(async () => { finishB(); expect(await pendingB).toBe(true) })
    } else {
      await act(async () => { finishB(); expect(await pendingB).toBe(true) })
      const stateB = controller.state
      await act(async () => { finishA(); expect(await pendingA).toBe(false) })
      expect(controller.state).toEqual(stateB)
    }
    expect(controller.state?.current.scope.binding.supervisor_session_id).toBe(b)
    expect(controller.initializing).toBe(false)
    expect(controller.initializationError).toBeNull()
    await mount(a)
    expect(controller.initializing).toBe(false)
    expect(controller.canInitialize).toBe(outcome === "error")
    expect(ticketClient.initialize).toHaveBeenCalledTimes(2)
  } finally {
    await act(async () => { finishA(); finishB(); await Promise.allSettled([pendingA, pendingB]) })
  }
})

it("admits only one initialization across two panels showing the same Supervisor", async () => {
  offerInitialization()
  const scope = initializableTicketScope()
  const presentation = scopeAvailability(scope, "root")!
  vi.mocked(ticketClient.load).mockRejectedValueOnce(new TicketScopeUnavailableError("uninitialized", "", presentation))
  const panels: Record<string, ReturnType<typeof useTicketWork>> = {}
  function SharedHarness({ name }: { name: string }) { panels[name] = useTicketWork("root"); return null }
  await act(async () => root.render(<OwnerAccessContext value={true}><SharedHarness name="a" /><SharedHarness name="b" /></OwnerAccessContext>))
  expect(panels.a.canInitialize).toBe(true); expect(panels.b.canInitialize).toBe(true)
  let finish!: () => void
  vi.mocked(ticketClient.initialize).mockReturnValueOnce(new Promise((resolve) => { finish = () => resolve({ created: true, scope: readyTicketScopeV1() }) }))
  let pending!: Promise<boolean>
  act(() => { pending = panels.a.initialize() })
  expect(panels.b.initializing).toBe(true)
  expect(panels.b.canInitialize).toBe(false)
  await act(async () => { expect(await panels.b.initialize()).toBe(false); await panels.b.refresh() })
  expect(ticketClient.initialize).toHaveBeenCalledTimes(1)
  expect(ticketClient.load).toHaveBeenCalledTimes(2)
  await act(async () => { finish(); expect(await pending).toBe(true) })
  expect(panels.a.initializing).toBe(false); expect(panels.b.initializing).toBe(false)
})

it("keeps scope reads separate from a pending Root mode while denying initialization and writes", async () => {
  offerInitialization(); await mount("root", true, "pending-mode", true)
  expect(controller.availability.kind).toBe("uninitialized")
  expect(controller.canRefresh).toBe(true)
  expect(controller.canInitialize).toBe(false)
  await act(async () => { expect(await controller.initialize()).toBe(false); await controller.refresh() })
  expect(controller.state).not.toBeNull()
  expect(controller.availability.kind).toBe("ready")
  expect(controller.canRespond).toBe(false)
  expect(controller.canSendIngress).toBe(false)
  expect(ticketClient.initialize).not.toHaveBeenCalled()
  expect(ticketClient.load).toHaveBeenCalledTimes(2)
})

it("shows an independent scope error even while Root mode recovery is pending", async () => {
  vi.mocked(ticketClient.load).mockRejectedValueOnce(new TicketScopeUnavailableError("error", "storage failure",
    { kind: "error", detail: "storage failure", reasonCode: "scope_io_error" }))
  await mount("root", true, "pending-mode", true)
  expect(controller.availability).toMatchObject({ kind: "error", reasonCode: "scope_io_error" })
  expect(controller.canRefresh).toBe(true)
  expect(container.textContent).toContain("无法读取工作存储")
  expect(controller.canInitialize).toBe(false)
})

it("starts one scope read after initial identity metadata settles and keeps unchanged context readable", async () => {
  await mount("root", true, "identity-pending", false, true)
  expect(controller.availability.kind).toBe("loading")
  expect(controller.canInitialize).toBe(false)
  expect(ticketClient.load).not.toHaveBeenCalled()
  await mount("root", true, "birth:1:true")
  expect(controller.availability.kind).toBe("ready")
  expect(ticketClient.load).toHaveBeenCalledTimes(1)
  const previous = controller.state
  await mount("root", true, "birth:1:true")
  expect(controller.state).toEqual(previous)
  expect(ticketClient.load).toHaveBeenCalledTimes(1)
})


it("shows the scoped execution session, objective and recorded status without cross-session Loop controls", async () => {
  const work = snapshot.views[0]
  work.ticket.contract.objective = "Compare the report with its acceptance evidence"
  work.sections = ["assignments", "requests", "submissions"]
  work.assignments = [{ id: work.ticket.active_assignment!, work_id: work.ticket.id, generation: 1, contract_revision: 1,
    state: "running", runtime: { session_id: "worker-session-A", run_id: "run-A" } }]
  await mount()
  expect(container.textContent).toContain(work.ticket.contract.objective)
  expect(container.textContent).toContain("worker-session-A")
  expect(container.textContent).toContain("运行中")
  expect(container.textContent).toContain("跨会话长程控制暂不可用")
  expect([...container.querySelectorAll("button")].some((button) => /启动循环|修改循环|停止循环/.test(button.textContent ?? ""))).toBe(false)
  vi.mocked(ticketClient.load).mockRejectedValueOnce(new TicketScopeUnavailableError("forbidden"))
  await act(async () => controller.refresh())
  expect(container.textContent).not.toContain("worker-session-A")
})

it.each(["work", "generation", "contract", "sections"])("does not present a %s mismatch as a managed execution", async (mismatch) => {
  const work = snapshot.views[0]
  work.sections = mismatch === "sections" ? ["requests", "submissions"] : ["assignments", "requests", "submissions"]
  work.assignments = [{ id: work.ticket.active_assignment!, work_id: mismatch === "work" ? "other" : work.ticket.id,
    generation: mismatch === "generation" ? 0 : 1, contract_revision: mismatch === "contract" ? 2 : 1,
    state: "running", runtime: { session_id: "unrelated-session", run_id: "old-run" } }]
  await mount()
  expect(container.textContent).not.toContain("unrelated-session")
  expect(container.textContent).toContain("执行会话信息尚未确认")
})

it("shows an accepted result's execution record after its active assignment has cleared", async () => {
  const work = snapshot.views[0]
  work.ticket.active_assignment = null; work.ticket.state = "accepted"; work.ticket.accepted_submission = "accepted-A"
  work.sections = ["assignments", "requests", "submissions"]
  work.assignments = [{ id: "assignment-A", work_id: work.ticket.id, generation: 1, contract_revision: 1,
    state: "submitted", process_stopped: true, runtime: { session_id: "completed-session", run_id: "completed-run" } }]
  work.submissions = [{ id: "accepted-A", assignment_id: "assignment-A", work_id: work.ticket.id, generation: 1,
    contract_revision: 1, stale: false, artifacts: [], evidence: ["verified result"], updated_seq: 10 }]
  await mount()
  expect(container.textContent).toContain("completed-session")
  expect(container.textContent).toContain("执行进程已确认结束")
  expect(container.textContent).toContain("已验收成果")
})


it.each(["supervisor_mode_required", "supervisor_identity_mismatch"] as const)("keeps the owner-only canonical reason after initialization HTTP 403/%s", async (code) => {
  offerInitialization(); await mount()
  const scope = { ...initializableTicketScope(), availability: { kind: "forbidden" as const, reason_code: code },
    reason: "Canonical scope refusal", can_initialize: false, initialization: null }
  vi.mocked(ticketClient.initialize).mockRejectedValueOnce(new ApiError("Scope refusal", 403, "Forbidden",
    JSON.stringify({ error: { type: "api_error", message: "Scope refusal" }, code, scope })))
  await act(async () => { expect(await controller.initialize()).toBe(false) })
  expect(controller.availability.reasonCode).toBe(code)
  expect(controller.initializationError).toBe("Canonical scope refusal")
  expect(controller.state).toBeNull()
  expect(controller.canInitialize).toBe(false)
  expect(ticketClient.load).toHaveBeenCalledTimes(1)
})

it("never promotes an HTTP 403 with a readable or contradictory scope", async () => {
  offerInitialization(); await mount()
  vi.mocked(ticketClient.initialize).mockRejectedValueOnce(new ApiError("Denied", 403, "Forbidden",
    JSON.stringify({ error: { message: "Denied" }, code: "supervisor_mode_required", scope: readyTicketScopeV1() })))
  await act(async () => { expect(await controller.initialize()).toBe(false) })
  expect(controller.availability).toMatchObject({ kind: "forbidden" })
  expect(controller.availability.reasonCode).toBeUndefined()
  expect(controller.state).toBeNull()
  expect(controller.canInitialize).toBe(false)
  expect(ticketClient.load).toHaveBeenCalledTimes(1)
})
