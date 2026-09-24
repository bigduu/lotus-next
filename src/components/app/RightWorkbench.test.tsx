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

  act(() => {
    root.render(
      <RightWorkbench
        docked
        activeTab="inspector"
        onTabChange={onTabChange}
        onClose={onClose}
        inspector={<div>inspector content</div>}
        review={<div>review content</div>}
        browser={<div>browser content</div>}
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

  const browserTab = Array.from(host.querySelectorAll<HTMLButtonElement>('[role="tab"]')).find(
    (button) => button.textContent?.includes("浏览器"),
  )
  expect(browserTab).toBeDefined()
  act(() =>
    browserTab?.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, button: 0 })),
  )
  expect(onTabChange).toHaveBeenCalledWith("browser")
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
        onTabChange={vi.fn()}
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
