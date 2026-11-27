import { ApiError } from "@services/api/errors"
import { clearSessionCompatibilityObservations, observeSessionExecutionConflict } from "@services/chat/sessionExecutionCompatibility"
import { createRoot, createSignal, flush, type Accessor } from "solid-js"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { Message } from "@shared/types/chatMessages"
import { createGuidanceQueue } from "./createGuidanceQueue"
import { guidanceService } from "@services/chat/guidance"
import { beginRootModeOperation } from "@/lib/rootModeTransitionState"
import { clearSessionOrder, sessionOrderSnapshot } from "@/lib/sidebarSessionOrderState"
const beginRootModeTransition = (id: string, enabled: boolean) => beginRootModeOperation(id, 0, "a".repeat(64), enabled)
vi.mock("@services/chat/guidance", () => ({ guidanceService: {
  list: vi.fn(), send: vi.fn(), cancel: vi.fn(),
  imageUrl: (sessionId: string, id: string) => `${sessionId}/image/${id}`,
} }))
let dispose: (() => void) | undefined
let queue: ReturnType<typeof createGuidanceQueue>
async function settle(action?: () => unknown) {
  await action?.()
  flush()
}
function unmount() {
  dispose?.()
  dispose = undefined
}
beforeEach(() => {
  clearSessionCompatibilityObservations()
  localStorage.clear()
  clearSessionOrder()
  sessionStorage.clear()
  const randomUUID = crypto.randomUUID.bind(crypto)
  vi.stubGlobal("crypto", { randomUUID, subtle: { digest: async (_algorithm: string, bytes: Uint8Array) => Uint8Array.from(bytes).buffer } })
  vi.mocked(guidanceService.list).mockResolvedValue({ messages: [] })
  vi.mocked(guidanceService.send).mockImplementation(async (_session, id) => ({ id, activation_pending: false }))
})
afterEach(() => {
  unmount()
  vi.resetAllMocks()
  vi.unstubAllGlobals()
})
const mount = async (sessionId = () => "s/1", history?: Accessor<readonly Message[]>) => {
  unmount()
  createRoot((cleanup) => {
    dispose = cleanup
    queue = createGuidanceQueue(sessionId, () => true, history)
  })
  flush()
  await settle()
}
it("blocks a queued message after another composer fences the same Session", async () => {
  await mount()
  expect(beginRootModeTransition("s/1", false)).not.toBeNull()
  await settle(async () => { expect(await queue.send("queued without mode field")).toEqual({ kind: "blocked" }) })
  expect(guidanceService.send).not.toHaveBeenCalled()
})
it("rechecks the fence after hashing before sending queued guidance", async () => {
  let completeDigest!: (value: ArrayBuffer) => void
  const digest = new Promise<ArrayBuffer>((resolve) => { completeDigest = resolve })
  vi.spyOn(crypto.subtle, "digest").mockReturnValueOnce(digest)
  await mount()
  let submission!: ReturnType<typeof queue.send>
  submission = queue.send("queued while another tab switches mode")
  expect(guidanceService.send).not.toHaveBeenCalled()
  expect(beginRootModeTransition("s/1", false)).not.toBeNull()
  completeDigest(new Uint8Array([1]).buffer)
  await settle(async () => { expect(await submission).toEqual({ kind: "blocked" }) })
  expect(guidanceService.send).not.toHaveBeenCalled()
  expect(sessionStorage.getItem("lotus-next.guidance-submission.s/1")).toBeNull()
})
it("retries uncertain text and image admission with the same identity after remount", async () => {
  vi.mocked(guidanceService.send).mockRejectedValueOnce(new Error("connection lost"))
  await mount()
  await settle(async () => queue.setMode("after_run"))
  const images = [{ base64: "data:image/png;base64,aGVsbG8=", type: "image/png", name: "test.png" }]
  await settle(async () => { expect((await queue.send("结合图片", images)).kind).toBe("unconfirmed") })
  expect(sessionOrderSnapshot().activity["s/1"]).toBeUndefined()
  const first = vi.mocked(guidanceService.send).mock.calls[0]
  expect(first[3]).toBe("after_run")
  const receipt = sessionStorage.getItem("lotus-next.guidance-submission.s/1")!
  expect(receipt).not.toContain("aGVsbG8")
  unmount()
  await mount()
  await settle(async () => { expect((await queue.send("结合图片", images)).kind).toBe("accepted") })
  expect(sessionOrderSnapshot().activity["s/1"]).toBeGreaterThan(0)
  expect(vi.mocked(guidanceService.send).mock.calls[1]).toEqual(first)
  expect(sessionStorage.getItem("lotus-next.guidance-submission.s/1")).toBeNull()
})
it("accepts an image-only message and assigns a new identity after acknowledgement", async () => {
  await mount()
  const images = [{ base64: "data:image/png;base64,aGVsbG8=" }]
  vi.mocked(guidanceService.send).mockImplementationOnce(async (_session, id) => {
    vi.mocked(guidanceService.list).mockResolvedValueOnce({
      messages: [{ id, text: "", created_at: "", images: ["stored-image"] }],
    })
    return { id, activation_pending: false }
  })
  await settle(async () => { expect((await queue.send("", images)).kind).toBe("accepted") })
  const initialId = vi.mocked(guidanceService.send).mock.calls[0][1]
  expect(queue.pending.map((item) => item.id)).toEqual([initialId])
  expect(queue.transcript.map((item) => item.message.id)).toEqual([initialId])

  await settle(async () => { expect((await queue.send("", images)).kind).toBe("accepted") })
  const calls = vi.mocked(guidanceService.send).mock.calls
  expect(calls[0][1]).not.toBe(calls[1][1])
  expect(calls[0][2]).toBe("")
  expect(calls[0][4]).toEqual(images)
})

