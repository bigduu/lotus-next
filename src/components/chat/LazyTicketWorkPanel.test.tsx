import { act, useEffect, type ComponentProps } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/ui"
import { LazyTicketWorkPanel } from "./LazyTicketWorkPanel"

type Props = ComponentProps<typeof LazyTicketWorkPanel>
type Module = Awaited<ReturnType<NonNullable<Props["loadPanel"]>>>
const roots: ReturnType<typeof createRoot>[] = []
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren(); vi.restoreAllMocks() })
const controller = { state: null, connected: true } as unknown as Props["controller"]
const Loaded: Module["TicketWorkPanel"] = ({ controller: current, onReady }) => {
  useEffect(() => { onReady?.() }, [onReady])
  return <div data-ready-work>{current.connected ? "current ready" : "current readonly"}</div>
}
function mount(loadPanel: Props["loadPanel"]) {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.body.appendChild(document.createElement("div")), root = createRoot(host)
  roots.push(root)
  return { host, render: async (props: Partial<Props> = {}) => {
    await act(async () => root.render(<><input aria-label="draft" defaultValue="draft" /><LazyTicketWorkPanel controller={controller} loadPanel={loadPanel} {...props} /></>))
  } }
}

it("keeps conversation and loading visible until ready, then uses the latest controller", async () => {
  let resolve!: (module: Module) => void
  const load = vi.fn(() => new Promise<Module>((done) => { resolve = done }))
  const view = mount(load), onReady = vi.fn()
  await view.render({ onReady })
  expect(view.host.querySelector('[role="status"]')).not.toBeNull()
  const input = view.host.querySelector("input")!; input.value = "new draft"
  await view.render({ controller: { ...controller, connected: false }, onReady })
  await act(async () => resolve({ TicketWorkPanel: Loaded }))
  expect(view.host.textContent).toContain("current readonly")
  expect(input.value).toBe("new draft")
  expect(load).toHaveBeenCalledOnce(); expect(onReady).toHaveBeenCalledOnce()
})

it("shows a load failure locally and explicitly retries without losing the conversation", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  const load = vi.fn<NonNullable<Props["loadPanel"]>>()
    .mockRejectedValueOnce(new Error("fixture unavailable"))
    .mockResolvedValueOnce({ TicketWorkPanel: Loaded })
  const view = mount(load)
  await view.render()
  expect(view.host.querySelector('[role="alert"]')?.textContent).toContain(uiText("work_load_failed"))
  const input = view.host.querySelector("input")!; input.value = "keep edited draft"
  await act(async () => view.host.querySelector<HTMLButtonElement>("button")!.click())
  expect(load).toHaveBeenCalledTimes(2)
  expect(view.host.querySelector('[role="alert"]')).toBeNull()
  expect(view.host.textContent).toContain("current ready")
  expect(view.host.querySelector("input")).toBe(input); expect(input.value).toBe("keep edited draft")
})
