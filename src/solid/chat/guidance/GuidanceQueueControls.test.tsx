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
  let queue!: ReturnType<typeof createGuidanceQueue>
  const dispose = render(() => {
    queue = createGuidanceQueue(() => sessionId, () => true)
    return <GuidanceQueueControls sessionId={sessionId} queue={queue} onPreview={preview} />
  }, host)
  cleanup = () => { dispose(); host.remove() }
  flush()
  await vi.waitFor(() => {
    flush()
    expect(queue.pending).toHaveLength(messages.length)
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

it("shows no control when only interjections are queued", async () => {
  const { host } = await mount([
    { id: "a", text: "interjection", created_at: "now", mode: "after_round" },
    { id: "b", text: "legacy interjection", created_at: "now" },
  ])
  expect(guidanceService.list).toHaveBeenCalledWith(sessionId)
  expect(host.textContent).toBe("")
  expect(host.querySelector("details, button, input")).toBeNull()
})

it("only counts after-run messages and keeps their full text when both timings are queued", async () => {
  const text = "长消息".repeat(1200) + "完整末尾"
  const { host } = await mount([
    { id: "a", text: "interjection", created_at: "now", mode: "after_round" },
    { id: "b", text, created_at: "now", mode: "after_run" },
  ])
  expect(host.querySelector("summary")?.textContent).toBe("队列中 1")
  expect(host.textContent).toContain(text)
  expect(host.textContent).not.toContain("interjection")
  expect(host.textContent).not.toContain("插话")
  expect(host.textContent).toContain("队列中 · 本次运行结束后发送")
  expect(host.textContent).not.toContain("已送达")
  expect(host.querySelector(".\\[overflow-wrap\\:anywhere\\]")).not.toBeNull()
})
