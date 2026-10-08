import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@services/api/errors"
import type { WorkflowCatalogEntry } from "@services/command/workflowCatalog"
import type { WorkflowRunSnapshot } from "@services/workflow/workflowRuns"
import { WorkflowRunsDialog } from "./WorkflowRunsDialog"

const mocks = vi.hoisted(() => ({ catalog: vi.fn(), list: vi.fn(), detail: vi.fn(), events: vi.fn(), start: vi.fn(), cancel: vi.fn() }))
vi.mock("@services/command/workflowCatalog", async (original) => ({
  ...await original<typeof import("@services/command/workflowCatalog")>(), getWorkflowCatalog: mocks.catalog,
}))
vi.mock("@services/workflow/workflowRuns", async (original) => ({
  ...await original<typeof import("@services/workflow/workflowRuns")>(),
  workflowRuns: { list: mocks.list, detail: mocks.detail, events: mocks.events, start: mocks.start, cancel: mocks.cancel },
}))

const entry: WorkflowCatalogEntry = { id: "review", name: "Read selected files", description: "Read only", kind: "orchestration",
  source: "user", revision: 7, status: "valid", winner: true, invocation_policy: { explicit: true },
  argument_schema: { type: "object", properties: { file: { type: "string" } }, required: ["file"], additionalProperties: false } }
function snapshot(sessionId = "primary", status: WorkflowRunSnapshot["status"] = "running", sequence = 5): WorkflowRunSnapshot {
  return { run_id: `${sessionId}-run`, session_id: sessionId, workflow_id: "review", workflow_revision: 7, status, can_cancel: true,
    last_sequence: sequence, steps: [{ id: "selected", status: "succeeded", attempts: 1 }, { id: "other", status: "skipped", attempts: 0 }],
    budget: { max_steps: 8, max_retries: 2, max_agents: 1, wall_time_ms: 30000, max_tokens: 1000, max_cost_micros: null },
    usage: { steps: 1, retries: 0, agents: 0, tokens: 20, cost_micros: null }, child_agent_count: 0,
    created_at: "2026-10-08T00:00:00Z", updated_at: "2026-10-08T00:00:01Z" }
}
function deferred<T>() {
  let resolve!: (value: T) => void, reject!: (error: unknown) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}
