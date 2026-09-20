import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest"
import { RightPanelLauncher, RightPanelMenu } from "./RightPanelLauncher"

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

it("exposes the collapsed workbench menu without creating an overlay", async () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  roots.push(root)
  const toggle = vi.fn()

  await act(async () => {
    root.render(
      <RightPanelLauncher
        open
        controlsId="workbench-menu"
        onToggle={toggle}
      />,
    )
  })
  const launcher = host.querySelector<HTMLButtonElement>("button")

  expect(launcher?.getAttribute("aria-expanded")).toBe("true")
  expect(launcher?.getAttribute("aria-controls")).toBe("workbench-menu")
  await act(async () => launcher?.click())
  expect(toggle).toHaveBeenCalledTimes(1)
  expect(document.querySelector("[data-radix-popper-content-wrapper]")).toBeNull()
})

it("renders menu actions as normal in-flow content", async () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  roots.push(root)
  const openReview = vi.fn()

  await act(async () => {
    root.render(
      <div data-layout-slot>
        <RightPanelMenu
          id="workbench-menu"
          onOpenInspector={vi.fn()}
          onOpenReview={openReview}
          onOpenSession={vi.fn()}
        />
      </div>,
    )
  })

  const menu = host.querySelector<HTMLElement>("[data-workbench-launcher-menu]")
  expect(menu?.parentElement?.hasAttribute("data-layout-slot")).toBe(true)
  const review = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.includes("查看当前会话产生的文件变更"),
  )
  await act(async () => review?.click())

  expect(openReview).toHaveBeenCalledTimes(1)
})
