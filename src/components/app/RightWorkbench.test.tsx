import { Feedback } from "@dnd-kit/dom"
import type { DragDropManager } from "@dnd-kit/react"
import * as cancellationModule from "./workbenchDragCancellation"
import type { WorkbenchTabDrag } from "./workbenchSurfaceContext"
import { act, lazy, StrictMode, Suspense, useEffect, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest"
import { captureWorkbenchFocusReturn } from "@/lib/workbenchFocusReturn"
import { CommandPalette } from "@/components/chat/CommandPalette"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogTitle, ResponsiveDialogTrigger } from "@/components/ui/responsive-dialog"
import { ModelEffortPicker } from "@/components/chat/ModelEffortPicker"
import { RightWorkbench, RightWorkbenchContent } from "./RightWorkbench"
import { RightWorkbenchSurface } from "./RightWorkbenchSurface"

const roots: Root[] = []
const actEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT?: boolean
}

beforeAll(() => {
  actEnvironment.IS_REACT_ACT_ENVIRONMENT = true
})

afterAll(() => {
  Reflect.deleteProperty(actEnvironment, "IS_REACT_ACT_ENVIRONMENT")
})

afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
  Reflect.deleteProperty(document, "getAnimations")
  Reflect.deleteProperty(Element.prototype, "getAnimations")
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

it("switches tools in one docked panel and closes without navigation", () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  roots.push(root)
  const onTabChange = vi.fn()
  const onClose = vi.fn()
  const onBrowserActivate = vi.fn()
  const onBrowserClose = vi.fn()
  const onToolClose = vi.fn()

  act(() => {
    root.render(
      <RightWorkbench
        docked
        activeTab="inspector"
        openToolTabs={["inspector", "review", "session"]}
        onTabChange={onTabChange}
        onToolClose={onToolClose}
        onClose={onClose}
        inspector={<div>inspector content</div>}
        review={<div>review content</div>}
        browser={<div>browser content</div>}
        browserTabs={[
          { tab_id: "tab-a", url: "https://a.test", title: "Alpha", active: true },
          { tab_id: "tab-b", url: "https://b.test", title: "Beta", active: false },
        ]}
        activeBrowserTabId="tab-a"
        onBrowserActivate={onBrowserActivate}
        onBrowserClose={onBrowserClose}
        session={<div>child transcript</div>}
        sessionTitle="Fix transport"
      />,
    )
  })

  expect(host.querySelector('[role="tab"][aria-selected="true"]')?.textContent).toContain(
    "检查器",
  )
  const reviewTab = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (button) => button.textContent?.includes("Review"),
  )
  expect(reviewTab).toBeDefined()
  act(() =>
    reviewTab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })),
  )
  expect(onTabChange).toHaveBeenCalledWith("review")

  const browserTab = host.querySelector<HTMLButtonElement>('[role="tab"][aria-label="浏览器标签页 2：Beta"]')
  expect(host.querySelectorAll('[role="tab"][aria-label^="浏览器标签页"]')).toHaveLength(2)
  act(() =>
    browserTab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })),
  )
  expect(onBrowserActivate).toHaveBeenCalledWith("tab-b")
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="关闭浏览器标签页 1：Alpha"]')?.click())
  expect(onBrowserClose).toHaveBeenCalledWith("tab-a")
  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="关闭Review标签页"]')?.click())
  expect(onToolClose).toHaveBeenCalledWith("review")
  expect(host.querySelector('button[aria-label="打开工作面板标签页"]')).not.toBeNull()
  expect(host.querySelector('[role="tablist"]')?.className).toContain("overflow-x-auto")

  act(() => host.querySelector<HTMLButtonElement>('button[aria-label="收起工作面板"]')?.click())
  expect(onClose).toHaveBeenCalledTimes(1)
})

it("uses the supplied docked width without a percentage cap and retains the mobile overlay", () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  roots.push(root)
  const renderWorkbench = (docked: boolean) => (
    <RightWorkbench
      docked={docked}
      width={1200}
      activeTab={null}
      openToolTabs={[]}
      onTabChange={vi.fn()}
      onToolClose={vi.fn()}
      onClose={vi.fn()}
      inspector={null}
      review={null}
      browser={null}
      session={null}
    />
  )

  act(() => root.render(renderWorkbench(true)))
  expect(host.querySelector("aside")!.style.width).toBe("1200px")
  expect(host.querySelector("aside")!.style.maxWidth).toBe("")
  act(() => root.render(renderWorkbench(false)))
  expect(document.querySelector("aside")!.className).toContain("fixed")
  expect(document.querySelector("aside")!.style.width).not.toBe("1200px")
  expect(document.querySelector('button[aria-label="收起工作面板"]')).not.toBeNull()
})

it("keeps an open root session mounted while another workbench tab is selected", () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  roots.push(root)
  const onMount = vi.fn()
  const onUnmount = vi.fn()

  function RunningSession() {
    const [status] = useState("sending")
    useEffect(() => {
      onMount()
      return () => onUnmount()
    }, [])
    return <div data-testid="running-session">{status}</div>
  }

  const renderWorkbench = (activeTab: "session" | "inspector", visible = true) => (
    <RightWorkbench
      docked
      visible={visible}
      activeTab={activeTab}
      openToolTabs={["inspector", "session"]}
      onTabChange={vi.fn()}
      onToolClose={vi.fn()}
      onClose={vi.fn()}
      inspector={<div>inspector content</div>}
      review={null}
      browser={null}
      session={<RunningSession />}
    />
  )

  act(() => root.render(renderWorkbench("session")))
  expect(host.querySelector('[data-testid="running-session"]')?.textContent).toBe("sending")
  act(() => root.render(renderWorkbench("inspector")))
  expect(onUnmount).not.toHaveBeenCalled()
  act(() => root.render(renderWorkbench("session")))
  expect(host.querySelector('[data-testid="running-session"]')?.textContent).toBe("sending")
  expect(onMount).toHaveBeenCalledTimes(1)
  act(() => root.render(renderWorkbench("session", false)))
  expect(onUnmount).toHaveBeenCalledOnce()
  expect(host.querySelector('[data-testid="running-session"]')).toBeNull()
})

