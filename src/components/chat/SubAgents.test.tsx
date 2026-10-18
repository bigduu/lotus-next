import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/ui"
import { SubAgents } from "./SubAgents"

it.each([
  ["completed", "done_c0b3fbff"],
  ["error", "failed_28384d7a"],
  ["cancelled", "workflow_run_status_cancelled"],
  ["retired", "exited_899df7e2"],
  ["unknown", "plugin_connection_unknown"],
] as const)("renders %s without an active spinner", (status, label) => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement("div")
  const root = createRoot(host)
  try {
    act(() => root.render(<SubAgents agents={{ child: { title: "Reviewer", status } }} />))
    expect(host.textContent).toContain(uiText(label))
    expect(host.querySelector(".animate-spin")).toBeNull()
  } finally { act(() => root.unmount()) }
})

it("starts compact with accessible independent expansion and opens the transcript only on request", () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement("div"), root = createRoot(host), onOpen = vi.fn()
  try {
    act(() => root.render(<SubAgents agents={{ a: { title: "Reviewer", status: "completed", outputPreview: "Review details" },
      b: { title: "Builder", status: "running" } }} onOpen={onOpen} />))
    const card = host.querySelector('[data-subagent-id="a"]')!
    const toggle = card.querySelector<HTMLButtonElement>("[data-subagent-toggle]")!
    const details = card.querySelector<HTMLElement>("[data-subagent-details]")!
    expect(toggle.getAttribute("aria-expanded")).toBe("false")
    expect(toggle.getAttribute("aria-controls")).toBe(details.id)
    expect(toggle.textContent).toContain(uiText("done_c0b3fbff"))
    expect(details.hidden).toBe(true)
    act(() => toggle.click())
    expect(toggle.getAttribute("aria-expanded")).toBe("true")
    expect(details.hidden).toBe(false)
    expect(details.textContent).toContain("Review details")
    expect(onOpen).not.toHaveBeenCalled()
    act(() => details.querySelector<HTMLButtonElement>("button")!.click())
    expect(onOpen).toHaveBeenCalledExactlyOnceWith("a")
    expect(host.querySelector('[data-subagent-id="b"] [data-subagent-toggle]')?.getAttribute("aria-expanded")).toBe("false")
    act(() => toggle.click())
    expect(details.hidden).toBe(true)
    expect(onOpen).toHaveBeenCalledTimes(1)
  } finally { act(() => root.unmount()) }
})

it("keeps per-child choices through reordered metadata and cancelled or completed lifecycle updates", () => {
  const host = document.createElement("div"), root = createRoot(host)
  try {
    act(() => root.render(<SubAgents agents={{ a: { title: "Reviewer", status: "running" }, b: { status: "running" } }} />))
    const toggle = (id: string) => host.querySelector<HTMLButtonElement>(`[data-subagent-id="${id}"] [data-subagent-toggle]`)!
    act(() => toggle("a").click())
    act(() => root.render(<SubAgents agents={{ b: { status: "completed" }, a: { title: "Renamed", status: "cancelled", error: "Cancelled" } }} />))
    expect(toggle("a").getAttribute("aria-expanded")).toBe("true")
    expect(toggle("b").getAttribute("aria-expanded")).toBe("false")
    expect(toggle("a").textContent).toContain(uiText("workflow_run_status_cancelled"))
    expect(toggle("a").textContent).not.toContain(uiText("failed_28384d7a"))
    expect(host.querySelector('[data-subagent-id="a"] .text-destructive')).toBeNull()
    act(() => toggle("a").click())
    act(() => root.render(<SubAgents agents={{ a: { status: "running" }, b: { status: "unknown" } }} />))
    expect(toggle("a").getAttribute("aria-expanded")).toBe("false")
  } finally { act(() => root.unmount()) }
})

it("keeps unknown provenance visible while details remain collapsed", () => {
  const host = document.createElement("div"), root = createRoot(host)
  try {
    act(() => root.render(<SubAgents originUnconfirmed agents={{ child: { status: "unknown" } }} />))
    expect(host.textContent).toContain(uiText("subagent_origin_unknown"))
    expect(host.querySelector<HTMLElement>("[data-subagent-details]")!.hidden).toBe(true)
  } finally { act(() => root.unmount()) }
})
