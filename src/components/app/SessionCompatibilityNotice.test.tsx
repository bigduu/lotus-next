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
async function mount(value?: SessionExecutionCompatibilityView) {
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  await act(async () => root.render(<SessionCompatibilityNotice state={value} />))
}
it.each(["compatible", "legacy_compatible", undefined] as const)("presents %s without an unsupported alert or continuation write", async (status) => {
  const value = state(status); await mount(value)
  expect(document.querySelector('[role="alert"]')).toBeNull()
  expect(document.querySelector('[data-session-execution-blocked="false"]')).not.toBeNull()
  expect(document.body.textContent).toContain(uiText(status === "compatible" ? "session_compatibility_compatible"
    : status === "legacy_compatible" ? "session_compatibility_legacy_compatible" : "session_compatibility_legacy_unassessed"))
  expect(value.refresh).not.toHaveBeenCalled()
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