it("preserves a Work decision draft across tab switches", () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  roots.push(root)
  const onMount = vi.fn()
  function WorkDecision() {
    const [answer, setAnswer] = useState("")
    useEffect(() => { onMount() }, [])
    return <input aria-label="Work answer" value={answer} onChange={(event) => setAnswer(event.target.value)} />
  }
  const render = (activeTab: "work" | "inspector", visible = true) => <RightWorkbench docked activeTab={activeTab} visible={visible}
    openToolTabs={["work", "inspector"]} workEnabled work={<WorkDecision />}
    onTabChange={vi.fn()} onToolClose={vi.fn()} onClose={vi.fn()}
    inspector={<div>inspector</div>} review={null} browser={null} session={null} />
  act(() => root.render(render("work")))
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Work answer"]')!
  act(() => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "蓝色")
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
  act(() => root.render(render("inspector")))
  expect(host.querySelector('input[aria-label="Work answer"]')).toBe(input)
  expect(input.closest('[role="tabpanel"]')?.className).toContain("hidden")
  act(() => root.render(render("work")))
  expect(input.value).toBe("蓝色")
  act(() => root.render(render("work", false)))
  expect(input.closest("aside")?.hidden).toBe(true)
  expect(input.closest("aside")?.style.display).toBe("none")
  act(() => root.render(render("work")))
  expect(input.value).toBe("蓝色")
  expect(onMount).toHaveBeenCalledOnce()
})

it("omits the browser tab and content when the phone layout disables it", () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  roots.push(root)

  act(() => {
    root.render(
      <RightWorkbench
        activeTab="inspector"
        openToolTabs={["inspector"]}
        onTabChange={vi.fn()}
        onToolClose={vi.fn()}
        onClose={vi.fn()}
        inspector={<div>inspector content</div>}
        review={<div>review content</div>}
        browser={<div>browser content</div>}
        browserEnabled={false}
        session={<div>child transcript</div>}
      />,
    )
  })

  expect(document.querySelector('[role="tab"][data-state="active"]')?.textContent).toContain("检查器")
  expect(Array.from(document.querySelectorAll('[role="tab"]')).some((tab) => tab.textContent?.includes("浏览器"))).toBe(false)
  expect(document.body.textContent).not.toContain("browser content")
})

it("shows a launcher instead of an about:blank tab when no content is open", () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  roots.push(root)
  const onTabChange = vi.fn()

  act(() => {
    root.render(
      <RightWorkbench
        docked
        activeTab={null}
        openToolTabs={[]}
        onTabChange={onTabChange}
        onToolClose={vi.fn()}
        onClose={vi.fn()}
        inspector={<div>inspector content</div>}
        review={<div>review content</div>}
        browser={<div>browser content</div>}
        browserTabs={[]}
        session={<div>child transcript</div>}
      />,
    )
  })

  expect(host.textContent).toContain("还没有打开内容")
  expect(host.querySelectorAll('[role="tab"]')).toHaveLength(0)
  expect(host.textContent).not.toContain("about:blank")
  const browserLauncher = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.includes("输入网址后打开"),
  )
  act(() => browserLauncher?.click())
  expect(onTabChange).toHaveBeenCalledWith("browser")
})

it("uses the same stable selection surface for tool and browser tabs", () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  roots.push(root)
  const onTabReorder = vi.fn()
  const render = (activeTab: "inspector" | "browser") => act(() => root.render(
    <RightWorkbench docked activeTab={activeTab} openToolTabs={["inspector"]}
      onTabChange={vi.fn()} onToolClose={vi.fn()} onClose={vi.fn()} onTabReorder={onTabReorder}
      inspector={null} review={null} session={null} browser={null}
      browserTabs={[{ tab_id: "alpha", title: "Alpha", url: "https://a.test", active: true }]} activeBrowserTabId="alpha" />,
  ))
  render("inspector")
  const [tool, browser] = [...host.querySelectorAll<HTMLElement>('[role="tab"]')]
  expect(tool.className).toBe(browser.className)
  const selectedStyle = tool.parentElement!.className
  const inactiveStyle = browser.parentElement!.className
  expect(selectedStyle).toContain("feedback-motion")
  expect(selectedStyle).toContain("shadow-sm")
  expect(selectedStyle).toContain("select-none")
  expect(inactiveStyle).toContain("hover:bg-accent")
  render("browser")
  expect(browser.parentElement!.className).toBe(selectedStyle)
  expect(tool.parentElement!.className).toBe(inactiveStyle)
  expect([...host.querySelectorAll('[role="tab"]')]).toEqual([tool, browser])
  expect(onTabReorder).not.toHaveBeenCalled()
})

