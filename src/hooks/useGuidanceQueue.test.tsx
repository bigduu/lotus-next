import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useGuidanceQueue } from "./useGuidanceQueue"
import { guidanceService } from "@services/chat/guidance"
vi.mock("@services/chat/guidance", () => ({ guidanceService: { list: vi.fn(), send: vi.fn(), cancel: vi.fn() } }))
let root: Root
let container: HTMLDivElement
let queue: ReturnType<typeof useGuidanceQueue>
function Harness({ session = "s/1" }: { session?: string }) { queue = useGuidanceQueue(session, true); return null }
beforeEach(() => {
  sessionStorage.clear()
  const randomUUID = crypto.randomUUID.bind(crypto)
  vi.stubGlobal("crypto", { randomUUID, subtle: { digest: async (_algorithm: string, bytes: Uint8Array) => Uint8Array.from(bytes).buffer } })
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.mocked(guidanceService.list).mockResolvedValue({ messages: [] })
  vi.mocked(guidanceService.send).mockImplementation(async (_session, id) => ({ id, activation_pending: false }))
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
})
afterEach(() => { act(() => root.unmount()); container.remove(); vi.resetAllMocks(); vi.unstubAllGlobals() })
const mount = async () => { await act(async () => root.render(<Harness />)) }
it("retries uncertain text and image admission with the same identity after remount", async () => {
  vi.mocked(guidanceService.send).mockRejectedValueOnce(new Error("connection lost"))
  await mount()
  await act(async () => queue.setMode("after_run"))
  const images = [{ base64: "data:image/png;base64,aGVsbG8=", type: "image/png", name: "test.png" }]
  await act(async () => { expect((await queue.send("结合图片", images)).kind).toBe("unconfirmed") })
  const first = vi.mocked(guidanceService.send).mock.calls[0]
  expect(first[3]).toBe("after_run")
  const receipt = sessionStorage.getItem("lotus-next.guidance-submission.s/1")!
  expect(receipt).not.toContain("aGVsbG8")
  await act(async () => root.render(null))
  await mount()
  await act(async () => { expect((await queue.send("结合图片", images)).kind).toBe("accepted") })
  expect(vi.mocked(guidanceService.send).mock.calls[1]).toEqual(first)
  expect(sessionStorage.getItem("lotus-next.guidance-submission.s/1")).toBeNull()
})
it("accepts an image-only message and assigns a new identity after acknowledgement", async () => {
  await mount()
  const images = [{ base64: "data:image/png;base64,aGVsbG8=" }]
  await act(async () => { expect((await queue.send("", images)).kind).toBe("accepted") })
  await act(async () => { expect((await queue.send("", images)).kind).toBe("accepted") })
  const calls = vi.mocked(guidanceService.send).mock.calls
  expect(calls[0][1]).not.toBe(calls[1][1])
  expect(calls[0][2]).toBe("")
  expect(calls[0][4]).toEqual(images)
})
it("retains queued images if withdrawal loses the claim race", async () => {
  vi.mocked(guidanceService.list).mockResolvedValue({ messages: [{ id: "m", text: "", images: ["image"], created_at: "now" }] })
  vi.mocked(guidanceService.cancel).mockRejectedValueOnce(new Error("claimed"))
  await mount()
  await act(async () => queue.cancel("m"))
  expect(queue.pending).toHaveLength(1)
  expect(queue.pending[0].images).toEqual(["image"])
  expect(queue.error).toContain("已经开始应用")
})
