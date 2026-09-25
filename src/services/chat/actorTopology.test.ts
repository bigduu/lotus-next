import { describe, expect, it } from "vitest"

import {
  applyActorTopologyEvent,
  applyActorTopologySnapshot,
  emptyActorTopology,
  markActorDirectoryChanged,
  type ActorTopologyRow,
  type ActorTopologySnapshot,
} from "./actorTopology"

const row = (
  actorId: string,
  parentActorId: string | null,
  fields: Partial<ActorTopologyRow> = {},
): ActorTopologyRow => ({
  actorId,
  rootActorId: "root",
  parentActorId,
  title: actorId,
  role: null,
  lifecycle: "cold",
  placement: "local",
  health: "healthy",
  queuedCount: 0,
  waitingForCount: 0,
  pendingRequestCount: 0,
  activationAttempt: 0,
  sequence: 0,
  ...fields,
})

const snapshot = (
  revision: number,
  actors: ActorTopologyRow[],
): ActorTopologySnapshot => ({ rootActorId: "root", revision, actors })

describe("actor topology projection", () => {
  it("normalizes descendants of one authorized root and stores public fields only", () => {
    const secretRow = {
      ...row("child", "root", { title: "x".repeat(200), lifecycle: "suspended" }),
      broker_token: "secret",
      worker_endpoint: "wss://private.example",
      protected_tool_body: "secret output",
    }
    const state = applyActorTopologySnapshot(emptyActorTopology("root"), snapshot(1, [
      row("root", null),
      secretRow,
      row("grandchild", "child", { lifecycle: "failed", placement: "remote" }),
      row("retired", "root", { lifecycle: "retired" }),
      row("foreign", "root", { rootActorId: "another-root" }),
      row("orphan", "missing"),
      row("cycle-a", "cycle-b"),
      row("cycle-b", "cycle-a"),
    ]))

    expect(Object.keys(state.byId).sort()).toEqual(["child", "grandchild", "retired", "root"])
    expect(state.byId.grandchild).toMatchObject({ depth: 2, lifecycle: "failed", placement: "remote" })
    expect(state.byId.child.title).toHaveLength(160)
    expect(state.byId.child).not.toHaveProperty("broker_token")
    expect(state.byId.child).not.toHaveProperty("worker_endpoint")
    expect(state.byId.child).not.toHaveProperty("protected_tool_body")
    expect(state.childrenById.root).toEqual(["child", "retired"])
    expect(state.needsSnapshot).toBe(false)
  })

  it("treats actor IDs as data even when they match object prototype keys", () => {
    const state = applyActorTopologySnapshot(emptyActorTopology("root"), snapshot(1, [
      row("root", null), row("__proto__", "root"), row("toString", "root"),
    ]))
    expect(Object.hasOwn(state.byId, "__proto__")).toBe(true)
    expect(Object.hasOwn(state.byId, "toString")).toBe(true)
    expect(state.byId.__proto__.actorId).toBe("__proto__")
    expect((Reflect.get(state.byId, "toString") as ActorTopologyRow).actorId).toBe("toString")
    expect(Object.getPrototypeOf(state.byId)).toBe(null)
  })

  it("replaces moves, retirements and removals without duplicating nodes", () => {
    const first = applyActorTopologySnapshot(emptyActorTopology("root"), snapshot(1, [
      row("root", null),
      row("left", "root"),
      row("right", "root"),
      row("child", "left"),
      row("grandchild", "child"),
    ]))
    const moved = applyActorTopologySnapshot(first, snapshot(2, [
      row("root", null),
      row("left", "root", { lifecycle: "retired" }),
      row("right", "root"),
      row("child", "right"),
      row("grandchild", "child"),
    ]))
    expect(moved.childrenById.left).toEqual([])
    expect(moved.childrenById.right).toEqual(["child"])
    expect(moved.byId.child.depth).toBe(2)
    expect(moved.byId.grandchild.depth).toBe(3)
    expect(moved.byId.left.lifecycle).toBe("retired")
    expect(moved.byId.root).toBe(first.byId.root)
    expect(moved.byId.right).toBe(first.byId.right)

    const removed = applyActorTopologySnapshot(moved, snapshot(3, [
      row("root", null),
      row("right", "root"),
    ]))
    expect(Object.keys(removed.byId).sort()).toEqual(["right", "root"])
    expect(removed.childrenById.root).toEqual(["right"])
    expect(applyActorTopologySnapshot(removed, snapshot(2, [row("root", null)]))).toBe(removed)
    expect(applyActorTopologySnapshot(removed, snapshot(3, [
      row("root", null), row("right", "root"), row("child", "right"),
    ]))).toBe(removed)
    expect(applyActorTopologySnapshot(moved, snapshot(2, [
      row("root", null), row("left", "root", { lifecycle: "retired" }),
      row("right", "root"), row("child", "left"), row("grandchild", "child"),
    ]))).toBe(moved)
  })

  it("does not clear an unknown-actor recovery request with an equal-revision omission", () => {
    const first = applyActorTopologySnapshot(emptyActorTopology("root"), snapshot(1, [
      row("root", null),
    ]))
    const unknown = applyActorTopologyEvent(first, {
      rootActorId: "root", actorId: "child", activationAttempt: 2, sequence: 4,
      update: { type: "state", lifecycle: "running" },
    })
    expect(unknown.needsSnapshot).toBe(true)
    expect(unknown.pendingGaps.child).toMatchObject({
      activationAttempt: 2, observedSequence: 4, unknownAtRevision: 1,
    })
    expect(applyActorTopologySnapshot(unknown, snapshot(1, [row("root", null)]))).toBe(unknown)
    // Equal revisions cannot contradict the previously accepted membership,
    // even when the newly observed actor is included in a delayed response.
    expect(applyActorTopologySnapshot(unknown, snapshot(1, [
      row("root", null), row("child", "root", { activationAttempt: 2, sequence: 4 }),
    ]))).toBe(unknown)

    const behind = applyActorTopologySnapshot(unknown, snapshot(2, [
      row("root", null), row("child", "root", { activationAttempt: 2, sequence: 3 }),
    ]))
    expect(behind).toBe(unknown)
    const recovered = applyActorTopologySnapshot(unknown, snapshot(2, [
      row("root", null), row("child", "root", { activationAttempt: 2, sequence: 4 }),
    ]))
    expect(recovered.needsSnapshot).toBe(false)
    expect(recovered.byId.child).toBeDefined()

    // Without an event directory revision, only a *newer* complete snapshot
    // can prove that an unknown actor is no longer an authorized member.
    const absent = applyActorTopologySnapshot(unknown, snapshot(2, [row("root", null)]))
    expect(absent.needsSnapshot).toBe(false)
    expect(absent.byId.child).toBeUndefined()
  })

  it("waits for a complete directory revision instead of applying older snapshots", () => {
    const first = applyActorTopologySnapshot(emptyActorTopology("root"), snapshot(5, [row("root", null)]))
    const stale = markActorDirectoryChanged(first, 7)
    expect(stale.needsSnapshot).toBe(true)
    expect(stale.requiredRevision).toBe(7)
    expect(applyActorTopologySnapshot(stale, snapshot(6, [row("root", null)]))).toBe(stale)

    const recovered = applyActorTopologySnapshot(stale, snapshot(7, [
      row("root", null), row("child", "root"),
    ]))
    expect(recovered.needsSnapshot).toBe(false)
    expect(recovered.byId.child).toBeDefined()
  })

  it("fences duplicate, stale, skipped and old-activation events until a covering snapshot", () => {
    const first = applyActorTopologySnapshot(emptyActorTopology("root"), snapshot(1, [
      row("root", null),
      row("child", "root", { activationAttempt: 2, sequence: 4, lifecycle: "running" }),
    ]))
    const current = applyActorTopologyEvent(first, {
      rootActorId: "root", actorId: "child", activationAttempt: 2, sequence: 5,
      update: { type: "state", lifecycle: "suspended", pendingRequestCount: 1 },
    })
    expect(current.byId.child).toMatchObject({ lifecycle: "suspended", pendingRequestCount: 1 })
    expect(current.byId.root).toBe(first.byId.root)
    expect(current.childrenById).toBe(first.childrenById)

    const oldAttempt = applyActorTopologyEvent(current, {
      rootActorId: "root", actorId: "child", activationAttempt: 1, sequence: 100,
      update: { type: "state", lifecycle: "completed" },
    })
    expect(oldAttempt).toBe(current)
    expect(applyActorTopologyEvent(current, {
      rootActorId: "root", actorId: "child", activationAttempt: 2, sequence: 5,
      update: { type: "state", lifecycle: "completed" },
    })).toBe(current)

    const gapped = applyActorTopologyEvent(current, {
      rootActorId: "root", actorId: "child", activationAttempt: 2, sequence: 7,
      update: { type: "state", lifecycle: "completed" },
    })
    expect(gapped.byId.child).toBe(current.byId.child)
    expect(gapped.needsSnapshot).toBe(true)
    expect(applyActorTopologySnapshot(gapped, snapshot(1, [
      row("root", null), row("child", "root", { activationAttempt: 2, sequence: 6 }),
    ]))).toBe(gapped)

    const recovered = applyActorTopologySnapshot(gapped, snapshot(1, [
      row("root", null),
      row("child", "root", { activationAttempt: 2, sequence: 7, lifecycle: "completed" }),
    ]))
    expect(recovered.needsSnapshot).toBe(false)
    expect(recovered.byId.child.lifecycle).toBe("completed")
    expect(recovered.pendingGaps).toEqual({})

    const replacement = applyActorTopologyEvent(recovered, {
      rootActorId: "root", actorId: "child", activationAttempt: 3, sequence: 1,
      update: { type: "activation_started", lifecycle: "running" },
    })
    expect(replacement.byId.child).toMatchObject({ activationAttempt: 3, sequence: 1, lifecycle: "running" })
    expect(applyActorTopologyEvent(replacement, {
      rootActorId: "root", actorId: "child", activationAttempt: 2, sequence: 100,
      update: { type: "state", lifecycle: "failed" },
    })).toBe(replacement)
  })

  it("keeps 128 actors normalized and changes only the observed actor on a state event", () => {
    const actors = [row("root", null)]
    for (let index = 0; index < 128; index += 1) {
      actors.push(row(`actor-${index}`, index < 8 ? "root" : `actor-${Math.floor(index / 8) - 1}`))
    }
    const first = applyActorTopologySnapshot(emptyActorTopology("root"), snapshot(1, actors))
    expect(Object.keys(first.byId)).toHaveLength(129)
    const updated = applyActorTopologyEvent(first, {
      rootActorId: "root", actorId: "actor-126", activationAttempt: 0, sequence: 1,
      update: { type: "state", lifecycle: "running", queuedCount: 2 },
    })
    expect(updated.byId["actor-126"].queuedCount).toBe(2)
    expect(updated.byId["actor-125"]).toBe(first.byId["actor-125"])
    expect(updated.childrenById).toBe(first.childrenById)
    expect(updated.byId.root).toBe(first.byId.root)
  })
})
