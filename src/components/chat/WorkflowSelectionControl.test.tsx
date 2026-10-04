import { act, useState, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, describe, expect, it, vi } from "vitest"
import { WorkflowSelectionControl } from "./WorkflowSelectionControl"
import { useWorkflowCatalog } from "./useWorkflowCatalog"
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
;(globalThis as typeof globalThis & { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren(); catalog.get.mockReset() })
async function mount(selected: TypedWorkflowDraft | null = null) {
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  const change = vi.fn()
  function Host({ sessionId = "root/id" }: { sessionId?: string }) {
    const [open, setOpen] = useState(false)
    const [selection, setSelection] = useState(selected)
    const catalogState = useWorkflowCatalog(sessionId, open)
    return <WorkflowSelectionControl sessionId={sessionId} selected={selection} onChange={(value) => { change(value); setSelection(value) }}
      onRemove={() => setSelection(null)} open={open} onOpenChange={setOpen} catalogState={catalogState} disabled={false} error={null} />
  }
  await act(async () => root.render(<Host />))
  const toggle = document.querySelector<HTMLButtonElement>('button[aria-expanded]')!
  return { toggle, change, root, render: (sessionId: string) => act(async () => root.render(<Host sessionId={sessionId} />)) }
}
async function click(element: HTMLElement) { await act(async () => element.click()) }
function button(text: string) { return [...document.querySelectorAll<HTMLButtonElement>("button")].find((el) => el.textContent?.includes(text))! }

describe("Workflow typed picker", () => {
  it("loads only when opened, disables unsupported rows, selects without executing, and highlights the chip", async () => {
    catalog.get.mockResolvedValue({ revision: 3, entries: [entry,
      { ...entry, id: "run", name: "Run", kind: "orchestration" }, { ...entry, id: "bad", name: "Bad", status: "invalid", last_error: "invalid definition" },
      { ...entry, id: "manual", name: "Manual", invocation_policy: { explicit: false } }, { ...entry, id: "no-revision", name: "Missing", revision: 0 },
    ] })
    const { toggle, change } = await mount()
    expect(catalog.get).not.toHaveBeenCalled()
    await click(toggle)
    expect(catalog.get).toHaveBeenCalledWith("root/id", expect.any(AbortSignal))
    const rows = [...document.querySelectorAll<HTMLButtonElement>('[aria-label="目录中的 Workflow"] button')]
    expect(rows.map((row) => row.disabled)).toEqual([false, true, true, true, true])
    await click(rows[0])
    expect(change).toHaveBeenCalledWith({ entry, argsText: "{}" })
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(document.querySelector('[data-workflow-chip]')?.textContent).toContain("Review本条消息")
  })
  it("keeps exact args and revision after refresh until explicit re-selection", async () => {
    const selected = { entry, argsText: '{"target":"old"}' }
    catalog.get.mockResolvedValue({ revision: 10, entries: [{ ...entry, source: "workspace", revision: 9 }] })
    const { toggle, change } = await mount(selected); await click(toggle)
    expect(document.querySelector('[data-workflow-selection]')?.textContent).toContain("user · r2")
    await click(button("刷新"))
    expect(catalog.get).toHaveBeenCalledTimes(2); expect(change).not.toHaveBeenCalled()
    expect(document.querySelector<HTMLTextAreaElement>('textarea[aria-label="Workflow 参数（JSON）"]')?.value).toBe(selected.argsText)
  })
  it("shows catalog auth failure without falling back to command metadata", async () => {
    catalog.get.mockRejectedValue(new Error("Authentication failed"))
    const { toggle } = await mount(); await click(toggle)
    expect(document.querySelector('[role="alert"]')?.textContent).toContain("Authentication failed")
    expect(document.querySelector('[aria-label="目录中的 Workflow"]')).toBeNull()
  })
  it("aborts old catalog reads and fences a late response after session switch", async () => {
    let finish!: (value: unknown) => void
    catalog.get.mockReturnValueOnce(new Promise((resolve) => { finish = resolve }))
      .mockResolvedValue({ revision: 4, entries: [{ ...entry, name: "Other session", description: "Other description" }] })
    const { toggle, render } = await mount(); await click(toggle)
    const signal = catalog.get.mock.calls[0][1] as AbortSignal
    await render("other-session")
    expect(signal.aborted).toBe(true)
    await act(async () => finish({ revision: 3, entries: [entry] }))
    expect(document.querySelector('[aria-label="目录中的 Workflow"]')?.textContent).toContain("Other session")
    expect(document.querySelector('[aria-label="目录中的 Workflow"]')?.textContent).not.toContain("Review")
  })
  it("leaves removal and argument editing disabled during admission", async () => {
    const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
    const props: ComponentProps<typeof WorkflowSelectionControl> = {
      sessionId: "root", selected: { entry, argsText: "{}" }, open: true, disabled: true, error: "old revision",
      onChange: vi.fn(), onRemove: vi.fn(), onOpenChange: vi.fn(),
      catalogState: { catalog: { revision: 1, entries: [entry] }, loading: false, error: null, refresh: vi.fn() },
    }
    await act(async () => root.render(<WorkflowSelectionControl {...props} />))
    expect(document.querySelector<HTMLTextAreaElement>("textarea")?.disabled).toBe(true)
    const remove = document.querySelector<HTMLButtonElement>('button[aria-label="移除目录工作流"]')!
    expect(remove.disabled).toBe(true); await click(remove)
    expect(props.onRemove).not.toHaveBeenCalled()
  })
})
