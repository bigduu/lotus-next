import { act, createRef, type ComponentProps } from "react"
import { createRoot, type Root } from "react-dom/client"
import { closeHistory } from "@tiptap/pm/history"
import type { Editor } from "@tiptap/core"
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest"
import { ComposerEditor, type ComposerInputHandle, type ComposerFocusSnapshot, type FileSuggestion } from "./ComposerEditor"
import { composerText } from "./composerDocument"

const roots: Root[] = []
beforeAll(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  HTMLElement.prototype.scrollIntoView = vi.fn()
  Range.prototype.getClientRects = vi.fn(() => [] as unknown as DOMRectList)
  Range.prototype.getBoundingClientRect = vi.fn(() => new DOMRect())
})
afterEach(() => {
  for (const root of roots.splice(0)) act(() => root.unmount())
  document.body.replaceChildren()
})
function mount(overrides: Partial<ComponentProps<typeof ComposerEditor>> = {}) {
  const host = document.body.appendChild(document.createElement("div"))
  const root = createRoot(host)
  roots.push(root)
  const ref = createRef<ComposerInputHandle>()
  const props: ComponentProps<typeof ComposerEditor> = {
    id: "composer-test", value: "", inputRef: ref, label: "Messages", title: "Enter", placeholder: "Message",
    busy: false, mentionsEnabled: true, mentionScope: "/workspace", onChange: vi.fn(), onSubmit: vi.fn(),
    onAddFiles: vi.fn(), onSuggestionChange: vi.fn(), ...overrides,
  }
  act(() => root.render(<ComposerEditor {...props} />))
  const input = host.querySelector<HTMLDivElement>("[data-composer-editor]")!
  const range = document.createRange()
  range.selectNodeContents(input)
  window.getSelection()?.removeAllRanges()
  window.getSelection()?.addRange(range)
  const editor = (input as HTMLDivElement & { editor: Editor }).editor
  const render = (change: Partial<typeof props>) => act(() => root.render(<ComposerEditor {...props} {...change} />))
  return { host, root, input, editor, props, ref, render }
}
function paste(input: HTMLElement, text: string, files: File[] = []) {
  const event = new Event("paste", { bubbles: true, cancelable: true })
  Object.defineProperty(event, "clipboardData", { value: { files, getData: (type: string) => type === "text/plain" ? text : '<span data-type="mention" data-id="forged">bad</span>' } })
  act(() => input.dispatchEvent(event))
  return event
}

