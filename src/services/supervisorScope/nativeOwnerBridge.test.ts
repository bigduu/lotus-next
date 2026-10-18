import { beforeEach, expect, it, vi } from "vitest"
import { nativeProjectScopeOwnerBridge as bridge } from "./nativeOwnerBridge"
import { nativeAvailabilityFixture, nativeCancellationFixture, scopeFixture } from "./testFixtures"
import { nativeCancellationCodes } from "./ownerBridge"

const sdk = vi.hoisted(() => ({ desktop: vi.fn(() => false), present: vi.fn(() => false), invoke: vi.fn() }))
vi.mock("@/utils/environment", () => ({ isTauriEnvironment: sdk.desktop }))
vi.mock("@tauri-apps/api/core", () => ({ isTauri: sdk.present, invoke: sdk.invoke }))
beforeEach(() => { sdk.desktop.mockReturnValue(false); sdk.present.mockReturnValue(false); sdk.invoke.mockReset() })
const intent = () => ({ supervisor: { ...scopeFixture().scope.supervisor }, expected_state_revision: 0,
  mutation: { kind: "configure_project_scope" as const, allowed_projects: ["p1"] } })
const native = () => { sdk.desktop.mockReturnValue(true); sdk.present.mockReturnValue(true) }

it.each([[false, false], [false, true], [true, false]])("keeps runtime desktop=%s/native=%s unavailable without invoking", async (desktop, present) => {
  sdk.desktop.mockReturnValue(desktop); sdk.present.mockReturnValue(present)
  expect(await bridge.inspectAvailability(scopeFixture())).toEqual({ transport_ready: false, authority_profile: null })
  expect(await bridge.confirmAndApply(intent())).toEqual({ kind: "unavailable" }); expect(sdk.invoke).not.toHaveBeenCalled()
})
it("uses the fixed inspection command with a captured HTTP-false observation", async () => {
  native(); sdk.invoke.mockResolvedValue(nativeAvailabilityFixture())
  const scope = { ...scopeFixture(), owner_authorization: { ...scopeFixture().owner_authorization, available: false } }
  expect(await bridge.inspectAvailability(scope)).toEqual(nativeAvailabilityFixture())
  expect(sdk.invoke).toHaveBeenCalledExactlyOnceWith("supervisor_scope_inspect_availability", { observation: scope })
  expect(sdk.invoke.mock.calls[0]![1].observation).not.toBe(scope)
})
it.each([true, false, null, {}, { transport_ready: true }, { transport_ready: true, authority_profile: { confirmed: true } }])("blocks missing/legacy or malformed native availability %j", async (value) => {
  native(); sdk.invoke.mockResolvedValue(value)
  expect(await bridge.inspectAvailability(scopeFixture())).toEqual({ transport_ready: false, authority_profile: null })
  expect(sdk.invoke).toHaveBeenCalledTimes(1)
})
it("does not cache permission after an inspection or retry a missing native command", async () => {
  native(); sdk.invoke.mockRejectedValue(new Error("command unavailable"))
  expect(await bridge.inspectAvailability(scopeFixture())).toEqual({ transport_ready: false, authority_profile: null })
  expect(sdk.invoke).toHaveBeenCalledTimes(1)
})
it("captures the full intent before lazy loading and sends only one fixed apply command", async () => {
  native(); sdk.invoke.mockResolvedValue(nativeCancellationFixture())
  const draft = intent(), captured = structuredClone(draft), pending = bridge.confirmAndApply(draft)
  draft.mutation.allowed_projects.push("later"); draft.expected_state_revision = 9
  expect(await pending).toEqual(nativeCancellationFixture())
  expect(sdk.invoke).toHaveBeenCalledExactlyOnceWith("supervisor_scope_confirm_and_apply", { intent: captured })
})
it.each(nativeCancellationCodes)("preserves the complete native pre-CAS cancellation %s", async (code) => {
  native(); sdk.invoke.mockResolvedValue(nativeCancellationFixture(code))
  expect(await bridge.confirmAndApply(intent())).toEqual(nativeCancellationFixture(code)); expect(sdk.invoke).toHaveBeenCalledTimes(1)
})
it.each([
  null, {}, { kind: "cancelled" }, { ...nativeCancellationFixture(), not_submitted: false },
  { ...nativeCancellationFixture(), receipt: {} }, { kind: "unavailable", receipt: {} },
  { kind: "applied" }, { kind: "applied", receipt: {} },
  { kind: "rejected", status: 409, code: "future_refusal" },
  { kind: "rejected", status: 503.5, code: "scope_unavailable" },
  { kind: "outcome_unconfirmed", code: "scope_unavailable", status_code: 503 },
])("keeps incomplete/ambiguous native result %j unknown without replay", async (value) => {
  native(); sdk.invoke.mockResolvedValue(value)
  expect(await bridge.confirmAndApply(intent())).toEqual({ kind: "unknown" }); expect(sdk.invoke).toHaveBeenCalledTimes(1)
})
it.each([
  { kind: "unavailable" }, { kind: "unknown" },
  { kind: "rejected", status: 403, code: "host_owner_authorization_required" },
  { kind: "rejected", status: 409, code: "scope_revision_conflict" },
  { kind: "rejected", status: 503, code: "native_confirmation_no_gui" },
])("preserves the explicit normalized native result %j", async (value) => {
  native(); sdk.invoke.mockResolvedValue(value)
  expect(await bridge.confirmAndApply(intent())).toEqual(value); expect(sdk.invoke).toHaveBeenCalledTimes(1)
})
it("accepts an applied receipt only for the captured identity/revision", async () => {
  native(); const receipt = { supervisor: intent().supervisor, state_revision: 1, changed: true, link_revision: null }
  sdk.invoke.mockResolvedValueOnce({ kind: "applied", receipt }).mockResolvedValueOnce({ kind: "applied", receipt: { ...receipt, state_revision: 0 } })
  expect(await bridge.confirmAndApply(intent())).toEqual({ kind: "applied", receipt })
  expect(await bridge.confirmAndApply(intent())).toEqual({ kind: "unknown" }); expect(sdk.invoke).toHaveBeenCalledTimes(2)
})
it("leaves invoke rejection after apply unknown instead of claiming cancellation or retrying", async () => {
  native(); sdk.invoke.mockRejectedValue(new Error("reply disconnected"))
  expect(await bridge.confirmAndApply(intent())).toEqual({ kind: "unknown" }); expect(sdk.invoke).toHaveBeenCalledTimes(1)
})
