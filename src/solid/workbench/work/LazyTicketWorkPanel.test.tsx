import { createSignal, onSettled } from "solid-js"
import { render, type ComponentProps } from "@solidjs/web"
import { afterEach, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/text"
import { LazyTicketWorkPanel } from "./LazyTicketWorkPanel"
import { settleWorkTest } from "./workTestHarness"

type Props = ComponentProps<typeof LazyTicketWorkPanel>
type Module = Awaited<ReturnType<NonNullable<Props["loadPanel"]>>>
const disposers: (() => void)[] = []
afterEach(() => { for (const dispose of disposers.splice(0)) dispose() })

const controller = { state: null, connected: true } as unknown as Props["controller"]
const Loaded: Module["TicketWorkPanel"] = (props) => {
  onSettled(() => { props.onReady?.() })
  return <div data-ready-work>{props.controller.connected ? "current ready" : "current readonly"}</div>
}

function mount(loadPanel: NonNullable<Props["loadPanel"]>) {
  const host = document.body.appendChild(document.createElement("div"))
  const [options, update] = createSignal<Partial<Props>>({})
  const dispose = render(() => <>
    <input aria-label="draft" value="draft" />
    <LazyTicketWorkPanel controller={options().controller ?? controller} loadPanel={loadPanel} onReady={options().onReady} />
  </>, host)
  disposers.push(() => { dispose(); host.remove() })
  return { host, update: (props: Partial<Props> = {}) => settleWorkTest(() => update(props)) }
}

it("keeps conversation and loading visible until ready, then uses the latest controller", async () => {
  let resolve!: (module: Module) => void
  const load = vi.fn(() => new Promise<Module>((done) => { resolve = done }))
  const view = mount(load)
  const onReady = vi.fn()
  await view.update({ onReady })
  expect(view.host.querySelector('[role="status"]')).not.toBeNull()
  const input = view.host.querySelector("input")!
  input.value = "new draft"
  await view.update({ controller: { ...controller, connected: false }, onReady })
  await settleWorkTest(() => resolve({ TicketWorkPanel: Loaded }))
  expect(view.host.textContent).toContain("current readonly")
  expect(input.value).toBe("new draft")
  expect(load).toHaveBeenCalledOnce()
  expect(onReady).toHaveBeenCalledOnce()
})

it("shows a load failure locally and explicitly retries without losing the conversation", async () => {
  const load = vi.fn<NonNullable<Props["loadPanel"]>>()
    .mockRejectedValueOnce(new Error("fixture unavailable"))
    .mockResolvedValueOnce({ TicketWorkPanel: Loaded })
  const view = mount(load)
  await view.update()
  expect(view.host.querySelector('[role="alert"]')?.textContent).toContain(uiText("work_load_failed"))
  const input = view.host.querySelector("input")!
  input.value = "keep edited draft"
  await settleWorkTest(() => view.host.querySelector<HTMLButtonElement>("button")!.click())
  expect(load).toHaveBeenCalledTimes(2)
  expect(view.host.querySelector('[role="alert"]')).toBeNull()
  expect(view.host.textContent).toContain("current ready")
  expect(view.host.querySelector("input")).toBe(input)
  expect(input.value).toBe("keep edited draft")
})
