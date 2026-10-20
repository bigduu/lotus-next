import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ApiError } from "@services/api"
import payload from "@/test/fixtures/sprintContract/producer-http-payload.json"
import { sprintClient, type SprintCommand, type SprintInspection, type SprintPage, type SprintReceipt } from "@services/tickets/sprints"
import type { SnapshotRef, TicketScope } from "@services/tickets/types"
import { useProjectSprints } from "./useProjectSprints"
vi.mock("@services/tickets/sprints", async (original) => ({ ...await original<typeof import("@services/tickets/sprints")>(), sprintClient: { list: vi.fn(), inspect: vi.fn(), scope: vi.fn(), command: vi.fn() } }))
const sample = payload.requests_and_actual_responses
const projectId = sample.list_request.project_id
let root: Root
let latest: ReturnType<typeof useProjectSprints>
let journal: NonNullable<Parameters<typeof useProjectSprints>[5]>
const refresh = vi.fn()
const snapshot = () => ({ ...sample.list_response.snapshot })
const scope = (at = snapshot()): TicketScope => ({ available: true, mutation_enabled: true, dispatch_enabled: false, capabilities: { ticket_scope_v1: true }, binding: sample.create_request.binding,
  overview: { ...sample.list_response, data: { ticket_count: 1, work_count: 1, states: {}, open_questions: 0, open_approvals: 0, needs_acceptance: 0 }, snapshot: at } })
