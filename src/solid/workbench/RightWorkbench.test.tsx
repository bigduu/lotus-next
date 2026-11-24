import { Feedback, type DragDropManager } from "@dnd-kit/dom"
import * as cancellationModule from "@/lib/workbench/workbenchDragCancellation"
import { captureWorkbenchFocusReturn } from "@/lib/workbenchFocusReturn"
import { render, type JSX } from "@solidjs/web"
import { createSignal, flush, lazy, Loading, onSettled, Show } from "solid-js"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ModelEffortPicker } from "../chat/model/ModelEffortPicker"
import { CommandPalette } from "../shell/CommandPalette"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogTitle, ResponsiveDialogTrigger } from "../ui/responsive-dialog"
import { RightWorkbench, RightWorkbenchContent, RightWorkbenchSurface, type RightWorkbenchProps, type WorkbenchTabDrag } from "./RightWorkbench"

const compiledPrimitive = vi.hoisted(() => async (name: string) => {
  const { createRequire } = await vi.importActual<{
    createRequire: (url: string) => { resolve: (specifier: string) => string }
  }>("node:module")
  return vi.importActual(createRequire(import.meta.url).resolve(name).replace(/\.jsx$/, ".js"))
})
vi.mock("@kobalte/core/dialog", () => compiledPrimitive("@kobalte/core/dialog"))
vi.mock("@kobalte/core/popover", () => compiledPrimitive("@kobalte/core/popover"))
vi.mock("@kobalte/core/tabs", () => compiledPrimitive("@kobalte/core/tabs"))
vi.mock("@kobalte/core/tooltip", () => compiledPrimitive("@kobalte/core/tooltip"))
vi.mock("@kobalte/core/dropdown-menu", () => compiledPrimitive("@kobalte/core/dropdown-menu"))
vi.mock("@lucide/solid", () => {
  const icon = () => null
  return { ArrowLeft: icon, Bot: icon, ChevronDown: icon, ChevronLeft: icon, ChevronRight: icon, Check: icon, Circle: icon,
    FileDiff: icon, Globe2: icon, GripVertical: icon, ListChecks: icon, MessageSquare: icon,
    Plus: icon, Search: icon, Settings: icon, RotateCcw: icon, Sparkles: icon, SlidersHorizontal: icon, Workflow: icon, X: icon }
})

const cleanups: Array<() => void> = []
const scrollIntoView = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "scrollIntoView")
beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", { configurable: true, value: vi.fn() })
})
afterEach(() => {
  for (const dispose of cleanups.splice(0)) dispose()
  if (scrollIntoView) Object.defineProperty(HTMLElement.prototype, "scrollIntoView", scrollIntoView)
  else Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView")
  Reflect.deleteProperty(document, "getAnimations")
  Reflect.deleteProperty(Element.prototype, "getAnimations")
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})
function dispatch(action: () => void) { action(); flush() }
function key(node: Element, key: string) {
  dispatch(() => node.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true })))
}
function mount(overrides: Partial<RightWorkbenchProps> = {}, content?: () => JSX.Element) {
  const host = document.body.appendChild(document.createElement("div"))
  const [props, setProps] = createSignal<RightWorkbenchProps>({
    docked: true, activeTab: null, openToolTabs: [], onTabChange: vi.fn(), onToolClose: vi.fn(), onClose: vi.fn(),
    inspector: null, review: null, browser: null, subagents: null, ...overrides,
  })
  const dispose = render(() => content ? content() : <RightWorkbench {...props()} />, host)
  cleanups.push(() => { dispose(); host.remove() })
  flush()
  return { host, update: (next: Partial<RightWorkbenchProps>) => dispatch(() => setProps((previous) => ({ ...previous, ...next }))) }
}
const exposedTabs = (host: ParentNode) => [...host.querySelectorAll<HTMLButtonElement>('[role="tab"]:not([aria-hidden="true"])')]
const button = (host: ParentNode, name: string) => host.querySelector<HTMLButtonElement>(`button[aria-label="${name}"]`)!
const browsers = [
  { tab_id: "tab-a", url: "https://a.test", title: "Alpha", active: true },
  { tab_id: "tab-b", url: "https://b.test", title: "Beta", active: false },
]

it("switches tools in one docked panel and closes without navigation", () => {
  const onTabChange = vi.fn(), onClose = vi.fn(), onBrowserActivate = vi.fn(), onBrowserClose = vi.fn(), onToolClose = vi.fn()
  const { host } = mount({ activeTab: "inspector", openToolTabs: ["inspector", "review", "subagents"],
    onTabChange, onClose, onBrowserActivate, onBrowserClose, onToolClose,
    browserTabs: browsers, activeBrowserTabId: "tab-a" })
  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain("检查器")
  dispatch(() => exposedTabs(host).find((tab) => tab.textContent?.includes("Review"))!.click())
  expect(onTabChange).toHaveBeenLastCalledWith("review")
  expect(host.querySelectorAll('[role="tab"][aria-label^="浏览器标签页"]')).toHaveLength(2)
  dispatch(() => button(host, "浏览器标签页 2：Beta").click())
  expect(onBrowserActivate).toHaveBeenLastCalledWith("tab-b")
  dispatch(() => button(host, "关闭浏览器标签页 1：Alpha").click())
  expect(onBrowserClose).toHaveBeenCalledWith("tab-a")
  dispatch(() => button(host, "关闭Review标签页").click())
  expect(onToolClose).toHaveBeenCalledWith("review")
  expect(button(host, "打开工作面板标签页")).not.toBeNull()
  expect(host.querySelector('[role="tablist"]')?.className).toContain("overflow-x-auto")
  dispatch(() => button(host, "收起工作面板").click())
  expect(onClose).toHaveBeenCalledOnce()
})

