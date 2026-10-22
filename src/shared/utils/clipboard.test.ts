import { afterEach, expect, it, vi } from "vitest"
import { copyText } from "./clipboard"

const originalExecCommand = Object.getOwnPropertyDescriptor(document, "execCommand")

afterEach(() => {
  if (originalExecCommand) Object.defineProperty(document, "execCommand", originalExecCommand)
  else Reflect.deleteProperty(document, "execCommand")
  document.body.replaceChildren()
  vi.unstubAllGlobals()
})

function fallback(callback: () => boolean) {
  vi.stubGlobal("navigator", { clipboard: { writeText: vi.fn().mockRejectedValue(new Error("unavailable")) } })
  Object.defineProperty(document, "execCommand", { configurable: true, value: vi.fn(callback) })
}

it("sends exact original source through the navigator path", async () => {
  const writeText = vi.fn().mockResolvedValue(undefined)
  vi.stubGlobal("navigator", { clipboard: { writeText } })
  const text = "\n **中文 English**\t\n末尾  "
  await copyText(text)
  expect(writeText).toHaveBeenCalledExactlyOnceWith(text)
  expect(document.querySelector("textarea")).toBeNull()
})

it("cleans up a successful fallback and restores the current control's focus", async () => {
  const input = document.body.appendChild(document.createElement("input"))
  input.focus()
  let copied: string | undefined
  fallback(() => { copied = (document.activeElement as HTMLTextAreaElement).value; return true })
  await copyText("source\n原文  ")
  expect(copied).toBe("source\n原文  ")
  expect(document.querySelector("textarea")).toBeNull()
  expect(document.activeElement).toBe(input)
})

it.each(["false", "throw"])("cleans up and restores focus when the fallback reports %s", async (failure) => {
  const button = document.body.appendChild(document.createElement("button"))
  button.focus()
  fallback(() => { if (failure === "throw") throw new Error("denied"); return false })
  await expect(copyText("source")).rejects.toThrow("Clipboard copy failed")
  expect(document.querySelector("textarea")).toBeNull()
  expect(document.activeElement).toBe(button)
})

it("does not reclaim focus after the fallback has moved it to another control", async () => {
  const before = document.body.appendChild(document.createElement("button"))
  const after = document.body.appendChild(document.createElement("button"))
  before.focus()
  fallback(() => { after.focus(); return true })
  await copyText("source")
  expect(document.querySelector("textarea")).toBeNull()
  expect(document.activeElement).toBe(after)
})

it("restores the newer focus when navigator fails after the user moved on", async () => {
  const before = document.body.appendChild(document.createElement("button"))
  const after = document.body.appendChild(document.createElement("button"))
  let reject!: (error: Error) => void
  vi.stubGlobal("navigator", { clipboard: { writeText: () => new Promise<void>((_done, fail) => { reject = fail }) } })
  Object.defineProperty(document, "execCommand", { configurable: true, value: () => true })
  before.focus()
  const pending = copyText("source")
  after.focus()
  reject(new Error("late navigator denial"))
  await pending
  expect(document.activeElement).toBe(after)
  expect(document.querySelector("textarea")).toBeNull()
})

it("does not restore a detached original control", async () => {
  const before = document.body.appendChild(document.createElement("button"))
  before.focus()
  fallback(() => { before.remove(); return true })
  await copyText("source")
  expect(document.querySelector("textarea")).toBeNull()
  expect(document.activeElement).toBe(document.body)
})
