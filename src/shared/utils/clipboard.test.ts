import { afterEach, expect, it, vi } from "vitest"
import { copyText } from "./clipboard"

const originalExecCommand = Object.getOwnPropertyDescriptor(document, "execCommand")

afterEach(() => {
  if (originalExecCommand) Object.defineProperty(document, "execCommand", originalExecCommand)
  else Reflect.deleteProperty(document, "execCommand")
  document.body.replaceChildren()
  document.getSelection()?.removeAllRanges()
  vi.restoreAllMocks()
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

function selectedTranscript(backwards = false) {
  const button = document.body.appendChild(document.createElement("button"))
  const paragraph = document.body.appendChild(document.createElement("p"))
  paragraph.textContent = "原文 English"
  const text = paragraph.firstChild!
  button.focus()
  const selection = document.getSelection()!
  selection.setBaseAndExtent(text, backwards ? text.textContent!.length : 0, text, backwards ? 0 : text.textContent!.length)
  // Chromium clears the document Range when textarea.select() takes over;
  // jsdom does not, so model that observed browser behavior explicitly.
  vi.spyOn(HTMLTextAreaElement.prototype, "select").mockImplementation(() => selection.removeAllRanges())
  return { button, paragraph, text, selection }
}

it.each(["true", "false", "throw"])("preserves a backwards transcript Range when fallback returns %s", async (result) => {
  const { button, text, selection } = selectedTranscript(true)
  fallback(() => { if (result === "throw") throw new Error("denied"); return result === "true" })
  const write = copyText("source")
  if (result === "true") await write
  else await expect(write).rejects.toThrow("Clipboard copy failed")
  expect(selection.toString()).toBe("原文 English")
  expect(selection.anchorNode).toBe(text)
  expect(selection.anchorOffset).toBe(text.textContent!.length)
  expect(selection.focusNode).toBe(text)
  expect(selection.focusOffset).toBe(0)
  expect(document.activeElement).toBe(button)
  expect(document.querySelector("textarea")).toBeNull()
})

it("preserves the forward direction of a transcript Range", async () => {
  const { text, selection } = selectedTranscript()
  fallback(() => true)
  await copyText("source")
  expect(selection.toString()).toBe("原文 English")
  expect(selection.anchorNode).toBe(text)
  expect(selection.anchorOffset).toBe(0)
  expect(selection.focusOffset).toBe(text.textContent!.length)
})

it("does not overwrite a newer transcript selection while fallback still has focus", async () => {
  const { selection } = selectedTranscript(true)
  const newer = document.body.appendChild(document.createElement("p"))
  newer.textContent = "new selection"
  fallback(() => { selection.setBaseAndExtent(newer.firstChild!, 0, newer.firstChild!, newer.textContent!.length); return true })
  await copyText("source")
  expect(selection.toString()).toBe("new selection")
  expect(selection.anchorNode).toBe(newer.firstChild)
  expect(document.querySelector("textarea")).toBeNull()
})

it("does not overwrite newer focus and its selection", async () => {
  const { selection } = selectedTranscript()
  const newer = document.body.appendChild(document.createElement("button"))
  newer.textContent = "new focus"
  fallback(() => {
    newer.focus()
    selection.setBaseAndExtent(newer.firstChild!, 0, newer.firstChild!, newer.textContent!.length)
    return true
  })
  await copyText("source")
  expect(document.activeElement).toBe(newer)
  expect(selection.toString()).toBe("new focus")
  expect(selection.anchorNode).toBe(newer.firstChild)
})

it("does not restore a transcript Range whose original nodes were removed", async () => {
  const { paragraph, text, selection } = selectedTranscript()
  fallback(() => { paragraph.remove(); return true })
  await copyText("source")
  expect(selection.toString()).toBe("")
  expect(selection.anchorNode).not.toBe(text)
  expect(document.querySelector("textarea")).toBeNull()
})

it("does not replace a new selection made while restoring the control's focus", async () => {
  const { button, selection } = selectedTranscript()
  const newer = document.body.appendChild(document.createElement("p"))
  newer.textContent = "new selection"
  vi.spyOn(button, "focus").mockImplementation(() => {
    HTMLElement.prototype.focus.call(button)
    selection.setBaseAndExtent(newer.firstChild!, 0, newer.firstChild!, newer.textContent!.length)
  })
  fallback(() => true)
  await copyText("source")
  expect(selection.toString()).toBe("new selection")
  expect(selection.anchorNode).toBe(newer.firstChild)
})

it("does not replace new focus chosen by the restored control's focus handler", async () => {
  const { button, text, selection } = selectedTranscript()
  const newer = document.body.appendChild(document.createElement("button"))
  button.addEventListener("focus", () => newer.focus())
  fallback(() => true)
  await copyText("source")
  expect(document.activeElement).toBe(newer)
  expect(selection.toString()).toBe("")
  expect(selection.anchorNode).not.toBe(text)
})