it("exposes complete long labels on keyboard focus and in a touch-accessible tab list", async () => {
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host); roots.push(root)
  const longTitle = "A very long session title that must remain complete when its workbench tab is truncated"
  const browserTitle = "https://example.test/" + "long-path/".repeat(12)
  const onBrowserActivate = vi.fn(); const onTabReorder = vi.fn()
  act(() => root.render(<RightWorkbench docked activeTab="session" openToolTabs={["session"]}
    onTabChange={vi.fn()} onToolClose={vi.fn()} onClose={vi.fn()} onTabReorder={onTabReorder}
    sessionTitle={longTitle} inspector={null} review={null} session={null} browser={null}
    browserTabs={[{ tab_id: "a", title: browserTitle, url: browserTitle, active: false }]}
    onBrowserActivate={onBrowserActivate} />))
  const sessionTab = host.querySelector<HTMLElement>('[role="tab"]')!
  await act(async () => sessionTab.focus())
  expect(document.querySelector('[role="tooltip"]')?.textContent).toBe(longTitle)
  await act(async () => sessionTab.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
  const list = host.querySelector<HTMLButtonElement>('button[aria-label="已打开的标签页"]')!
  await act(async () => list.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })))
  const items = [...document.querySelectorAll<HTMLElement>('[role="menuitemradio"]')]
  expect(items.map((item) => item.textContent)).toEqual([longTitle, browserTitle])
  expect(items[0].getAttribute("aria-checked")).toBe("true")
  expect(items[1].style.whiteSpace).toBe("normal")
  expect(items[1].style.overflowWrap).toBe("anywhere")
  await act(async () => items[1].click())
  expect(onBrowserActivate).toHaveBeenCalledWith("a")
  await vi.waitFor(() => expect(document.activeElement).toBe(list))
  expect(document.querySelector('[role="menu"]')).toBeNull()
  expect(onTabReorder).not.toHaveBeenCalled()
  // Pointer/touch click remains a normal button opening the same Radix list.
  await act(async () => list.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })))
  expect(document.querySelector('[role="menu"]')).not.toBeNull()
  await act(async () => document.querySelector('[role="menu"]')!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
  await vi.waitFor(() => expect(document.activeElement).toBe(list))
})

it("refreshes full labels from current props and returns focus safely when the last tab closes", async () => {
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host); roots.push(root)
  const onTabChange = vi.fn()
  const render = (title: string | null) => act(() => root.render(<RightWorkbench docked activeTab={title ? "session" : null}
    openToolTabs={title ? ["session"] : []} sessionTitle={title}
    onTabChange={onTabChange} onToolClose={vi.fn()} onClose={vi.fn()}
    inspector={null} review={null} session={null} browser={null} />))
  render("Original session")
  const list = host.querySelector<HTMLButtonElement>('button[aria-label="已打开的标签页"]')!
  await act(async () => list.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })))
  render("Current session after navigation")
  expect(document.querySelector('[role="menuitemradio"]')?.textContent).toBe("Current session after navigation")
  expect(document.querySelector('[role="menu"]')?.textContent).not.toContain("Original session")
  render(null)
  await vi.waitFor(() => expect(document.querySelector('[role="menu"]')).toBeNull())
  const add = host.querySelector('button[aria-label="打开工作面板标签页"]')
  await vi.waitFor(() => expect(document.activeElement).toBe(add))
  expect(list.disabled).toBe(true)
  expect(onTabChange).not.toHaveBeenCalled()
})

it("restores focus after closing tabs without changing their order", async () => {
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host); roots.push(root)
  const onTabReorder = vi.fn()
  function Harness() {
    const [open, setOpen] = useState<Array<"inspector" | "session">>(["inspector", "session"])
    return <RightWorkbench docked activeTab={open[0] ?? null} openToolTabs={open} onTabChange={vi.fn()}
      onToolClose={(closed) => setOpen((tabs) => tabs.filter((tab) => tab !== closed))}
      onTabReorder={onTabReorder} onClose={vi.fn()} inspector={null} review={null} session={null} browser={null} />
  }
  act(() => root.render(<Harness />))
  const close = host.querySelector<HTMLButtonElement>('button[aria-label="关闭检查器标签页"]')!
  act(() => close.focus())
  await act(async () => close.click())
  expect(document.activeElement).toBe(host.querySelector('[role="tab"]'))
  const last = host.querySelector<HTMLButtonElement>('button[aria-label="关闭并排会话标签页"]')!
  act(() => last.focus())
  await act(async () => last.click())
  expect(document.activeElement).toBe(host.querySelector('button[aria-label="打开工作面板标签页"]'))
  expect(onTabReorder).not.toHaveBeenCalled()
})

it("does not steal focus when a delayed close finishes after the user moves away", async () => {
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host); roots.push(root)
  let finishClose = () => {}
  function Harness() {
    const [open, setOpen] = useState<Array<"inspector" | "session">>(["inspector", "session"])
    return <RightWorkbench docked activeTab="session" openToolTabs={open} onTabChange={vi.fn()}
      onToolClose={(closed) => { finishClose = () => setOpen((tabs) => tabs.filter((tab) => tab !== closed)) }}
      onClose={vi.fn()} inspector={null} review={null} session={null} browser={null} />
  }
  act(() => root.render(<Harness />))
  const close = host.querySelector<HTMLButtonElement>('button[aria-label="关闭检查器标签页"]')!
  await act(async () => { close.focus(); close.click() })
  const add = host.querySelector<HTMLButtonElement>('button[aria-label="打开工作面板标签页"]')!
  act(() => add.focus())
  act(() => finishClose())
  expect(document.activeElement).toBe(add)
})

it("traps narrow-workbench focus, dismisses the topmost menu first, and restores its opener", async () => {
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host); roots.push(root)
  const closed = vi.fn()
  function Harness() {
    const [visible, setVisible] = useState(false)
    return <><button aria-controls="right-workbench" onClick={() => setVisible(true)}>Open workbench</button>
      <button>Background action</button>
      <RightWorkbench visible={visible} activeTab="inspector" openToolTabs={["inspector"]} onTabChange={vi.fn()}
        onToolClose={vi.fn()} onClose={() => { closed(); setVisible(false) }}
        inspector={<button>Panel action</button>} review={null} session={null} browser={null} /></>
  }
  act(() => root.render(<Harness />))
  const opener = host.querySelector<HTMLButtonElement>('[aria-controls="right-workbench"]')!
  await act(async () => { opener.focus(); opener.click() })
  const dialog = document.querySelector<HTMLElement>('[role="dialog"]')!
  expect(dialog).not.toBeNull()
  expect(dialog.getAttribute("aria-label")).toBeTruthy()
  expect(dialog.contains(document.activeElement)).toBe(true)
  const background = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Background action")!
  act(() => background.focus())
  expect(dialog.contains(document.activeElement)).toBe(true)
  const buttons = [...dialog.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
  act(() => buttons.at(-1)!.focus())
  expect(document.activeElement).toBe(buttons.at(-1))
  const tab = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
  act(() => buttons.at(-1)!.dispatchEvent(tab))
  expect(tab.defaultPrevented).toBe(true)
  expect(dialog.contains(document.activeElement)).toBe(true)
  expect(document.activeElement).not.toBe(buttons.at(-1))
  const menuTrigger = dialog.querySelector<HTMLButtonElement>('button[aria-label="已打开的标签页"]')!
  await act(async () => menuTrigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })))
  expect(document.querySelector('[role="menu"]')).not.toBeNull()
  await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
  expect(closed).not.toHaveBeenCalled()
  expect(document.querySelector('[role="menu"]')).toBeNull()
  await vi.waitFor(() => expect(document.activeElement).toBe(menuTrigger))
  await act(async () => menuTrigger.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
  expect(closed).toHaveBeenCalledTimes(1)
  await vi.waitFor(() => expect(document.activeElement).toBe(opener))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(host.closest('[aria-hidden="true"]')).toBeNull()
})

