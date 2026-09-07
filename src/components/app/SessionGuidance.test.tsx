import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SessionGuidance } from "./SessionGuidance"
vi.mock("@services/chat/guidance", () => ({ guidanceService: { imageUrl: (_session: string, id: string) => `/images/${id}` } }))
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.resetAllMocks() })
it("collapses queued text and images without adding another input", async () => {
  const cancel = vi.fn()
  const preview = vi.fn()
  await act(async () => root.render(<SessionGuidance sessionId="s" messages={[{ id: "m", text: "结合这张图", images: ["image-id"], created_at: "now", mode: "after_run" }]} busy={false} onCancel={cancel} onPreview={preview} />))
  expect(container.querySelector("details")!.open).toBe(false)
  expect(container.querySelector("input, textarea")).toBeNull()
  expect(container.querySelector("summary")!.textContent).toBe("待发 1")
  expect(container.querySelector("img")!.getAttribute("src")).toBe("/images/image-id")
  await act(async () => container.querySelector('button[aria-label="查看待发图片 1"]')!.dispatchEvent(new MouseEvent("click", { bubbles: true })))
  expect(preview).toHaveBeenCalledWith("/images/image-id")
  await act(async () => Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "撤回")!.click())
  expect(cancel).toHaveBeenCalledWith("m")
})
it("shows no queue control when there is no pending message", async () => {
  await act(async () => root.render(<SessionGuidance sessionId="s" messages={[]} busy={false} onCancel={vi.fn()} onPreview={vi.fn()} />))
  expect(container.innerHTML).toBe("")
})
