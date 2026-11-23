import { render, type JSX } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/text"
import { RenderHistoryRow } from "./HistoryRow"
import { buildLiveItems, type ProcessItem } from "./historyProjection"

vi.mock("@lucide/solid", () => {
  const Icon = (props: Pick<JSX.IntrinsicElements["svg"], "class" | "aria-hidden">) =>
    <svg class={props.class} aria-hidden={props["aria-hidden"]} />
  return { Brain: Icon, ChevronRight: Icon, Columns2: Icon, FileDiff: Icon, FileText: Icon, LoaderCircle: Icon,
    Rows3: Icon, Terminal: Icon, WrapText: Icon }
})

const dispose = new Set<() => void>()
const originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate")

afterEach(() => {
  for (const cleanup of dispose) cleanup()
  dispose.clear()
  delete document.body.dataset.vdiSafe
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate)
  else Reflect.deleteProperty(HTMLElement.prototype, "animate")
})

function mount(item: ProcessItem, open = false) {
  const host = document.body.appendChild(document.createElement("div"))
  const [row, setRow] = createSignal(item)
  const [expanded, setExpanded] = createSignal(open)
  const toggle = vi.fn()
  const cleanup = render(() => <RenderHistoryRow item={row()} live theme="light"
    disclosure={{ isOpen: () => expanded(), toggle }} onOpenLink={() => {}} onPreviewImage={() => {}} />, host)
  dispose.add(() => { cleanup(); host.remove() })
  const find = <T extends HTMLElement = HTMLElement,>(marker: string) => host.querySelector<T>(`[data-process-${marker}]`)
  flush()
  return {
    host, find, toggle,
    update(next: ProcessItem) { setRow(next); flush() },
    expand(value: boolean) { setExpanded(value); flush() },
  }
}

function tool(id: string, status: "running" | "completed") {
  const [process] = buildLiveItems([{ kind: "tools", calls: [{ toolCallId: id, toolName: "Read",
    args: { file_path: `${id}.ts` }, output: status === "completed" ? "Complete output" : "", status }] }],
  null, null, true, null, uiText)
  if (process?.kind !== "process") throw new Error("The tool fixture must produce a process")
  return process
}

function animations() {
  const observed: Array<{ node: HTMLElement; frames: Keyframe[]; options: KeyframeAnimationOptions;
    resolve: () => void; reject: () => void; cancel: ReturnType<typeof vi.fn> }> = []
  HTMLElement.prototype.animate = vi.fn(function (this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
    let resolve!: () => void
    let reject!: () => void
    const finished = new Promise<void>((done, fail) => { resolve = done; reject = () => fail(new Error("cancelled")) })
    const cancel = vi.fn()
    observed.push({ node: this, frames, options, resolve, reject, cancel })
    return { finished, cancel } as unknown as Animation
  })
  return observed
}

async function settle(update: () => void) {
  update()
  await Promise.resolve()
  flush()
}

it("animates the running step with its motion token, then settles it into the unchanged disclosure", async () => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }))
  const style = document.createElement("div").style
  style.setProperty("--motion-fast", "110ms")
  style.setProperty("--motion-normal", "0.26s")
  style.setProperty("--motion-ease", "linear")
  vi.spyOn(globalThis, "getComputedStyle").mockReturnValue(style)
  const changes = animations()
  const view = mount(tool("read", "running"))
  const panel = view.find("content")!
  expect(view.find("current")?.textContent).toContain("read.ts")
  expect(panel.getAttribute("aria-hidden")).toBe("true")
  expect(changes[0]?.node).toBe(view.find("current"))
  expect(changes[0]?.options).toEqual({ duration: 110, easing: "linear" })
  expect(changes[0]?.frames).toEqual([
    { opacity: 0, transform: "translateY(4px)" }, { opacity: 1, transform: "translateY(0)" },
  ])
  view.update(tool("read", "running"))
  expect(changes).toHaveLength(1)

  view.update(tool("read", "completed"))
  expect(view.find("current")).toBeNull()
  expect(view.find("handoff")?.textContent).toContain("read.ts")
  expect(view.find("shimmer")?.textContent).toBe(uiText("thinking_64088d8c"))
  expect(changes[0].cancel).toHaveBeenCalledTimes(1)
  const handoff = changes.find((entry) => entry.node === view.find("handoff"))!
  expect(handoff.options).toEqual({ duration: 260, easing: "linear", fill: "forwards" })
  expect(handoff.frames).toEqual([
    { height: "0px", opacity: 1, transform: "translateY(0) scale(1)", offset: 0 },
    { height: "0px", opacity: 1, transform: "translateY(0) scale(1)", offset: 0.35 },
    { height: "0px", opacity: 0, transform: "translateY(-12px) scale(0.98)" },
  ])
  expect(handoff.cancel).not.toHaveBeenCalled()
  await settle(handoff.resolve)
  expect(view.find("handoff")).toBeNull()
  expect(handoff.cancel).toHaveBeenCalledTimes(1)
  view.expand(true)
  expect(view.find("content")).toBe(panel)
  expect(panel.getAttribute("aria-hidden")).toBe("false")
  expect(panel.textContent).toContain("Complete output")
})

