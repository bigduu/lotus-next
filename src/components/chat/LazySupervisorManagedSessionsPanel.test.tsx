import { act, type ComponentProps } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/ui"
import { LazySupervisorManagedSessionsPanel } from "./LazySupervisorManagedSessionsPanel"

type Props = ComponentProps<typeof LazySupervisorManagedSessionsPanel>
type Module = Awaited<ReturnType<NonNullable<Props["loadPanel"]>>>
const roots: ReturnType<typeof createRoot>[] = []
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks() })
const Loaded: Module["SupervisorManagedSessionsPanel"] = ({ active }) => <div data-ready-sessions>{active ? "active" : "inactive"}</div>
function mount(loadPanel: Props["loadPanel"]) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host); roots.push(root)
  return { host, render: async (active: boolean) => { await act(async () => root.render(<><input aria-label="draft" defaultValue="draft" />
    <LazySupervisorManagedSessionsPanel active={active} onSelectSession={() => {}} loadPanel={loadPanel} /></>)) } }
}
it("keeps the rest of the Inspector available while the session directory loads", async () => {
  let resolve!: (module: Module) => void
  const load = vi.fn(() => new Promise<Module>((done) => { resolve = done }))
  const view = mount(load); await view.render(true)
  expect(view.host.querySelector('[role="status"]')?.textContent).toContain(uiText("supervisor_sessions_loading"))
  const input = view.host.querySelector("input")!; input.value = "kept draft"
  await view.render(false); await act(async () => resolve({ SupervisorManagedSessionsPanel: Loaded }))
  expect(view.host.querySelector('[data-ready-sessions]')?.textContent).toBe("inactive")
  expect(input.value).toBe("kept draft"); expect(load).toHaveBeenCalledOnce()
})
it("reports a failed panel load locally and permits an explicit retry", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  const load = vi.fn<NonNullable<Props["loadPanel"]>>().mockRejectedValueOnce(new Error("fixture unavailable"))
    .mockResolvedValueOnce({ SupervisorManagedSessionsPanel: Loaded })
  const view = mount(load); await view.render(true)
  expect(view.host.querySelector('[role="alert"]')?.textContent).toContain(uiText("supervisor_sessions_unavailable"))
  const input = view.host.querySelector("input")!; input.value = "kept draft"
  await act(async () => view.host.querySelector<HTMLButtonElement>("button")!.click())
  expect(load).toHaveBeenCalledTimes(2); expect(view.host.querySelector('[data-ready-sessions]')?.textContent).toBe("active")
  expect(input.value).toBe("kept draft")
})
