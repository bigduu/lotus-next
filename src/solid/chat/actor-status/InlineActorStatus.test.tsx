import { render, type JSX } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/text"
import type { SubAgentCard } from "@services/chat/actorInlineStatus"
import { InlineActorGroup, type InlineActorStatus } from "./InlineActorStatus"

vi.mock("@lucide/solid", () => {
  const Icon = (props: Pick<JSX.IntrinsicElements["svg"], "class" | "aria-hidden">) =>
    <svg class={props.class} aria-hidden={props["aria-hidden"]} />
  return { AlertCircle: Icon, Bot: Icon, Check: Icon, ChevronRight: Icon, Container: Icon,
    Loader2: Icon, Monitor: Icon, Server: Icon }
})

const dispose: (() => void)[] = []
afterEach(() => { for (const cleanup of dispose.splice(0)) cleanup() })

function mount(agents: Record<string, SubAgentCard>, originUnconfirmed = false) {
  const host = document.body.appendChild(document.createElement("div"))
  const [rows, setRows] = createSignal(agents)
  const onOpen = vi.fn()
  const stop = render(() => {
    const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
    const status: InlineActorStatus = {
      expanded,
      toggle: (id) => setExpanded((previous) => {
        const next = new Set(previous)
        if (!next.delete(id)) next.add(id)
        return next
      }),
      groups: () => ({ byOrigin: new Map(), folded: {}, unplaced: {}, hasUnconfirmedAge: false }),
      error: () => null,
      refresh: vi.fn(),
    }
    return <InlineActorGroup agents={rows()} status={status} onOpen={onOpen} originUnconfirmed={originUnconfirmed} />
  }, host)
  dispose.push(() => { stop(); host.remove() })
  flush()
  const card = (id: string) => host.querySelector<HTMLElement>(`[data-subagent-id="${id}"]`)!
  return { host, card, onOpen,
    toggle: (id: string) => card(id).querySelector<HTMLButtonElement>("[data-subagent-toggle]")!,
    details: (id: string) => card(id).querySelector<HTMLElement>("[data-subagent-details]")!,
    update(next: Record<string, SubAgentCard>) { setRows(next); flush() } }
}

const click = (button: HTMLButtonElement) => { button.click(); flush() }

it.each([
  ["completed", "done_c0b3fbff"], ["error", "failed_28384d7a"], ["cancelled", "workflow_run_status_cancelled"],
  ["retired", "exited_899df7e2"], ["unknown", "plugin_connection_unknown"],
] as const)("renders %s without an active spinner", (status, label) => {
  const view = mount({ child: { title: "Reviewer", status } })
  expect(view.host.textContent).toContain(uiText(label))
  expect(view.host.querySelector(".animate-spin")).toBeNull()
})

it("keeps independent accessible expansion and opens the selected transcript only on request", () => {
  const view = mount({ a: { title: "Reviewer", status: "completed" }, b: { title: "Builder", status: "running" } })
  const toggle = view.toggle("a")
  const details = view.details("a")
  expect(toggle.getAttribute("aria-expanded")).toBe("false")
  expect(toggle.getAttribute("aria-controls")).toBe(details.id)
  expect(toggle.textContent).toContain(uiText("done_c0b3fbff"))
  expect(details.hidden).toBe(true)
  click(toggle)
  expect(toggle.getAttribute("aria-expanded")).toBe("true")
  expect(details.hidden).toBe(false)
  expect(view.onOpen).not.toHaveBeenCalled()
  click(details.querySelector("button")!)
  expect(view.onOpen).toHaveBeenCalledExactlyOnceWith("a")
  expect(view.toggle("b").getAttribute("aria-expanded")).toBe("false")
  click(toggle)
  expect(details.hidden).toBe(true)
  expect(view.onOpen).toHaveBeenCalledTimes(1)
})

it("keeps a child's expansion through status changes and reorder without rendering stale private details", () => {
  const view = mount({ a: { title: "Reviewer", status: "running" }, b: { status: "running" } })
  const first = view.toggle("a")
  click(first)
  view.update({ b: { status: "completed" }, a: { title: "Renamed", status: "cancelled", error: "old private error" } })
  expect(view.toggle("a")).toBe(first)
  expect(first.getAttribute("aria-expanded")).toBe("true")
  expect(view.toggle("b").getAttribute("aria-expanded")).toBe("false")
  expect(first.textContent).toContain(uiText("workflow_run_status_cancelled"))
  expect(first.textContent).not.toContain(uiText("failed_28384d7a"))
  expect(view.card("a").querySelector(".text-destructive")).toBeNull()
  expect(view.card("a").textContent).not.toContain("old private error")
  click(first)
  view.update({ a: { status: "running" }, b: { status: "unknown" } })
  expect(view.toggle("a").getAttribute("aria-expanded")).toBe("false")
})

it("shows the provenance gap while leaving the details collapsed", () => {
  const view = mount({ child: { status: "unknown" } }, true)
  expect(view.host.textContent).toContain(uiText("subagent_origin_unknown"))
  expect(view.details("child").hidden).toBe(true)
})
