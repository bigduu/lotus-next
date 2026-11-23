import { render } from "@solidjs/web"
import { flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { guidanceService, type PendingGuidance } from "@services/chat/guidance"
import { createGuidanceQueue } from "./createGuidanceQueue"
import { GuidanceQueueControls } from "./GuidanceQueueControls"

vi.mock("@services/chat/guidance", () => ({
  guidanceService: { list: vi.fn(), cancel: vi.fn(), imageUrl: (_sessionId: string, id: string) => `/images/${id}` },
}))
const sessionId = "s"
let cleanup: (() => void) | undefined

afterEach(() => {
  cleanup?.()
  vi.resetAllMocks()
})

async function mount(messages: PendingGuidance[]) {
  vi.mocked(guidanceService.list).mockResolvedValue({ messages })
  vi.mocked(guidanceService.cancel).mockResolvedValue(undefined)
  const host = document.body.appendChild(document.createElement("div"))
  const preview = vi.fn()
  const dispose = render(() => {
    const queue = createGuidanceQueue(() => sessionId, () => true)
    return <GuidanceQueueControls sessionId={sessionId} queue={queue} onPreview={preview} />
  }, host)
  cleanup = () => { dispose(); host.remove() }
  flush()
  await vi.waitFor(() => {
    flush()
    expect(host.querySelector("details") !== null).toBe(messages.length > 0)
  })
  return { host, preview }
}

it("collapses queued text and images without adding another input", async () => {
  const { host, preview } = await mount([
    { id: "m", text: "结合这张图", images: ["image-id"], created_at: "now", mode: "after_run" },
  ])
  expect(host.querySelector("details")?.open).toBe(false)
  expect(host.querySelector("input, textarea")).toBeNull()
  expect(host.querySelector("summary")?.textContent).toBe("队列中 1")
  expect(host.querySelector("img")?.getAttribute("src")).toBe("/images/image-id")
  host.querySelector<HTMLButtonElement>('button[aria-label="查看待发图片 1"]')!.click()
  expect(preview).toHaveBeenCalledWith("/images/image-id")
  const withdraw = [...host.querySelectorAll("button")].find((button) => button.textContent === "撤回")!
  withdraw.click()
  expect(guidanceService.cancel).toHaveBeenCalledWith(sessionId, "m")
})

it("shows no control when there is no queued message", async () => {
  const { host } = await mount([])
  expect(guidanceService.list).toHaveBeenCalledWith(sessionId)
  expect(host.textContent).toBe("")
  expect(host.querySelector("details, button, input")).toBeNull()
})

it("keeps full queued text and distinguishes interjection from after-run delivery", async () => {
  const text = "长消息".repeat(1200) + "完整末尾"
  const { host } = await mount([
    { id: "a", text, created_at: "now", mode: "after_round" },
    { id: "b", text: "later", created_at: "now", mode: "after_run" },
  ])
  expect(host.textContent).toContain(text)
  expect(host.textContent).toContain("插话 · 队列中，下一次模型回复前发送")
  expect(host.textContent).toContain("队列中 · 本次运行结束后发送")
  expect(host.textContent).not.toContain("已送达")
  expect(host.querySelector(".\\[overflow-wrap\\:anywhere\\]")).not.toBeNull()
})
