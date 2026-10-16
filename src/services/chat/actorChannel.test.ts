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


describe("Actor replay completion proof", () => {
  const proof = {
    ch: "actor.child", seq: 9,
    control: { type: "actor_replay_complete", epoch: activation, cursor: 9, resumed_from: 6 },
  }

  it("accepts an exact epoch-bound replay proof or a fresh snapshot baseline", () => {
    expect(parseActorChannelFrame(proof, "child")).toEqual({ type: "replay_complete", seq: 9, control: proof.control })
    const baseline = { ...proof, control: { ...proof.control, resumed_from: null } }
    expect(parseActorChannelFrame(baseline, "child")).toEqual({ type: "replay_complete", seq: 9, control: baseline.control })
  })

  it.each([
    { ...proof, ch: "actor.other" },
    { ...proof, seq: 8 },
    { ...proof, control: { ...proof.control, epoch: "not-an-epoch" } },
    { ...proof, control: { ...proof.control, epoch: activation.replaceAll("-", "") } },
    { ...proof, control: { ...proof.control, cursor: Number.MAX_SAFE_INTEGER + 1 } },
    { ...proof, control: { ...proof.control, resumed_from: 10 } },
    { ...proof, control: { ...proof.control, resumed_from: 0 } },
    { ...proof, control: { ...proof.control, resumed_from: 1.5 } },
    { ...proof, control: { ...proof.control, resumed_from: undefined } },
    { ...proof, control: { ...proof.control, worker_token: "private" } },
    { ...proof, event: {} },
  ])("rejects malformed, private or out-of-scope proof %#", (frame) => {
    expect(parseActorChannelFrame(frame, "child")).toBeNull()
  })
})