it("preserves session drafts and attachment state across desktop/modal resizing without locking desktop focus", async () => {
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host); roots.push(root)
  const mounted = vi.fn(); const unmounted = vi.fn()
  function Session() {
    const [draft, setDraft] = useState("Saved draft")
    const [attachments, setAttachments] = useState(0)
    useEffect(() => { mounted(); return unmounted }, [])
    return <><input aria-label="Draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button onClick={() => setAttachments((count) => count + 1)}>Attach {attachments}</button></>
  }
  const render = (docked: boolean) => act(() => root.render(<><button aria-controls="right-workbench">Launcher</button>
    <RightWorkbench docked={docked} activeTab="session" openToolTabs={["session"]} onTabChange={vi.fn()}
      onToolClose={vi.fn()} onClose={vi.fn()} inspector={null} review={null} browser={null} session={<Session />} /></>))
  render(true)
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Draft"]')!
  const attach = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Attach 0")!
  act(() => attach.click())
  act(() => input.focus())
  render(false)
  expect(document.querySelector('input[aria-label="Draft"]')).toBe(input)
  expect(document.querySelector('[role="dialog"]')?.textContent).toContain("Attach 1")
  expect(document.activeElement).toBe(input)
  render(true)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  expect(host.querySelector('input[aria-label="Draft"]')).toBe(input)
  expect(document.activeElement).toBe(input)
  expect(input.value).toBe("Saved draft")
  expect(mounted).toHaveBeenCalledTimes(1)
  expect(unmounted).not.toHaveBeenCalled()
  const launcher = host.querySelector<HTMLButtonElement>('[aria-controls="right-workbench"]')!
  act(() => launcher.focus())
  expect(document.activeElement).toBe(launcher)
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(document.body.style.pointerEvents).not.toBe("none")
})

it("keeps internal pointer interaction open and restores focus after backdrop or close-button dismissal", async () => {
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host); roots.push(root)
  const closed = vi.fn(); const inside = vi.fn()
  function Harness() {
    const [visible, setVisible] = useState(false)
    return <><button aria-controls="right-workbench" onClick={() => setVisible(true)}>Launcher</button>
      <RightWorkbench visible={visible} activeTab="inspector" openToolTabs={["inspector"]} onTabChange={vi.fn()}
        onToolClose={vi.fn()} onClose={() => { closed(); setVisible(false) }}
        inspector={<button onClick={inside}>Inside action</button>} review={null} session={null} browser={null} /></>
  }
  act(() => root.render(<Harness />))
  const opener = host.querySelector<HTMLButtonElement>('[aria-controls="right-workbench"]')!
  const open = async () => {
    await act(async () => { opener.focus(); opener.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  }
  await open()
  const action = [...document.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')].find((button) => button.textContent === "Inside action")!
  await act(async () => { action.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })); action.click() })
  expect(inside).toHaveBeenCalledTimes(1)
  expect(closed).not.toHaveBeenCalled()
  await act(async () => {
    const overlay = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!
    overlay.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    overlay.click()
  })
  expect(closed).toHaveBeenCalledTimes(1)
  await vi.waitFor(() => expect(document.activeElement).toBe(opener))
  await open()
  await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="收起工作面板"]')!.click())
  expect(closed).toHaveBeenCalledTimes(2)
  await vi.waitFor(() => expect(document.activeElement).toBe(opener))
  expect(document.body.style.pointerEvents).not.toBe("none")
})

it("returns to an available launcher when the original opener becomes hidden", async () => {
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host); roots.push(root)
  function Harness() {
    const [visible, setVisible] = useState(false)
    return <><button aria-controls="right-workbench">Available launcher</button><button onClick={() => setVisible(true)}>Original opener</button>
      <RightWorkbench visible={visible} activeTab="inspector" openToolTabs={["inspector"]} onTabChange={vi.fn()}
        onToolClose={vi.fn()} onClose={() => setVisible(false)} inspector={null} review={null} session={null} browser={null} /></>
  }
  act(() => root.render(<Harness />))
  const [fallback, opener] = host.querySelectorAll<HTMLButtonElement>("button")
  await act(async () => { opener.focus(); opener.click() })
  opener.hidden = true
  await act(async () => document.querySelector<HTMLButtonElement>('[role="dialog"] button[aria-label="收起工作面板"]')!.click())
  await vi.waitFor(() => expect(document.activeElement).toBe(fallback))
})


