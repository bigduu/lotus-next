import { act } from "react"
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

  expect(host.querySelector('[role="tab"][data-state="active"]')?.textContent).toContain("检查器")
  expect(Array.from(host.querySelectorAll('[role="tab"]')).some((tab) => tab.textContent?.includes("浏览器"))).toBe(false)
  expect(host.textContent).not.toContain("browser content")
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
