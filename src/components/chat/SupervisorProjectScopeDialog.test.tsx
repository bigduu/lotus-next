import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, expect, it, vi } from "vitest"
import { ApiError } from "@services/api"
import { uiText } from "@shared/i18n/ui"
import { currentUserScopeFixture, httpScopeFixture, scopeFixture } from "@services/supervisorScope/testFixtures"
import type { ProjectScopeDependencies } from "@/hooks/useSupervisorProjectScope"
import type { ProjectScopeIntent, ProjectScopeReceipt, ProjectScopeResponse } from "@services/supervisorScope/types"
import { SupervisorProjectScopeDialog } from "./SupervisorProjectScopeDialog"
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const roots: Root[] = []
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); document.body.replaceChildren() })
const button = (key: Parameters<typeof uiText>[0]) => [...document.querySelectorAll<HTMLButtonElement>("button")].find((b) => b.textContent === uiText(key))!
async function mount(initial: ProjectScopeResponse = httpScopeFixture(), missingProject = false) {
  let scope = initial
  const update = vi.fn<(intent: ProjectScopeIntent) => Promise<ProjectScopeReceipt>>().mockRejectedValue(new Error("lost response"))
  const close = vi.fn()
  const dependencies: ProjectScopeDependencies = { read: vi.fn(async () => structuredClone(scope)), update,
    projects: async () => missingProject ? [{ id: "p2", name: "Two", status: "active" }] : [{ id: "p1", name: "One", status: "active" }, { id: "p2", name: "Two", status: "active" }] }
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  await act(async () => root.render(<SupervisorProjectScopeDialog open onOpenChange={close} dependencies={dependencies} />))
  const dialog = document.querySelector('[role="dialog"]')!
  return { dialog, update, dependencies, close, setScope(value: ProjectScopeResponse) { scope = value },
    check(id: string) { const label = [...dialog.querySelectorAll("label")].find((el) => el.querySelector("code")?.textContent === id)!; act(() => label.querySelector<HTMLInputElement>("input")!.click()) },
    preview() { act(() => button("supervisor_scope_preview").click()) },
    async confirm() { await act(async () => button("supervisor_scope_http_confirm").click()) } }
}
it("allows admitted web confirmation without any native bridge", async () => {
  const h = await mount(); h.check("p2"); h.preview()
  expect(h.dialog.textContent).toContain(uiText("supervisor_scope_http_ready"))
  expect([...h.dialog.querySelectorAll('[data-testid="project-scope-review"] code')].map((c) => c.textContent)).toEqual(["p1", "p2"])
  expect(button("supervisor_scope_http_confirm").disabled).toBe(false); expect(h.update).not.toHaveBeenCalled()
  act(() => button("supervisor_scope_close").click()); expect(h.close).toHaveBeenCalledWith(false); expect(h.update).not.toHaveBeenCalled()
})
it.each([{ allowed_projects: [] }, { allowed_projects: ["p1"] }])("shows default current-user management with legacy metadata %j, without an access editor", async ({ allowed_projects }) => {
  const current = currentUserScopeFixture()
  const h = await mount({ ...current, scope: { ...current.scope, allowed_projects } })
  expect(h.dialog.textContent).toContain(uiText("supervisor_scope_current_user_ready"))
  expect(h.dialog.textContent).toContain(uiText("supervisor_scope_current_user_legacy_note"))
  expect(h.dialog.textContent).not.toContain(uiText("supervisor_scope_empty"))
  expect(h.dialog.querySelector('input[type="checkbox"]')).toBeNull()
  expect(button("supervisor_scope_preview")).toBeUndefined()
  expect(button("supervisor_scope_http_confirm")).toBeUndefined()
  expect(h.update).not.toHaveBeenCalled()
  await act(async () => button("supervisor_scope_refresh").click())
  expect(h.update).not.toHaveBeenCalled()
})
it.each([
  [scopeFixture(), "supervisor_scope_http_unsupported"],
  [httpScopeFixture(false), "supervisor_scope_unavailable"],
] as const)("keeps precise blocking and full-set local review for %#", async (scope, key) => {
  const h = await mount(scope); h.preview(); expect(h.dialog.textContent).toContain(uiText(key))
  expect(button("supervisor_scope_http_confirm").disabled).toBe(true); await h.confirm(); expect(h.update).not.toHaveBeenCalled()
  expect(h.dialog.querySelector('[data-testid="project-scope-review"]')).not.toBeNull()
})
it("shows global access refusal without embedding a scope login", async () => {
  const h = await mount(); h.preview()
  h.update.mockRejectedValue(new ApiError("access denied", 401, "", "{}"))
  await h.confirm()
  expect(h.dialog.textContent).toContain(uiText("supervisor_scope_access_required"))
  expect(h.dialog.querySelector('input[type="password"]')).toBeNull()
  expect(h.dialog.querySelector("form")).toBeNull()
  expect(h.dialog.textContent).not.toContain("验证已有访问密码")
  expect(h.update).toHaveBeenCalledTimes(1)
})
it("keeps unavailable current IDs visible until explicitly removed", async () => {
  const h = await mount(httpScopeFixture(), true); h.preview()
  expect(h.dialog.textContent).toContain(uiText("supervisor_scope_invalid_selection")); expect(button("supervisor_scope_http_confirm").disabled).toBe(true)
  act(() => button("supervisor_scope_edit").click()); h.check("p1"); h.check("p2"); h.preview()
  expect(button("supervisor_scope_http_confirm").disabled).toBe(false)
  expect(h.dialog.textContent).toContain(uiText("supervisor_scope_removal_effect")); expect(h.update).not.toHaveBeenCalled()
})
it.each([
  [401, "", "supervisor_scope_access_required"],
  [403, "host_owner_authorization_required", "supervisor_scope_rejected"],
  [409, "scope_revision_conflict", "supervisor_scope_conflict"],
  [503, "project_store_unavailable", "supervisor_scope_storage"],
] as const)("renders %i/%s without false success or retry", async (status, code, key) => {
  const h = await mount(); h.preview(); h.update.mockRejectedValue(new ApiError("private diagnostic", status, "", JSON.stringify({ code })))
  await h.confirm(); expect(h.dialog.textContent).toContain(uiText(key)); expect(h.update).toHaveBeenCalledTimes(1)
  expect(h.dialog.textContent).not.toContain(uiText("supervisor_scope_saved")); expect(h.dialog.querySelector('[data-testid="project-scope-review"]')).toBeNull()
})
it("shows saved only after matching receipt and fresh GET", async () => {
  const h = await mount(); h.check("p1"); h.check("p2"); h.preview()
  h.update.mockImplementation(async (intent) => {
    h.setScope({ ...httpScopeFixture(), scope: { ...httpScopeFixture().scope, state_revision: 1, allowed_projects: ["p2"] } })
    return { supervisor: intent.supervisor, state_revision: 1, changed: true, link_revision: null }
  })
  await h.confirm(); expect(h.dialog.textContent).toContain(uiText("supervisor_scope_saved")); expect(h.dependencies.read).toHaveBeenCalledTimes(2)
})
it("keeps a lost response unknown despite matching current state", async () => {
  const h = await mount(); h.preview(); await h.confirm()
  expect(h.dialog.textContent).toContain(uiText("supervisor_scope_unknown")); expect(h.dialog.textContent).not.toContain(uiText("supervisor_scope_saved"))
})

it("uses existing access for review without a scope password or native gate", async () => {
  const h = await mount({ ...httpScopeFixture(), owner_authorization: { available: true, required: true,
    kind: "existing_access", http_registration: false, code: null } })
  h.check("p2"); h.preview()
  expect(button("supervisor_scope_http_confirm").disabled).toBe(false)
  expect(h.dialog.querySelector('input[type="password"]')).toBeNull()
  expect(h.dialog.textContent).not.toContain("验证已有访问密码")
  expect(h.update).not.toHaveBeenCalled()
})