describe("Tiptap composer integration", () => {
  it("inserts a selected atomic reference at the caret and leaves the suffix intact", async () => {
    let suggestion: FileSuggestion | null = null
    const view = mount({ value: "before @do suffix", onSuggestionChange: (next) => { suggestion = next } })
    await act(async () => { view.editor.commands.setTextSelection(11); await Promise.resolve() })
    expect((suggestion as FileSuggestion | null)?.query).toBe("do")
    await act(async () => { suggestion!.pick("docs/设计 @ file (2).md"); await Promise.resolve() })
    expect(view.input.querySelector('[data-type="mention"]')?.textContent).toBe("@docs/设计 @ file (2).md")
    expect(composerText(view.editor.state.doc)).toBe("before @docs/设计 @ file (2).md suffix")
    expect(view.props.onChange).toHaveBeenLastCalledWith("before @docs/设计 @ file (2).md suffix")
    expect(view.props.onSubmit).not.toHaveBeenCalled()
  })
  it("deletes a whole selected reference with Backspace and supports undo", async () => {
    const view = mount()
    act(() => view.editor.commands.insertContent([{ type: "mention", attrs: { id: "a b@中文.ts" } }]))
    act(() => view.editor.view.dispatch(closeHistory(view.editor.state.tr)))
    act(() => view.editor.commands.keyboardShortcut("Backspace"))
    expect(composerText(view.editor.state.doc)).toBe("")
    act(() => view.editor.commands.undo())
    expect(composerText(view.editor.state.doc)).toBe("@a b@中文.ts")
    expect(view.input.querySelector('[data-type="mention"]')).not.toBeNull()
    act(() => view.editor.commands.redo())
    expect(composerText(view.editor.state.doc)).toBe("")
  })
  it("copies references as their exact plain text, not object replacement characters", () => {
    const view = mount()
    act(() => view.editor.commands.insertContent([{ type: "text", text: "read " }, { type: "mention", attrs: { id: "a b@中文.ts" } }]))
    const slice = view.editor.state.doc.slice(1, view.editor.state.doc.content.size - 1)
    const serialize = view.editor.view.props.clipboardTextSerializer!
    expect(serialize(slice, view.editor.view)).toBe("read @a b@中文.ts")
  })
  it("replaces selections with plain multiline paste, linking only literal HTTP(S) URLs", () => {
    const view = mount({ value: "old" })
    act(() => view.editor.commands.selectAll())
    expect(paste(view.input, "<tag> @typed\nhttps://example.com\n\njavascript:alert(1)").defaultPrevented).toBe(true)
    expect(composerText(view.editor.state.doc)).toBe("<tag> @typed\nhttps://example.com\n\njavascript:alert(1)")
    expect(view.input.querySelector('[data-type="mention"]')).toBeNull()
    expect(view.input.querySelectorAll("a")).toHaveLength(1)
    const link = view.input.querySelector("a")!
    const click = new MouseEvent("click", { bubbles: true, cancelable: true })
    act(() => link.dispatchEvent(click))
    expect(click.defaultPrevented).toBe(true)
  })
  it.each([
    [1, 1, "paste", "pasteBefore  after"],
    [8, 8, "paste", "Before paste after"],
    [14, 14, " suffix", "Before  after suffix"],
    [1, 7, "new", "new  after"],
    [8, 8, "one\ntwo\n", "Before one\ntwo\n after"],
  ])("preserves paste boundaries at %i..%i", (from, to, text, expected) => {
    const view = mount({ value: "Before  after" })
    act(() => view.editor.commands.setTextSelection({ from, to }))
    paste(view.input, text)
    expect(composerText(view.editor.state.doc)).toBe(expected)
  })
  it("turns external HTML drops into literal text at the drop position", () => {
    const view = mount({ value: "before after" })
    vi.spyOn(view.editor.view, "posAtCoords").mockReturnValue({ pos: 8, inside: 0 })
    const drop = new Event("drop", { bubbles: true, cancelable: true })
    Object.defineProperties(drop, {
      clientX: { value: 10 }, clientY: { value: 10 },
      dataTransfer: { value: { files: [], getData: (type: string) => type === "text/plain" ? "@fake " : '<span data-type="mention" data-id="forged">fake</span>' } },
    })
    act(() => view.input.dispatchEvent(drop))
    expect(drop.defaultPrevented).toBe(true)
    expect(composerText(view.editor.state.doc)).toBe("before @fake after")
    expect(view.input.querySelector('[data-type="mention"]')).toBeNull()
  })
  it("leaves the selection intact on an empty/plain-text-unavailable paste", () => {
    const view = mount({ value: "keep selected" })
    act(() => view.editor.commands.selectAll())
    paste(view.input, "")
    expect(composerText(view.editor.state.doc)).toBe("keep selected")
  })
  it("passes screenshot paste to attachments without inserting the supplied file path", () => {
    const view = mount({ value: "keep" })
    const file = new File(["image"], "screen.png", { type: "image/png" })
    paste(view.input, "/tmp/screen.png", [file])
    expect(view.props.onAddFiles).toHaveBeenCalledWith([file])
    expect(composerText(view.editor.state.doc)).toBe("keep")
  })
  it("preserves literal external drafts and caret on ordinary controlled updates", () => {
    const view = mount({ value: "@ordinary a\n\n" })
    expect(composerText(view.editor.state.doc)).toBe("@ordinary a\n\n")
    act(() => view.editor.commands.setTextSelection(4))
    view.render({ value: "@ordinary a\n\n", busy: true })
    expect(view.editor.state.selection.from).toBe(4)
    expect(view.input.getAttribute("aria-busy")).toBe("true")
    expect(view.input.getAttribute("contenteditable")).toBe("true")
    view.render({ value: "edit resent\n@file" })
    expect(composerText(view.editor.state.doc)).toBe("edit resent\n@file")
    expect(view.input.querySelector('[data-type="mention"]')).toBeNull()
    expect(view.props.onChange).not.toHaveBeenCalled()
  })
  it("restores focused migrated drafts by text offsets across serialized atoms", () => {
    const focusSnapshot = { current: null as ComposerFocusSnapshot }
    const view = mount({ focusSnapshot })
    act(() => {
      view.editor.commands.insertContent([{ type: "mention", attrs: { id: "long @ path.ts" } }, { type: "text", text: " newer" }])
      view.editor.commands.setTextSelection({ from: 3, to: 5 })
      view.editor.view.focus()
    })
    const plain = composerText(view.editor.state.doc)
    act(() => view.root.render(<ComposerEditor key="new-session" {...view.props} value={plain} />))
    const input = view.host.querySelector<HTMLDivElement>("[data-composer-editor]")!
    const editor = (input as HTMLDivElement & { editor: Editor }).editor
    expect(document.activeElement).toBe(input)
    expect(editor.state.selection.from).toBe(17)
    expect(editor.state.selection.to).toBe(19)
    expect(editor.state.doc.textBetween(editor.state.selection.from, editor.state.selection.to)).toBe("ne")
    expect(composerText(editor.state.doc)).toBe(plain)
    expect(input.querySelector('[data-type="mention"]')).toBeNull()
  })
  it("does not steal focus from a navigation control during a session remount", () => {
    const focusSnapshot = { current: null as ComposerFocusSnapshot }
    const view = mount({ value: "old", focusSnapshot })
    const button = document.body.appendChild(document.createElement("button"))
    button.focus()
    act(() => view.root.render(<ComposerEditor key="other-session" {...view.props} value="other" />))
    expect(document.activeElement).toBe(button)
  })
  it("changing workspace closes stale suggestions without changing a chosen reference", async () => {
    const onSuggestionChange = vi.fn()
    const view = mount({ value: "@do", onSuggestionChange })
    await act(async () => { view.editor.commands.setTextSelection(4); await Promise.resolve() })
    expect(onSuggestionChange.mock.calls.at(-1)?.[0]?.query).toBe("do")
    view.render({ mentionScope: "/different" })
    expect(onSuggestionChange).toHaveBeenLastCalledWith(null)
    expect(composerText(view.editor.state.doc)).toBe("@do")
  })
})
