import { apiClient } from "../api"

import type { OfficialPublisher, PublisherMode, PublisherPolicy, PublisherPolicyChange } from "./types"
export type { PublisherMode, OfficialPublisher, PublisherPolicy, PublisherPolicyChange } from "./types"

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)
const nonnegativeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) >= 0

function parsePolicy(value: unknown): PublisherPolicy {
  const invalid = () => { throw new Error("Publisher policy could not be verified.") }
  if (!record(value) || !nonnegativeInteger(value.expected_revision) ||
    !["follow_defaults", "explicit"].includes(value.publisher_mode as string) ||
    !["strict", "off"].includes(value.enforcement as string) ||
    !nonnegativeInteger(value.custom_key_count) || !Array.isArray(value.publishers) || !value.publishers.length) return invalid()
  const ids = new Set<string>()
  const publishers = value.publishers.map((publisher): OfficialPublisher => {
    if (!record(publisher) || typeof publisher.id !== "string" || !/^[a-z0-9_-]{1,64}$/.test(publisher.id) ||
      ids.has(publisher.id) || typeof publisher.trusted !== "boolean" || typeof publisher.revoked !== "boolean" ||
      (publisher.trusted && publisher.revoked) || !record(publisher.key) ||
      typeof publisher.key.label !== "string" || !publisher.key.label.trim() || publisher.key.algorithm !== "ed25519" ||
      typeof publisher.key.public_key !== "string" || !/^[a-f\d]{64}$/i.test(publisher.key.public_key)) return invalid()
    ids.add(publisher.id)
    return { id: publisher.id, trusted: publisher.trusted, revoked: publisher.revoked,
      key: { label: publisher.key.label, algorithm: "ed25519", public_key: publisher.key.public_key } }
  })
  return { expected_revision: value.expected_revision, publisher_mode: value.publisher_mode as PublisherMode,
    enforcement: value.enforcement as PublisherPolicy["enforcement"], custom_key_count: value.custom_key_count, publishers }
}

const catalog = (policy: PublisherPolicy) => Object.fromEntries(policy.publishers.map(({ id, key }) =>
  [id, `${key.algorithm}:${key.public_key.toLowerCase()}`]))

/** Only a fresh observation can confirm an uncertain POST; never retry it. */
export function publisherChangeConfirmed(reviewed: PublisherPolicy, change: PublisherPolicyChange, fresh: PublisherPolicy): boolean {
  const expected = catalog(reviewed)
  const actual = catalog(fresh)
  if (fresh.expected_revision <= reviewed.expected_revision || Object.keys(expected).length !== Object.keys(actual).length ||
    Object.entries(expected).some(([id, key]) => actual[id] !== key)) return false
  if (change.type === "set_mode") return fresh.publisher_mode === change.publisher_mode
  const publisher = fresh.publishers.find(({ id }) => id === change.publisher_id)
  return Boolean(publisher && (change.type === "revoke" ? publisher.revoked && !publisher.trusted : publisher.trusted && !publisher.revoked))
}

export const publisherPolicyService = {
  async get(): Promise<PublisherPolicy> {
    return parsePolicy(await apiClient.get<unknown>("plugins/publishers"))
  },
  async change(reviewed: PublisherPolicy, change: PublisherPolicyChange): Promise<void> {
    const policy = parsePolicy(reviewed)
    if (!["set_mode", "revoke", "trust"].includes(change.type) ||
      (change.type === "set_mode" && !["follow_defaults", "explicit"].includes(change.publisher_mode))) {
      throw new Error("Invalid publisher policy change.")
    }
    if (change.type !== "set_mode" && !policy.publishers.some(({ id }) => id === change.publisher_id)) {
      throw new Error("Publisher is not in the reviewed catalog.")
    }
    // Reconstruct the finite change rather than forwarding arbitrary wire keys.
    const selected = change.type === "set_mode" ? { type: change.type, publisher_mode: change.publisher_mode } :
      { type: change.type, publisher_id: change.publisher_id }
    await apiClient.post<unknown>("plugins/publishers", {
      expected_revision: policy.expected_revision, expected_publishers: catalog(policy), change: selected,
    })
  },
}
