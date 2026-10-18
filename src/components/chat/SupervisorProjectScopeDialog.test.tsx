import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { uiText } from "@shared/i18n/ui"
import { nativeAvailabilityFixture, nativeCancellationFixture, scopeFixture } from "@services/supervisorScope/testFixtures"
import { nativeConfirmationUnavailableCodes, unavailableProjectScopeOwnerBridge, type ProjectScopeOwnerOutcome } from "@services/supervisorScope/ownerBridge"
import type { ProjectScopeDependencies } from "@/hooks/useSupervisorProjectScope"
import type { ProjectScopeIntent } from "@services/supervisorScope/types"
import { SupervisorProjectScopeDialog } from "./SupervisorProjectScopeDialog"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const roots: Root[] = []
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren() })
const button = (key: Parameters<typeof uiText>[0]) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === uiText(key))!
async function mount(blocked = false, missingProject = false) {
  let scope = { ...scopeFixture(), owner_authorization: { ...scopeFixture().owner_authorization, available: false } }
  const apply = vi.fn<(intent: ProjectScopeIntent) => Promise<ProjectScopeOwnerOutcome>>().mockResolvedValue(nativeCancellationFixture())
  const dependencies: ProjectScopeDependencies = {
    read: vi.fn(async () => structuredClone(scope)),
    projects: async () => missingProject ? [{ id: "p2", name: "Two", status: "active" }] : [{ id: "p1", name: "One", status: "active" }, { id: "p2", name: "Two", status: "active" }],
    bridge: blocked ? unavailableProjectScopeOwnerBridge : { inspectAvailability: async () => nativeAvailabilityFixture(), confirmAndApply: apply },
  }
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  await act(async () => root.render(<SupervisorProjectScopeDialog open onOpenChange={vi.fn()} dependencies={dependencies} />))
  const dialog = document.querySelector('[role="dialog"]')!
  return { dialog, apply, dependencies, setScope(value: typeof scope) { scope = value },
    check(id: string) { const label = [...dialog.querySelectorAll("label")].find((el) => el.querySelector("code")?.textContent === id)!; act(() => label.querySelector<HTMLInputElement>("input")!.click()) },
    preview() { act(() => button("supervisor_scope_preview").click()) },
    async confirm() { await act(async () => button("supervisor_scope_native_confirm").click()) } }
}
it("shows precise native blocking while allowing a full-set preview with no writes", async () => {
  const h = await mount(true)
  expect(h.dialog.textContent).toContain(uiText("supervisor_scope_bridge_unavailable"))
  h.check("p2"); h.preview()
  expect([...h.dialog.querySelectorAll('[data-testid="project-scope-review"] code')].map((c) => c.textContent)).toEqual(["p1", "p2"])
  expect(h.dialog.textContent).toContain(uiText("supervisor_scope_native_review"))
  expect(button("supervisor_scope_native_confirm").disabled).toBe(true)
  await h.confirm(); expect(h.apply).not.toHaveBeenCalled()
})
it("keeps unknown current IDs visible and blocks confirmation until explicitly removed", async () => {
  const h = await mount(false, true)
  const selected = h.dialog.querySelector<HTMLInputElement>("input:checked")!
  expect(selected.closest("label")?.textContent).toContain("p1")
  h.preview(); expect(h.dialog.textContent).toContain(uiText("supervisor_scope_invalid_selection"))
  expect(button("supervisor_scope_native_confirm").disabled).toBe(true)
  act(() => button("supervisor_scope_edit").click()); h.check("p1"); h.check("p2"); h.preview()
  expect([...h.dialog.querySelectorAll('[data-testid="project-scope-review"] code')].map((c) => c.textContent)).toEqual(["p2"])
  expect(h.dialog.textContent).toContain(uiText("supervisor_scope_removal_effect"))
  expect(h.apply).not.toHaveBeenCalled()
})
it.each([
  [nativeCancellationFixture(), "supervisor_scope_cancelled"],
  [nativeCancellationFixture("native_confirmation_window_closed"), "supervisor_scope_cancelled_closed"],
  [nativeCancellationFixture("native_confirmation_timed_out"), "supervisor_scope_cancelled_timeout"],
  [{ kind: "rejected", status: 403, code: "host_owner_authorization_required" }, "supervisor_scope_rejected"],
  [{ kind: "rejected", status: 409, code: "scope_revision_conflict" }, "supervisor_scope_conflict"],
  [{ kind: "rejected", status: 503, code: "host_owner_authorization_unavailable" }, "supervisor_scope_unavailable"],
  [{ kind: "rejected", status: 503, code: "scope_authority_invalid" }, "supervisor_scope_authority_invalid"],
  [{ kind: "unknown" }, "supervisor_scope_unknown"],
] as const)("renders mock outcome %j without retry or false success", async (outcome, key) => {
  const h = await mount(); h.apply.mockResolvedValue(outcome); h.preview(); await h.confirm()
  expect(h.dialog.textContent).toContain(uiText(key)); expect(h.apply).toHaveBeenCalledTimes(1)
  expect(h.dialog.textContent).not.toContain(uiText("supervisor_scope_saved"))
  expect(h.dialog.querySelector('[data-testid="project-scope-review"]')).toBeNull()
})
it("shows a saved set only after a matching receipt and canonical read", async () => {
  const h = await mount(); h.check("p1"); h.check("p2"); h.preview()
  h.apply.mockImplementation(async (intent) => {
    h.setScope({ ...scopeFixture(), scope: { ...scopeFixture().scope, state_revision: 1, allowed_projects: ["p2"] } })
    return { kind: "applied", receipt: { supervisor: intent.supervisor, state_revision: 1, changed: true, link_revision: null } }
  })
  await h.confirm(); expect(h.dialog.textContent).toContain(uiText("supervisor_scope_saved"))
  expect(h.dependencies.read).toHaveBeenCalledTimes(2); expect(h.apply).toHaveBeenCalledTimes(1)
})

it("enables only the request for Bamboo confirmation while the HTTP verifier is absent", async () => {
  const h = await mount(); h.preview()
  expect(h.dialog.textContent).toContain(uiText("supervisor_scope_native_ready"))
  expect(h.dialog.textContent).not.toContain(uiText("supervisor_scope_unavailable"))
  expect(button("supervisor_scope_native_confirm").disabled).toBe(false)
  expect(h.apply).not.toHaveBeenCalled(); expect(h.dialog.textContent).not.toContain(uiText("supervisor_scope_saved"))
})
it.each(nativeConfirmationUnavailableCodes)("renders the inspect-time stable reason %s", async (code) => {
  const h = await mount(); h.dependencies.bridge = { inspectAvailability: async () => nativeAvailabilityFixture(false, true, code), confirmAndApply: h.apply }
  await act(async () => button("supervisor_scope_refresh").click()); h.preview()
  expect(button("supervisor_scope_native_confirm").disabled).toBe(true)
  expect(h.dialog.textContent).not.toContain(uiText("supervisor_scope_native_ready"))
  expect(h.dialog.textContent).not.toContain(uiText("supervisor_scope_saved")); expect(h.apply).not.toHaveBeenCalled()
})
