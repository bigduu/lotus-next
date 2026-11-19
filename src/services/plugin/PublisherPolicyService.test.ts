import { afterEach, describe, expect, it, vi } from "vitest"
import { apiClient } from "@services/api"
import { publisherChangeConfirmed, publisherPolicyService, type PublisherPolicy } from "./PublisherPolicyService"

const policy = (): PublisherPolicy => ({ expected_revision: 7, publisher_mode: "follow_defaults", enforcement: "strict", custom_key_count: 1,
  publishers: [{ id: "jiandu", key: { label: "Jiandu", algorithm: "ed25519", public_key: "ab".repeat(32) }, trusted: true, revoked: false }] })
afterEach(() => vi.restoreAllMocks())

describe("publisher policy authority", () => {
  it("submits only the reviewed revision, catalog identities and finite action", async () => {
    const input = { ...policy(), enforcement_override: "off", arbitrary: "not forwarded" }
    const post = vi.spyOn(apiClient, "post").mockResolvedValue(undefined)
    await publisherPolicyService.change(input, { type: "revoke", publisher_id: "jiandu" })
    expect(post).toHaveBeenCalledExactlyOnceWith("plugins/publishers", { expected_revision: 7,
      expected_publishers: { jiandu: `ed25519:${"ab".repeat(32)}` }, change: { type: "revoke", publisher_id: "jiandu" } })
  })
  it.each([
    { expected_revision: -1 }, { expected_revision: Number.MAX_SAFE_INTEGER + 1 }, { publisher_mode: null },
    { publisher_mode: "unknown" }, { enforcement: "unknown" }, { custom_key_count: -1 }, { publishers: [] },
    { publishers: [policy().publishers[0], policy().publishers[0]] },
    { publishers: [{ ...policy().publishers[0], revoked: true }] },
    { publishers: [{ ...policy().publishers[0], key: { ...policy().publishers[0]!.key, public_key: "unverified" } }] },
  ])("rejects malformed or contradictory observation %j", async (override) => {
    vi.spyOn(apiClient, "get").mockResolvedValue({ ...policy(), ...override })
    await expect(publisherPolicyService.get()).rejects.toThrow("could not be verified")
  })
  it("requires a later matching catalog and desired result to confirm a mutation", () => {
    const reviewed = policy()
    const change = { type: "revoke", publisher_id: "jiandu" } as const
    const fresh = { ...policy(), expected_revision: 8, publishers: [{ ...policy().publishers[0]!, revoked: true, trusted: false }] }
    expect(publisherChangeConfirmed(reviewed, change, fresh)).toBe(true)
    expect(publisherChangeConfirmed(reviewed, change, { ...fresh, expected_revision: 7 })).toBe(false)
    expect(publisherChangeConfirmed(reviewed, change, { ...fresh, publishers: [{ ...fresh.publishers[0]!, key: { ...fresh.publishers[0]!.key, public_key: "cd".repeat(32) } }] })).toBe(false)
    expect(publisherChangeConfirmed(reviewed, { type: "trust", publisher_id: "jiandu" }, fresh)).toBe(false)
  })
})
