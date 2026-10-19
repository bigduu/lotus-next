import { ApiError } from "@services/api/errors"
import { clearSessionCompatibilityObservations, observeSessionExecutionConflict } from "@services/chat/sessionExecutionCompatibility"
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useGuidanceQueue } from "./useGuidanceQueue"
import { guidanceService } from "@services/chat/guidance"
import { beginRootModeOperation } from "@/lib/rootModeTransitionFence"
const beginRootModeTransition = (id: string, enabled: boolean) => beginRootModeOperation(id, 0, "a".repeat(64), enabled)
vi.mock("@services/chat/guidance", () => ({ guidanceService: { list: vi.fn(), send: vi.fn(), cancel: vi.fn() } }))
let root: Root
let container: HTMLDivElement
let queue: ReturnType<typeof useGuidanceQueue>
function Harness({ session = "s/1" }: { session?: string }) { queue = useGuidanceQueue(session, true); return null }
beforeEach(() => {
  clearSessionCompatibilityObservations()
  localStorage.clear()
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
it("blocks a queued message after another composer fences the same Session", async () => {
  await mount()
  expect(beginRootModeTransition("s/1", false)).not.toBeNull()
  await act(async () => { expect(await queue.send("queued without mode field")).toEqual({ kind: "blocked" }) })
  expect(guidanceService.send).not.toHaveBeenCalled()
})
it("rechecks the fence after hashing before sending queued guidance", async () => {
  let completeDigest!: (value: ArrayBuffer) => void
  const digest = new Promise<ArrayBuffer>((resolve) => { completeDigest = resolve })
  vi.spyOn(crypto.subtle, "digest").mockReturnValueOnce(digest)
  await mount()
  let submission!: ReturnType<typeof queue.send>
  act(() => { submission = queue.send("queued while another tab switches mode") })
  expect(guidanceService.send).not.toHaveBeenCalled()
  expect(beginRootModeTransition("s/1", false)).not.toBeNull()
  completeDigest(new Uint8Array([1]).buffer)
  await act(async () => { expect(await submission).toEqual({ kind: "blocked" }) })
  expect(guidanceService.send).not.toHaveBeenCalled()
  expect(sessionStorage.getItem("lotus-next.guidance-submission.s/1")).toBeNull()
})
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

it("clears a previous withdrawal failure when the next withdrawal succeeds", async () => {
  vi.mocked(guidanceService.list).mockResolvedValue({ messages: [{ id: "m", text: "", images: ["image"], created_at: "now" }] })
  vi.mocked(guidanceService.cancel).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined)
  await mount()
  await act(async () => queue.cancel("m"))
  expect(queue.error).toContain("已经开始应用")
  await act(async () => queue.cancel("m"))
  expect(queue.pending).toHaveLength(0)
  expect(queue.error).toBeNull()
})

const versionRefusal = () => new ApiError("incompatible", 409, "", JSON.stringify({ session_id: "s/1",
  error: { code: "session_execution_incompatible" }, compatibility: { session_version: null, current_session_version: 1,
    status: "conflict", history_readable: true, execution_allowed: false,
    conflicts: [{ code: "unsupported_runtime_state_version", message: "Unsupported runtime" }] } }))
it("blocks guidance only for an explicit compatibility conflict", async () => {
  await mount(); observeSessionExecutionConflict("s/1", versionRefusal())
  await act(async () => { expect((await queue.send("keep draft")).kind).toBe("blocked") })
  expect(guidanceService.send).not.toHaveBeenCalled()
})
it("records a typed guidance refusal without resending or marking the new request uncertain", async () => {
  await mount(); vi.mocked(guidanceService.send).mockRejectedValueOnce(versionRefusal())
  await act(async () => { expect((await queue.send("keep draft")).kind).toBe("blocked") })
  await act(async () => { expect((await queue.send("keep draft")).kind).toBe("blocked") })
  expect(guidanceService.send).toHaveBeenCalledTimes(1)
  expect(queue.hasUnconfirmed).toBe(false)
})

it("preserves an earlier uncertain guidance receipt after a later compatibility refusal", async () => {
  await mount(); vi.mocked(guidanceService.send).mockRejectedValueOnce(new Error("lost acknowledgement"))
  await act(async () => { expect((await queue.send("same uncertain draft")).kind).toBe("unconfirmed") })
  const previous = sessionStorage.getItem("lotus-next.guidance-submission.s/1")
  vi.mocked(guidanceService.send).mockRejectedValueOnce(versionRefusal())
  await act(async () => { expect((await queue.send("same uncertain draft")).kind).toBe("blocked") })
  expect(sessionStorage.getItem("lotus-next.guidance-submission.s/1")).toBe(previous)
  expect(queue.hasUnconfirmed).toBe(true)
  expect(guidanceService.send).toHaveBeenCalledTimes(2)
})


it.each([false, true])("restores a prior uncertain receipt when changed guidance is definitively incompatible (image=%s)", async (image) => {
  await mount()
  vi.mocked(guidanceService.send).mockRejectedValueOnce(new Error("lost acknowledgement"))
  await act(async () => { expect((await queue.send("original uncertain draft")).kind).toBe("unconfirmed") })
  const first = vi.mocked(guidanceService.send).mock.calls[0]
  const previous = sessionStorage.getItem("lotus-next.guidance-submission.s/1")
  vi.mocked(guidanceService.send).mockRejectedValueOnce(versionRefusal())
  await act(async () => { expect((await queue.send(image ? "original uncertain draft" : "changed draft", image ? [{ base64: "new-image" }] : [])).kind).toBe("blocked") })
  expect(vi.mocked(guidanceService.send).mock.calls[1][1]).not.toBe(first[1])
  expect(sessionStorage.getItem("lotus-next.guidance-submission.s/1")).toBe(previous)
  expect(queue.hasUnconfirmed).toBe(true)
  expect(guidanceService.send).toHaveBeenCalledTimes(2)
  clearSessionCompatibilityObservations()
  if (image) { await act(async () => root.render(null)); await mount() }
  await act(async () => { expect((await queue.send("original uncertain draft")).kind).toBe("accepted") })
  expect(vi.mocked(guidanceService.send).mock.calls[2]).toEqual(first)
  expect(sessionStorage.getItem("lotus-next.guidance-submission.s/1")).toBeNull()
})