it.each(["resolve", "reject"] as const)("ignores a stale handoff %s without dropping the newer step", async (outcome) => {
  vi.stubGlobal("matchMedia", () => ({ matches: false }))
  const changes = animations()
  const view = mount(tool("first", "running"))
  view.update(tool("second", "running"))
  const old = changes.find((entry) => entry.node === view.find("handoff"))!
  expect(view.find("handoff")?.textContent).toContain("first.ts")
  view.update(tool("third", "running"))
  expect(old.cancel).toHaveBeenCalledTimes(1)
  expect(view.find("handoff")?.textContent).toContain("second.ts")
  await settle(old[outcome])
  expect(view.find("handoff")?.textContent).toContain("second.ts")
  const current = changes.find((entry) => entry.node === view.find("handoff"))!
  await settle(current.resolve)
  expect(view.find("handoff")).toBeNull()
  expect(current.cancel).toHaveBeenCalledTimes(1)
  expect(view.find("current")?.textContent).toContain("third.ts")
})

it.each(["reduced motion", "VDI safe mode", "no Web Animations"])("archives the tool immediately in %s", (mode) => {
  vi.stubGlobal("matchMedia", () => ({ matches: mode === "reduced motion" }))
  if (mode === "VDI safe mode") document.body.dataset.vdiSafe = "true"
  const changes = animations()
  if (mode === "no Web Animations") Reflect.deleteProperty(HTMLElement.prototype, "animate")
  const view = mount(tool("read", "running"))
  view.update(tool("read", "completed"))
  expect(view.find("current")).toBeNull()
  expect(view.find("handoff")).toBeNull()
  expect(changes).toEqual([])
  expect(view.find("content")?.textContent).toContain("Complete output")
})

it("lets the disclosure owner control expansion while keeping mounted details and restoring only internal focus", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  const thought = "First plan.\n**Now check the complete output.**"
  const view = mount({ kind: "process", key: "thought", parts: [{ kind: "reasoning", text: thought }] })
  const button = view.find<HTMLButtonElement>("toggle")!
  const panel = view.find("content")!
  const detail = panel.querySelector<HTMLButtonElement>("[data-reasoning-toggle]")!
  expect(button.type).toBe("button")
  expect(button.getAttribute("aria-controls")).toBe(panel.id)
  expect(button.getAttribute("aria-expanded")).toBe("false")
  expect(panel.hasAttribute("inert")).toBe(true)
  expect(panel.textContent).toContain(thought)
  expect(view.find("brief")?.textContent).toBe("Now check the complete output.")
  button.click()
  flush()
  expect(view.toggle).toHaveBeenCalledExactlyOnceWith("thought")
  expect(button.getAttribute("aria-expanded")).toBe("false")

  for (const expanded of [true, false, true, false, true]) view.expand(expanded)
  expect(view.find("content")).toBe(panel)
  expect(panel.querySelector("[data-reasoning-toggle]")).toBe(detail)
  expect(panel.getAttribute("data-state")).toBe("open")
  expect(panel.hasAttribute("inert")).toBe(false)
  detail.focus()
  view.expand(false)
  expect(document.activeElement).toBe(button)
  expect(panel.hasAttribute("inert")).toBe(true)

  view.expand(true)
  const outside = view.host.appendChild(document.createElement("button"))
  outside.focus()
  view.expand(false)
  expect(document.activeElement).toBe(outside)
})

it("keeps the accessible process label separate from reasoning, progress and the tool count", () => {
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  const thinking: ProcessItem = { kind: "process", key: "model-progress", active: true, thinking: true,
    parts: [{ kind: "reasoning", text: "Earlier. Checking the newest state." }] }
  const view = mount(thinking)
  const button = view.find("toggle")!
  const brief = view.find("brief")!
  expect(button.getAttribute("aria-label")).toBe(uiText("thinking_64088d8c"))
  expect(brief.textContent).toBe("Checking the newest state.")
  expect(view.find("shimmer")).not.toBeNull()

  view.update({ ...thinking, thinking: false, status: "Inspecting tool output" })
  expect(brief.textContent).toBe("Inspecting tool output")
  expect(button.getAttribute("aria-label")).toBe(uiText("process_activity"))
  expect(view.find("shimmer")).toBeNull()

  view.update({ ...thinking, active: false, parts: [{ kind: "reasoning", text: "Earlier. Latest saved conclusion." }] })
  expect(brief.textContent).toBe("Latest saved conclusion.")
  expect(button.getAttribute("aria-label")).toBe(uiText("process_activity"))
  expect(view.find("shimmer")).toBeNull()

  const count = tool("saved", "completed")
  view.update({ ...count, key: thinking.key, active: false, thinking: false })
  expect(brief.textContent).toBe(uiText("process_tool_count", { count: 1 }))
})
