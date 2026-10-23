import { act, StrictMode } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { useCopyFeedback } from "./useCopyFeedback"

const clipboard = vi.hoisted(() => ({ copyText: vi.fn() }))
vi.mock("@shared/utils/clipboard", () => clipboard)

let root: Root | null
let feedback: ReturnType<typeof useCopyFeedback>

function Probe({ text, id }: { text: string; id: string }) {
  feedback = useCopyFeedback(text, id)
  return null
}

function render(text = "原文 **Markdown**\n\nEnglish 末尾  ", id = "message-a") {
  act(() => root!.render(<StrictMode><Probe text={text} id={id} /></StrictMode>))
}

function deferred() {
  let resolve!: () => void
  let reject!: (reason: Error) => void
  const promise = new Promise<void>((done, fail) => { resolve = done; reject = fail })
  return { promise, resolve, reject }
}

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] })
  clipboard.copyText.mockReset().mockResolvedValue(undefined)
  root = createRoot(document.body.appendChild(document.createElement("div")))
})

afterEach(() => {
  if (root) act(() => root!.unmount())
  root = null
  document.body.replaceChildren()
  vi.useRealTimers()
  vi.unstubAllGlobals()
})

it("copies source verbatim and starts the 2500ms receipt only after success", async () => {
  const write = deferred()
  clipboard.copyText.mockReturnValueOnce(write.promise)
  render()
  act(() => { void feedback.copy() })
  expect(clipboard.copyText).toHaveBeenCalledExactlyOnceWith("原文 **Markdown**\n\nEnglish 末尾  ")
  act(() => vi.advanceTimersByTime(10_000))
  expect(feedback.status).toBe("idle")
  await act(async () => write.resolve())
  expect(feedback.status).toBe("copied")
  act(() => vi.advanceTimersByTime(2499))
  expect(feedback.status).toBe("copied")
  act(() => vi.advanceTimersByTime(1))
  expect(feedback.status).toBe("idle")
  expect(vi.getTimerCount()).toBe(0)
})

it("restarts the receipt and small icon animation for each successful repeat", async () => {
  render()
  await act(async () => feedback.copy())
  const first = feedback.sequence
  act(() => vi.advanceTimersByTime(2000))
  await act(async () => feedback.copy())
  expect(feedback.sequence).toBeGreaterThan(first)
  act(() => vi.advanceTimersByTime(500))
  expect(feedback.status).toBe("copied")
  act(() => vi.advanceTimersByTime(1999))
  expect(feedback.status).toBe("copied")
  act(() => vi.advanceTimersByTime(1))
  expect(feedback.status).toBe("idle")
})

it("expires the previous success while a later write is still pending", async () => {
  render()
  await act(async () => feedback.copy())
  act(() => vi.advanceTimersByTime(1000))
  const later = deferred()
  clipboard.copyText.mockReturnValueOnce(later.promise)
  act(() => { void feedback.copy() })
  act(() => vi.advanceTimersByTime(1500))
  expect(feedback.status).toBe("idle")
  await act(async () => later.resolve())
  expect(feedback.status).toBe("copied")
  act(() => vi.advanceTimersByTime(2500))
  expect(feedback.status).toBe("idle")
})

it("ignores an older failed write after the newest write succeeds", async () => {
  const old = deferred()
  clipboard.copyText.mockReturnValueOnce(old.promise)
  render()
  act(() => { void feedback.copy() })
  await act(async () => feedback.copy())
  const sequence = feedback.sequence
  await act(async () => old.reject(new Error("old failure")))
  expect(feedback.status).toBe("copied")
  expect(feedback.sequence).toBe(sequence)
})

it("ignores an older success after the newest failure and allows retry", async () => {
  const old = deferred()
  clipboard.copyText.mockReturnValueOnce(old.promise).mockRejectedValueOnce(new Error("new failure"))
  render()
  act(() => { void feedback.copy() })
  await act(async () => feedback.copy())
  expect(feedback.status).toBe("error")
  await act(async () => old.resolve())
  expect(feedback.status).toBe("error")
  expect(vi.getTimerCount()).toBe(0)
  await act(async () => feedback.copy())
  expect(feedback.status).toBe("copied")
})

it("invalidates a changed source, its pending write, and retained old callbacks", async () => {
  const old = deferred()
  clipboard.copyText.mockReturnValueOnce(old.promise)
  render("old", "a")
  const oldCopy = feedback.copy
  act(() => { void oldCopy() })
  render("new", "b")
  await act(async () => old.resolve())
  expect(feedback.status).toBe("idle")
  await act(async () => oldCopy())
  expect(clipboard.copyText).toHaveBeenCalledTimes(1)
  await act(async () => feedback.copy())
  expect(clipboard.copyText).toHaveBeenLastCalledWith("new")
  expect(feedback.status).toBe("copied")
  render("edited", "b")
  expect(feedback.status).toBe("idle")
  expect(vi.getTimerCount()).toBe(0)
})

it("clears timers on unmount and ignores a write that settles afterwards", async () => {
  render()
  await act(async () => feedback.copy())
  const later = deferred()
  clipboard.copyText.mockReturnValueOnce(later.promise)
  act(() => { void feedback.copy() })
  act(() => { root!.unmount(); root = null })
  expect(vi.getTimerCount()).toBe(0)
  await act(async () => later.resolve())
  expect(vi.getTimerCount()).toBe(0)
})