it("keeps the real model popover usable across breakpoint changes and repeated focus cycles", async () => {
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host); roots.push(root)
  const close = vi.fn()
  const render = (docked: boolean) => act(() => root.render(<RightWorkbench docked={docked}
    activeTab="session" openToolTabs={["session"]} onTabChange={vi.fn()} onToolClose={vi.fn()} onClose={close}
    inspector={null} review={null} browser={null} session={<ModelEffortPicker models={["Model A", "Model B"]}
      model="Model A" onModelChange={vi.fn()} value="medium" onChange={vi.fn()} />} />))
  render(true)
  const picker = host.querySelector<HTMLButtonElement>('[data-testid="model-effort-picker"]')!
  await act(async () => picker.click())
  const popover = document.querySelector<HTMLElement>('[data-slot="popover-content"]')!
  expect(popover).not.toBeNull()
  render(false)
  expect(document.querySelector('[data-slot="popover-content"]')).toBe(popover)
  expect(popover.closest('[aria-hidden="true"]')).toBeNull()
  const slider = popover.querySelector<HTMLInputElement>('input[type="range"]')!
  act(() => slider.focus())
  expect(document.activeElement).toBe(slider)
  await act(async () => slider.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
  expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
  expect(close).not.toHaveBeenCalled()
  for (let i = 0; i < 30; i++) {
    const panel = document.getElementById("right-workbench")!
    const buttons = [...panel.querySelectorAll<HTMLButtonElement>('button:not(:disabled)')]
    act(() => buttons.at(-1)!.focus())
    const event = new KeyboardEvent("keydown", { key: "Tab", bubbles: true, cancelable: true })
    act(() => document.activeElement!.dispatchEvent(event))
    expect(panel.contains(document.activeElement)).toBe(true)
    await act(async () => picker.click())
    expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull()
    await act(async () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
    expect(close).not.toHaveBeenCalled()
  }
  render(true)
  await act(async () => picker.click())
  expect(document.querySelector('[data-slot="popover-content"]')).not.toBeNull()
})


it("treats sibling-owned work portals and their nested popovers as inside pointer targets", async () => {
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host); roots.push(root)
  const close = vi.fn()
  function Work() {
    const [all, setAll] = useState(false)
    return <><input aria-label="Portal draft" defaultValue="蓝色" hidden={!all} />
      <button onClick={() => setAll(true)}>All work</button>
      <Popover><PopoverTrigger asChild><button>Portal menu</button></PopoverTrigger>
        <PopoverContent><button>Nested portal action</button></PopoverContent></Popover></>
  }
  function Harness() {
    const [target, setTarget] = useState<HTMLDivElement | null>(null)
    return <><RightWorkbench activeTab="work" openToolTabs={["work"]} workEnabled work={<div ref={setTarget} />}
      onTabChange={vi.fn()} onToolClose={vi.fn()} onClose={close} inspector={null} review={null} session={null} browser={null} />
      {target ? createPortal(<Work />, target) : null}</>
  }
  act(() => root.render(<Harness />))
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  const clickPointer = async (target: HTMLElement) => act(async () => {
    target.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 }))
    target.click()
  })
  await clickPointer([...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "All work")!)
  expect(close).not.toHaveBeenCalled()
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Portal draft"]')!
  expect(input.hidden).toBe(false)
  expect(input.value).toBe("蓝色")
  await clickPointer([...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Portal menu")!)
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  const nested = document.querySelector<HTMLButtonElement>('[data-slot="popover-content"] button')!
  expect(nested).not.toBeNull()
  await clickPointer(nested)
  expect(close).not.toHaveBeenCalled()
  await act(async () => nested.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
  expect(document.querySelector('[data-slot="popover-content"]')).toBeNull()
  expect(close).not.toHaveBeenCalled()
  await clickPointer(document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!)
  expect(close).toHaveBeenCalledTimes(1)
})

it.each(["restore", "kept-mounted", "new-control", "hidden-opener", "changed-session", "reopened"] as const)(
  "settles backdrop default focus safely after dismissal: %s", async (scenario) => {
    const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host); roots.push(root)
    let currentScope = "session-a"
    const getScope = () => currentScope
    function Harness() {
      const [visible, setVisible] = useState(false)
      return <><button aria-controls="right-workbench">Fallback launcher</button>
        <button onClick={() => setVisible(true)}>Original opener</button><button>New focus</button>
        {visible || scenario === "kept-mounted" ? <RightWorkbench visible={visible} focusScopeKey="session-a" getCurrentFocusScope={getScope}
          activeTab="inspector" openToolTabs={["inspector"]} onTabChange={vi.fn()}
          onToolClose={vi.fn()} onClose={() => setVisible(false)} inspector={<button>Panel action</button>}
          review={null} session={null} browser={null} /> : null}</>
    }
    act(() => root.render(<Harness />))
    const [fallback, opener, next] = host.querySelectorAll<HTMLButtonElement>("button")
    await act(async () => { opener.focus(); opener.click() })
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
    const backdrop = document.querySelector<HTMLElement>('[data-slot="dialog-overlay"]')!
    await act(async () => backdrop.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true, button: 0 })))
    expect(document.querySelector('[aria-modal="true"]')).toBeNull()
    // Browsers apply the non-focusable backdrop's default focus action after
    // React has synchronously unmounted the pane in its pointerdown handler.
    act(() => { (document.activeElement as HTMLElement).blur() })
    expect(document.activeElement).toBe(document.body)
    await act(async () => {
      document.body.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, button: 0 }))
      document.body.click()
      if (scenario === "new-control") next.focus()
      if (scenario === "hidden-opener") opener.hidden = true
      if (scenario === "changed-session") currentScope = "session-b"
      if (scenario === "reopened") opener.click()
      await new Promise((resolve) => setTimeout(resolve, 40))
    })
    if (scenario === "restore" || scenario === "kept-mounted") expect(document.activeElement).toBe(opener)
    if (scenario === "new-control") expect(document.activeElement).toBe(next)
    if (scenario === "hidden-opener") expect(document.activeElement).toBe(fallback)
    if (scenario === "changed-session") expect(document.activeElement).toBe(document.body)
    if (scenario === "reopened") expect(document.getElementById("right-workbench")!.contains(document.activeElement)).toBe(true)
  },
)

