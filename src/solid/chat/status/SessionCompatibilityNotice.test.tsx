import { render } from "@solidjs/web"
import { createSignal, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/text"
import { SessionCompatibilityNotice } from "./SessionCompatibilityNotice"

type NoticeState = Parameters<typeof SessionCompatibilityNotice>[0]["state"]
const cleanups: Array<() => void> = []
afterEach(() => { for (const dispose of cleanups.splice(0)) dispose() })

const state = (status?: "compatible" | "legacy_compatible" | "conflict"): NoticeState => ({
  report: status ? { session_version: status === "legacy_compatible" ? null : 99, current_session_version: 1, status,
    history_readable: true, execution_allowed: status !== "conflict", conflicts: status === "conflict"
      ? [{ code: "unsupported_session_version", message: "Original service diagnostic" }] : [] } : null,
  blocked: status === "conflict", observed: true, legacy: !status, readError: false, loading: false, refresh: vi.fn(async () => {}),
})
function mount(value: NoticeState = { ...state(), observed: false }) {
  const host = document.body.appendChild(document.createElement("div"))
  const [current, setCurrent] = createSignal(value)
  const dispose = render(() => <SessionCompatibilityNotice state={current()} />, host)
  cleanups.push(() => { dispose(); host.remove() })
  flush()
  return (next: NoticeState) => { setCurrent(next); flush() }
}
it.each(["compatible", undefined] as const)("omits the entire %s panel and its actions", (status) => {
  const value = state(status); mount(value)
  expect(document.querySelector("section")).toBeNull()
  expect(document.querySelector("button")).toBeNull()
  expect(document.body.textContent).toBe("")
  expect(value.refresh).not.toHaveBeenCalled()
})
it("retains an observed legacy migration requirement", () => {
  const value = state("legacy_compatible"); mount(value)
  expect(document.querySelector('[role="alert"]')).toBeNull()
  expect(document.querySelector('[data-session-execution-blocked="false"]')).not.toBeNull()
  expect(document.body.textContent).toContain(uiText("session_compatibility_legacy_compatible"))
  expect(value.refresh).not.toHaveBeenCalled()
})
it("keeps unknown, compatible and compatible-refresh transitions free of a normal banner", () => {
  const loading = { ...state(), observed: false, loading: true }
  const update = mount(loading)
  expect(document.body.textContent).toBe("")
  for (const value of [state("compatible"), { ...state("compatible"), loading: true }, state("compatible")]) {
    update(value)
    expect(document.querySelector("section")).toBeNull()
    expect(document.querySelector("button")).toBeNull()
    expect(document.body.textContent).toBe("")
  }
})
it("shows a read failure without presenting the stale compatible report as success", () => {
  mount({ ...state("compatible"), readError: true })
  expect(document.body.textContent).toContain(uiText("session_compatibility_read_error"))
  expect(document.body.textContent).not.toContain(uiText("session_compatibility_compatible"))
  expect(document.querySelector("button")).not.toBeNull()
})
it("shows explicit conflict, readable-history recovery and original escaped diagnostic", () => {
  const value = state("conflict"); value.report!.conflicts = [{ code: "unsupported_session_version", message: "<script>not executable</script>" }]
  mount(value)
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(uiText("session_compatibility_execution_blocked"))
  expect(document.body.textContent).toContain(uiText("session_compatibility_recovery"))
  expect(document.querySelector("script")).toBeNull()
  expect(document.body.textContent).toContain("<script>not executable</script>")
  const button = document.querySelector("button")!
  button.click()
  expect(value.refresh).toHaveBeenCalledTimes(1)
})
it("keeps read errors distinct and a confirmed conflict visible while a refresh is pending", () => {
  const value = { ...state("conflict"), loading: true, readError: true }; mount(value)
  expect(document.querySelector('[role="alert"]')).not.toBeNull()
  expect(document.body.textContent).toContain(uiText("session_compatibility_read_error"))
  expect(document.querySelector("button")?.disabled).toBe(true)
})
it("renders no compatibility UI for a new session without an observation", () => {
  mount(); expect(document.body.textContent).toBe("")
})
