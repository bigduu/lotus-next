import { beforeEach, expect, it } from "vitest"
import { readDecisionReceipts, saveDecisionReceipt } from "./decisionReceipts"
import { applyTicketSnapshot, responseCommand } from "./state"
import { ticketSnapshot } from "./testFixtures"

beforeEach(() => sessionStorage.clear())
const command = () => {
  const state = applyTicketSnapshot(null, ticketSnapshot())
  return responseCommand(state, state.requests["q-A"], { kind: "question", answer: "answer" }, "operation-A")
}
it("recovers complete question and approval commands unchanged", () => {
  const value = command(); saveDecisionReceipt("root", value)
  expect(readDecisionReceipts("root")["q-A"]).toEqual(value)
  value.decision = { kind: "approval", fingerprint: "a".repeat(64), approve: false }
  saveDecisionReceipt("root", value)
  expect(readDecisionReceipts("root")["q-A"]).toEqual(value)
})
it.each([
  ["operation_id", 1], ["binding.scope_id", null], ["binding.binding_revision", 0],
  ["binding.binding_revision", 1.5], ["target.work_id", null], ["target.assignment_id", undefined],
  ["target.generation", 0], ["target.contract_revision", -1], ["target.prompt_revision", Number.MAX_SAFE_INTEGER + 1],
  ["expected_seq", -1], ["expected_epoch", 0], ["decision.answer", null], ["decision.answer", " "],
])("rejects incomplete or invalid question fence %s=%s", (field, value) => {
  const source = command()
  const parts = String(field).split(".")
  const target = parts.length === 2 ? (source as unknown as Record<string, Record<string, unknown>>)[parts[0]] : source as unknown as Record<string, unknown>
  target[parts.at(-1)!] = value
  const key = "lotus-next.ticket-decision.root.q-A"
  sessionStorage.setItem(key, JSON.stringify(source))
  expect(() => readDecisionReceipts("root")).toThrow("请求回执无法核对")
  expect(sessionStorage.getItem(key)).not.toBeNull()
})
it.each([{ kind: "approval", approve: true }, { kind: "approval", fingerprint: "a", approve: "true" }])("rejects incomplete approval payloads: %j", (decision) => {
  sessionStorage.setItem("lotus-next.ticket-decision.root.q-A", JSON.stringify({ ...command(), decision }))
  expect(() => readDecisionReceipts("root")).toThrow("请求回执无法核对")
})