it("releases hidden-page modal effects for Settings without remounting the workbench draft", async () => {
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host); roots.push(root)
  const mounted = vi.fn(); const unmounted = vi.fn(); const close = vi.fn(); const changeTheme = vi.fn()
  function SessionDraft() {
    const [draft, setDraft] = useState("retained side draft")
    useEffect(() => { mounted(); return unmounted }, [])
    return <input aria-label="Session draft" value={draft} onChange={(event) => setDraft(event.target.value)} />
  }
  function Harness({ pageVisible }: { pageVisible: boolean }) {
    return <><div data-testid="chat-shell" hidden={!pageVisible} inert={!pageVisible} aria-hidden={!pageVisible || undefined}>
      <button aria-controls="right-workbench">Launcher</button>
      <RightWorkbench pageVisible={pageVisible} activeTab="session" openToolTabs={["session"]}
        onTabChange={vi.fn()} onToolClose={vi.fn()} onClose={close} inspector={null} review={null} browser={null}
        session={<SessionDraft />} />
    </div><section data-testid="settings"><button onClick={changeTheme}>Light theme</button></section></>
  }
  const render = (pageVisible: boolean) => act(() => root.render(<Harness pageVisible={pageVisible} />))
  render(true)
  const panel = document.getElementById("right-workbench")!
  const input = host.querySelector<HTMLInputElement>('input[aria-label="Session draft"]')!
  expect(document.body.style.pointerEvents).toBe("none")
  expect(document.body.hasAttribute("data-scroll-locked")).toBe(true)
  const settings = host.querySelector<HTMLElement>('[data-testid="settings"]')!
  expect(settings.getAttribute("aria-hidden")).toBe("true")
  render(false)
  expect(document.body.style.pointerEvents).not.toBe("none")
  expect(document.body.hasAttribute("data-scroll-locked")).toBe(false)
  expect(settings.closest('[aria-hidden="true"]')).toBeNull()
  expect(panel.hasAttribute("aria-modal")).toBe(false)
  expect(document.querySelector('[data-slot="dialog-overlay"]')).toBeNull()
  const theme = settings.querySelector<HTMLButtonElement>("button")!
  await act(async () => { theme.focus(); theme.click() })
  expect(document.activeElement).toBe(theme)
  expect(changeTheme).toHaveBeenCalledTimes(1)
  expect(close).not.toHaveBeenCalled()
  expect(host.querySelector('input[aria-label="Session draft"]')).toBe(input)
  expect(input.value).toBe("retained side draft")
  render(true)
  expect(document.getElementById("right-workbench")).toBe(panel)
  expect(host.querySelector('input[aria-label="Session draft"]')).toBe(input)
  expect(input.value).toBe("retained side draft")
  expect(mounted).toHaveBeenCalledTimes(1)
  expect(unmounted).not.toHaveBeenCalled()
  expect(document.body.style.pointerEvents).toBe("none")
  expect(document.body.hasAttribute("data-scroll-locked")).toBe(true)
  act(() => theme.focus())
  expect(panel.contains(document.activeElement)).toBe(true)
})


it("gives global Radix overlays focus above a narrow workbench and restores their launchers", async () => {
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host); roots.push(root)
  const closeWorkbench = vi.fn()
  function Harness() {
    const [palette, setPalette] = useState(false)
    const [settings, setSettings] = useState(false)
    useEffect(() => {
      const key = (event: KeyboardEvent) => { if (event.ctrlKey && event.key === "k") { event.preventDefault(); setPalette(true) } }
      window.addEventListener("keydown", key)
      return () => window.removeEventListener("keydown", key)
    }, [])
    return <><ResponsiveDialog>
      <div hidden={settings} inert={settings}><RightWorkbench pageVisible={!settings} activeTab="session" openToolTabs={["session"]}
        onTabChange={vi.fn()} onToolClose={vi.fn()} onClose={closeWorkbench} inspector={null} review={null} browser={null}
        session={<><input aria-label="Side editor" defaultValue="Side draft" />
          <ResponsiveDialogTrigger asChild><button>Other global dialog</button></ResponsiveDialogTrigger></>} /></div>
      <ResponsiveDialogContent><ResponsiveDialogTitle>Global settings</ResponsiveDialogTitle><input aria-label="Global input" /></ResponsiveDialogContent>
    </ResponsiveDialog>
    {settings ? <button onClick={() => setSettings(false)}>Return from Settings</button> : null}
    <CommandPalette open={palette} chats={[]} onClose={() => setPalette(false)} onSelect={vi.fn()} onNewChat={vi.fn()} onSettings={() => setSettings(true)} /></>
  }
  act(() => root.render(<Harness />))
  const side = host.querySelector<HTMLInputElement>('input[aria-label="Side editor"]')!
  const openCommand = async () => {
    await act(async () => { side.focus(); side.dispatchEvent(new KeyboardEvent("keydown", { key: "k", ctrlKey: true, bubbles: true })) })
    const search = host.querySelector<HTMLInputElement>('input[placeholder="搜索会话或操作…"]')!
    await vi.waitFor(() => expect(document.activeElement).toBe(search))
    return search
  }
  let search = await openCommand()
  await act(async () => search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
  await vi.waitFor(() => expect(document.activeElement).toBe(side))
  expect(closeWorkbench).not.toHaveBeenCalled()
  search = await openCommand()
  // Write to the actually focused input, not a selector that could mask a trap.
  act(() => {
    const focused = document.activeElement as HTMLInputElement
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(focused, "系统设置")
    focused.dispatchEvent(new Event("input", { bubbles: true }))
  })
  expect(search.value).toBe("系统设置")
  expect(side.value).toBe("Side draft")
  await act(async () => search.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true })))
  const back = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Return from Settings")!
  act(() => back.focus())
  await act(async () => { await new Promise((resolve) => setTimeout(resolve, 10)) })
  expect(document.activeElement).toBe(back)
  expect(document.body.style.pointerEvents).not.toBe("none")
  await act(async () => back.click())
  expect(host.querySelector('input[aria-label="Side editor"]')).toBe(side)
  expect(side.value).toBe("Side draft")
  const other = [...host.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent === "Other global dialog")!
  await act(async () => other.click())
  const globalInput = document.querySelector<HTMLInputElement>('input[aria-label="Global input"]')!
  expect(document.activeElement).toBe(globalInput)
  act(() => side.focus())
  expect(document.activeElement).toBe(globalInput)
  await act(async () => globalInput.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true })))
  await vi.waitFor(() => expect(document.activeElement).toBe(other))
  expect(closeWorkbench).not.toHaveBeenCalled()
})

