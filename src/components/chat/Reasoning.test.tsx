import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { Reasoning } from "./Reasoning"
import { StreamingReasoning } from "./StreamingReasoning"
let dispose = () => {}
afterEach(() => { act(dispose); document.body.replaceChildren(); vi.unstubAllGlobals() })
it("keeps live and completed reasoning collapsed and exposes full text on demand", () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const host = document.createElement("div"); document.body.append(host)
  const root = createRoot(host); dispose = () => root.unmount()
  act(() => root.render(<StreamingReasoning text="first reasoning" />))
  const button = host.querySelector("button")!
  expect(button.getAttribute("aria-expanded")).toBe("false")
  expect(host.textContent).not.toContain("first reasoning")
  act(() => button.click())
  expect(button.getAttribute("aria-controls")).toBe(host.querySelector('[role="region"]')!.id)
  act(() => root.render(<StreamingReasoning text="first reasoning plus new text" />))
  expect(host.querySelector('[role="region"]')!.textContent).toBe("first reasoning plus new text")
  act(() => root.render(<Reasoning text="saved reasoning" />))
  expect(host.querySelector("button")!.getAttribute("aria-expanded")).toBe("false")
  act(() => host.querySelector("button")!.click())
  expect(host.querySelector('[role="region"]')!.textContent).toBe("saved reasoning")
})