it("shows the acknowledged guidance before polling and waits for its exact history ID", async () => {
  const [history, setHistory] = createSignal<Message[]>([])
  await mount(undefined, history)
  await settle(() => queue.setMode("after_run"))
  let releaseList!: () => void
  vi.mocked(guidanceService.list).mockReturnValueOnce(new Promise((resolve) => {
    releaseList = () => resolve({ messages: [] })
  }))
  const image = { base64: "aGVsbG8=", type: "image/png", name: "test.png" }
  const submission = queue.send("repeat this", [image])
  const settled = vi.fn()
  void submission.then(settled)
  try {
    await vi.waitFor(() => {
      flush()
      expect(settled).toHaveBeenCalledWith(expect.objectContaining({ kind: "accepted" }))
      expect(guidanceService.list).toHaveBeenCalledTimes(2)
      expect(queue.busy).toBe(false)
      expect(queue.transcript).toHaveLength(1)
    })
  } finally {
    releaseList()
    await settle(() => submission)
  }
  const id = vi.mocked(guidanceService.send).mock.calls[0][1]
  expect(queue.transcript[0]).toMatchObject({
    mode: "after_run", message: { id, role: "user", content: "repeat this", images: [image] },
  })
  expect(queue.pending).toEqual([])
  expect(queue.transcript[0].message.id).toBe(id)
  await settle(() => setHistory([{ id: "older", role: "user", content: "repeat this", createdAt: "" }]))
  expect(queue.transcript[0].message.id).toBe(id)
  await settle(() => setHistory([{ id, role: "user", content: "repeat this", createdAt: "" }]))
  expect(queue.transcript).toEqual([])
})

it("keeps a late acknowledgement in its originating session and removes it on successful withdrawal", async () => {
  const [sessionId, setSessionId] = createSignal("s/1")
  await mount(sessionId)
  let acknowledge!: () => void
  vi.mocked(guidanceService.send).mockImplementationOnce((_session, id) => new Promise((resolve) => {
    acknowledge = () => resolve({ id, activation_pending: false })
  }))
  const submission = queue.send("queued")
  await vi.waitFor(() => {
    expect(guidanceService.send).toHaveBeenCalledOnce()
  })
  const id = vi.mocked(guidanceService.send).mock.calls[0][1]
  await settle(() => setSessionId("s/2"))
  acknowledge()
  await settle(() => submission)
  expect(queue.transcript).toEqual([])
  vi.mocked(guidanceService.list).mockResolvedValueOnce({
    messages: [{ id, text: "queued", created_at: "", mode: "after_round" }],
  })
  await settle(() => setSessionId("s/1"))
  expect(queue.transcript.map((item) => item.message.id)).toEqual([id])
  await vi.waitFor(() => {
    flush()
    expect(queue.pending.map((item) => item.id)).toEqual([id])
  })

  vi.mocked(guidanceService.cancel).mockResolvedValueOnce(undefined)
  await settle(() => queue.cancel(id))
  expect(guidanceService.cancel).toHaveBeenCalledExactlyOnceWith("s/1", id)
  expect(queue.transcript).toEqual([])
})

