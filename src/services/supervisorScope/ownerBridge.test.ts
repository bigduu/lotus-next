import { expect, it } from "vitest"
import { decodeProjectScopeOwnerAvailability, isNativeScopeCancellation, nativeCancellationCodes, nativeConfirmationReady, nativeConfirmationUnavailableCodes } from "./ownerBridge"
import { nativeAvailabilityFixture, nativeCancellationFixture } from "./testFixtures"

it("recognizes only a ready transport with exact per-request Bamboo confirmation, without consent", () => {
  const decoded = decodeProjectScopeOwnerAvailability(nativeAvailabilityFixture())
  expect(decoded).toEqual(nativeAvailabilityFixture()); expect(nativeConfirmationReady(decoded)).toBe(true)
  expect(nativeConfirmationReady(decodeProjectScopeOwnerAvailability(nativeAvailabilityFixture(true, false)))).toBe(false)
})
it.each(nativeConfirmationUnavailableCodes)("preserves unavailable profile reason %s without treating transport as permission", (code) => {
  const decoded = decodeProjectScopeOwnerAvailability(nativeAvailabilityFixture(false, true, code))
  expect(decoded?.authority_profile?.unavailable_code).toBe(code); expect(nativeConfirmationReady(decoded)).toBe(false)
})
it.each([
  true, false, null, {}, { transport_ready: true }, { transport_ready: true, owner_authorization_available: true },
  { transport_ready: true, authority_profile: null },
  ...[
    { kind: "future_profile" }, { confirmation_available: "true" }, { confirmation_required_per_request: false },
    { unavailable_code: "native_confirmation_unavailable" }, { confirmed: true },
    { confirmation_available: false, unavailable_code: null }, { confirmation_available: false, unavailable_code: "future_unavailable" },
  ].map((changes) => ({ ...nativeAvailabilityFixture(), authority_profile: { ...nativeAvailabilityFixture().authority_profile, ...changes } })),
  { ...nativeAvailabilityFixture(), transport_ready: "true" },
])("blocks legacy or malformed profile %#", (value) => {
  expect(nativeConfirmationReady(decodeProjectScopeOwnerAvailability(value))).toBe(false)
})
it.each(nativeCancellationCodes)("accepts only the explicit pre-CAS guarantee for %s", (code) => {
  expect(isNativeScopeCancellation(nativeCancellationFixture(code))).toBe(true)
})
it.each([
  null, { kind: "cancelled" }, { ...nativeCancellationFixture(), not_submitted: false },
  { ...nativeCancellationFixture(), status_code: 503 }, { ...nativeCancellationFixture(), code: "future_cancel" },
  { ...nativeCancellationFixture(), receipt: {} }, { kind: "unknown", not_submitted: true },
])("does not turn ambiguous native cancellation %# into a not-submitted claim", (value) => {
  expect(isNativeScopeCancellation(value)).toBe(false)
})
