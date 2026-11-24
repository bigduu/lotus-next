import { render, type ComponentProps } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/text"
import { LazySupervisorManagedSessionsPanel } from "./LazySupervisorManagedSessionsPanel"

type Props = ComponentProps<typeof LazySupervisorManagedSessionsPanel>
type Module = Awaited<ReturnType<NonNullable<Props["loadPanel"]>>>
const roots: Array<() => void> = []
afterEach(() => { for (const dispose of roots.splice(0)) dispose(); document.body.replaceChildren(); vi.restoreAllMocks() })

async function settle(action: () => unknown) {
  await action()
  for (let turn = 0; turn < 5; turn += 1) {
    await Promise.resolve()
    flush()
  }
}
const Loaded: Module["SupervisorManagedSessionsPanel"] = (props) => <div data-ready-sessions>{props.active ? "active" : "inactive"}</div>
function mount(loadPanel: Props["loadPanel"]) {
  const [active, setActive] = createSignal(true)
  const host = document.body.appendChild(document.createElement("div"))
  roots.push(render(() => <><input aria-label="draft" value="draft" />
    <LazySupervisorManagedSessionsPanel active={active()} onSelectSession={() => {}} loadPanel={loadPanel} /></>, host))
  return { host, render: (visible: boolean) => settle(() => setActive(visible)) }
}
it("keeps the rest of the Inspector available while the session directory loads", async () => {
  let resolve!: (module: Module) => void
  const load = vi.fn(() => new Promise<Module>((done) => { resolve = done }))
  const view = mount(load); await view.render(true)
  expect(view.host.querySelector('[role="status"]')?.textContent).toContain(uiText("supervisor_sessions_loading"))
  const input = view.host.querySelector("input")!; input.value = "kept draft"
  await view.render(false); await settle(async () => resolve({ SupervisorManagedSessionsPanel: Loaded }))
  expect(view.host.querySelector('[data-ready-sessions]')?.textContent).toBe("inactive")
  expect(input.value).toBe("kept draft"); expect(load).toHaveBeenCalledOnce()
})
it("reports a failed panel load locally and permits an explicit retry", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  const load = vi.fn<NonNullable<Props["loadPanel"]>>().mockRejectedValueOnce(new Error("fixture unavailable"))
    .mockResolvedValueOnce({ SupervisorManagedSessionsPanel: Loaded })
  const view = mount(load); await view.render(true)
  expect(view.host.querySelector('[role="alert"]')?.textContent).toContain(uiText("supervisor_sessions_render_failed"))
  expect(view.host.querySelector('[role="alert"]')?.textContent).not.toContain(uiText("supervisor_sessions_unavailable"))
  const input = view.host.querySelector("input")!; input.value = "kept draft"
  await settle(async () => view.host.querySelector<HTMLButtonElement>("button")!.click())
  expect(load).toHaveBeenCalledTimes(2); expect(view.host.querySelector('[data-ready-sessions]')?.textContent).toBe("active")
  expect(input.value).toBe("kept draft")
})
