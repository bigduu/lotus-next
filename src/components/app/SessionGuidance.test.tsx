import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SessionGuidance } from "./SessionGuidance"
import { guidanceService } from "@services/chat/guidance"
vi.mock("@services/chat/guidance", () => ({ guidanceService: { list: vi.fn(), send: vi.fn(), cancel: vi.fn() } }))
let root: Root
let container: HTMLDivElement
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.mocked(guidanceService.list).mockResolvedValue({ messages: [] })
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.resetAllMocks() })
const mount = async () => { await act(async () => root.render(<SessionGuidance sessionId="s/1" running />)) }
const type = async (text: string) => {
  const input = container.querySelector("textarea")!
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, text)
    input.dispatchEvent(new Event("input", { bubbles: true }))
  })
}
const send = async () => { await act(async () => (Array.from(container.querySelectorAll("button")).find((button) => button.textContent === "发送指导")!).click()) }
it("retains an uncertain submission and retries with the same message identity", async () => {
  vi.mocked(guidanceService.send).mockRejectedValueOnce(new Error("connection lost"))
    .mockResolvedValueOnce({ id: "accepted", activation_pending: false })
  await mount(); await type("保留文件"); await send()
  expect(container.querySelector("textarea")!.value).toBe("保留文件")
  expect(container.querySelector('[role="alert"]')).not.toBeNull()
  await send()
  const calls = vi.mocked(guidanceService.send).mock.calls
  expect(calls[0]).toEqual(calls[1])
  expect(calls[0][0]).toBe("s/1")
  expect(container.querySelector("textarea")!.value).toBe("")
})
it("keeps a pending item visible if withdrawal loses the claim race", async () => {
  vi.mocked(guidanceService.list).mockResolvedValue({ messages: [{ id: "m1", text: "等待确认", created_at: "now" }] })
  vi.mocked(guidanceService.cancel).mockRejectedValue(new Error("already claimed"))
  await mount()
  await act(async () => container.querySelector("button")!.click())
  expect(container.textContent).toContain("待应用：等待确认")
  expect(container.querySelector('[role="alert"]')!.textContent).toContain("已经开始应用")
})