const roots: Root[] = []
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
beforeEach(() => {
  Object.values(mocks).forEach((mock) => mock.mockReset())
  mocks.catalog.mockResolvedValue({ revision: 1, entries: [entry, { ...entry, id: "instruction", kind: "instruction", name: "Chat instruction" }] })
  mocks.list.mockResolvedValue([])
  mocks.detail.mockImplementation(async (sessionId: string) => snapshot(sessionId))
  mocks.events.mockResolvedValue([])
})
afterEach(() => { roots.splice(0).forEach((root) => act(() => root.unmount())); document.body.replaceChildren() })
async function mount(sessionId = "primary", strict = false) {
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  const close = vi.fn()
  const render = async (id: string) => act(async () => {
    const content = <WorkflowRunsDialog sessionId={id} sessionTitle={`${id} chat`} onClose={close} />
    root.render(strict ? <StrictMode>{content}</StrictMode> : content)
  })
  await render(sessionId)
  return { root, close, render }
}
const body = () => document.querySelector('[role="dialog"]')!
function button(label: string) {
  const found = [...body().querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === label)
  if (!found) throw new Error(`Missing button: ${label}`)
  return found
}
async function click(element: HTMLElement) { await act(async () => element.click()) }
async function choose(revision = 7) {
  const select = body().querySelector<HTMLSelectElement>("select")!
  await act(async () => { select.value = `user:review:${revision}`; select.dispatchEvent(new Event("change", { bubbles: true })) })
}
async function args(value: string) {
  const field = body().querySelector<HTMLTextAreaElement>("textarea")!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(field, value)
    field.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("Workflow Run dialog", () => {
  it("admits only orchestration, validates args and fences duplicate start intent", async () => {
    const pending = deferred<WorkflowRunSnapshot>(); mocks.start.mockReturnValue(pending.promise)
    await mount(); expect(body().textContent).not.toContain("Chat instruction")
    await choose(); expect(button("启动运行").disabled).toBe(true)
    await args('{"file":"docs/one.md"}')
    const start = button("启动运行")
    await act(async () => { start.click(); start.click() })
    expect(mocks.start).toHaveBeenCalledExactlyOnceWith("primary", { entry, argsText: '{"file":"docs/one.md"}' })
    expect(body().querySelector<HTMLTextAreaElement>("textarea")!.disabled).toBe(true)
    expect(body().querySelector<HTMLSelectElement>("select")!.disabled).toBe(true)
    mocks.list.mockResolvedValue([snapshot()])
    await act(async () => pending.resolve(snapshot()))
    expect(body().textContent).toContain("运行中")
    expect(body().textContent).toContain("已跳过")
    expect(body().textContent).toContain("金额用量：未计量")
  })
  it("preserves exact revision and arguments after catalog refresh and a rejected start", async () => {
    mocks.start.mockRejectedValue(new ApiError("PRIVATE_PATH_TOKEN", 400, "Bad"))
    await mount(); await choose(); await args('{"file":"keep/me.md"}')
    mocks.catalog.mockResolvedValue({ revision: 2, entries: [{ ...entry, revision: 8 }] })
    await click(button("刷新"))
    expect(body().querySelector<HTMLSelectElement>("select")!.value).toBe("user:review:7")
    expect(body().querySelector<HTMLTextAreaElement>("textarea")!.value).toBe('{"file":"keep/me.md"}')
    await click(button("启动运行"))
    expect(mocks.start).toHaveBeenCalledTimes(1)
    expect(mocks.start.mock.calls[0][1].entry.revision).toBe(7)
    expect(body().textContent).toContain("已保留选择")
    expect(body().textContent).not.toContain("PRIVATE_PATH_TOKEN")
    expect(body().querySelector<HTMLTextAreaElement>("textarea")!.value).toBe('{"file":"keep/me.md"}')
    await choose(8); expect(body().querySelector<HTMLTextAreaElement>("textarea")!.value).toBe("{}")
  })
  it.each([
    { cost: 50, limit: 2000, expected: "50/2000" },
    { cost: 50, limit: null, expected: "50" },
    { cost: 0, limit: 2000, expected: "0/2000" },
  ])("shows metered usage and its optional budget without treating zero as unmetered ($expected)", async ({ cost, limit, expected }) => {
    const run = snapshot()
    run.usage = { ...run.usage, agents: 2, cost_micros: cost }
    run.budget = { ...run.budget, max_agents: 4, max_cost_micros: limit }
    run.child_agent_count = 2
    mocks.list.mockResolvedValue([run]); mocks.detail.mockResolvedValue(run)
    await mount()
    expect(body().textContent).toContain("代理: 2/4")
    expect(body().textContent).toContain(`金额用量（微单位）: ${expected}`)
    expect(body().textContent).not.toContain("金额用量：未计量")
  })
  it("preserves the start draft on a conflict without claiming a run has already ended", async () => {
    mocks.start.mockRejectedValue(new ApiError("PRIVATE_CONFLICT", 409, "Conflict"))
    await mount(); await choose(); await args('{"file":"keep/me.md"}'); await click(button("启动运行"))
    expect(body().textContent).toContain("编排状态已变化")
    expect(body().textContent).not.toContain("此运行已结束")
    expect(body().textContent).not.toContain("PRIVATE_CONFLICT")
    expect(body().querySelector<HTMLSelectElement>("select")!.value).toBe("user:review:7")
    expect(body().querySelector<HTMLTextAreaElement>("textarea")!.value).toBe('{"file":"keep/me.md"}')
    expect(mocks.start).toHaveBeenCalledTimes(1)
  })
  it("does not assume an ambiguous start failed or automatically replay it", async () => {
    mocks.start.mockRejectedValue(new Error("PRIVATE_BODY"))
    await mount(); await choose(); await args('{"file":"safe.md"}'); await click(button("启动运行"))
    expect(body().textContent).toContain("操作结果尚未确认")
    await click(button("刷新")); expect(mocks.start).toHaveBeenCalledTimes(1)
    expect(body().textContent).not.toContain("PRIVATE_BODY")
  })
  it("reconstructs a running snapshot even when the event tail is unavailable", async () => {
    mocks.list.mockResolvedValue([snapshot("primary", "queued", 1)])
    mocks.detail.mockResolvedValue(snapshot())
    mocks.events.mockRejectedValue(new Error("PRIVATE_EVENT"))
    await mount()
    expect(body().textContent).toContain("运行中")
    expect(body().textContent).toContain("状态可能已过期")
    expect(body().textContent).not.toContain("PRIVATE_EVENT")
    expect(button("取消运行").disabled).toBe(false)
  })
  it("uses snapshot authority and event cursor without synthesizing terminal state from an event", async () => {
    mocks.list.mockResolvedValue([snapshot()])
    mocks.events.mockResolvedValueOnce([{ run_id: "primary-run", sequence: 8, type: "run_cancelled" }]).mockResolvedValue([])
    await mount(); expect(body().textContent).toContain("运行中")
    await click(button("刷新"))
    expect(mocks.events).toHaveBeenLastCalledWith("primary", "primary-run", 8, expect.any(AbortSignal))
    expect(body().textContent).not.toContain("已取消")
  })
  it("fences a pending read and never rolls a confirmed cancellation back to an older snapshot", async () => {
    mocks.list.mockResolvedValue([snapshot()])
    const { root } = await mount()
    const oldRead = deferred<WorkflowRunSnapshot[]>()
    mocks.list.mockReturnValueOnce(oldRead.promise).mockResolvedValue([snapshot()])
    await click(button("刷新"))
    const pending = deferred<WorkflowRunSnapshot>(); mocks.cancel.mockReturnValue(pending.promise)
    const cancel = button("取消运行")
    await act(async () => { cancel.click(); cancel.click() })
    expect(mocks.cancel).toHaveBeenCalledExactlyOnceWith("primary", "primary-run")
    expect(body().textContent).not.toContain("已取消")
    await act(async () => pending.resolve(snapshot("primary", "cancelled", 9)))
    await act(async () => oldRead.resolve([snapshot()]))
    expect(body().textContent).toContain("已取消")
    expect(body().textContent).not.toContain("运行中")
    expect([...body().querySelectorAll("button")].some((item) => item.textContent === "取消运行")).toBe(false)
    act(() => root.unmount()); roots.splice(roots.indexOf(root), 1)
  })
  it("fences old-session reads and mutation completion when the pane switches sessions", async () => {
    mocks.list.mockResolvedValueOnce([snapshot()])
    const { render } = await mount()
    const pending = deferred<WorkflowRunSnapshot>(); mocks.cancel.mockReturnValue(pending.promise)
    await click(button("取消运行"))
    const oldSignal = mocks.list.mock.calls[0][1] as AbortSignal
    mocks.list.mockImplementation(async (id: string) => [snapshot(id)])
    await render("side")
    expect(oldSignal.aborted).toBe(true)
    expect(mocks.catalog).toHaveBeenLastCalledWith("side", expect.any(AbortSignal))
    await act(async () => pending.resolve(snapshot("primary", "cancelled", 9)))
    expect(body().textContent).toContain("side-run")
    expect(body().textContent).not.toContain("primary-run")
    expect(body().textContent).not.toContain("已取消")
    await click(button("取消运行")); expect(mocks.cancel).toHaveBeenLastCalledWith("side", "side-run")
  })
  it("aborts a late list on unmount, stops polling, and remains usable under StrictMode", async () => {
    vi.useFakeTimers()
    const { root } = await mount("primary", true)
    expect(mocks.list.mock.calls.length).toBeGreaterThanOrEqual(2)
    const before = mocks.list.mock.calls.length
    await act(async () => vi.advanceTimersByTime(2000))
    expect(mocks.list).toHaveBeenCalledTimes(before + 1)
    const delayed = deferred<WorkflowRunSnapshot[]>()
    mocks.list.mockReturnValueOnce(delayed.promise)
    await click(button("刷新"))
    const signal = mocks.list.mock.calls.at(-1)![1] as AbortSignal
    act(() => root.unmount()); roots.splice(roots.indexOf(root), 1)
    expect(signal.aborted).toBe(true)
    const closed = mocks.list.mock.calls.length
    await act(async () => { delayed.resolve([snapshot()]); vi.advanceTimersByTime(10000) })
    expect(mocks.list).toHaveBeenCalledTimes(closed)
    expect(document.querySelector('[role="dialog"]')).toBeNull()
  })
  it("distinguishes a failed history read from an empty history and keeps errors private", async () => {
    mocks.list.mockRejectedValue(new ApiError("PRIVATE_BODY", 403, "Denied"))
    await mount(); expect(body().textContent).toContain("未获授权")
    expect(body().textContent).not.toContain("还没有编排运行记录")
    expect(body().textContent).not.toContain("PRIVATE_BODY")
    mocks.list.mockResolvedValue([]); await click(button("刷新"))
    expect(body().textContent).toContain("还没有编排运行记录")
    expect(body().textContent).not.toContain("未获授权")
  })
})