it("uses the supplied docked width without a percentage cap and retains the mobile overlay", () => {
  const { host, update } = mount({ width: 1200 })
  const aside = host.querySelector("aside")!
  expect(aside.style.width).toBe("1200px")
  expect(aside.style.maxWidth).toBe("")
  update({ docked: false })
  expect(host.querySelector("aside")).toBe(aside)
  expect(aside.classList.contains("fixed")).toBe(true)
  expect(aside.style.width).not.toBe("1200px")
  expect(button(host, "收起工作面板")).not.toBeNull()
})

it("keeps the subagent view mounted while another workbench tab is selected", () => {
  const onMount = vi.fn(), onUnmount = vi.fn()
  function RunningSession() {
    onSettled(() => { onMount(); return () => { onUnmount() } })
    return <div data-testid="running-session">sending</div>
  }
  const [tab, setTab] = createSignal<"subagents" | "inspector">("subagents")
  const [visible, setVisible] = createSignal(true)
  const { host } = mount({}, () => <RightWorkbench docked visible={visible()} activeTab={tab()} openToolTabs={["inspector", "subagents"]}
    onTabChange={vi.fn()} onToolClose={vi.fn()} onClose={vi.fn()} inspector={<div>Inspector</div>} review={null} browser={null}
    subagents={<RunningSession />} />)
  const running = () => host.querySelector('[data-testid="running-session"]')
  expect(running()?.textContent).toBe("sending")
  dispatch(() => setTab("inspector"))
  expect(onUnmount).not.toHaveBeenCalled()
  dispatch(() => setTab("subagents"))
  expect(running()?.textContent).toBe("sending")
  expect(onMount).toHaveBeenCalledOnce()
  dispatch(() => setVisible(false))
  expect(onUnmount).toHaveBeenCalledOnce()
  expect(running()).toBeNull()
})

it("preserves a Work decision draft across tab switches and visibility changes", () => {
  const onMount = vi.fn()
  function WorkDecision() {
    const [answer, setAnswer] = createSignal("")
    onSettled(() => { onMount() })
    return <input aria-label="Work answer" value={answer()} onInput={(event) => setAnswer(event.currentTarget.value)} />
  }
  const [tab, setTab] = createSignal<"work" | "inspector">("work")
  const [visible, setVisible] = createSignal(true)
  const { host } = mount({}, () => <RightWorkbench docked visible={visible()} activeTab={tab()} openToolTabs={["work", "inspector"]}
    workEnabled work={<WorkDecision />} onTabChange={vi.fn()} onToolClose={vi.fn()} onClose={vi.fn()}
    inspector={<div>Inspector</div>} review={null} browser={null} subagents={null} />)
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Work answer"]')!
  dispatch(() => { input.value = "蓝色"; input.dispatchEvent(new Event("input", { bubbles: true })) })
  dispatch(() => setTab("inspector"))
  expect(host.querySelector('input[aria-label="Work answer"]')).toBe(input)
  expect(input.closest('[role="tabpanel"]')?.className).toContain("hidden")
  dispatch(() => setTab("work"))
  expect(input.value).toBe("蓝色")
  dispatch(() => setVisible(false))
  expect(input.closest("aside")?.hidden).toBe(true)
  expect(input.closest("aside")?.style.display).toBe("none")
  dispatch(() => setVisible(true))
  expect(input.value).toBe("蓝色")
  expect(onMount).toHaveBeenCalledOnce()
})

it("omits the browser tab and content when the phone layout disables it", () => {
  const { host } = mount({ docked: false, activeTab: "inspector", openToolTabs: ["inspector"], browserEnabled: false,
    browser: "browser content", browserTabs: browsers })
  expect(host.querySelector('[role="tab"][data-state="active"]')?.textContent).toContain("检查器")
  expect(exposedTabs(host).some((tab) => tab.textContent?.includes("浏览器"))).toBe(false)
  expect(host.textContent).not.toContain("browser content")
})

it("shows a launcher without creating an about:blank tab", () => {
  const onTabChange = vi.fn()
  const { host } = mount({ onTabChange })
  expect(host.textContent).toContain("还没有打开内容")
  expect(exposedTabs(host)).toHaveLength(0)
  expect(host.textContent).not.toContain("about:blank")
  const browser = [...host.querySelectorAll<HTMLButtonElement>("button")].find((node) => node.textContent?.includes("输入网址后打开"))!
  dispatch(() => browser.click())
  expect(onTabChange).toHaveBeenCalledWith("browser")
})