it.each([
  { docked: true, visible: true, pageVisible: true },
  { docked: false, visible: false, pageVisible: true },
  { docked: false, visible: true, pageVisible: false },
])("keeps the eager surface below a global dialog while lazy content arrives (%j)", async (mode) => {
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host); roots.push(root)
  const closeWorkbench = vi.fn()
  let resolveContent!: (module: { default: typeof RightWorkbenchContent }) => void
  const LazyContent = lazy(() => new Promise<{ default: typeof RightWorkbenchContent }>((resolve) => { resolveContent = resolve }))
  function Harness({ mountWorkbench }: { mountWorkbench: boolean }) {
    const [open, setOpen] = useState(true)
    return <><button>Background</button>
      <RightWorkbenchSurface {...mode} onClose={closeWorkbench}>
        {mountWorkbench ? <Suspense fallback={<span>Loading workbench</span>}><LazyContent {...mode} activeTab="session" openToolTabs={["session"]}
          onTabChange={vi.fn()} onToolClose={vi.fn()} onClose={closeWorkbench} inspector={null} review={null} browser={null}
          session={<input aria-label="Inactive editor" />} /></Suspense> : null}
      </RightWorkbenchSurface>
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent><ResponsiveDialogTitle>Rename Supervisor</ResponsiveDialogTitle><input aria-label="Rename title" /></ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  }
  await act(async () => root.render(<StrictMode><Harness mountWorkbench={false} /></StrictMode>))
  const panel = document.getElementById("right-workbench")!
  const rename = document.querySelector<HTMLInputElement>('input[aria-label="Rename title"]')!
  expect(document.activeElement).toBe(rename)
  await act(async () => root.render(<StrictMode><Harness mountWorkbench /></StrictMode>))
  expect(host.textContent).toContain("Loading workbench")
  await act(async () => resolveContent({ default: RightWorkbenchContent }))
  expect(host.textContent).not.toContain("Loading workbench")
  expect(document.getElementById("right-workbench")).toBe(panel)
  act(() => host.querySelector<HTMLButtonElement>("button")!.focus())
  expect(document.activeElement).toBe(rename)
  await act(async () => rename.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true })))
  expect(document.querySelector('[role="dialog"]')).toBeNull()
  expect(closeWorkbench).not.toHaveBeenCalled()
})

it.each([false, true])("cancels a keyboard tab drag before allowing Escape to dismiss the narrow pane (immediate: %s)", async (immediate) => {
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host); roots.push(root)
  const closeWorkbench = vi.fn(); const reorder = vi.fn()
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(document, "getAnimations", { configurable: true, value: () => [] })
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] })
  await act(async () => root.render(<RightWorkbench activeTab="review" openToolTabs={["review", "session"]}
    onTabChange={vi.fn()} onToolClose={vi.fn()} onClose={closeWorkbench} onTabReorder={reorder}
    inspector={null} review={<input aria-label="Review editor" />} browser={null} session={<input aria-label="Side draft" />} />))
  const panel = document.getElementById("right-workbench")!
  const handle = host.querySelector<HTMLButtonElement>('button[aria-keyshortcuts]')!
  const before = [...host.querySelectorAll('[role="tab"]')]
  await act(async () => {
    handle.focus()
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true }))
    if (immediate) handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true }))
  })
  if (!immediate) {
    await vi.waitFor(() => expect(handle.parentElement!.style.opacity).toBe("0.6"))
    await act(async () => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true })))
  }
  expect(closeWorkbench).not.toHaveBeenCalled()
  expect(reorder).not.toHaveBeenCalled()
  expect(document.getElementById("right-workbench")).toBe(panel)
  expect([...host.querySelectorAll('[role="tab"]')]).toEqual(before)
  await act(async () => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true })))
  expect(closeWorkbench).toHaveBeenCalledTimes(1)
})

it.each(["unmount", "settings", "session"])("cancels a tab drag on %s without leaving Escape disabled", async (change) => {
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host); roots.push(root)
  const close = vi.fn(); const reorder = vi.fn()
  const dragRef = { current: null as WorkbenchTabDrag | null }
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(document, "getAnimations", { configurable: true, value: () => [] })
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] })
  const render = (changed: boolean) => act(async () => root.render(
    <RightWorkbenchSurface tabDragRef={dragRef} visible={!(changed && change === "unmount")} pageVisible={!(changed && change === "settings")}
      focusScopeKey={changed && change === "session" ? "next" : "original"} onClose={close}>
      {changed && change === "unmount" ? null : <RightWorkbenchContent activeTab="session" openToolTabs={["review", "session"]}
        onTabChange={vi.fn()} onToolClose={vi.fn()} onClose={close} onTabReorder={reorder}
        inspector={null} review={null} browser={null} session={<input aria-label="Draft" defaultValue="Retained" />} />}
    </RightWorkbenchSurface>,
  ))
  await render(false)
  const draft = host.querySelector<HTMLInputElement>('input[aria-label="Draft"]')!
  const handle = host.querySelector<HTMLButtonElement>('button[aria-keyshortcuts]')!
  await act(async () => {
    handle.focus()
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true }))
  })
  await vi.waitFor(() => expect(handle.parentElement!.style.opacity).toBe("0.6"))
  expect(dragRef.current?.getSourceId()).toBe(handle.dataset.workbenchTabHandle)
  await render(true)
  expect(dragRef.current?.getSourceId() ?? null).toBeNull()
  await render(false)
  expect(dragRef.current?.getSourceId() ?? null).toBeNull()
  if (change !== "unmount") expect(host.querySelector('input[aria-label="Draft"]')).toBe(draft)
  expect(host.querySelector<HTMLInputElement>('input[aria-label="Draft"]')!.value).toBe("Retained")
  expect(reorder).not.toHaveBeenCalled()
  await act(async () => document.getElementById("right-workbench")!.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true })))
  expect(close).toHaveBeenCalledTimes(1)
})

