import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterAll, afterEach, beforeAll, expect, it, vi } from "vitest"
import {
  EnvironmentCard,
  EnvironmentLauncher,
  RightPanelLauncher,
} from "./RightPanelLauncher"

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

it("opens the side pane directly", async () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  roots.push(root)
  const toggle = vi.fn()

  await act(async () => {
    root.render(<RightPanelLauncher open={false} onToggle={toggle} />)
  })
  const launcher = host.querySelector<HTMLButtonElement>("button")

  expect(launcher?.getAttribute("aria-label")).toBe("打开侧边面板")
  expect(launcher?.getAttribute("aria-expanded")).toBe("false")
  expect(launcher?.getAttribute("aria-controls")).toBe("right-workbench")
  await act(async () => launcher?.click())
  expect(toggle).toHaveBeenCalledTimes(1)
})

it("exposes Environment independently from the side pane", async () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  roots.push(root)
  const toggle = vi.fn()

  await act(async () => {
    root.render(
      <EnvironmentLauncher
        open
        controlsId="environment-card"
        onToggle={toggle}
      />,
    )
  })
  const launcher = host.querySelector<HTMLButtonElement>("button")

  expect(launcher?.getAttribute("aria-label")).toBe("收起 Environment")
  expect(launcher?.getAttribute("aria-expanded")).toBe("true")
  expect(launcher?.getAttribute("aria-controls")).toBe("environment-card")
  await act(async () => launcher?.click())
  expect(toggle).toHaveBeenCalledTimes(1)
})

it("renders truthful Environment details without a popup portal", async () => {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  roots.push(root)
  const openReview = vi.fn()
  const previewImage = vi.fn()
  const previewUrl = "data:image/png;base64,cHJldmlldw=="

  await act(async () => {
    root.render(
      <div data-layout-slot>
        <EnvironmentCard
          id="environment-card"
          workspace="/workspace/zenith"
          projectName="Zenith"
          placement={{ kind: "local", host: "Mac" }}
          changedFiles={2}
          addedLines={3}
          removedLines={1}
          sources={[
            {
              id: "image:1",
              name: "reference.png",
              kind: "image",
              previewUrl,
            },
          ]}
          onOpenReview={openReview}
          onPreviewImage={previewImage}
        />
      </div>,
    )
  })

  const card = host.querySelector<HTMLElement>("[data-environment-card]")
  expect(card?.parentElement?.hasAttribute("data-layout-slot")).toBe(true)
  expect(card?.textContent).toContain("Environment")
  expect(card?.textContent).toContain("Changes")
  expect(card?.textContent).toContain("Local")
  expect(card?.textContent).toContain("zenith")
  expect(card?.textContent).toContain("Zenith")
  expect(card?.textContent).toContain("reference.png")
  expect(card?.textContent).not.toContain("Create pull request")

  const changes = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.includes("Changes"),
  )
  await act(async () => changes?.click())
  expect(openReview).toHaveBeenCalledTimes(1)

  const sourcePreview = host.querySelector<HTMLButtonElement>(
    'button[aria-label="预览 reference.png"]',
  )
  expect(sourcePreview?.querySelector("img")?.getAttribute("src")).toBe(previewUrl)
  await act(async () => sourcePreview?.click())
  expect(previewImage).toHaveBeenCalledExactlyOnceWith(previewUrl)
  expect(document.querySelector("[data-radix-popper-content-wrapper]")).toBeNull()
})
