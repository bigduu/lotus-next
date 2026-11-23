import { render, type JSX } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { RenderHistoryRow } from "./HistoryRow"

vi.mock("@lucide/solid", () => {
  const Icon = (props: Pick<JSX.IntrinsicElements["svg"], "class" | "aria-hidden">) =>
    <svg class={props.class} aria-hidden={props["aria-hidden"]} />
  return { Brain: Icon, ChevronRight: Icon, Terminal: Icon }
})

let cleanup: (() => void) | undefined
afterEach(() => { cleanup?.() })

function mount(text: string, live = false) {
  vi.stubGlobal("matchMedia", () => ({ matches: true }))
  const host = document.body.appendChild(document.createElement("div"))
  const [row, setRow] = createSignal({ text, live })
  const dispose = render(() => {
    const [expanded, setExpanded] = createSignal(new Set<string>())
    const disclosure = {
      isOpen: (key: string) => expanded().has(key),
      toggle: (key: string) => setExpanded((previous) => {
        const next = new Set(previous)
        if (!next.delete(key)) next.add(key)
        return next
      }),
    }
    return <RenderHistoryRow item={{
      kind: "process", key: "reasoning", active: row().live, thinking: row().live,
      parts: [{ kind: "reasoning", text: row().text }],
    }} live={row().live} disclosure={disclosure} theme="light" onOpenLink={() => {}} onPreviewImage={() => {}} />
  }, host)
  cleanup = () => { dispose(); host.remove() }
  flush()
  const click = (button: HTMLButtonElement) => { button.click(); flush() }
  click(host.querySelector("[data-process-toggle]")!)
  const button = () => host.querySelector<HTMLButtonElement>("[data-reasoning-toggle]")!
  const panel = () => document.getElementById(button().getAttribute("aria-controls")!)!
  return {
    host, button, panel, click,
    region: () => panel().querySelector<HTMLElement>('[role="region"]')!,
    update: (value: string, live = row().live) => { setRow({ text: value, live }); flush() },
  }
}

it("retains the full collapsed reasoning, panel identity and scroll through live updates", () => {
  const view = mount("first reasoning", true)
  const button = view.button()
  const panel = view.panel()
  const region = view.region()
  expect(button.getAttribute("aria-expanded")).toBe("false")
  expect(panel.getAttribute("aria-hidden")).toBe("true")
  expect(panel.hasAttribute("inert")).toBe(true)
  expect(region.tabIndex).toBe(-1)
  expect(region.textContent).toBe("first reasoning")
  view.click(button)
  expect(button.getAttribute("aria-controls")).toBe(panel.id)
  expect(panel.getAttribute("aria-hidden")).toBe("false")
  expect(panel.hasAttribute("inert")).toBe(false)
  expect(region.tabIndex).toBe(0)
  region.scrollTop = 24
  view.update("first reasoning plus new text")
  expect(view.region()).toBe(region)
  expect(region.textContent).toBe("first reasoning plus new text")
  view.click(button)
  view.update("原文  保留\n  exact whitespace 🔍")
  expect(view.region()).toBe(region)
  expect(region.textContent).toBe("原文  保留\n  exact whitespace 🔍")
  expect(region.scrollTop).toBe(24)
  expect(panel.hasAttribute("inert")).toBe(true)
  view.update("saved reasoning", false)
  expect(view.button().getAttribute("aria-expanded")).toBe("false")
  view.click(view.button())
  expect(view.region().textContent).toBe("saved reasoning")
})

it("restores focus from reasoning on close and leaves external focus alone", () => {
  const view = mount("completed reasoning")
  const button = view.button()
  expect(button.getAttribute("aria-expanded")).toBe("false")
  expect(view.region().textContent).toBe("completed reasoning")
  const outside = view.host.appendChild(document.createElement("button"))
  view.click(button)
  const region = view.region()
  region.focus()
  expect(document.activeElement).toBe(region)
  view.click(button)
  expect(document.activeElement).toBe(button)
  view.click(button)
  outside.focus()
  view.click(button)
  expect(document.activeElement).toBe(outside)
})

it("keeps the same panel and control relationship through rapid reversals", () => {
  const view = mount("the full thought")
  const button = view.button()
  const panel = view.panel()
  const region = view.region()
  for (let index = 0; index < 7; index += 1) view.click(button)
  expect(button.getAttribute("aria-expanded")).toBe("true")
  expect(button.getAttribute("aria-controls")).toBe(panel.id)
  expect(view.region()).toBe(region)
  expect(panel.getAttribute("data-state")).toBe("open")
  expect(panel.hasAttribute("inert")).toBe(false)
})
