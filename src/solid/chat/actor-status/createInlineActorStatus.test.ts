import { createRoot, createSignal, flush } from "solid-js"
import { afterEach, expect, it, vi } from "vitest"
import type { ChatItem } from "@shared/types/chatMessages"
import { appStore } from "@shared/store/appStore/state"
import type { ChildProgress } from "@shared/store/appStore/slices/executionStateSlice/types"
import { actorSnapshotFixture, actorSnapshotV2Fixture } from "@/test/fixtures/actorSnapshot"
import { mergeSubAgentView } from "@services/chat/actorInlineStatus"
import type { ActorSubtreeSnapshot } from "@services/chat/actorSnapshot"
import { createInlineActorStatus } from "./createInlineActorStatus"

type Observation = { snapshot: ActorSubtreeSnapshot | null; error: string | null; gapReason: string | null }
const fixture = vi.hoisted(() => ({
  state: () => ({ snapshot: null, error: null, gapReason: null }) as Observation,
  refresh: vi.fn(),
}))
vi.mock("../../workbench/subagents/createActorSnapshot", () => ({ createActorSnapshot: () => fixture }))

const chat = (id: string, createdAt = 1): ChatItem => ({ id, title: id, createdAt, messages: [], config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null }, parentSessionId: "root" })
const make = (status: "succeeded" | "failed" | "cancelled" | "running" | "reserved", attempt = 1) => {
  const snapshot = actorSnapshotFixture("root", 1)
  Object.assign(snapshot.nodes[1], { logical_state: status === "failed" ? "failed" : status === "running" || status === "reserved" ? "active" : "cold",
    activation: { activation_id: `${String(attempt).repeat(8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, attempt, status } })
  return snapshot
}
it.each([["succeeded", "completed"], ["failed", "failed"], ["cancelled", "cancelled"], ["reserved", "queued"]] as const)(
  "uses the current saved %s activation over stale Running", (outcome, status) => {
    const agents = mergeSubAgentView("root", [{ ...chat("actor-0"), isRunning: true }],
      { "actor-0": { status: "running", error: "old error", outputPreview: "old output" } }, make(outcome), true)
    expect(agents["actor-0"]).toMatchObject({ status })
    expect(agents["actor-0"].error).toBeUndefined()
    expect(agents["actor-0"].outputPreview).toBeUndefined()
  })

it.each(["completed", "error", "cancelled"])("does not let delayed %s from an older run complete the new activation", (status) => {
  const agents = mergeSubAgentView("root", [{ ...chat("actor-0"), isRunning: false, lastRunStatus: status }],
    { "actor-0": { status } }, make("running", 2), true)
  expect(agents["actor-0"].status).toBe("running")
})

it("uses unconfirmed for missing identity, transport gaps, denied reads and a stopped task without outcome", () => {
  expect(mergeSubAgentView("root", [chat("actor-0")], {}, null, false)["actor-0"].status).toBe("unknown")
  expect(mergeSubAgentView("root", [chat("actor-0")], {}, make("succeeded"), false)["actor-0"].status).toBe("unknown")
  const stopped = actorSnapshotV2Fixture("stop_unconfirmed", "root")
  expect(mergeSubAgentView("root", [], {}, stopped, true)["actor-0"].status).toBe("unknown")
})

it("keeps first observed order when the session index changes recency order", () => {
  const first = mergeSubAgentView("root", [chat("b", 2), chat("a", 1)], {}, null, false)
  expect(Object.keys(first)).toEqual(["a", "b"])
  const next = mergeSubAgentView("root", [{ ...chat("b", 2), updatedAt: "later", lastRunStatus: "completed" }, chat("a", 1), chat("c", 0)], {}, null, false, Object.keys(first))
  expect(Object.keys(next)).toEqual(["a", "b", "c"])
  expect(mergeSubAgentView("other", [chat("a")], {}, make("succeeded"), true)).toEqual({})
})

it("uses only the exact saved birth time for transcript placement", () => {
  const createdAtExact = "2026-11-02T00:00:01.000100Z"
  const agents = mergeSubAgentView("root", [chat("unknown"), { ...chat("saved"), createdAtExact }], {}, null, false)
  expect(agents.unknown.createdAt).toBeUndefined()
  expect(agents.saved.createdAt).toBe(createdAtExact)
})

it("reuses one view identity while only unrendered token detail changes", () => {
  const chats = [chat("actor-0")]
  const snapshot = make("succeeded")
  const first = mergeSubAgentView("root", chats,
    { "actor-0": { status: "running", outputPreview: "a", roundCount: 1 } }, snapshot, true)
  const second = mergeSubAgentView("root", chats,
    { "actor-0": { status: "running", outputPreview: "ab", roundCount: 2 } }, snapshot, true,
    Object.keys(first), first)
  // A child token must not allocate a new card state: the collapsed card shows
  // neither the preview nor the round count.
  expect(second).toBe(first)
  expect(second["actor-0"].status).toBe("completed")
  expect(second["actor-0"].outputPreview).toBeUndefined()
})

it("keeps untouched cards stable and rebuilds only the one that changed", () => {
  const chats = [chat("b", 2), chat("a", 1)]
  const first = mergeSubAgentView("root", chats, {}, null, false)
  const moved = [{ ...chat("b", 2), placement: { kind: "local", host: "box-1" } }, chat("a", 1)]
  const changed = mergeSubAgentView("root", moved, {}, null, false, Object.keys(first), first)
  expect(changed).not.toBe(first)
  expect(changed.b).not.toBe(first.b)
  expect(changed.a).toBe(first.a)
})

it("rebuilds a card when its placement changes but not when the host is repeated", () => {
  const placed = (host: string) => ({ ...chat("actor-0"), placement: { kind: "docker", host } }) as ChatItem
  const first = mergeSubAgentView("root", [placed("box-1")], {}, null, false)
  const same = mergeSubAgentView("root", [placed("box-1")], {}, null, false, Object.keys(first), first)
  expect(same).toBe(first)
  const moved = mergeSubAgentView("root", [placed("box-2")], {}, null, false, Object.keys(first), first)
  expect(moved).not.toBe(first)
  expect((moved["actor-0"] as { placement?: { host: string } }).placement?.host).toBe("box-2")
})

const close = new Set<() => void>()
afterEach(() => {
  for (const dispose of close) dispose()
  close.clear()
  appStore.getState().clearChildProgress("root", "actor-0")
  fixture.refresh.mockReset()
})

function mount(initial: ActorSubtreeSnapshot) {
  appStore.getState().applyChildProgress("root", "actor-0", { status: "running" })
  return createRoot((dispose) => {
    close.add(dispose)
    const root = { ...chat("root"), parentSessionId: null, rootSessionId: "root", subagentCount: 1 }
    const chats = [root, chat("actor-0")]
    const [observation, setObservation] = createSignal<Observation>({ snapshot: initial, error: null, gapReason: null })
    fixture.state = observation
    const view = createInlineActorStatus({
      session: () => root,
      chats: () => chats,
      active: () => true,
      history: () => [],
      live: () => [],
      messages: () => [],
    })
    return {
      agents: () => view.groups().folded,
      update(progress: ChildProgress, next?: Partial<Observation>) {
        if (next) setObservation((previous) => ({ ...previous, ...next }))
        appStore.getState().applyChildProgress("root", "actor-0", progress)
        flush()
      },
    }
  })
}

it("does not hand out a fresh view when a poll returns the identical cards", () => {
  const view = mount(make("succeeded"))
  view.update({ status: "running" })
  const settled = view.agents()
  // The lease-driven refresh returns an equal but distinct snapshot object.
  view.update({ status: "running" }, { snapshot: make("succeeded") })
  expect(view.agents()).toBe(settled)
  // Token detail alone is invisible to the collapsed card.
  view.update({ status: "running", outputPreview: "more output" })
  expect(view.agents()).toBe(settled)
  view.update({ status: "cancelled" }, { snapshot: make("cancelled", 2) })
  expect(view.agents()).not.toBe(settled)
  expect(view.agents()["actor-0"].status).toBe("cancelled")
})

it("re-reads on legacy lifecycle changes without letting unordered or duplicate hints overwrite a snapshot", () => {
  const view = mount(make("succeeded"))
  view.update({ status: "running" })
  expect(view.agents()["actor-0"].status).toBe("completed")
  view.update({ status: "completed" })
  view.update({ status: "completed" })
  expect(fixture.refresh).toHaveBeenCalledTimes(1)
  view.update({ status: "running" }, { snapshot: make("running", 2) })
  view.update({ status: "cancelled" })
  view.update({ status: "completed" })
  expect(view.agents()["actor-0"].status).toBe("running")
  view.update({ status: "completed" }, { gapReason: "transport_gap" })
  expect(view.agents()["actor-0"].status).toBe("unknown")
  view.update({ status: "running" }, { gapReason: null, snapshot: make("cancelled", 2) })
  expect(view.agents()["actor-0"].status).toBe("cancelled")
})