it("keeps browser and tool tabs on the same selection surface and DOM nodes", () => {
  const onTabReorder = vi.fn()
  const { host, update } = mount({ activeTab: "inspector", openToolTabs: ["inspector"], onTabReorder,
    browserTabs: [browsers[0]!], activeBrowserTabId: "tab-a" })
  const [tool, browser] = exposedTabs(host)
  expect(tool.className).toBe(browser.className)
  const selectedStyle = tool.parentElement!.className
  const inactiveStyle = browser.parentElement!.className
  expect(selectedStyle).toContain("feedback-motion")
  expect(selectedStyle).toContain("shadow-sm")
  expect(selectedStyle).toContain("select-none")
  expect(inactiveStyle).toContain("hover:bg-accent")
  update({ activeTab: "browser" })
  expect(browser.parentElement!.className).toBe(selectedStyle)
  expect(tool.parentElement!.className).toBe(inactiveStyle)
  expect(exposedTabs(host)).toEqual([tool, browser])
  expect(onTabReorder).not.toHaveBeenCalled()
})

it("exposes complete long labels on keyboard focus and in the tab list", async () => {
  const title = "https://example.test/" + "long-path/".repeat(12)
  const onBrowserActivate = vi.fn(), onTabReorder = vi.fn()
  const { host } = mount({ activeTab: "subagents", openToolTabs: ["subagents"], onBrowserActivate, onTabReorder,
    browserTabs: [{ tab_id: "a", title, url: title, active: false }] })
  const browserTab = host.querySelector<HTMLButtonElement>('[role="tab"][aria-label^="浏览器标签页"]')!
  dispatch(() => browserTab.focus())
  await vi.waitFor(() => expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(title))
  key(browserTab, "Escape")
  const list = button(host, "已打开的标签页")
  key(list, "Enter")
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
  expect(items.map((item) => item.textContent?.trim())).toEqual(["子代理", title])
  expect(items[0].getAttribute("aria-checked")).toBe("true")
  expect(items[1].style.whiteSpace).toBe("normal")
  expect(items[1].style.overflowWrap).toBe("anywhere")
  key(items[1], "Enter")
  expect(onBrowserActivate).toHaveBeenCalledWith("a")
  await vi.waitFor(() => expect(document.activeElement).toBe(list))
  expect(document.querySelector('[role="menu"][data-state="open"]')).toBeNull()
  expect(onTabReorder).not.toHaveBeenCalled()
  dispatch(() => {
    list.dispatchEvent(new PointerEvent("pointerdown", { pointerType: "touch", isPrimary: true, button: 0, bubbles: true }))
    list.dispatchEvent(new PointerEvent("pointerup", { pointerType: "touch", isPrimary: true, button: 0, bubbles: true }))
    list.click()
  })
  const menu = document.querySelector('[role="menu"][data-state="open"]')!
  expect(menu).not.toBeNull()
  key(menu, "Escape")
  await vi.waitFor(() => expect(document.activeElement).toBe(list))
})

it("refreshes full labels from current props and returns focus safely when the last tab closes", async () => {
  const onTabChange = vi.fn()
  const { host, update } = mount({ activeTab: "browser", activeBrowserTabId: "tab-a", onTabChange, browserTabs: [browsers[0]!] })
  const list = button(host, "已打开的标签页")
  key(list, "Enter")
  update({ browserTabs: [{ ...browsers[0]!, title: "Current session after navigation" }] })
  expect(document.querySelector('[role="menuitemradio"]')?.textContent?.trim()).toBe("Current session after navigation")
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain("Alpha")
  update({ activeTab: null, activeBrowserTabId: null, browserTabs: [] })
  await vi.waitFor(() => expect(document.querySelector('[role="menu"][data-state="open"]')).toBeNull())
  await vi.waitFor(() => expect(document.activeElement).toBe(button(host, "打开工作面板标签页")))
  expect(list.disabled).toBe(true)
  expect(onTabChange).not.toHaveBeenCalled()
})

it.each([false, true])("keeps a safe focus target when closing a tab, delayed=%s", async (delayed) => {
  const onTabReorder = vi.fn()
  let finish = () => {}
  const { host, update } = mount({ activeTab: "inspector", openToolTabs: ["inspector", "subagents"], onTabReorder,
    onToolClose: (closed) => {
      const applyClose = () => update(closed === "inspector"
        ? { openToolTabs: ["subagents"], activeTab: "subagents" }
        : { openToolTabs: [], activeTab: null })
      if (delayed) finish = applyClose
      else applyClose()
    } })
  const add = button(host, "打开工作面板标签页")
  const close = button(host, "关闭检查器标签页")
  dispatch(() => { close.focus(); close.click() })
  if (delayed) {
    dispatch(() => add.focus())
    finish()
    expect(document.activeElement).toBe(add)
  } else {
    await vi.waitFor(() => expect(document.activeElement).toBe(exposedTabs(host)[0]))
    const last = button(host, "关闭子代理标签页")
    dispatch(() => { last.focus(); last.click() })
    await vi.waitFor(() => expect(document.activeElement).toBe(add))
  }
  expect(onTabReorder).not.toHaveBeenCalled()
})

