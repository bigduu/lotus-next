import { expect, it } from "vitest"
import { applyTicketSnapshot, effectiveStatus, responseCommand } from "./state"
import type { PendingRequest } from "./types"
import { ticketSnapshot as snapshot } from "./testFixtures"


it("answers E/B/D/A/C by exact immutable identity and preserves every unanswered request", () => {
  let state = applyTicketSnapshot(null, snapshot())
  for (const [index, id] of ["E", "B", "D", "A", "C"].entries()) {
    const q = state.requests["q-" + id]
    const command = responseCommand(state, q, { kind: "question", answer: "answer-" + id }, "op-" + id)
    expect(command.target).toEqual({ request_id: q.id, work_id: id, assignment_id: "assignment-" + id, generation: 1, contract_revision: 1, prompt_revision: 1 })
    const next = snapshot(11 + index)
    for (const view of next.views) {
      const old = state.requests[view.requests[0].id]
      if (old.status !== "open") view.requests[0] = old
      if (view.ticket.id === id) view.requests[0] = { ...q, status: "answered", answer: command.decision.kind === "question" ? command.decision.answer : null, updated_seq: 11 + index }
    }
    state = applyTicketSnapshot(state, next)
    expect(Object.values(state.requests).filter((r) => effectiveStatus(state, r) === "open")).toHaveLength(4 - index)
    expect(() => responseCommand(state, q, { kind: "question", answer: "old" }, "old")).toThrow()
  }
  for (const id of ["A", "B", "C", "D", "E"]) expect(state.requests["q-" + id].answer).toBe("answer-" + id)
})

it("rejects late/repeated snapshots, conflicting same-seq hashes and revival of terminal requests", () => {
  const first = snapshot()
  first.views[0].requests[0].status = "answered"
  let state = applyTicketSnapshot(null, first)
  expect(applyTicketSnapshot(state, snapshot(9))).toBe(state)
  const conflict = snapshot(); conflict.snapshot.commit = "another"
  expect(() => applyTicketSnapshot(state, conflict)).toThrow()
  const late = snapshot(12)
  late.views[0].requests[0].updated_seq = 12
  state = applyTicketSnapshot(state, late)
  expect(state.requests["q-A"].status).toBe("answered")
  expect(applyTicketSnapshot(state, late).requests["q-A"].status).toBe("answered")
})

it("retains partial coverage and marks prior-generation, changed-contract and cancelled cards superseded", () => {
  const state = applyTicketSnapshot(null, snapshot())
  const partial = snapshot(11); partial.complete = false; partial.views = [partial.views[0]]
  let next = applyTicketSnapshot(state, partial)
  expect(Object.keys(next.works)).toHaveLength(5)
  for (const change of ["generation", "contract_revision", "cancelled"] as const) {
    const changed = snapshot(12)
    if (change === "cancelled") changed.views[0].ticket.state = "cancelled"
    else changed.views[0].ticket[change] = 2
    next = applyTicketSnapshot(state, changed)
    expect(effectiveStatus(next, state.requests["q-A"])).toBe("superseded")
    expect(() => responseCommand(next, state.requests["q-A"], { kind: "question", answer: "old" }, "old")).toThrow()
  }
})

it("negotiates new scopes without old tombstones and binds approval A without granting B", () => {
  const source = snapshot()
  const approval: PendingRequest["kind"] = { kind: "approval", fingerprint: "a".repeat(64), action: { kind: "payment", target: "A", data_hash: "b".repeat(64), amount: "100 CNY", permissions: [], risk: "测试" } }
  source.views[0].requests[0].kind = approval
  const state = applyTicketSnapshot(null, source)
  const command = responseCommand(state, state.requests["q-A"], { kind: "approval", fingerprint: approval.fingerprint, approve: true }, "approve-A")
  expect(command.target.request_id).toBe("q-A")
  expect(state.requests["q-B"].status).toBe("open")
  expect(() => responseCommand(state, state.requests["q-A"], { kind: "approval", fingerprint: "wrong", approve: true }, "wrong")).toThrow()
  const migrated = snapshot(1); migrated.scope.binding.scope_id = "new-scope"; migrated.views = []
  expect(applyTicketSnapshot(state, migrated).requests).toEqual({})
})

it.each([1, 10])("accepts higher authority epochs at sequence %s without old-epoch record fences", (seq) => {
  const old = snapshot(10)
  old.views[0].requests[0].status = "answered"
  const state = applyTicketSnapshot(null, old)
  const newer = snapshot(seq); newer.snapshot.authority_epoch = 2
  newer.views = [newer.views[0]]
  const next = applyTicketSnapshot(state, newer)
  expect(next.current.snapshot).toEqual(newer.snapshot)
  expect(next.requests["q-A"].status).toBe("open")
  expect(next.requests["q-B"]).toBeUndefined()
  expect(responseCommand(next, next.requests["q-A"], { kind: "question", answer: "new" }, "new").expected_epoch).toBe(2)
  expect(applyTicketSnapshot(next, snapshot(100))).toBe(next)
})
