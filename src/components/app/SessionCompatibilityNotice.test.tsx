import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/ui"
import type { SessionExecutionCompatibilityView } from "@/hooks/useSessionExecutionCompatibility"
import { SessionCompatibilityNotice } from "./SessionCompatibilityNotice"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const roots: Root[] = []
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren() })
const state = (status?: "compatible" | "legacy_compatible" | "conflict"): SessionExecutionCompatibilityView => ({
  report: status ? { session_version: status === "legacy_compatible" ? null : 99, current_session_version: 1, status,
    history_readable: true, execution_allowed: status !== "conflict", conflicts: status === "conflict"
      ? [{ code: "unsupported_session_version", message: "Original service diagnostic" }] : [] } : null,
  blocked: status === "conflict", observed: true, legacy: !status, readError: false, loading: false, refresh: vi.fn(async () => {}),
})
async function mount(value?: SessionExecutionCompatibilityView, sessionId?: string) {
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  await act(async () => root.render(<SessionCompatibilityNotice state={value} sessionId={sessionId} />))
  return root
}
it.each(["compatible", undefined] as const)("omits the entire %s panel and its actions", async (status) => {
  const value = state(status); await mount(value, "synthetic-session")
  expect(document.querySelector("section")).toBeNull()
  expect(document.querySelector("button")).toBeNull()
  expect(document.body.textContent).toBe("")
  expect(value.refresh).not.toHaveBeenCalled()
})
it("retains an observed legacy migration requirement", async () => {
  const value = state("legacy_compatible"); await mount(value)
  expect(document.querySelector('[role="alert"]')).toBeNull()
  expect(document.querySelector('[data-session-execution-blocked="false"]')).not.toBeNull()
  expect(document.body.textContent).toContain(uiText("session_compatibility_legacy_compatible"))
  expect(value.refresh).not.toHaveBeenCalled()
})
it("keeps unknown, compatible and compatible-refresh transitions free of a normal banner", async () => {
  const loading = { ...state(), observed: false, loading: true }
  const root = await mount(loading, "synthetic-session")
  expect(document.body.textContent).toBe("")
  for (const value of [state("compatible"), { ...state("compatible"), loading: true }, state("compatible")]) {
    await act(async () => root.render(<SessionCompatibilityNotice state={value} sessionId="synthetic-session" />))
    expect(document.querySelector("section")).toBeNull()
    expect(document.querySelector("button")).toBeNull()
    expect(document.body.textContent).toBe("")
  }
})
it("shows a read failure without presenting the stale compatible report as success", async () => {
  await mount({ ...state("compatible"), readError: true })
  expect(document.body.textContent).toContain(uiText("session_compatibility_read_error"))
  expect(document.body.textContent).not.toContain(uiText("session_compatibility_compatible"))
  expect(document.querySelector("button")).not.toBeNull()
})
it("shows explicit conflict, readable-history recovery and original escaped diagnostic", async () => {
  const value = state("conflict"); value.report!.conflicts = [{ code: "unsupported_session_version", message: "<script>not executable</script>" }]
  await mount(value)
  expect(document.querySelector('[role="alert"]')?.textContent).toContain(uiText("session_compatibility_execution_blocked"))
  expect(document.body.textContent).toContain(uiText("session_compatibility_recovery"))
  expect(document.querySelector("script")).toBeNull()
  expect(document.body.textContent).toContain("<script>not executable</script>")
  const button = document.querySelector("button")!
  await act(async () => button.click()); expect(value.refresh).toHaveBeenCalledTimes(1)
})
it("keeps read errors distinct and a confirmed conflict visible while a refresh is pending", async () => {
  const value = { ...state("conflict"), loading: true, readError: true }; await mount(value)
  expect(document.querySelector('[role="alert"]')).not.toBeNull()
  expect(document.body.textContent).toContain(uiText("session_compatibility_read_error"))
  expect(document.querySelector("button")?.disabled).toBe(true)
})
it("renders no compatibility UI for a new session without an observation", async () => {
  await mount(); expect(document.body.textContent).toBe("")
})
