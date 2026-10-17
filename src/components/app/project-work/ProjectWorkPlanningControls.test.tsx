import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { ProjectWorkPlanningControls, type ProjectWorkPlanningControlsProps } from "./ProjectWorkPlanningControls"
import { controlCopy as copy, planningProps } from "./testFixtures"

let root: Root
const render = async (props: ProjectWorkPlanningControlsProps) => act(async () => root.render(<ProjectWorkPlanningControls {...props} />))
const button = (label: string) => [...document.querySelectorAll("button")].find((element) => element.textContent === label)!
const submit = () => document.querySelector("form")!.dispatchEvent(new Event("submit", { bubbles: true, cancelable: true }))
beforeEach(() => {
  ;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true
  document.body.replaceChildren()
  root = createRoot(document.body.appendChild(document.createElement("div")))
})
afterEach(() => act(() => root.unmount()))

it("emits the offset-preserving value and authoritative CAS once, without changing saved planning", async () => {
  const props = planningProps()
  await render(props)
  await act(async () => { submit(); submit() })
  expect(props.onSavePlanning).toHaveBeenCalledExactlyOnceWith({ priority: "high", expectedCompletionAt: "2026-10-19T09:15:00-07:00" }, props.command)
  expect(document.querySelector(`[aria-label="${copy.currentPlanning}"]`)?.textContent).toContain("2026-10-18T00:00:00+08:00")
  expect(button(copy.savePlanning).disabled).toBe(true)
  expect(document.body.textContent).toContain("not a model ETA")
})
it("keeps the draft controlled, clears to a draft blank and only saves explicit null", async () => {
  const props = planningProps()
  await render(props)
  await act(async () => button(copy.clearDeadline).click())
  expect(props.onDraftChange).toHaveBeenCalledExactlyOnceWith({ priority: "high", expectedCompletionAt: "" })
  expect(document.querySelector("input")?.value).toBe(props.draft.expectedCompletionAt)
  props.draft = { priority: "low", expectedCompletionAt: "" }
  await render(props)
  await act(async () => submit())
  expect(props.onSavePlanning).toHaveBeenCalledExactlyOnceWith({ priority: "low", expectedCompletionAt: null }, props.command)
})
it("blocks missing offsets and invalid calendar dates with an accessible error", async () => {
  const props = planningProps()
  for (const invalid of ["2026-10-18T09:00:00", "2026-02-31T09:00:00Z"]) {
    props.draft = { priority: "critical", expectedCompletionAt: invalid }
    await render(props)
    expect(document.querySelector("input")?.getAttribute("aria-invalid")).toBe("true")
    expect(document.querySelector('[role="alert"]')?.textContent).toBe(copy.invalidDeadline)
    expect(button(copy.savePlanning).disabled).toBe(true)
    await act(async () => submit())
  }
  expect(props.onSavePlanning).not.toHaveBeenCalled()
})
it("never creates writable planning for a non-owner, absent capability or stale generation", async () => {
  for (const change of [
    { owner: false }, { editCapability: { available: false as const, reason: "Planning unavailable" } },
    { current: null }, { command: null }, { work: { ...planningProps().work, generation: 4 } },
  ]) {
    const props = { ...planningProps(), ...change }
    await render(props)
    expect(button(copy.savePlanning).disabled).toBe(true)
    await act(async () => submit())
    expect(props.onSavePlanning).not.toHaveBeenCalled()
  }
})
it("sends only a semantic server query, preserving fixed as_of even on a partial view", async () => {
  const props = planningProps()
  await render(props)
  const selects = document.querySelectorAll("select")
  await act(async () => { selects[1].value = "priority"; selects[1].dispatchEvent(new Event("change", { bubbles: true })) })
  expect(props.onQueryChange).toHaveBeenCalledExactlyOnceWith({ ...props.query, order: "priority" })
  expect(props.onSavePlanning).not.toHaveBeenCalled()
  expect(selects[1].value).toBe("updated")
  expect(document.body.textContent).toContain("never sorted locally")
  expect(document.querySelector("[data-deadline-status]")?.getAttribute("data-deadline-status")).toBe("overdue")
})
it("disables overdue filtering for an absent snapshot time and preserves unknown vs unset", async () => {
  const props = planningProps()
  props.query = { ...props.query, asOf: null }
  await render(props)
  expect(document.querySelector('option[value="overdue"]')?.hasAttribute("disabled")).toBe(true)
  expect(document.querySelector("[data-deadline-status]")?.getAttribute("data-deadline-status")).toBe("as_of_unknown")
  props.current = { priority: "medium", expectedCompletionAt: null }
  await render(props)
  expect(document.querySelector("[data-deadline-status]")?.getAttribute("data-deadline-status")).toBe("unset")
  props.current = { priority: "medium", expectedCompletionAt: "" }
  await render(props)
  expect(document.querySelector("[data-deadline-status]")?.getAttribute("data-deadline-status")).toBe("invalid")
  expect(document.querySelector(`[aria-label="${copy.currentPlanning}"]`)?.textContent).not.toContain(copy.deadlineUnset)
  props.current = null
  props.queryCapability = { available: false, reason: "Server snapshot filters unsupported" }
  await render(props)
  expect(document.querySelector("[data-deadline-status]")?.getAttribute("data-deadline-status")).toBe("unknown")
  expect(document.body.textContent).toContain("Server snapshot filters unsupported")
})
it("keeps conflicts and uncertain receipt identity visible with read-only reconciliation", async () => {
  const props = planningProps()
  props.request = { phase: "conflict", operationId: "old-operation" }
  await render(props)
  expect(document.querySelector("input")?.value).toBe(props.draft.expectedCompletionAt)
  await act(async () => { button(copy.reload).click(); button(copy.reconcile).click(); submit() })
  expect(props.onReload).toHaveBeenCalledOnce()
  expect(props.onReconcile).toHaveBeenCalledExactlyOnceWith("old-operation")
  expect(props.onSavePlanning).not.toHaveBeenCalled()
  props.request = { phase: "idle" }
  props.onSavePlanning = vi.fn().mockRejectedValue(new Error("connection lost after write"))
  await render(props)
  await act(async () => submit())
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(copy.outcomeUnknown)
  await act(async () => { button(copy.reconcile).click(); submit() })
  expect(props.onReconcile).toHaveBeenLastCalledWith(props.command!.operationId)
  expect(props.onSavePlanning).toHaveBeenCalledOnce()
})
it("treats a mismatched receipt as uncertain instead of replaying the write", async () => {
  const props = planningProps()
  props.onSavePlanning = vi.fn().mockResolvedValue({ operationId: "wrong-operation" })
  await render(props)
  await act(async () => { submit(); submit() })
  expect(props.onSavePlanning).toHaveBeenCalledOnce()
  expect(document.body.textContent).toContain(copy.outcomeUnknown)
})
