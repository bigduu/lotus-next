import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import { defaultProjectScopeDependencies, useSupervisorProjectScope } from "./useSupervisorProjectScope"
import { nativeProjectScopeOwnerBridge } from "@services/supervisorScope/nativeOwnerBridge"
import { nativeAvailabilityFixture, nativeCancellationFixture, scopeFixture } from "@services/supervisorScope/testFixtures"
import { nativeCancellationCodes } from "@services/supervisorScope/ownerBridge"

const sdk = vi.hoisted(() => ({ desktop: vi.fn(() => false), present: vi.fn(() => false), invoke: vi.fn() }))
vi.mock("@/utils/environment", () => ({ isTauriEnvironment: sdk.desktop }))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: sdk.present, invoke: sdk.invoke }))
Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
const roots: Root[] = []
beforeEach(() => { sdk.desktop.mockReturnValue(false); sdk.present.mockReturnValue(false); sdk.invoke.mockReset() })
afterEach(() => { for (const root of roots.splice(0)) act(() => root.unmount()); vi.restoreAllMocks(); document.body.replaceChildren() })
async function mount() {
  const scope = { ...scopeFixture(), owner_authorization: { ...scopeFixture().owner_authorization, available: false } }
  const read = vi.spyOn(defaultProjectScopeDependencies, "read").mockResolvedValue(scope)
  vi.spyOn(defaultProjectScopeDependencies, "projects").mockResolvedValue([{ id: "p1", name: "One", status: "active" }])
  let state!: ReturnType<typeof useSupervisorProjectScope>
  const root = createRoot(document.body.appendChild(document.createElement("div"))); roots.push(root)
  function Probe() { state = useSupervisorProjectScope(true); return null }
  await act(async () => root.render(<Probe />))
  return { get state() { return state }, read,
    review() { act(() => state.reviewDraft()) }, async confirm() { await act(async () => state.confirm()) } }
}
it("bootstraps the real native adapter while ordinary Web stays read-only and unavailable", async () => {
  expect(defaultProjectScopeDependencies.bridge).toBe(nativeProjectScopeOwnerBridge)
  const h = await mount(); h.review(); await h.confirm()
  expect(h.read).toHaveBeenCalledTimes(1); expect(h.state.nativeAvailable).toBe(false)
  expect(h.state.canConfirm).toBe(false); expect(sdk.invoke).not.toHaveBeenCalled()
})
it.each(nativeCancellationCodes)("routes default native %s without an HTTP-verifier gate or mutation replay", async (code) => {
  sdk.desktop.mockReturnValue(true); sdk.present.mockReturnValue(true)
  sdk.invoke.mockImplementation(async (command: string) => command === "supervisor_scope_inspect_availability" ? nativeAvailabilityFixture() : nativeCancellationFixture(code))
  const h = await mount(); h.review(); expect(h.state.canConfirm).toBe(true); await h.confirm()
  expect(h.state.notice).toEqual({ kind: "cancelled", code }); expect(h.read).toHaveBeenCalledTimes(1)
  expect(sdk.invoke.mock.calls.map((call) => call[0])).toEqual(["supervisor_scope_inspect_availability", "supervisor_scope_confirm_and_apply"])
})
it("withdraws a request-time native refusal without retrying", async () => {
  sdk.desktop.mockReturnValue(true); sdk.present.mockReturnValue(true)
  sdk.invoke.mockImplementation(async (command: string) => command === "supervisor_scope_inspect_availability" ? nativeAvailabilityFixture() : { kind: "rejected", status: 503, code: "native_confirmation_no_gui" })
  const h = await mount(); h.review(); await h.confirm(); h.review(); await h.confirm()
  expect(h.state.notice).toBeNull()
  expect(h.state.nativeAvailable).toBe(false); expect(h.read).toHaveBeenCalledTimes(2)
  expect(sdk.invoke.mock.calls.filter((call) => call[0] === "supervisor_scope_confirm_and_apply")).toHaveLength(1)
})
it("keeps a post-invoke disconnect unknown even when canonical state matches, without replay", async () => {
  sdk.desktop.mockReturnValue(true); sdk.present.mockReturnValue(true)
  sdk.invoke.mockImplementation(async (command: string) => {
    if (command === "supervisor_scope_inspect_availability") return nativeAvailabilityFixture()
    throw new Error("lost native response")
  })
  const h = await mount(); h.review(); await h.confirm()
  expect(h.state.notice?.kind).toBe("unknown"); expect(h.read).toHaveBeenCalledTimes(2)
  expect(sdk.invoke.mock.calls.filter((call) => call[0] === "supervisor_scope_confirm_and_apply")).toHaveLength(1)
})
