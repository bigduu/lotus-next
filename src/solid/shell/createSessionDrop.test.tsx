import { flush } from "solid-js"
import { render } from "@solidjs/web"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { createSessionDrop } from "./createSessionDrop"
import { SIDEBAR_SESSION_DRAG_TYPE } from "@/lib/projectSidebarPreferences"

const chats = [{ id: "a", kind: "root", config: { projectId: "p" } }, { id: "b", kind: "root" }, { id: "child", kind: "child", parentSessionId: "a" }] as const
let host: HTMLDivElement
let dispose: () => void
const open = vi.fn()
const editorDrop = vi.fn()
function Harness() {
  const drop = createSessionDrop(() => chats, open)
  return <div data-active={drop.active() ? "true" : "false"} ref={drop.bindTarget}><div data-editor onDrop={editorDrop} /></div>
}
function drag(type: string, payload: unknown = { sessionId: "a", projectId: "p" }, types = [SIDEBAR_SESSION_DRAG_TYPE], relatedTarget: EventTarget | null = null) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  const transfer = { types, dropEffect: "none", getData: () => typeof payload === "string" ? payload : JSON.stringify(payload) }
  Object.defineProperties(event, { dataTransfer: { value: transfer }, relatedTarget: { value: relatedTarget } })
  host.querySelector("[data-editor]")!.dispatchEvent(event)
  flush()
  return { event, transfer }
}
beforeEach(() => {
  vi.clearAllMocks()
  host = document.body.appendChild(document.createElement("div"))
  dispose = render(() => <Harness />, host)
  flush()
})
afterEach(() => { dispose(); host.remove() })
it("offers copy feedback and opens only at drop, intercepting editor insertion", () => {
  expect(drag("dragover").transfer.dropEffect).toBe("copy")
  expect(host.firstElementChild?.getAttribute("data-active")).toBe("true")
  expect(open).not.toHaveBeenCalled()
  expect(drag("drop").event.defaultPrevented).toBe(true)
  expect(open).toHaveBeenCalledExactlyOnceWith("a"); expect(editorDrop).not.toHaveBeenCalled()
  expect(host.firstElementChild?.getAttribute("data-active")).toBe("false")
})
it("opens unassigned roots without changing their project", () => {
  drag("drop", { sessionId: "b", projectId: null }); expect(open).toHaveBeenCalledExactlyOnceWith("b")
})
it.each(["bad json", {}, { sessionId: "missing", projectId: null }, { sessionId: "a", projectId: "forged" }, { sessionId: "child", projectId: null }, { sessionId: "b" }, { sessionId: "", projectId: null }])("rejects invalid or stale session payload %j", (payload) => {
  drag("drop", payload); expect(open).not.toHaveBeenCalled(); expect(editorDrop).not.toHaveBeenCalled()
})
it("leaves external files and ordinary text to the existing attachment/editor path", () => {
  expect(drag("dragover", {}, ["Files"]).event.defaultPrevented).toBe(false)
  drag("drop", {}, ["Files"]); drag("drop", {}, ["text/plain"])
  expect(editorDrop).toHaveBeenCalledTimes(2); expect(open).not.toHaveBeenCalled()
})
it("clears on leave and cancellation without navigation and keeps child transitions stable", () => {
  drag("dragover"); drag("dragleave", {}, [], host.querySelector("[data-editor]"))
  expect(host.firstElementChild?.getAttribute("data-active")).toBe("true")
  drag("dragleave"); expect(host.firstElementChild?.getAttribute("data-active")).toBe("false")
  drag("dragover")
  window.dispatchEvent(new Event("dragend"))
  flush()
  expect(host.firstElementChild?.getAttribute("data-active")).toBe("false"); expect(open).not.toHaveBeenCalled()
})