it.each(["initializing", "dragging", "move-key"])("cancels the drag sensor when command search opens (%s)", async (mode) => {
  let manager: DragDropManager | undefined
  const originalCancellation = cancellationModule.workbenchDragCancellation
  vi.spyOn(cancellationModule, "workbenchDragCancellation").mockImplementation((instance, active) => {
    manager = instance
    return originalCancellation(instance, active)
  })
  const immediate = mode === "initializing"
  const host = document.body.appendChild(document.createElement("div")); const root = createRoot(host); roots.push(root)
  const close = vi.fn(); const reorder = vi.fn()
  vi.stubGlobal("matchMedia", () => ({ matches: true, addEventListener() {}, removeEventListener() {} }))
  vi.stubGlobal("IntersectionObserver", class { observe() {} unobserve() {} disconnect() {} })
  Object.defineProperty(document, "getAnimations", { configurable: true, value: () => [] })
  Object.defineProperty(Element.prototype, "getAnimations", { configurable: true, value: () => [] })
  function Harness() {
    const [palette, setPalette] = useState(false)
    const dragRef = useRef<WorkbenchTabDrag | null>(null)
    const returnTarget = useRef<() => HTMLElement | null>(() => null)
    useEffect(() => {
      const key = (event: KeyboardEvent) => { if (event.ctrlKey && event.key === "k") { event.preventDefault(); returnTarget.current = captureWorkbenchFocusReturn(document.activeElement as HTMLElement, "session", () => "session", dragRef.current?.getSourceId()); setPalette(true) } }
      window.addEventListener("keydown", key)
      return () => window.removeEventListener("keydown", key)
    }, [])
    return <><RightWorkbench tabDragRef={dragRef} interactionSuspended={palette} activeTab="session" openToolTabs={["review", "session"]}
      onTabChange={vi.fn()} onToolClose={vi.fn()} onClose={close} onTabReorder={reorder}
      inspector={null} review={null} browser={null} session={<input aria-label="Draft" defaultValue="Retained" />} />
      <CommandPalette getReturnFocusTarget={returnTarget.current} open={palette} chats={[]} onClose={() => setPalette(false)} onSelect={vi.fn()} onNewChat={vi.fn()} onSettings={vi.fn()} /></>
  }
  await act(async () => root.render(<StrictMode><Harness /></StrictMode>))
  const handle = host.querySelector<HTMLButtonElement>('button[aria-keyshortcuts]')!
  const draft = host.querySelector<HTMLInputElement>('input[aria-label="Draft"]')!
  const command = () => document.activeElement!.dispatchEvent(new KeyboardEvent("keydown", { key: "k", code: "KeyK", ctrlKey: true, bubbles: true, cancelable: true }))
  await act(async () => {
    handle.focus()
    handle.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true }))
    if (immediate) command()
  })
  if (!immediate) {
    await vi.waitFor(() => expect(handle.parentElement!.style.opacity).toBe("0.6"))
    if (mode === "move-key") {
      await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)) })
      await act(async () => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", code: "ArrowRight", bubbles: true, cancelable: true })))
      await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)) })
      expect(document.querySelector("[data-dnd-placeholder]")).not.toBeNull()
      // Real Chromium loses handle focus after moving the drag preview.
      act(() => host.querySelector<HTMLElement>("#right-workbench")!.focus())
    }
    await act(async () => command())
  }
  const search = host.querySelector<HTMLInputElement>('input[placeholder="搜索会话或操作…"]')!
  await vi.waitFor(() => expect(document.activeElement).toBe(search))
  const feedback = manager!.plugins.find((plugin) => plugin instanceof Feedback)!
  expect(feedback.dropAnimation).toBeNull()
  const lateFocus = vi.spyOn(handle, "focus")
  for (const character of "Alpha movable") {
    await act(async () => {
      const focused = document.activeElement as HTMLInputElement
      const key = new KeyboardEvent("keydown", { key: character, code: character === " " ? "Space" : `Key${character.toUpperCase()}`, bubbles: true, cancelable: true })
      focused.dispatchEvent(key)
      expect(key.defaultPrevented).toBe(false)
      Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(focused, focused.value + character)
      focused.dispatchEvent(new Event("input", { bubbles: true }))
    })
  }
  expect(search.value).toBe("Alpha movable")
  await vi.waitFor(() => expect(document.querySelector("[data-dnd-placeholder]")).toBeNull())
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(resolve)) })
  expect(lateFocus).not.toHaveBeenCalled()
  expect(document.activeElement).toBe(search)
  lateFocus.mockRestore()
  expect(host.querySelector('input[aria-label="Draft"]')).toBe(draft)
  expect(draft.value).toBe("Retained")
  expect(reorder).not.toHaveBeenCalled()
  await act(async () => search.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true })))
  await vi.waitFor(() => expect(document.activeElement).toBe(handle))
  // Cancellation must not permanently disable the keyboard sensor.
  await act(async () => handle.dispatchEvent(new KeyboardEvent("keydown", { key: " ", code: "Space", bubbles: true, cancelable: true })))
  await vi.waitFor(() => expect(handle.parentElement!.style.opacity).toBe("0.6"))
  expect(feedback.dropAnimation).toBeUndefined()
  await act(async () => handle.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", code: "Escape", bubbles: true, cancelable: true })))
  expect(close).not.toHaveBeenCalled()
  expect(reorder).not.toHaveBeenCalled()
})
