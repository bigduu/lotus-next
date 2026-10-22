import { act, type ReactNode } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { Reasoning } from "./Reasoning"
import { StreamingReasoning } from "./StreamingReasoning"
let dispose = () => {}
afterEach(() => { act(dispose); document.body.replaceChildren(); vi.unstubAllGlobals() })

function mount(element: ReactNode) {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const host = document.createElement("div"); document.body.append(host)
  const root = createRoot(host); dispose = () => root.unmount()
  act(() => root.render(element))
  return { host, root }
}

it("keeps live and completed reasoning collapsed and exposes full mounted text on demand", () => {
  const { host, root } = mount(<StreamingReasoning text="first reasoning" />)
  const button = host.querySelector("button")!
  const panel = host.querySelector("[data-disclosure-panel]")!
  const region = host.querySelector<HTMLElement>('[role="region"]')!
  expect(button.getAttribute("aria-expanded")).toBe("false")
  expect(panel.getAttribute("aria-hidden")).toBe("true")
  expect(panel.hasAttribute("inert")).toBe(true)
  expect(region.tabIndex).toBe(-1)
  expect(region.textContent).toBe("first reasoning")
  act(() => button.click())
  expect(button.getAttribute("aria-controls")).toBe(region.id)
  expect(panel.getAttribute("aria-hidden")).toBe("false")
  expect(panel.hasAttribute("inert")).toBe(false)
  expect(region.tabIndex).toBe(0)
  region.scrollTop = 24
  act(() => root.render(<StreamingReasoning text="first reasoning plus new text" />))
  expect(host.querySelector('[role="region"]')).toBe(region)
  expect(region.textContent).toBe("first reasoning plus new text")
  act(() => button.click())
  act(() => root.render(<StreamingReasoning text={"原文  保留\n  exact whitespace 🔍"} />))
  expect(host.querySelector('[role="region"]')).toBe(region)
  expect(region.textContent).toBe("原文  保留\n  exact whitespace 🔍")
  expect(region.scrollTop).toBe(24)
  expect(panel.hasAttribute("inert")).toBe(true)
  act(() => root.render(<Reasoning text="saved reasoning" />))
  expect(host.querySelector("button")!.getAttribute("aria-expanded")).toBe("false")
  act(() => host.querySelector("button")!.click())
  expect(host.querySelector('[role="region"]')!.textContent).toBe("saved reasoning")
})

it("returns focus from reasoning on close and leaves outside focus alone", () => {
  const { host } = mount(<Reasoning text="complete reasoning" />)
  const button = host.querySelector("button")!
  const region = host.querySelector<HTMLElement>('[role="region"]')!
  const outside = document.createElement("button")
  document.body.append(outside)
  act(() => button.click())
  region.focus()
  expect(document.activeElement).toBe(region)
  act(() => button.click())
  expect(document.activeElement).toBe(button)
  act(() => button.click())
  outside.focus()
  act(() => button.click())
  expect(document.activeElement).toBe(outside)
})

it("keeps the same panel and control relationship through rapid reversals", () => {
  const { host } = mount(<Reasoning text="the full thought" />)
  const button = host.querySelector("button")!
  const region = host.querySelector('[role="region"]')!
  const panel = host.querySelector("[data-disclosure-panel]")!
  for (let index = 0; index < 7; index += 1) act(() => button.click())
  expect(button.getAttribute("aria-expanded")).toBe("true")
  expect(button.getAttribute("aria-controls")).toBe(region.id)
  expect(host.querySelector('[role="region"]')).toBe(region)
  expect(panel.getAttribute("data-state")).toBe("open")
  expect(panel.hasAttribute("inert")).toBe(false)
})
