import { act } from "react"
import { createRoot } from "react-dom/client"
import { afterEach, beforeEach, expect, it, vi } from "vitest"
import type { ChatItem } from "@shared/types/chatMessages"
import type { ChildProgress } from "@shared/store/appStore/slices/executionStateSlice/types"
import { actorSnapshotFixture, actorSnapshotV2Fixture } from "@/test/fixtures/actorSnapshot"
import { mergeSubAgentView, useSubAgentView } from "./useSubAgentView"
import type { ActorSubtreeSnapshot } from "@services/chat/actorSnapshot"

const read = vi.hoisted(() => ({ snapshot: null as ActorSubtreeSnapshot | null, error: null as string | null,
  gapReason: null as string | null, refresh: vi.fn() }))
vi.mock("./useActorSnapshot", () => ({ useActorSnapshot: vi.fn(() => read) }))
const chat = (id: string, createdAt = 1): ChatItem => ({ id, title: id, createdAt, messages: [], config: { systemPromptId: "", baseSystemPrompt: "", lastUsedEnhancedPrompt: null }, parentSessionId: "root" })
const make = (status: "succeeded" | "failed" | "cancelled" | "running" | "reserved", attempt = 1) => {
  const snapshot = actorSnapshotFixture("root", 1)
  Object.assign(snapshot.nodes[1], { logical_state: status === "failed" ? "failed" : status === "running" || status === "reserved" ? "active" : "cold",
    activation: { activation_id: `${String(attempt).repeat(8)}-aaaa-4aaa-8aaa-aaaaaaaaaaaa`, attempt, status } })
  return snapshot
}
beforeEach(() => { read.snapshot = null; read.error = null; read.gapReason = null; read.refresh.mockClear() })
afterEach(() => vi.clearAllMocks())

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

it("does not hand out a fresh view when a poll returns the identical cards", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement("div"), root = createRoot(host)
  const current = { ...chat("root"), parentSessionId: null, rootSessionId: "root", subagentCount: 1 }
  let view!: ReturnType<typeof useSubAgentView>
  function Harness({ live }: { live: Record<string, ChildProgress> }) {
    view = useSubAgentView(current, [current, chat("actor-0")], live, true)
    return null
  }
  const render = async (live: Record<string, ChildProgress>) => { await act(async () => root.render(<Harness live={live} />)) }
  try {
    read.snapshot = make("succeeded")
    await render({ "actor-0": { status: "running" } })
    const settled = view.agents
    // The lease-driven refresh returns an equal but distinct snapshot object.
    read.snapshot = make("succeeded")
    await render({ "actor-0": { status: "running" } })
    expect(view.agents).toBe(settled)
    // Token-level detail alone is invisible to the card and must not reallocate.
    await render({ "actor-0": { status: "running", outputPreview: "more output" } })
    expect(view.agents).toBe(settled)
    // A real lifecycle change still lands.
    read.snapshot = make("cancelled", 2)
    await render({ "actor-0": { status: "cancelled" } })
    expect(view.agents).not.toBe(settled)
    expect(view.agents["actor-0"].status).toBe("cancelled")
  } finally { act(() => root.unmount()) }
})

it("re-reads on legacy lifecycle changes without letting unordered or duplicate hints overwrite a snapshot", async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  const host = document.createElement("div"), root = createRoot(host)
  const current = { ...chat("root"), parentSessionId: null, rootSessionId: "root", subagentCount: 1 }
  let view!: ReturnType<typeof useSubAgentView>
  function Harness({ live }: { live: Record<string, ChildProgress> }) {
    view = useSubAgentView(current, [current, chat("actor-0")], live, true)
    return null
  }
  const render = async (status: string) => { await act(async () => root.render(<Harness live={{ "actor-0": { status } }} />)) }
  try {
    read.snapshot = make("succeeded")
    await render("running")
    expect(view.agents["actor-0"].status).toBe("completed")
    await render("completed"); await render("completed")
    expect(read.refresh).toHaveBeenCalledTimes(1)
    read.snapshot = make("running", 2)
    await render("running"); await render("cancelled"); await render("completed")
    expect(view.agents["actor-0"].status).toBe("running")
    read.gapReason = "transport_gap"
    await render("completed")
    expect(view.agents["actor-0"].status).toBe("unknown")
    read.gapReason = null; read.snapshot = make("cancelled", 2)
    await render("running")
    expect(view.agents["actor-0"].status).toBe("cancelled")
  } finally { act(() => root.unmount()) }
})