const frame = () => new Promise<void>((resolve) => requestAnimationFrame(() => { flush(); resolve() }))
const activeModal = () => document.querySelector<HTMLElement>('#right-workbench[aria-modal="true"]')
it("traps narrow workbench focus, dismisses its menu before the workbench, and restores its opener", async () => {
  const onClose = vi.fn()
  const [visible, setVisible] = createSignal(false)
  const { host } = mount({}, () => <>
    <button aria-controls="right-workbench" onClick={() => setVisible(true)}>Open workbench</button>
    <button data-background>Background action</button>
    <RightWorkbench visible={visible()} activeTab="inspector" openToolTabs={["inspector"]}
      onTabChange={() => {}} onToolClose={() => {}} onClose={() => { onClose(); setVisible(false) }}
      inspector={<button>Panel action</button>} review={null} browser={null} subagents={null} />
  </>)
  const opener = host.querySelector<HTMLButtonElement>('[aria-controls="right-workbench"]')!
  dispatch(() => { opener.focus(); opener.click() })
  const dialog = activeModal()!
  expect(dialog.getAttribute("aria-label")).toBeTruthy()
  expect(dialog.contains(document.activeElement)).toBe(true)
  dispatch(() => host.querySelector<HTMLButtonElement>("[data-background]")!.focus())
  expect(dialog.contains(document.activeElement)).toBe(true)
  const last = [...dialog.querySelectorAll<HTMLButtonElement>("button:not(:disabled)")].at(-1)!
  dispatch(() => last.focus())
  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
  dispatch(() => last.dispatchEvent(tab))
  expect(tab.defaultPrevented).toBe(true)
  expect(dialog.contains(document.activeElement)).toBe(true)
  expect(document.activeElement).not.toBe(last)
  const menuTrigger = button(dialog, "已打开的标签页")
  key(menuTrigger, "Enter")
  const menu = dialog.querySelector('[role="menu"][data-state="open"]')!
  expect(menu).not.toBeNull()
  key(menu, "Escape")
  expect(onClose).not.toHaveBeenCalled()
  await vi.waitFor(() => expect(document.activeElement).toBe(menuTrigger))
  key(menuTrigger, "Escape")
  expect(onClose).toHaveBeenCalledOnce()
  await vi.waitFor(() => expect(document.activeElement).toBe(opener))
  expect(activeModal()).toBeNull()
  expect(host.closest('[aria-hidden="true"]')).toBeNull()
})

it("preserves workbench content identity across desktop and modal sizes", async () => {
  const mounted = vi.fn(), unmounted = vi.fn()
  const [docked, setDocked] = createSignal(true)
  function Session() {
    const [attachments, setAttachments] = createSignal(0)
    onSettled(() => { mounted(); return () => { unmounted() } })
    return <><input aria-label="Draft" value="Saved draft" />
      <button data-attach onClick={() => setAttachments((count) => count + 1)}>Attach {attachments()}</button></>
  }
  const { host } = mount({}, () => <><button aria-controls="right-workbench">Launcher</button>
    <RightWorkbench docked={docked()} activeTab="subagents" openToolTabs={["subagents"]} onTabChange={() => {}}
      onToolClose={() => {}} onClose={() => {}} inspector={null} review={null} browser={null} subagents={<Session />} /></>)
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Draft"]')!
  dispatch(() => { host.querySelector<HTMLButtonElement>("[data-attach]")!.click(); input.focus() })
  dispatch(() => setDocked(false))
  expect(activeModal()?.textContent).toContain("Attach 1")
  expect(activeModal()?.querySelector("input")).toBe(input)
  expect(document.activeElement).toBe(input)
  dispatch(() => setDocked(true))
  await frame()
  expect(host.querySelector('input[aria-label="Draft"]')).toBe(input)
  expect(input.value).toBe("Saved draft")
  expect(document.activeElement).toBe(input)
  expect(mounted).toHaveBeenCalledOnce()
  expect(unmounted).not.toHaveBeenCalled()
  const launcher = host.querySelector<HTMLButtonElement>('[aria-controls="right-workbench"]')!
  dispatch(() => launcher.focus())
  expect(document.activeElement).toBe(launcher)
  expect(activeModal()).toBeNull()
})

it.each(["restore", "kept-mounted", "new-control", "hidden-opener", "changed-session", "reopened"] as const)(
  "settles backdrop focus safely after dismissal: %s", async (scenario) => {
    const [visible, setVisible] = createSignal(false)
    const onClose = vi.fn()
    let scope = "session-a"
    const { host } = mount({}, () => <>
      <button aria-controls="right-workbench">Fallback launcher</button>
      <button data-opener onClick={() => setVisible(true)}>Original opener</button><button data-next>New focus</button>
      <Show when={visible() || scenario === "kept-mounted"}>
        <RightWorkbench visible={visible()} focusScopeKey="session-a" getCurrentFocusScope={() => scope}
          activeTab="inspector" openToolTabs={["inspector"]} onTabChange={() => {}} onToolClose={() => {}}
          onClose={() => { onClose(); setVisible(false) }}
          inspector={<button data-panel-action>Panel action</button>} review={null} subagents={null} browser={null} />
      </Show>
    </>)
    const [fallback, opener, next] = host.querySelectorAll<HTMLButtonElement>("button")
    dispatch(() => { opener.focus(); opener.click() })
    const action = host.querySelector<HTMLButtonElement>("[data-panel-action]")!
    dispatch(() => action.click())
    expect(onClose).not.toHaveBeenCalled()
    const backdrop = host.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!
    dispatch(() => backdrop.click())
    expect(onClose).toHaveBeenCalledOnce()
    expect(activeModal()).toBeNull()
    dispatch(() => (document.activeElement as HTMLElement).blur())
    expect(document.activeElement).toBe(document.body)
    if (scenario === "new-control") next.focus()
    if (scenario === "hidden-opener") opener.hidden = true
    if (scenario === "changed-session") scope = "session-b"
    if (scenario === "reopened") dispatch(() => opener.click())
    await frame()
    if (scenario === "restore" || scenario === "kept-mounted") expect(document.activeElement).toBe(opener)
    if (scenario === "new-control") expect(document.activeElement).toBe(next)
    if (scenario === "hidden-opener") expect(document.activeElement).toBe(fallback)
    if (scenario === "changed-session") expect(document.activeElement).toBe(document.body)
    if (scenario === "reopened") expect(activeModal()?.contains(document.activeElement)).toBe(true)
  },
)

