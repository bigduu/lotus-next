import { createSignal, Show } from "solid-js"
import { render, type ComponentProps } from "@solidjs/web"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/text"
import { LazyBrowserPaneView } from "./LazyBrowserPaneView"
import type { BrowserPaneView } from "./BrowserPane"
import { settleBrowser } from "./browserSessionTestHarness"

type Props = ComponentProps<typeof LazyBrowserPaneView>
type Module = { BrowserPaneView: typeof BrowserPaneView }
type Request = { loadView: NonNullable<Props["loadView"]>; sessionId: string }
let host: HTMLDivElement
let dispose: () => void
let change: (request: Request | null) => void
const actions = { openDefault: vi.fn(), openProfile: vi.fn(), closeProfile: vi.fn() }
const browser = actions as unknown as Props["browser"]
const show = (loadView: Request["loadView"], sessionId = "a") => settleBrowser(() => change({ loadView, sessionId }))
const content = vi.fn((props: ComponentProps<typeof BrowserPaneView>) => <p>Browser {props.sessionId}</p>)

beforeEach(() => {
  host = document.body.appendChild(document.createElement("div"))
  const [request, setRequest] = createSignal<Request | null>(null)
  change = setRequest
  dispose = render(() => <Show when={request()}>{(current) => (
    <LazyBrowserPaneView sessionId={current().sessionId} active browser={browser} loadView={current().loadView} />
  )}</Show>, host)
})
afterEach(() => {
  dispose()
  host.remove()
  vi.restoreAllMocks()
  vi.clearAllMocks()
})
const noActions = () => { for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled() }

it("keeps a visible loading state without creating or closing a browser", async () => {
  const loader = vi.fn(() => new Promise<Module>(() => {}))
  await show(loader)
  expect(host.querySelector('[role="status"]')?.textContent).toBe(uiText("loading_4927a53b"))
  expect(loader).toHaveBeenCalledTimes(1); expect(content).not.toHaveBeenCalled(); noActions()
})

it("renders current chat props rather than the chat that began a delayed import", async () => {
  let finish!: (module: Module) => void
  const loader = vi.fn(() => new Promise<Module>((resolve) => { finish = resolve }))
  await show(loader, "a"); await show(loader, "b")
  await settleBrowser(async () => finish({ BrowserPaneView: content }))
  expect(host.textContent).toBe("Browser b"); expect(loader).toHaveBeenCalledTimes(1); noActions()
})

it("contains a failed chunk and retries only loading on explicit user intent", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  const loader = vi.fn<NonNullable<Props["loadView"]>>().mockRejectedValueOnce(new Error("synthetic chunk failure")).mockResolvedValue({ BrowserPaneView: content })
  await show(loader)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(uiText("browser_view_load_failed"))
  expect(loader).toHaveBeenCalledTimes(1); noActions()
  await settleBrowser(async () => host.querySelector<HTMLButtonElement>("button")!.click())
  expect(host.textContent).toBe("Browser a"); expect(loader).toHaveBeenCalledTimes(2); noActions()
})

it("does not render a late loaded view after the pane is dismissed", async () => {
  let finish!: (module: Module) => void
  await show(() => new Promise<Module>((resolve) => { finish = resolve }))
  await settleBrowser(() => change(null))
  await settleBrowser(async () => finish({ BrowserPaneView: content }))
  expect(host.textContent).toBe(""); expect(content).not.toHaveBeenCalled(); noActions()
})
