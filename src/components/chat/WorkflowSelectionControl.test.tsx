import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WorkflowSelectionControl } from "./WorkflowSelectionControl"
import type { TypedWorkflowDraft, WorkflowCatalogEntry } from "@services/command/workflowCatalog"

const catalog = vi.hoisted(() => ({ get: vi.fn() }))
vi.mock("@services/command/workflowCatalog", async (original) => ({
  ...await original<typeof import("@services/command/workflowCatalog")>(), getWorkflowCatalog: catalog.get,
}))
const entry: WorkflowCatalogEntry = {
  id: "review", name: "Review", description: "Review", kind: "instruction", source: "user", revision: 2,
  status: "valid", winner: true, invocation_policy: { explicit: true }, argument_schema: { type: "object" },
}
const roots: Root[] = []
const environment = globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }
environment.IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren(); catalog.get.mockReset() })
async function mount(selected: TypedWorkflowDraft | null = null) {
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  const change = vi.fn()
  await act(async () => root.render(<WorkflowSelectionControl sessionId="root/id" selected={selected} onChange={change} disabled={false} error={null} />))
  const toggle = document.querySelector<HTMLButtonElement>('button[aria-expanded]')!
  return { toggle, change }
}
async function click(element: HTMLElement) { await act(async () => element.click()) }
describe("Workflow typed picker", () => {
  it("loads only on open and exposes unavailable orchestration, invalid and manual entries", async () => {
    catalog.get.mockResolvedValue({ revision: 3, entries: [entry,
      { ...entry, id: "run", kind: "orchestration" }, { ...entry, id: "bad", status: "invalid", last_error: "invalid definition" },
      { ...entry, id: "manual", invocation_policy: { explicit: false } }, { ...entry, id: "no-revision", revision: 0 },
    ] })
    const { toggle, change } = await mount()
    expect(toggle.textContent).toContain("选择目录工作流")
    expect(catalog.get).not.toHaveBeenCalled()
    await click(toggle)
    expect(catalog.get).toHaveBeenCalledWith("root/id", expect.any(AbortSignal))
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="目录中的 Workflow"]')!
    expect([...select.options].slice(1).map((option) => option.disabled)).toEqual([false, true, true, true, true])
    expect(select.textContent).toContain("Workflow Run API")
    await act(async () => { select.value = "0"; select.dispatchEvent(new Event("change", { bubbles: true })) })
    expect(change).toHaveBeenCalledWith({ entry, argsText: "{}" })
  })
  it("keeps an old selected revision after catalog refresh until explicit re-selection", async () => {
    const selected = { entry, argsText: '{"target":"old"}' }
    catalog.get.mockResolvedValue({ revision: 10, entries: [{ ...entry, source: "workspace", revision: 9 }] })
    const { toggle, change } = await mount(selected); await click(toggle)
    expect(toggle.textContent).toContain("目录工作流 · Review")
    expect(document.querySelector('button[aria-label="移除目录工作流"]')).not.toBeNull()
    expect(document.body.textContent).toContain("user · r2")
    expect(change).not.toHaveBeenCalled()
    const refresh = [...document.querySelectorAll("button")].find((button) => button.textContent === "刷新 Workflow 目录")!
    await click(refresh)
    expect(catalog.get).toHaveBeenCalledTimes(2); expect(change).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Workflow 参数（JSON）"]')?.value).toBe(selected.argsText)
  })
  it("shows catalog auth failure without falling back to command metadata", async () => {
    catalog.get.mockRejectedValue(new Error("Authentication failed"))
    const { toggle } = await mount(); await click(toggle)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Authentication failed")
    expect(document.querySelector("select")).toBeNull()
  })
  it("ignores a late response after closing and aborts that request", async () => {
    let finish!: (value: unknown) => void
    catalog.get.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const { toggle } = await mount(); await click(toggle)
    const signal = catalog.get.mock.calls[0][1] as AbortSignal
    await click(toggle); expect(signal.aborted).toBe(true)
    await act(async () => finish({ revision: 3, entries: [entry] }))
    expect(document.querySelector("select")).toBeNull()
  })
})