it("retains queued images if withdrawal loses the claim race", async () => {
  vi.mocked(guidanceService.list).mockResolvedValue({ messages: [{ id: "m", text: "", images: ["image"], created_at: "now" }] })
  vi.mocked(guidanceService.cancel).mockRejectedValueOnce(new Error("claimed"))
  await mount()
  await settle(async () => queue.cancel("m"))
  expect(queue.pending).toHaveLength(1)
  expect(queue.pending[0].images).toEqual(["image"])
  expect(queue.error).toContain("已经开始应用")
})

it("clears a previous withdrawal failure when the next withdrawal succeeds", async () => {
  vi.mocked(guidanceService.list).mockResolvedValue({ messages: [{ id: "m", text: "", images: ["image"], created_at: "now" }] })
  vi.mocked(guidanceService.cancel).mockRejectedValueOnce(new Error("offline")).mockResolvedValueOnce(undefined)
  await mount()
  await settle(async () => queue.cancel("m"))
  expect(queue.error).toContain("已经开始应用")
  await settle(async () => queue.cancel("m"))
  expect(queue.pending).toHaveLength(0)
  expect(queue.error).toBeNull()
})

const versionRefusal = () => new ApiError("incompatible", 409, "", JSON.stringify({ session_id: "s/1",
  error: { code: "session_execution_incompatible" }, compatibility: { session_version: null, current_session_version: 1,
    status: "conflict", history_readable: true, execution_allowed: false,
    conflicts: [{ code: "unsupported_runtime_state_version", message: "Unsupported runtime" }] } }))
it("blocks guidance only for an explicit compatibility conflict", async () => {
  await mount(); observeSessionExecutionConflict("s/1", versionRefusal())
  await settle(async () => { expect((await queue.send("keep draft")).kind).toBe("blocked") })
  expect(guidanceService.send).not.toHaveBeenCalled()
})
it("records a typed guidance refusal without resending or marking the new request uncertain", async () => {
  await mount(); vi.mocked(guidanceService.send).mockRejectedValueOnce(versionRefusal())
  await settle(async () => { expect((await queue.send("keep draft")).kind).toBe("blocked") })
  await settle(async () => { expect((await queue.send("keep draft")).kind).toBe("blocked") })
  expect(guidanceService.send).toHaveBeenCalledTimes(1)
  expect(queue.hasUnconfirmed).toBe(false)
})

it("preserves an earlier uncertain guidance receipt after a later compatibility refusal", async () => {
  await mount(); vi.mocked(guidanceService.send).mockRejectedValueOnce(new Error("lost acknowledgement"))
  await settle(async () => { expect((await queue.send("same uncertain draft")).kind).toBe("unconfirmed") })
  const previous = sessionStorage.getItem("lotus-next.guidance-submission.s/1")
  vi.mocked(guidanceService.send).mockRejectedValueOnce(versionRefusal())
  await settle(async () => { expect((await queue.send("same uncertain draft")).kind).toBe("blocked") })
  expect(sessionStorage.getItem("lotus-next.guidance-submission.s/1")).toBe(previous)
  expect(queue.hasUnconfirmed).toBe(true)
  expect(guidanceService.send).toHaveBeenCalledTimes(2)
})


it.each([false, true])("restores a prior uncertain receipt when changed guidance is definitively incompatible (image=%s)", async (image) => {
  await mount()
  vi.mocked(guidanceService.send).mockRejectedValueOnce(new Error("lost acknowledgement"))
  await settle(async () => { expect((await queue.send("original uncertain draft")).kind).toBe("unconfirmed") })
  const first = vi.mocked(guidanceService.send).mock.calls[0]
  const previous = sessionStorage.getItem("lotus-next.guidance-submission.s/1")
  vi.mocked(guidanceService.send).mockRejectedValueOnce(versionRefusal())
  await settle(async () => { expect((await queue.send(image ? "original uncertain draft" : "changed draft", image ? [{ base64: "new-image" }] : [])).kind).toBe("blocked") })
  expect(vi.mocked(guidanceService.send).mock.calls[1][1]).not.toBe(first[1])
  expect(sessionStorage.getItem("lotus-next.guidance-submission.s/1")).toBe(previous)
  expect(queue.hasUnconfirmed).toBe(true)
  expect(guidanceService.send).toHaveBeenCalledTimes(2)
  clearSessionCompatibilityObservations()
  if (image) { unmount(); await mount() }
  await settle(async () => { expect((await queue.send("original uncertain draft")).kind).toBe("accepted") })
  expect(vi.mocked(guidanceService.send).mock.calls[2]).toEqual(first)
  expect(sessionStorage.getItem("lotus-next.guidance-submission.s/1")).toBeNull()
})
