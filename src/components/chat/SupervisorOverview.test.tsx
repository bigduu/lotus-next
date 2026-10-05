import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { SupervisorOverview } from "./SupervisorOverview"
import { ticketSnapshot } from "@services/tickets/testFixtures"
import { applyTicketSnapshot } from "@services/tickets/state"
import type { TicketSnapshot } from "@services/tickets/types"

let root: Root
beforeEach(() => { Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true }); root = createRoot(document.body.appendChild(document.createElement("div"))) })
afterEach(() => { act(() => root.unmount()); document.body.replaceChildren() })

async function open(snapshot: TicketSnapshot, connected = true) {
  const onSelectWork = vi.fn()
  await act(async () => root.render(<SupervisorOverview running={false} onSelectWork={onSelectWork} controller={{
    state: applyTicketSnapshot(null, snapshot), connected, negotiated: true, error: null, busy: {}, uncertain: {},
    respond: async () => false, refresh: async () => {}, canRespond: false, canSendIngress: false,
  }} />))
  await act(async () => document.querySelector<HTMLButtonElement>('[data-testid="ticket-work-status"]')!.click())
  return { panel: document.querySelector<HTMLElement>('[data-testid="supervisor-overview"]')!, onSelectWork }
}

it.each([true, false])("does not claim absence from an unloaded nonempty scope, connected=%s", async (connected) => {
  const snapshot = ticketSnapshot(); snapshot.complete = false; snapshot.views = []
  const { panel, onSelectWork } = await open(snapshot, connected)
  expect(panel.textContent).toContain("5 项工作")
  expect(panel.textContent).toContain("详细信息待更新")
  expect(panel.textContent).not.toContain("还没有工作")
  expect(panel.textContent).not.toContain("还没有交付成果")
  const all = [...panel.querySelectorAll<HTMLButtonElement>("button")].find((button) => button.textContent?.includes("查看全部工作"))!
  act(() => all.click())
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
