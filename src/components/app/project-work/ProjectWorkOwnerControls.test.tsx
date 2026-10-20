import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ProjectWorkOwnerControls, type ProjectWorkOwnerControlsProps } from "./ProjectWorkOwnerControls"
import { commandContext, controlCopy as copy, ownerProps } from "./testFixtures"

let root: Root
const render = async (props: ProjectWorkOwnerControlsProps) => act(async () => root.render(<ProjectWorkOwnerControls {...props} />))
const button = (label: string) => [...document.querySelectorAll("button")].find((element) => element.textContent === label)!
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  document.body.replaceChildren()
  root = createRoot(document.body.appendChild(document.createElement("div")))
})
afterEach(() => act(() => root.unmount()))

it("guards duplicate and conflicting click/Enter delivery with the same semantic command identity", async () => {
  const props = ownerProps()
  await render(props)
  await act(async () => { button(copy.pause).click(); button(copy.pause).click(); button(copy.cancel).click() })
  expect(props.onRequestAction).toHaveBeenCalledExactlyOnceWith({ kind: "pause" }, props.commands.pause)
  expect(button(copy.pause).disabled).toBe(true)
  expect(button(copy.cancel).disabled).toBe(true)
})
it("never equates receipt/ACK with actual paused or terminal state", async () => {
  const props = ownerProps()
  props.work = { ...props.work, state: "active" }
  await render(props)
  await act(async () => button(copy.cancel).click())
  expect(document.querySelector('[data-testid="work-authoritative-state"]')?.textContent).toBe("Active")
  for (const phase of ["requested", "awaiting_ack", "acknowledged"] as const) {
    props.request = { phase, operationId: "operation-cancel" }
    await render(props)
    expect(document.querySelector('[data-testid="work-authoritative-state"]')?.textContent).toBe("Active")
    expect(button(copy.accept).disabled).toBe(true)
  }
  props.work = { ...props.work, state: "cancelled" }
  await render(props)
  expect(document.querySelector('[data-testid="work-authoritative-state"]')?.textContent).toBe("Cancelled")
  expect(document.body.textContent).not.toContain(copy.acceptedByUser)
})
it("reloads a pending request without another mutation and retains the operation identity", async () => {
  const props = ownerProps()
  props.request = { phase: "awaiting_ack", operationId: "saved-operation" }
  await render(props)
  act(() => root.unmount())
  root = createRoot(document.body.appendChild(document.createElement("div")))
  await render(props)
  expect(document.body.textContent).toContain("saved-operation")
  await act(async () => button(copy.pause).click())
  expect(props.onRequestAction).not.toHaveBeenCalled()
})
it("ignores an old Work receipt while a new Work command is in flight", async () => {
  const props = ownerProps()
  let resolveOld!: (value: { operationId: string }) => void
  let resolveNew!: (value: { operationId: string }) => void
  props.onRequestAction = vi.fn(() => new Promise<{ operationId: string }>((resolve) => { resolveOld = resolve }))
  await render(props)
  await act(async () => button(copy.pause).click())
  props.work = { ...props.work, id: "work-2", generation: 4 }
  props.commands = { pause: { ...commandContext("new-work-operation"), workId: "work-2", generation: 4 } }
  props.onRequestAction = vi.fn(() => new Promise<{ operationId: string }>((resolve) => { resolveNew = resolve }))
  await render(props)
  await act(async () => button(copy.pause).click())
  await act(async () => resolveOld({ operationId: "operation-pause" }))
  expect(document.body.textContent).toContain(copy.submitting)
  expect(props.onRequestAction).toHaveBeenCalledOnce()
  await act(async () => resolveNew({ operationId: "new-work-operation" }))
  expect(document.body.textContent).not.toContain(copy.submitting)
  expect(document.querySelector('[data-testid="work-authoritative-state"]')?.textContent).toBe("Submitted")
})
it("requires owner authorization, explicit capability and matching generation/revision", async () => {
  const props = ownerProps()
  props.owner = false
  await render(props)
  expect(button(copy.pause).disabled).toBe(true)
  props.owner = true
  props.capabilities.pause = { available: false, reason: "Runtime pause unsupported" }
  props.commands.resume = { ...props.commands.resume!, generation: 2 }
  props.commands.cancel = { ...props.commands.cancel!, recordRevision: 7 }
  await render(props)
  for (const label of [copy.pause, copy.resume, copy.cancel]) expect(button(label).disabled).toBe(true)
  expect(document.body.textContent).toContain("Runtime pause unsupported")
  await act(async () => button(copy.pause).click())
  expect(props.onRequestAction).not.toHaveBeenCalled()
})
it("does not enable acceptance from absent active_assignment: it requires the exact stop guard and stop confirmation", async () => {
  const props = ownerProps()
  for (const patch of [
    { stopGuardEnforced: false }, { processStopped: false }, { processStopped: null }, { stale: true },
    { generation: 2 }, { contractRevision: 4 }, { submissionId: "historical-submission" },
  ]) {
    props.acceptance = { ...ownerProps().acceptance!, ...patch }
    await render(props)
    expect(button(copy.accept).disabled).toBe(true)
    expect(document.querySelector('input[type="checkbox"]')?.hasAttribute("disabled")).toBe(true)
    expect(document.body.textContent).toContain(copy.completionGuard)
    await act(async () => button(copy.accept).click())
  }
  expect(props.onRequestAction).not.toHaveBeenCalled()
})
it("requires explicit User confirmation and preserves exact submission and unverified evidence", async () => {
  const props = ownerProps()
  props.acceptanceConfirmation = null
  await render(props)
  expect(button(copy.accept).disabled).toBe(true)
  await act(async () => (document.querySelector('input[type="checkbox"]') as HTMLInputElement).click())
  expect(props.onAcceptanceConfirmationChange).toHaveBeenCalledExactlyOnceWith({ submissionId: "submission-1", generation: 3, contractRevision: 5 })
  expect((document.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false)
  props.acceptanceConfirmation = ownerProps().acceptanceConfirmation
  await render(props)
  await act(async () => button(copy.accept).click())
  expect(props.onRequestAction).toHaveBeenCalledExactlyOnceWith({ kind: "accept", source: "user", submissionId: "submission-1",
    generation: 3, contractRevision: 5, unverifiedItems: ["Live backend integration has not been verified"] }, props.commands.accept)
  expect(document.body.textContent).toContain("Live backend integration has not been verified")
  expect(document.body.textContent).toContain("does not claim that automated tests passed")
  expect(document.querySelector('[data-testid="work-authoritative-state"]')?.textContent).toBe("Submitted")
})
it("does not reuse User confirmation for another submission or generation", async () => {
  const props = ownerProps()
  for (const patch of [{ submissionId: "old-submission" }, { generation: 2 }, { contractRevision: 4 }]) {
    props.acceptanceConfirmation = { ...ownerProps().acceptanceConfirmation!, ...patch }
    await render(props)
    expect(button(copy.accept).disabled).toBe(true)
    expect((document.querySelector('input[type="checkbox"]') as HTMLInputElement).checked).toBe(false)
    await act(async () => button(copy.accept).click())
  }
  expect(props.onRequestAction).not.toHaveBeenCalled()
})
it("marks an authoritative accepted record as User acceptance without rewriting evidence", async () => {
  const props = ownerProps()
  props.work.state = "accepted"
  props.acceptedByUser = true
  props.capabilities.accept = { available: false }
  await render(props)
  expect(document.body.textContent).toContain(copy.acceptedByUser)
  expect(document.body.textContent).toContain("Recorded source review")
  expect(document.body.textContent).toContain("Live backend integration has not been verified")
})
it.each(["conflict", "denied", "outcome_unknown", "failed"] as const)("keeps %s visible and only reconciles the same operation", async (phase) => {
  const props = ownerProps()
  props.request = { phase, operationId: "operation-cancel" }
  await render(props)
  await act(async () => { button(copy.reload).click(); button(copy.reconcile).click(); button(copy.cancel).click() })
  expect(props.onReload).toHaveBeenCalledOnce()
  expect(props.onReconcile).toHaveBeenCalledExactlyOnceWith("operation-cancel")
  expect(props.onRequestAction).not.toHaveBeenCalled()
})
it("keeps transport uncertainty latched, then accepts only a newly authorized context after reload", async () => {
  const props = ownerProps()
  props.onRequestAction = vi.fn().mockRejectedValue(new Error("lost ACK"))
  await render(props)
  await act(async () => button(copy.pause).click())
  expect(document.body.textContent).toContain(copy.outcomeUnknown)
  await act(async () => { button(copy.reconcile).click(); button(copy.resume).click() })
  expect(props.onReconcile).toHaveBeenCalledExactlyOnceWith("operation-pause")
  expect(props.onRequestAction).toHaveBeenCalledOnce()
  props.work = { ...props.work, id: "work-2", generation: 4, recordRevision: 9 }
  props.commands = { pause: { ...commandContext("new-authorized-operation"), workId: "work-2", generation: 4, recordRevision: 9 } }
  props.onRequestAction = vi.fn(async (_intent, context) => ({ operationId: context.operationId }))
  await render(props)
  expect(button(copy.pause).disabled).toBe(false)
  await act(async () => button(copy.pause).click())
  expect(props.onRequestAction).toHaveBeenCalledOnce()
})