it.each([false, true])("restores focus after button dismissal, hidden opener=%s", async (hidden) => {
  const [visible, setVisible] = createSignal(false)
  const { host } = mount({}, () => <>
    <button aria-controls="right-workbench">Available launcher</button><button onClick={() => setVisible(true)}>Original opener</button>
    <RightWorkbench visible={visible()} activeTab="inspector" openToolTabs={["inspector"]}
      onTabChange={() => {}} onToolClose={() => {}} onClose={() => setVisible(false)}
      inspector={null} review={null} subagents={null} browser={null} />
  </>)
  const [fallback, opener] = host.querySelectorAll<HTMLButtonElement>("button")
  dispatch(() => { opener.focus(); opener.click() })
  opener.hidden = hidden
  dispatch(() => button(activeModal()!, "收起工作面板").click())
  await vi.waitFor(() => expect(document.activeElement).toBe(hidden ? fallback : opener))
})

it("keeps the real model popover usable across workbench sizes and repeated focus cycles", async () => {
  const close = vi.fn()
  const [docked, setDocked] = createSignal(true)
  const { host } = mount({}, () => <RightWorkbench docked={docked()} activeTab="subagents" openToolTabs={["subagents"]}
    onTabChange={() => {}} onToolClose={() => {}} onClose={close} inspector={null} review={null} browser={null}
    subagents={<ModelEffortPicker modelGroups={[{ provider: "fixture", label: "Fixture", models: ["Model A", "Model B"] }]}
      model="Model A" modelProvider="fixture" onModelChange={() => {}} value="medium" onChange={() => {}} />} />)
  const picker = host.querySelector<HTMLButtonElement>('[data-testid="model-effort-picker"]')!
  dispatch(() => picker.click())
  const popover = () => host.querySelector<HTMLElement>('[data-slot="popover-content"][data-state="open"]')
  const original = popover()!
  expect(original).not.toBeNull()
  dispatch(() => setDocked(false))
  expect(popover()).toBe(original)
  expect(original.closest('[aria-hidden="true"]')).toBeNull()
  const slider = original.querySelector<HTMLInputElement>('input[type="range"]')!
  dispatch(() => slider.focus())
  expect(document.activeElement).toBe(slider)
  key(slider, "Escape")
  expect(popover()).toBeNull()
  expect(close).not.toHaveBeenCalled()
  for (let cycle = 0; cycle < 30; cycle += 1) {
    const panel = activeModal()!
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    dispatch(() => buttons.at(-1)!.focus())
    key(document.activeElement!, "Tab")
    expect(panel.contains(document.activeElement)).toBe(true)
    dispatch(() => picker.click())
    expect(popover()).not.toBeNull()
    key(popover()!, "Escape")
    expect(popover()).toBeNull()
    expect(close).not.toHaveBeenCalled()
  }
  dispatch(() => setDocked(true))
  dispatch(() => picker.click())
  expect(popover()).not.toBeNull()
})

it("keeps a nested Work popover and its draft inside the modal pointer boundary", () => {
  const close = vi.fn()
  const nested = vi.fn()
  function Work() {
    const [all, setAll] = createSignal(false)
    return <><input aria-label="Portal draft" value="蓝色" hidden={!all()} />
      <button data-all-work onClick={() => setAll(true)}>All work</button>
      <Popover><PopoverTrigger>Portal menu</PopoverTrigger>
        <PopoverContent><button data-nested onClick={nested}>Nested portal action</button></PopoverContent></Popover></>
  }
  const { host } = mount({}, () => <RightWorkbench activeTab="work" openToolTabs={["work"]} workEnabled work={<Work />}
    onTabChange={() => {}} onToolClose={() => {}} onClose={close} inspector={null} review={null} subagents={null} browser={null} />)
  const pointer = (target: HTMLElement) => {
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    target.click()
  }
  dispatch(() => pointer(host.querySelector<HTMLButtonElement>("[data-all-work]")!))
  const draft = host.querySelector<HTMLInputElement>('input[aria-label="Portal draft"]')!
  expect(draft.hidden).toBe(false)
  expect(draft.value).toBe("蓝色")
  dispatch(() => pointer(host.querySelector<HTMLButtonElement>('[data-slot="popover-trigger"]')!))
  const nestedButton = activeModal()!.querySelector<HTMLButtonElement>("[data-nested]")!
  expect(nestedButton).not.toBeNull()
  dispatch(() => pointer(nestedButton))
  expect(nested).toHaveBeenCalledOnce()
  expect(close).not.toHaveBeenCalled()
  key(nestedButton, "Escape")
  expect(activeModal()?.querySelector('[data-slot="popover-content"][data-state="open"]')).toBeNull()
  expect(close).not.toHaveBeenCalled()
  dispatch(() => pointer(host.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!))
  expect(close).toHaveBeenCalledOnce()
})

