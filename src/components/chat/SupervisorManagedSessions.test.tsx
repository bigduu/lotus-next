import { act, useState } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { ApiError } from "@services/api"
import { uiText } from "@shared/i18n/ui"
import type { ManagedSessionsResponse } from "@services/supervisorScope/managedSessions"
import type { ManagedSessionsDependencies } from "@/hooks/useSupervisorManagedSessions"
import { SupervisorManagedSessionsDialog, SupervisorManagedSessionsPanel } from "./SupervisorManagedSessions"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const roots: Root[] = []
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren() })
const fixture = (): ManagedSessionsResponse => ({ capabilities: { managed_sessions_http_v1: true }, scope: { supervisor: { session_id: "bamboo-default-supervisor", incarnation_id: "11111111-1111-4111-8111-111111111111" }, state_revision: 4, allowed_projects: ["p1"] },
  sessions: [
    { session_id: "a", link_revision: 1, enabled: true, authorized: true, target_created_at: "2026-10-25T00:00:00Z", target_project_id: "p1", target_metadata_version: 0 },
    { session_id: "stale", link_revision: 2, enabled: true, authorized: false, target_created_at: "2026-10-25T00:00:00Z", target_project_id: "p1", target_metadata_version: 0 },
    { session_id: "detached", link_revision: 3, enabled: false, authorized: false, target_created_at: "2026-10-25T00:00:00Z", target_project_id: "p1", target_metadata_version: 0 },
  ], owner_authorization: { available: true, required: true, kind: "existing_access", http_registration: false, code: null } })
const button = (key: Parameters<typeof uiText>[0], scope: ParentNode = document) => [...scope.querySelectorAll<HTMLButtonElement>("button")].find((element) => element.textContent === uiText(key))!
async function mount(options: { canonical?: ManagedSessionsResponse; panel?: boolean; unavailable?: boolean } = {}) {
  const canonical = options.canonical ?? fixture(), close = vi.fn(), select = vi.fn()
  const dependencies: ManagedSessionsDependencies = { read: vi.fn(async () => { if (options.unavailable) throw new ApiError("old", 404, ""); return canonical }),
    candidates: vi.fn(async () => ({ sessions: ["a", "stale", "detached", "new"].map((id) => ({ session_id: id, title: `Target ${id}`, project_id: "p1", model: "independent-model", is_running: false })), nextOffset: null })),
    update: vi.fn(async () => { throw new Error("lost response") }) }
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  function Probe() {
    const [open, setOpen] = useState(true)
    return options.panel ? <SupervisorManagedSessionsPanel active onSelectSession={select} dependencies={dependencies} /> : <SupervisorManagedSessionsDialog open={open} onOpenChange={(next) => { setOpen(next); close(next) }} dependencies={dependencies} />
  }
  await act(async () => root.render(<Probe />))
  return { dependencies, close, select }
}
it("distinguishes canonical authorized, stale and detached rows with explicit review before any write", async () => {
  const h = await mount()
  expect(document.body.textContent).toContain(uiText("supervisor_sessions_authorized"))
  expect(document.body.textContent).toContain(uiText("supervisor_sessions_reconfirm"))
  expect(document.body.textContent).toContain(uiText("supervisor_sessions_detached"))
  expect(document.body.textContent).toContain("independent-model")
  const row = document.querySelector('[data-managed-session="stale"]')!
  act(() => button("supervisor_sessions_reconfirm_action", row).click())
  expect(document.querySelector('[data-testid="managed-session-review"]')?.textContent).toContain("Target stale")
  expect(h.dependencies.update).not.toHaveBeenCalled()
  act(() => button("cancel_2cd0f3be").click())
  expect(document.querySelector('[data-testid="managed-session-review"]')).toBeNull()
  expect(h.dependencies.update).not.toHaveBeenCalled()
})
it("shows unavailable target authority without an enabled add action, retaining detach", async () => {
  const canonical = fixture()
  const h = await mount({ canonical: { ...canonical, sessions: [{ ...canonical.sessions[0]!, authorized: false, authorization_error: "target_authority_unavailable" }] } })
  const row = document.querySelector('[data-managed-session="a"]')!
  expect(row.textContent).toContain(uiText("supervisor_sessions_unverified"))
  expect(button("supervisor_sessions_attach", row).disabled).toBe(true)
  expect(button("supervisor_sessions_detach", row).disabled).toBe(false)
  act(() => button("supervisor_sessions_detach", row).click())
  expect(h.dependencies.update).not.toHaveBeenCalled()
})
it("keeps a lost mutation outcome unconfirmed and refreshes without replaying", async () => {
  const h = await mount(), row = document.querySelector('[data-managed-session="new"]')!
  act(() => button("supervisor_sessions_attach", row).click())
  await act(async () => button("supervisor_sessions_confirm").click())
  expect(document.body.textContent).toContain(uiText("supervisor_sessions_unknown"))
  expect(document.body.textContent).not.toContain(uiText("supervisor_sessions_saved"))
  await act(async () => button("supervisor_scope_refresh").click())
  expect(h.dependencies.update).toHaveBeenCalledTimes(1)
})
it("keeps old backend management unsupported without inventing an empty authorized list", async () => {
  const h = await mount({ unavailable: true })
  expect(document.body.textContent).toContain(uiText("supervisor_sessions_unsupported"))
  expect(document.body.textContent).not.toContain(uiText("supervisor_sessions_empty"))
  expect(document.querySelectorAll('[data-managed-session]')).toHaveLength(0)
  expect(h.dependencies.update).not.toHaveBeenCalled()
})
it("makes managed independent sessions the panel contents and opens the selected target", async () => {
  const h = await mount({ panel: true })
  const panel = document.querySelector('[data-testid="supervisor-managed-panel"]')!
  expect(panel.textContent).toContain("Target a"); expect(panel.textContent).not.toContain("Target new")
  await act(async () => button("supervisor_sessions_open", panel.querySelector('[data-managed-session="a"]')!).click())
  expect(h.select).toHaveBeenCalledExactlyOnceWith("a"); expect(h.dependencies.update).not.toHaveBeenCalled()
})