function Host({ id = projectId, at = snapshot(), owner = true, sprintId = null }: { id?: string; at?: SnapshotRef; owner?: boolean; sprintId?: string | null }) {
  latest = useProjectSprints(id, at, sprintId, owner, refresh, journal)
  return null
}
const render = async (props: Parameters<typeof Host>[0] = {}) => { await act(async () => root.render(<Host {...props} />)) }
const start = () => latest.command("a", { op: "start", expected_revision: 3 })
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  document.body.replaceChildren(); root = createRoot(document.body.appendChild(document.createElement("div")))
  vi.resetAllMocks()
  journal = new Map()
  vi.mocked(sprintClient.list).mockResolvedValue(structuredClone(sample.list_response) as SprintPage)
  vi.mocked(sprintClient.scope).mockResolvedValue(scope())
  vi.mocked(sprintClient.inspect).mockResolvedValue(structuredClone(sample.inspect_response) as SprintInspection)
  vi.mocked(sprintClient.command).mockImplementation(async (command) => ({ operation: { operation_id: command.operation_id, committed_seq: command.expected_seq + 1 } } as SprintReceipt))
})
afterEach(() => act(() => root.unmount()))
it("does not read or write without the verified owner context", async () => {
  await render({ owner: false })
  await act(async () => { await start() })
  expect(sprintClient.list).not.toHaveBeenCalled(); expect(sprintClient.command).not.toHaveBeenCalled()
})
it("uses the board's exact snapshot and verified canonical binding for one explicit command", async () => {
  await render()
  expect(latest.canWrite).toBe(true)
  await act(async () => { await start() })
  expect(sprintClient.list).toHaveBeenCalledWith(projectId, undefined, snapshot(), expect.any(AbortSignal))
  expect(sprintClient.command).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ project_id: projectId, binding: sample.create_request.binding, expected_seq: 6, expected_epoch: 1, action: { op: "start", expected_revision: 3 } }))
  expect(latest.request).toMatchObject({ status: "committed", committedSeq: 7 })
  expect(refresh).toHaveBeenCalledTimes(1)
})
it.each(["mutation", "binding", "epoch", "snapshot"])("keeps %s unavailable instead of granting authority from a supported route", async (kind) => {
  const value = scope()
  if (kind === "mutation") value.mutation_enabled = false
  if (kind === "binding") value.binding = undefined
  if (kind === "epoch") value.overview!.snapshot.authority_epoch++
  if (kind === "snapshot") value.overview!.snapshot.commit = "newer"
  vi.mocked(sprintClient.scope).mockResolvedValue(value)
  await render(); await act(async () => { await start() })
  expect(latest.canWrite).toBe(false); expect(sprintClient.command).not.toHaveBeenCalled()
})
it("retains conflict for explicit user review and never retries with a refreshed CAS", async () => {
  vi.mocked(sprintClient.command).mockRejectedValue(new ApiError("stale_snapshot", 409, "Conflict"))
  await render(); await act(async () => { await start(); await latest.reconcile(); await start() })
  expect(sprintClient.command).toHaveBeenCalledTimes(1)
  expect(latest.request?.status).toBe("conflict")
  expect(refresh).not.toHaveBeenCalled()
  act(() => latest.reviewLatest())
  expect(refresh).toHaveBeenCalledTimes(1)
})
it("checks an uncertain result only on demand with the identical full original command", async () => {
  vi.mocked(sprintClient.command).mockRejectedValueOnce(new TypeError("network disconnected"))
  await render(); await act(async () => { await start() })
  const command = structuredClone(vi.mocked(sprintClient.command).mock.calls[0][0]) as SprintCommand
  expect(latest.request?.status).toBe("unknown"); expect(refresh).not.toHaveBeenCalled()
  await act(async () => { await latest.reconcile() })
  expect(sprintClient.command).toHaveBeenCalledTimes(2)
  expect(vi.mocked(sprintClient.command).mock.calls[1][0]).toEqual(command)
  expect(latest.request?.status).toBe("committed")
})
it("immediately fences duplicate clicks before React publishes a busy render", async () => {
  let finish!: (value: SprintReceipt) => void
  vi.mocked(sprintClient.command).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  await render()
  let first!: Promise<void>
  act(() => { first = start(); void start() })
  expect(sprintClient.command).toHaveBeenCalledTimes(1)
  await act(async () => { const command = vi.mocked(sprintClient.command).mock.calls[0][0]; finish({ operation: { operation_id: command.operation_id, committed_seq: 7 } } as SprintReceipt); await first })
})
it("does not install a late project's data or refresh a different project's board", async () => {
  let finish!: (value: SprintReceipt) => void
  vi.mocked(sprintClient.command).mockImplementation(() => new Promise((resolve) => { finish = resolve }))
  await render()
  let operation!: Promise<void>
  act(() => { operation = start() })
  const command = vi.mocked(sprintClient.command).mock.calls[0][0]
  await render({ id: "other-project" })
  await act(async () => { finish({ operation: { operation_id: command.operation_id, committed_seq: 7 } } as SprintReceipt); await operation })
  expect(latest.request).toBeNull(); expect(refresh).not.toHaveBeenCalled()
  await render()
  expect(latest.request).toMatchObject({ status: "committed", operationId: command.operation_id })
})
it("retains unknown after a denied outcome check and cannot replace its original identity", async () => {
  vi.mocked(sprintClient.command).mockRejectedValueOnce(new TypeError("lost response")).mockRejectedValueOnce(new ApiError("denied", 403, "Forbidden"))
  await render(); await act(async () => { await start() })
  const original = structuredClone(vi.mocked(sprintClient.command).mock.calls[0][0])
  await act(async () => { await latest.reconcile() })
  expect(latest.request?.status).toBe("unknown")
  act(() => latest.reviewLatest())
  await act(async () => { await start() })
  expect(sprintClient.command).toHaveBeenCalledTimes(2)
  expect(vi.mocked(sprintClient.command).mock.calls[1][0]).toEqual(original)
  expect(refresh).not.toHaveBeenCalled()
})
it("restores an uncertain original command after the dialog is unmounted and reopened", async () => {
  vi.mocked(sprintClient.command).mockRejectedValueOnce(new TypeError("lost response"))
  await render(); await act(async () => { await start() })
  const original = structuredClone(vi.mocked(sprintClient.command).mock.calls[0][0])
  await act(async () => root.render(null))
  await render()
  expect(latest.request?.status).toBe("unknown")
  await act(async () => { await latest.reconcile() })
  expect(vi.mocked(sprintClient.command).mock.calls[1][0]).toEqual(original)
})
it("does not expose another Sprint inspection during a same-snapshot selection change", async () => {
  const old = structuredClone(sample.inspect_response) as SprintInspection
  vi.mocked(sprintClient.inspect).mockResolvedValueOnce(old)
  await render({ sprintId: "a" })
  expect(latest.inspection?.data.sprint.id).toBe("a")
  let finish!: (value: SprintInspection) => void
  vi.mocked(sprintClient.inspect).mockImplementationOnce(() => new Promise((resolve) => { finish = resolve }))
  await render({ sprintId: "b" })
  expect(latest.inspection).toBeNull(); expect(latest.canWrite).toBe(false)
  await act(async () => { const next = structuredClone(old); next.data.sprint.id = "b"; finish(next) })
  expect(latest.inspection?.data.sprint.id).toBe("b")
})
it("cannot replay an uncertain command into a different canonical scope", async () => {
  vi.mocked(sprintClient.command).mockRejectedValueOnce(new TypeError("lost response"))
  await render(); await act(async () => { await start() })
  vi.mocked(sprintClient.scope).mockResolvedValue({ ...scope(), binding: { ...sample.create_request.binding, scope_id: "another-scope" } })
  act(() => latest.refresh())
  await act(async () => {})
  await act(async () => { await latest.reconcile() })
  expect(sprintClient.command).toHaveBeenCalledTimes(1); expect(latest.request?.status).toBe("unknown")
})
it("keeps the original board usable when Sprint routes are unsupported", async () => {
  vi.mocked(sprintClient.list).mockRejectedValue(new ApiError("missing", 404, "Not Found"))
  await render()
  expect(latest.status).toBe("unsupported"); expect(latest.canWrite).toBe(false)
})
