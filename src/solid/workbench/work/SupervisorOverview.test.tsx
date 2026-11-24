import { createContext, Show, useContext } from "solid-js"
import { render, type JSX } from "@solidjs/web"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SupervisorOverview } from "./SupervisorOverview"
import { ticketSnapshot } from "@services/tickets/testFixtures"
import { applyTicketSnapshot } from "@services/tickets/state"
import type { TicketSnapshot } from "@services/tickets/types"

import { settleWorkTest } from "./workTestHarness"

vi.mock("@lucide/solid", () => {
  const Icon = () => <svg aria-hidden="true" />
  return { ChevronRight: Icon, CircleDot: Icon, FileText: Icon, MessageCircle: Icon }
})

// The Work browser spec exercises the actual controlled Popover, focus and
// placement. This fixture isolates how the native overview presents data.
vi.mock("../../ui/popover", () => {
  const Context = createContext<{ open: () => boolean; toggle: () => void }>()
  type Content = { children: JSX.Element; "data-testid": string }
  return {
    Popover: (props: { open: boolean; onOpenChange: (open: boolean) => void; children: JSX.Element }) =>
      <Context value={{ open: () => props.open, toggle: () => props.onOpenChange(!props.open) }}>{props.children}</Context>,
    PopoverTrigger: (props: Content) => {
      const context = useContext(Context)!
      return <button type="button" data-testid={props["data-testid"]} onClick={context.toggle}>{props.children}</button>
    },
    PopoverContent: (props: Content) => {
      const context = useContext(Context)!
      return <Show when={context.open()}><div data-testid={props["data-testid"]}>{props.children}</div></Show>
    },
  }
})

let host: HTMLDivElement
let dispose: () => void
beforeEach(() => { host = document.body.appendChild(document.createElement("div")) })
afterEach(() => { dispose(); host.remove() })

async function open(snapshot: TicketSnapshot, connected = true, running = false) {
  const onSelectWork = vi.fn()
  await settleWorkTest(() => {
    dispose = render(() => <SupervisorOverview running={running} onSelectWork={onSelectWork} controller={{
      state: applyTicketSnapshot(null, snapshot), connected, negotiated: true, availability: { kind: "ready" },
      refreshing: false, canRefresh: true, initializing: false, initializationError: null, canInitialize: false,
      initialize: async () => false, error: null, busy: {}, uncertain: {}, respond: async () => false,
      refresh: async () => {}, canRespond: false, canSendIngress: false,
      answerDraft: () => "", setAnswerDraft: () => {},
    }} />, host)
  })
  await settleWorkTest(() => host.querySelector<HTMLButtonElement>('[data-testid="ticket-work-status"]')!.click())
  return { panel: host.querySelector<HTMLElement>('[data-testid="supervisor-overview"]')!, onSelectWork }
}

it.each([true, false])("does not infer physical dispatch from an active Work, Supervisor running=%s", async (running) => {
  const snapshot = ticketSnapshot()
  const work = snapshot.views[0]
  work.ticket.state = "active"; work.ticket.blocked = null; work.requests = []
  work.sections = ["assignments", "requests", "submissions"]
  work.assignments = [{ id: "assignment-A", work_id: "A", generation: 1, contract_revision: 1,
    state: "dispatch_pending", runtime: null }]
  snapshot.scope.overview.data.states = { active: 1, blocked: 4 }
  const { panel } = await open(snapshot, true, running)
  expect(panel.textContent).toContain("等待派发确认")
  if (running) expect(panel.textContent).toContain("正在处理工作")
  else {
    expect(panel.textContent).not.toContain("正在处理工作")
    expect(panel.textContent).toContain("请查看当前工作状态")
  }
})

it.each([true, false])("does not claim absence from an unloaded nonempty scope, connected=%s", async (connected) => {
  const snapshot = ticketSnapshot(); snapshot.complete = false; snapshot.views = []
  const { panel, onSelectWork } = await open(snapshot, connected)
  expect(panel.textContent).toContain("5 项工作")
  expect(panel.textContent).toContain("详细信息待更新")
  expect(panel.textContent).not.toContain("还没有工作")
  expect(panel.textContent).not.toContain("还没有交付成果")
  const all = [...panel.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("查看全部工作"))!
  await settleWorkTest(() => all.click())
  expect(onSelectWork).toHaveBeenCalledExactlyOnceWith(null)
})

it("keeps stale submissions and archived Work out of current output navigation", async () => {
  const snapshot = ticketSnapshot()
  snapshot.views[0].ticket.archived = true
  const work = snapshot.views[1]
  work.ticket.current_submission = "stale-submission"
  work.submissions = [{ id: "stale-submission", work_id: work.ticket.id, generation: 1, contract_revision: 1,
    updated_seq: 5, stale: true, artifacts: [{ uri: "managed:result.rs", sha256: "a".repeat(64) }], evidence: ["private-path"] }]
  const { panel } = await open(snapshot)
  expect(panel.textContent).not.toContain("报告A")
  expect(panel.textContent).toContain("报告B")
  expect(panel.textContent).toContain("还没有交付成果")
  expect(panel.textContent).not.toContain("读取成果 1")
  expect(panel.textContent).not.toContain("private-path")
})
