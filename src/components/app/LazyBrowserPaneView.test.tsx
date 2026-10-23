import { act, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/ui"
import { LazyBrowserPaneView } from "./LazyBrowserPaneView"
import type { BrowserPaneView } from "./BrowserPane"

type Props = ComponentProps<typeof LazyBrowserPaneView>
type Module = { BrowserPaneView: typeof BrowserPaneView }
let host: HTMLDivElement, root: Root
const actions = { openDefault: vi.fn(), openProfile: vi.fn(), closeProfile: vi.fn() }
const browser = actions as unknown as Props["browser"]
const render = (loadView: NonNullable<Props["loadView"]>, sessionId = "a") => act(async () => root.render(<LazyBrowserPaneView sessionId={sessionId} active browser={browser} loadView={loadView} />))
const content = vi.fn(({ sessionId }: ComponentProps<typeof BrowserPaneView>) => <p>Browser {sessionId}</p>)

beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  host = document.body.appendChild(document.createElement("div")); root = createRoot(host)
})
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.clearAllMocks() })
const noActions = () => { for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled() }

it("keeps a visible loading state without creating or closing a browser", async () => {
  const loader = vi.fn(() => new Promise<Module>(() => {}))
  await render(loader)
  expect(host.querySelector('[role="status"]')?.textContent).toBe(uiText("loading_4927a53b"))
  expect(loader).toHaveBeenCalledTimes(1); expect(content).not.toHaveBeenCalled(); noActions()
})

it("renders current chat props rather than the chat that began a delayed import", async () => {
  let finish!: (module: Module) => void
  const loader = vi.fn(() => new Promise<Module>((resolve) => { finish = resolve }))
  await render(loader, "a"); await render(loader, "b")
  await act(async () => finish({ BrowserPaneView: content }))
  expect(host.textContent).toBe("Browser b"); expect(loader).toHaveBeenCalledTimes(1); noActions()
})

it("contains a failed chunk and retries only loading on explicit user intent", async () => {
  vi.spyOn(console, "error").mockImplementation(() => {})
  const loader = vi.fn<NonNullable<Props["loadView"]>>().mockRejectedValueOnce(new Error("synthetic chunk failure")).mockResolvedValue({ BrowserPaneView: content })
  await render(loader)
  expect(host.querySelector('[role="alert"]')?.textContent).toContain(uiText("browser_view_load_failed"))
  expect(loader).toHaveBeenCalledTimes(1); noActions()
  await act(async () => host.querySelector<HTMLButtonElement>("button")!.click())
  expect(host.textContent).toBe("Browser a"); expect(loader).toHaveBeenCalledTimes(2); noActions()
})

it("does not render a late loaded view after the pane is dismissed", async () => {
  let finish!: (module: Module) => void
  await render(() => new Promise<Module>((resolve) => { finish = resolve }))
  await act(async () => root.render(null))
  await act(async () => finish({ BrowserPaneView: content }))
  expect(host.textContent).toBe(""); expect(content).not.toHaveBeenCalled(); noActions()
})