it("releases modal effects while Settings owns the page without remounting the workbench draft", () => {
  const mounted = vi.fn(), unmounted = vi.fn(), close = vi.fn(), changeTheme = vi.fn()
  const [pageVisible, setPageVisible] = createSignal(true)
  function SessionDraft() {
    onSettled(() => { mounted(); return () => { unmounted() } })
    return <input aria-label="Session draft" value="retained side draft" />
  }
  const { host } = mount({}, () => <><div data-chat-shell hidden={!pageVisible()} inert={!pageVisible()}>
    <RightWorkbench pageVisible={pageVisible()} activeTab="subagents" openToolTabs={["subagents"]}
      onTabChange={() => {}} onToolClose={() => {}} onClose={close} inspector={null}
      review={null} browser={null} subagents={<SessionDraft />} />
  </div><section data-settings><button onClick={changeTheme}>Light theme</button></section></>)
  const panel = activeModal()!
  const input = panel.querySelector<HTMLInputElement>('input[aria-label="Session draft"]')!
  const settings = host.querySelector<HTMLElement>("[data-settings]")!
  expect(settings.getAttribute("aria-hidden")).toBe("true")
  expect(host.querySelector('[data-slot="dialog-overlay"]')).not.toBeNull()
  dispatch(() => setPageVisible(false))
  expect(settings.closest('[aria-hidden="true"]')).toBeNull()
  expect(activeModal()).toBeNull()
  expect(host.querySelector('[data-slot="dialog-overlay"]')).toBeNull()
  const theme = settings.querySelector<HTMLButtonElement>("button")!
  dispatch(() => { theme.focus(); theme.click() })
  expect(document.activeElement).toBe(theme)
  expect(changeTheme).toHaveBeenCalledOnce()
  expect(close).not.toHaveBeenCalled()
  expect(host.querySelector('input[aria-label="Session draft"]')).toBe(input)
  dispatch(() => setPageVisible(true))
  expect(activeModal()).toBe(panel)
  expect(panel.querySelector('input[aria-label="Session draft"]')).toBe(input)
  expect(input.value).toBe("retained side draft")
  expect(mounted).toHaveBeenCalledOnce()
  expect(unmounted).not.toHaveBeenCalled()
  dispatch(() => theme.focus())
  expect(panel.contains(document.activeElement)).toBe(true)
})

it("lets a global palette and dialog own focus above the workbench", async () => {
  const close = vi.fn()
  const [palette, setPalette] = createSignal(false)
  const [settings, setSettings] = createSignal(false)
  let side!: HTMLInputElement
  const { host } = mount({}, () => <><ResponsiveDialog>
    <div hidden={settings()} inert={settings()}><RightWorkbench pageVisible={!settings()} activeTab="subagents" openToolTabs={["subagents"]}
      onTabChange={() => {}} onToolClose={() => {}} onClose={close} inspector={null} review={null} browser={null}
      subagents={<><input ref={(input) => { side = input }} aria-label="Side editor" value="Side draft" />
        <ResponsiveDialogTrigger>Other global dialog</ResponsiveDialogTrigger></>} /></div>
    <ResponsiveDialogContent><ResponsiveDialogTitle>Global settings</ResponsiveDialogTitle><input aria-label="Global input" /></ResponsiveDialogContent>
  </ResponsiveDialog>
  <Show when={settings()}><button data-return onClick={() => setSettings(false)}>Return from Settings</button></Show>
  <Show when={palette()}><CommandPalette chats={[]} onClose={() => setPalette(false)} onSelect={() => {}}
    getReturnFocusTarget={() => side} onNewChat={() => {}} onSettings={() => setSettings(true)} /></Show></>)
  const openPalette = async () => {
    dispatch(() => { side.focus(); setPalette(true) })
    const search = document.querySelector<HTMLInputElement>('[data-command-palette] input')!
    await vi.waitFor(() => expect(document.activeElement).toBe(search))
    return search
  }
  let search = await openPalette()
  key(search, "Escape")
  await vi.waitFor(() => expect(document.activeElement).toBe(side))
  expect(close).not.toHaveBeenCalled()
  search = await openPalette()
  dispatch(() => { search.value = "系统设置"; search.dispatchEvent(new Event("input", { bubbles: true })) })
  expect(search.value).toBe("系统设置")
  expect(side.value).toBe("Side draft")
  key(search, "Enter")
  const back = host.querySelector<HTMLButtonElement>("[data-return]")!
  dispatch(() => back.focus())
  await frame()
  expect(document.activeElement).toBe(back)
  dispatch(() => back.click())
  expect(host.querySelector('input[aria-label="Side editor"]')).toBe(side)
  const other = [...host.querySelectorAll<HTMLButtonElement>("button")].find((item) => item.textContent === "Other global dialog")!
  dispatch(() => other.click())
  const globalInput = document.querySelector<HTMLInputElement>('input[aria-label="Global input"]')!
  await vi.waitFor(() => expect(document.activeElement).toBe(globalInput))
  dispatch(() => side.focus())
  expect(document.activeElement).toBe(globalInput)
  key(globalInput, "Escape")
  await vi.waitFor(() => expect(document.activeElement).toBe(other))
  expect(close).not.toHaveBeenCalled()
})

