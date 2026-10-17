import { act, useEffect, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest"
import { RightWorkbench } from "./RightWorkbench"

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
  expect(dialog.getAttribute("aria-labelledby")).toBeTruthy()
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
