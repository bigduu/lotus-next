import { render, type JSX } from "@solidjs/web"
import { createSignal, flush, onSettled } from "solid-js"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { RightWorkbench, type RightWorkbenchProps } from "./RightWorkbench"

const compiledPrimitive = vi.hoisted(() => async (name: string) => {
  const { createRequire } = await vi.importActual<{
    createRequire: (url: string) => { resolve: (specifier: string) => string }
  }>("node:module")
  return vi.importActual(createRequire(import.meta.url).resolve(name).replace(/\.jsx$/, ".js"))
})
vi.mock("@kobalte/core/tabs", () => compiledPrimitive("@kobalte/core/tabs"))
vi.mock("@kobalte/core/tooltip", () => compiledPrimitive("@kobalte/core/tooltip"))
vi.mock("@kobalte/core/dropdown-menu", () => compiledPrimitive("@kobalte/core/dropdown-menu"))
vi.mock("@lucide/solid", () => {
  const icon = () => null
  return { ArrowLeft: icon, Bot: icon, ChevronDown: icon, ChevronRight: icon, Check: icon, Circle: icon,
    FileDiff: icon, Globe2: icon, GripVertical: icon, ListChecks: icon, MessageSquare: icon,
    Plus: icon, SlidersHorizontal: icon, Workflow: icon, X: icon }
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
  vi.restoreAllMocks()
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
