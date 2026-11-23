import { render, type JSX } from "@solidjs/web"
import { flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { EnvironmentCard, EnvironmentLauncher } from "./Environment"
import { createEnvironment, type EnvironmentController } from "./createEnvironment"

vi.mock("@lucide/solid", () => ({ ChevronRight: () => null, File: () => null, FileDiff: () => null, FolderGit2: () => null,
  FolderKanban: () => null, Image: () => null, ListFilter: () => null, Monitor: () => null }))

const cleanups: Array<() => void> = []
afterEach(() => { for (const cleanup of cleanups.splice(0)) cleanup() })
function mount(content: (environment: EnvironmentController) => JSX.Element) {
  const host = document.body.appendChild(document.createElement("div"))
  let environment!: EnvironmentController
  const dispose = render(() => {
    environment = createEnvironment({ sessionId: () => "session", pageVisible: () => true, sidePaneOpen: () => false })
    return content(environment)
  }, host)
  environment.toggle()
  flush()
  cleanups.push(() => { dispose(); host.remove() })
  return host
}

it("exposes Environment independently from the side pane", () => {
  const host = mount((environment) => <EnvironmentLauncher environment={environment} />)
  const launcher = host.querySelector<HTMLButtonElement>("button")!

  expect(launcher.getAttribute("aria-label")).toBe("收起 Environment")
  expect(launcher.getAttribute("aria-expanded")).toBe("true")
  expect(launcher.getAttribute("aria-controls")).toBeTruthy()
  launcher.click()
  flush()
  expect(launcher.getAttribute("aria-expanded")).toBe("false")
  expect(launcher.getAttribute("aria-label")).toBe("打开 Environment")
})

it("renders truthful Environment details without a popup portal", () => {
  const openReview = vi.fn()
  const previewImage = vi.fn()
  const previewUrl = "data:image/png;base64,cHJldmlldw=="

  const host = mount((environment) => (
      <div data-layout-slot>
        <EnvironmentCard
          environment={environment}
          workspace="/workspace/zenith"
          projectName="Zenith"
          placement={{ kind: "local", host: "Mac" }}
          changes={{ fileCount: 2, editCount: 2, addedLines: 3, removedLines: 1 }}
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
      </div>
  ))

  const card = host.querySelector<HTMLElement>("[data-environment-card]")
  expect(card?.closest("[data-layout-slot]")).toBe(host.firstElementChild)
  expect(card?.textContent).toContain("Environment")
  const text = card?.textContent ?? ""
  expect(text.indexOf("Project")).toBeLessThan(text.indexOf("Sources"))
  expect(card?.textContent).toContain("Changes")
  expect(card?.textContent).toContain("Local")
  expect(card?.textContent).toContain("zenith")
  expect(card?.textContent).toContain("Zenith")
  expect(card?.textContent).toContain("reference.png")
  expect(card?.textContent).not.toContain("Create pull request")

  const changes = Array.from(host.querySelectorAll<HTMLButtonElement>("button")).find(
    (button) => button.textContent?.includes("Changes"),
  )
  changes?.click()
  expect(openReview).toHaveBeenCalledTimes(1)

  const sourcePreview = host.querySelector<HTMLButtonElement>(
    'button[aria-label="预览 reference.png"]',
  )
  expect(sourcePreview?.querySelector("img")?.getAttribute("src")).toBe(previewUrl)
  sourcePreview?.click()
  expect(previewImage).toHaveBeenCalledExactlyOnceWith(previewUrl)
  expect(document.querySelectorAll("[data-environment-card]")).toHaveLength(1)
})

it("keeps workspace paths separate from an unreported execution location", () => {
  const host = mount((environment) => <EnvironmentCard environment={environment} workspace="/Users/example/project"
    changes={{ fileCount: 0, editCount: 0, addedLines: 0, removedLines: 0 }} sources={[]}
    onOpenReview={vi.fn()} onPreviewImage={vi.fn()} />)
  expect(host.textContent).toContain("/Users/example/project")
  expect(host.textContent).toContain("运行位置未确认")
  expect(host.textContent).not.toContain("Local")
})
