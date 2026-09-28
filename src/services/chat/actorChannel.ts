/** Public, body-free Actor observation carried by the authenticated v2 socket. */
export interface ActorChangedEvent {
  type: "actor_changed"
  actor_id: string
  root_actor_id: string
  parent_actor_id: string | null
  activation_id: string
  attempt: number
  event_id: string
  class: "lifecycle" | "semantic" | "snapshot" | "ephemeral"
}

export interface ActorSnapshotRequired {
  type: "actor_snapshot_required"
  reason: "initial" | "gap"
  cursor: number
}

export type ActorChannelFrame =
  | { type: "event"; seq: number; event: ActorChangedEvent }
  | { type: "control"; seq: number; control: ActorSnapshotRequired }

const encoder = new TextEncoder()
const record = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
const exact = (value: Record<string, unknown>, keys: readonly string[]) =>
  Object.keys(value).length === keys.length && keys.every((key) => Object.hasOwn(value, key))
const positiveSafeInteger = (value: unknown): value is number =>
  typeof value === "number" && Number.isSafeInteger(value) && value > 0
export const validActorId = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.trim() === value &&
  encoder.encode(value).length <= 256 && !value.includes("..") && !/[\\/]/.test(value) &&
  ![...value].some((character) => {
    const code = character.codePointAt(0)!
    return code < 32 || code >= 127 && code <= 159 || code >= 0xd800 && code <= 0xdfff ||
      code >= 0x202a && code <= 0x202e || code >= 0x2066 && code <= 0x2069
  })

const activationId = (value: unknown): value is string => {
  if (typeof value !== "string") return false
  if (value.length === 32) return /^[0-9a-f]{32}$/i.test(value)
  const uuid = value.length === 38 && value.startsWith("{") && value.endsWith("}") ? value.slice(1, -1)
    : value.length === 45 && value.startsWith("urn:uuid:") ? value.slice(9) : value
  return uuid.length === 36 && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(uuid)
}

/** Reject unknown fields and private payloads before they reach UI state. */
export function parseActorChannelFrame(value: unknown, actorId: string): ActorChannelFrame | null {
  if (!validActorId(actorId) || !record(value) || value.ch !== `actor.${actorId}` || !positiveSafeInteger(value.seq)) return null
  if (exact(value, ["ch", "seq", "control"]) && record(value.control)) {
    const control = value.control
    if (exact(control, ["type", "reason", "cursor"]) && control.type === "actor_snapshot_required" &&
      (control.reason === "initial" || control.reason === "gap") && control.cursor === value.seq) {
      return { type: "control", seq: value.seq, control: control as unknown as ActorSnapshotRequired }
    }
  }
  if (exact(value, ["ch", "seq", "event"]) && record(value.event)) {
    const event = value.event
    if (exact(event, ["type", "actor_id", "root_actor_id", "parent_actor_id", "activation_id", "attempt", "event_id", "class"]) &&
      event.type === "actor_changed" && event.actor_id === actorId && validActorId(event.root_actor_id) &&
      (event.parent_actor_id === null || validActorId(event.parent_actor_id)) && activationId(event.activation_id) &&
      positiveSafeInteger(event.attempt) && typeof event.event_id === "string" && /^ae1-[0-9a-f]{64}$/.test(event.event_id) &&
      (event.class === "lifecycle" || event.class === "semantic" || event.class === "snapshot" || event.class === "ephemeral")) {
      return { type: "event", seq: value.seq, event: event as unknown as ActorChangedEvent }
    }
  }
  return null
}