it.each([
  { docked: true, visible: true, pageVisible: true },
  { docked: false, visible: false, pageVisible: true },
  { docked: false, visible: true, pageVisible: false },
])("keeps an eager surface below a global dialog as lazy workbench content arrives (%j)", async (mode) => {
  const close = vi.fn()
  const [load, setLoad] = createSignal(false)
  const [open, setOpen] = createSignal(true)
  let resolveContent!: (module: { default: typeof RightWorkbenchContent }) => void
  const pending = new Promise<{ default: typeof RightWorkbenchContent }>((resolve) => { resolveContent = resolve })
  const LateContent = lazy(() => pending)
  const { host } = mount({}, () => <><button data-background>Background</button>
    <RightWorkbenchSurface {...mode} onClose={close}>
      <Show when={load()}><Loading fallback={<span>Loading workbench</span>}>
        <LateContent {...mode} activeTab="subagents" openToolTabs={["subagents"]} onTabChange={() => {}}
          onToolClose={() => {}} onClose={close} inspector={null} review={null} browser={null}
          subagents={<input aria-label="Inactive editor" />} />
      </Loading></Show>
    </RightWorkbenchSurface>
    <ResponsiveDialog open={open()} onOpenChange={setOpen}>
      <ResponsiveDialogContent><ResponsiveDialogTitle>Rename Supervisor</ResponsiveDialogTitle><input aria-label="Rename title" /></ResponsiveDialogContent>
    </ResponsiveDialog></>)
  const panel = host.querySelector("#right-workbench")
  const rename = document.querySelector<HTMLInputElement>('input[aria-label="Rename title"]')!
  await vi.waitFor(() => expect(document.activeElement).toBe(rename))
  dispatch(() => setLoad(true))
  expect(host.textContent).toContain("Loading workbench")
  resolveContent({ default: RightWorkbenchContent })
  await vi.waitFor(() => { flush(); expect(host.textContent).not.toContain("Loading workbench") })
  expect(host.querySelector("#right-workbench")).toBe(panel)
  dispatch(() => host.querySelector<HTMLButtonElement>("[data-background]")!.focus())
  expect(document.activeElement).toBe(rename)
  key(rename, "Escape")
  expect(document.querySelector('[role="dialog"][data-state="open"]')).toBeNull()
  expect(close).not.toHaveBeenCalled()
})

function setupKeyboardDrag() {
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(document, "getAnimations", { configurable: true, value: () => [] })
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] })
}
const keyboard = (element: Element, key: string, code = key) =>
  element.dispatchEvent(new KeyboardEvent("keydown", { key, code, bubbles: true, cancelable: true }))

it.each([false, true])("cancels a keyboard tab drag before Escape dismisses the pane, immediate=%s", async (immediate) => {
  setupKeyboardDrag()
  const close = vi.fn(), reorder = vi.fn()
  const { host } = mount({ docked: false, activeTab: "review", openToolTabs: ["review", "subagents"], onClose: close, onTabReorder: reorder })
  const panel = activeModal()!
  const handle = panel.querySelector<HTMLButtonElement>("[aria-keyshortcuts]")!
  const before = exposedTabs(host)
  await frame()
  dispatch(() => {
    handle.focus()
    keyboard(handle, " ", "Space")
    if (immediate) keyboard(handle, "Escape")
  })
  if (!immediate) {
    await vi.waitFor(() => expect(handle.parentElement!.style.opacity).toBe("0.6"))
    dispatch(() => keyboard(handle, "Escape"))
  }
  expect(close).not.toHaveBeenCalled()
  expect(reorder).not.toHaveBeenCalled()
  expect(activeModal()).toBe(panel)
  await vi.waitFor(() => expect(exposedTabs(host)).toEqual(before))
  dispatch(() => keyboard(handle, "Escape"))
  expect(close).toHaveBeenCalledOnce()
})

