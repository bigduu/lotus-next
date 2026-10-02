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
async function mount(selected: TypedWorkflowDraft | null = null, error: string | null = null) {
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  const change = vi.fn()
  const close = vi.fn()
  await act(async () => root.render(<WorkflowSelectionControl sessionId="root/id" selected={selected} onChange={change} onClose={close} disabled={false} error={error} />))
  const toggle = document.querySelector<HTMLButtonElement>('button[aria-expanded]')!
  return { toggle, change, close, render: async (openRequest: number) => act(async () => root.render(<WorkflowSelectionControl sessionId="root/id" selected={selected} onChange={change} onClose={close} openRequest={openRequest} disabled={false} error={error} />)) }
}
async function click(element: HTMLElement) { await act(async () => element.click()) }
describe("Workflow typed picker", () => {
  it("loads on demand, explains the difference from text workflows, and collapses after selection", async () => {
    catalog.get.mockResolvedValue({ revision: 3, entries: [entry,
      { ...entry, id: "run", kind: "orchestration" }, { ...entry, id: "bad", status: "invalid", last_error: "invalid definition" },
      { ...entry, id: "manual", invocation_policy: { explicit: false } }, { ...entry, id: "no-revision", revision: 0 },
    ] })
    const { toggle, change } = await mount()
    expect(toggle.textContent).toContain("选择目录工作流")
    expect(catalog.get).toHaveBeenCalledWith("root/id", expect.any(AbortSignal))
    expect(document.body.textContent).toContain("发送消息时会按所选工作流和参数执行")
    const select = document.querySelector<HTMLSelectElement>('select[aria-label="目录中的 Workflow"]')!
    expect([...select.options].slice(1).map((option) => option.disabled)).toEqual([false, true, true, true, true])
    await act(async () => { select.value = "0"; select.dispatchEvent(new Event("change", { bubbles: true })) })
    expect(change).toHaveBeenCalledWith({ entry, argsText: "{}" })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(document.querySelector('[data-workflow-selection]')).toBeNull()
  })
  it("keeps an old selected revision after catalog refresh until explicit re-selection", async () => {
    const selected = { entry, argsText: '{"target":"old"}' }
    catalog.get.mockResolvedValue({ revision: 10, entries: [{ ...entry, source: "workspace", revision: 9 }] })
    const { toggle, change } = await mount(selected); await click(toggle)
    expect(toggle.textContent).toContain("工作流 · Review")
    expect(document.querySelector('button[aria-label="移除目录工作流"]')).not.toBeNull()
    expect(document.body.textContent).toContain("user · r2")
    expect(change).not.toHaveBeenCalled()
    const refresh = [...document.querySelectorAll("button")].find((button) => button.textContent === "刷新 Workflow 目录")!
    await click(refresh)
    expect(catalog.get).toHaveBeenCalledTimes(2); expect(change).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Workflow 参数（JSON）"]')?.value).toBe(selected.argsText)
  })
  it("closes the directory even when a previous submission left an error", async () => {
    catalog.get.mockResolvedValue({ revision: 3, entries: [] })
    const { toggle, close } = await mount(null, "旧工作流已不可用")
    await click(toggle)
    expect(close).toHaveBeenCalledOnce()
  })
  it("reopens the directory on a new slash-menu request without replacing the selected revision", async () => {
    const selected = { entry, argsText: "{}" }
    catalog.get.mockResolvedValue({ revision: 3, entries: [entry] })
    const { toggle, change, render } = await mount(selected)
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    await render(1)
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(change).not.toHaveBeenCalled()
    expect(document.body.textContent).toContain("user · r2")
  })
  it("shows catalog auth failure without falling back to command metadata", async () => {
    catalog.get.mockRejectedValue(new Error("Authentication failed"))
    await mount()
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Authentication failed")
    expect(document.querySelector("select")).toBeNull()
  })
  it("ignores a late response after closing and aborts that request", async () => {
    let finish!: (value: unknown) => void
    catalog.get.mockReturnValue(new Promise((resolve) => { finish = resolve }))
    const { toggle, close } = await mount()
    const signal = catalog.get.mock.calls[0][1] as AbortSignal
    await click(toggle); expect(close).toHaveBeenCalledOnce()
    // Parent unmounts the picker on close; abort the pending request on unmount.
    await act(async () => roots[0].unmount()); roots.shift()
    expect(signal.aborted).toBe(true)
    await act(async () => finish({ revision: 3, entries: [entry] }))
    expect(document.querySelector("select")).toBeNull()
  })
})
