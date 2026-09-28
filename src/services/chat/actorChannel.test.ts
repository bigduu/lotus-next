import { describe, expect, it } from "vitest"
import { parseActorChannelFrame } from "./actorChannel"

const activation = "123e4567-e89b-42d3-a456-426614174000"
const event = {
  ch: "actor.child",
  seq: 8,
  event: {
    type: "actor_changed", actor_id: "child", root_actor_id: "root", parent_actor_id: "root",
    activation_id: activation, attempt: 2, event_id: `ae1-${"a".repeat(64)}`, class: "semantic",
  },
}

describe("public Actor channel", () => {
  it("accepts only the exact body-free event and gap contract", () => {
    expect(parseActorChannelFrame(event, "child")).toEqual({ type: "event", seq: 8, event: event.event })
    expect(parseActorChannelFrame({ ch: "actor.child", seq: 9, control: {
      type: "actor_snapshot_required", reason: "gap", cursor: 9,
    } }, "child")).toEqual({ type: "control", seq: 9, control: {
      type: "actor_snapshot_required", reason: "gap", cursor: 9,
    } })
  })

  it("rejects unknown versions, private payloads and mismatched identities", () => {
    for (const candidate of [
      { ...event, event: { ...event.event, schema_version: 2 } },
      { ...event, event: { ...event.event, worker_token: "secret" } },
      { ...event, event: { ...event.event, actor_id: "foreign" } },
      { ...event, event: { ...event.event, event_id: "untrusted" } },
      { ...event, seq: 0 },
      { ...event, ch: "agent.child" },
      { ch: "actor.child", seq: 9, control: { type: "actor_snapshot_required", reason: "gap", cursor: 8 } },
      { ch: "actor.child", seq: 9, control: { type: "terminal" } },
    ]) {
      expect(parseActorChannelFrame(candidate, "child")).toBeNull()
    }
  })
})