it.each(["unmount", "settings", "subagents"])("cancels a tab drag on %s without leaving Escape disabled", async (change) => {
  setupKeyboardDrag()
  const close = vi.fn(), reorder = vi.fn()
  const dragRef = { current: null as WorkbenchTabDrag | null }
  const [changed, setChanged] = createSignal(false)
  const { host } = mount({}, () => <RightWorkbenchSurface tabDragRef={dragRef}
    visible={!(changed() && change === "unmount")} pageVisible={!(changed() && change === "settings")}
    focusScopeKey={changed() && change === "subagents" ? "next" : "original"} onClose={close}>
    <Show when={!(changed() && change === "unmount")}>
      <RightWorkbenchContent activeTab="subagents" openToolTabs={["review", "subagents"]}
        onTabChange={() => {}} onToolClose={() => {}} onClose={close} onTabReorder={reorder}
        inspector={null} review={null} browser={null} subagents={<input aria-label="Draft" value="Retained" />} />
    </Show>
  </RightWorkbenchSurface>)
  const draft = host.querySelector<HTMLInputElement>('input[aria-label="Draft"]')!
  const handle = host.querySelector<HTMLButtonElement>("[aria-keyshortcuts]")!
  await frame()
  dispatch(() => { handle.focus(); keyboard(handle, " ", "Space") })
  await vi.waitFor(() => expect(handle.parentElement!.style.opacity).toBe("0.6"))
  expect(dragRef.current?.getSourceId()).toBe(handle.dataset.workbenchTabHandle)
  dispatch(() => setChanged(true))
  expect(dragRef.current?.getSourceId() ?? null).toBeNull()
  dispatch(() => setChanged(false))
  expect(dragRef.current?.getSourceId() ?? null).toBeNull()
  if (change !== "unmount") expect(host.querySelector('input[aria-label="Draft"]')).toBe(draft)
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Draft"]')!.value).toBe("Retained")
  expect(reorder).not.toHaveBeenCalled()
  key(activeModal()!, "Escape")
  expect(close).toHaveBeenCalledOnce()
})

it.each(["initializing", "dragging", "move-key"])("cancels the drag sensor when command search opens (%s)", async (mode) => {
  setupKeyboardDrag()
  const close = vi.fn(), reorder = vi.fn()
  const dragRef = { current: null as WorkbenchTabDrag | null }
  const [palette, setPalette] = createSignal(false)
  let returnTarget: () => HTMLElement | null = () => null
  let manager: DragDropManager | undefined
  const register = cancellationModule.workbenchDragCancellation
  vi.spyOn(cancellationModule, "workbenchDragCancellation").mockImplementation((instance, active) => {
    manager = instance
    return register(instance, active)
  })
  const command = () => {
    const focused = document.activeElement
    returnTarget = captureWorkbenchFocusReturn(focused instanceof HTMLElement ? focused : null,
      "subagents", () => "subagents", dragRef.current?.getSourceId())
    setPalette(true)
  }
  const { host } = mount({}, () => <>
    <RightWorkbench tabDragRef={dragRef} interactionSuspended={palette()} activeTab="subagents" openToolTabs={["review", "subagents"]}
      onTabChange={() => {}} onToolClose={() => {}} onClose={close} onTabReorder={reorder}
      inspector={null} review={null} browser={null} subagents={<input aria-label="Draft" value="Retained" />} />
    <Show when={palette()}><CommandPalette getReturnFocusTarget={returnTarget} chats={[]} onClose={() => setPalette(false)}
      onSelect={() => {}} onNewChat={() => {}} onSettings={() => {}} /></Show>
  </>)
  const handle = host.querySelector<HTMLButtonElement>("[aria-keyshortcuts]")!
  const draft = host.querySelector<HTMLInputElement>('input[aria-label="Draft"]')!
  await frame()
  dispatch(() => {
    handle.focus()
    keyboard(handle, " ", "Space")
    if (mode === "initializing") command()
  })
  if (mode !== "initializing") {
    await vi.waitFor(() => expect(handle.parentElement!.style.opacity).toBe("0.6"))
    if (mode === "move-key") {
      await frame()
      dispatch(() => keyboard(handle, "ArrowRight"))
      await frame()
      expect(document.querySelector("[data-dnd-placeholder]")).not.toBeNull()
      dispatch(() => activeModal()?.focus())
    }
    dispatch(command)
  }
  const search = document.querySelector<HTMLInputElement>('[data-command-palette] input')!
  await vi.waitFor(() => expect(document.activeElement).toBe(search))
  const feedback = manager!.plugins.find((plugin) => plugin instanceof Feedback)!
  expect(feedback.dropAnimation).toBeNull()
  const lateFocus = vi.spyOn(handle, "focus")
  for (const character of "Alpha movable") {
    dispatch(() => {
      const focused = document.activeElement as HTMLInputElement
      expect(focused.dispatchEvent(new KeyboardEvent("keydown", {
        key: character, code: character === " " ? "Space" : `Key${character.toUpperCase()}`, bubbles: true, cancelable: true,
      }))).toBe(true)
      focused.value += character
      focused.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }
  expect(search.value).toBe("Alpha movable")
  await vi.waitFor(() => expect(document.querySelector("[data-dnd-placeholder]")).toBeNull())
  await frame()
  expect(lateFocus).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(search)
  lateFocus.mockRestore()
  expect(host.querySelector('input[aria-label="Draft"]')).toBe(draft)
  expect(draft.value).toBe("Retained")
  expect(reorder).not.toHaveBeenCalled()
  key(search, "Escape")
  await vi.waitFor(() => expect(document.activeElement).toBe(handle))
  dispatch(() => keyboard(handle, " ", "Space"))
  await vi.waitFor(() => expect(handle.parentElement!.style.opacity).toBe("0.6"))
  expect(feedback.dropAnimation).toBeUndefined()
  dispatch(() => keyboard(handle, "Escape"))
  expect(close).not.toHaveBeenCalled()
  expect(reorder).not.toHaveBeenCalled()
})
