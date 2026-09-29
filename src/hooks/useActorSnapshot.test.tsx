import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@services/api/errors"
import { getActorSnapshot, type ActorSubtreeSnapshot } from "@services/chat/actorSnapshot"
import { subscribeActor, subscribeActorTree } from "@services/chat/v2Stream"
import { ActorSnapshotPanel } from "@/components/chat/ActorSnapshotPanel"
import { actorSnapshotFixture } from "@/test/fixtures/actorSnapshot"
import { useActorSnapshot } from "./useActorSnapshot"

vi.mock("@services/chat/actorSnapshot", async (importOriginal) => ({
  ...await importOriginal<typeof import("@services/chat/actorSnapshot")>(), getActorSnapshot: vi.fn(),
}))
vi.mock("@services/chat/v2Stream", () => ({
  subscribeActor: vi.fn(() => ({ close: vi.fn() })),
  subscribeActorTree: vi.fn(() => ({ close: vi.fn() })),
}))
let root: Root
let host: HTMLDivElement
let state: ReturnType<typeof useActorSnapshot>
function Harness({ id, active = true, actorId = null, descendantCount = null }: {
  id: string | null; active?: boolean; actorId?: string | null; descendantCount?: number | null
}) {
  state = useActorSnapshot(id, active, actorId, descendantCount)
  return null
}
function deferred() {
  let resolve!: (value: ActorSubtreeSnapshot) => void
  let reject!: (error: unknown) => void
  const promise = new Promise<ActorSubtreeSnapshot>((success, failure) => { resolve = success; reject = failure })
  return { promise, resolve, reject }
}
beforeEach(() => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true })
  vi.mocked(getActorSnapshot).mockReset().mockResolvedValue(actorSnapshotFixture())
  vi.mocked(subscribeActor).mockClear()
  vi.mocked(subscribeActorTree).mockClear()
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })
const mount = async (id: string | null, active = true, actorId: string | null = null, descendantCount: number | null = null) => {
  await act(async () => root.render(<Harness id={id} active={active} actorId={actorId} descendantCount={descendantCount} />))
}

describe("public Actor interest", () => {
  it("authorizes a selected child from the exact Root snapshot and coalesces event refreshes", async () => {
    const pending = deferred()
    vi.mocked(getActorSnapshot).mockReturnValueOnce(pending.promise)
    await mount("root", true, "actor-0")
    expect(subscribeActor).not.toHaveBeenCalled()
    await act(async () => pending.resolve(actorSnapshotFixture()))
    expect(subscribeActor).toHaveBeenCalledExactlyOnceWith("actor-0", expect.any(Object))
    const handlers = vi.mocked(subscribeActor).mock.calls[0][1]
    const event = { type: "actor_changed" as const, actor_id: "actor-0", root_actor_id: "root",
      parent_actor_id: "root", activation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      attempt: 1, event_id: `ae1-${"a".repeat(64)}`, class: "lifecycle" as const }
    await act(async () => {
      handlers.onEvent(event, 2)
      handlers.onEvent(event, 3)
      handlers.onControl({ type: "actor_snapshot_required", reason: "initial", cursor: 4 })
      await Promise.resolve()
    })
    expect(getActorSnapshot).toHaveBeenCalledTimes(2)
    expect(state.gapReason).toBeNull()
  })

  it("reads state added after the HTTP snapshot on initial, gap and reconnect controls", async () => {
    await mount("root", true, "actor-0")
    const handlers = vi.mocked(subscribeActor).mock.calls[0][1]
    const afterSubscribe = actorSnapshotFixture()
    afterSubscribe.nodes[1].revision.session_metadata_version = 8
    vi.mocked(getActorSnapshot).mockResolvedValueOnce(afterSubscribe)
    await act(async () => {
      handlers.onControl({ type: "actor_snapshot_required", reason: "initial", cursor: 5 })
      await Promise.resolve()
    })
    expect(state.snapshot?.nodes[1].revision.session_metadata_version).toBe(8)
    expect(state.gapReason).toBeNull()

    const afterGap = actorSnapshotFixture()
    afterGap.nodes[1].revision.session_metadata_version = 9
    vi.mocked(getActorSnapshot).mockResolvedValueOnce(afterGap)
    await act(async () => {
      handlers.onControl({ type: "actor_snapshot_required", reason: "gap", cursor: 1 })
      await Promise.resolve()
    })
    expect(getActorSnapshot).toHaveBeenCalledTimes(3)
    expect(state.snapshot?.nodes[1].revision.session_metadata_version).toBe(9)
    expect(state.snapshot?.stream_cursor).toBeNull()
    expect(state.gapReason).toBe("transport_gap")

    const afterReconnect = actorSnapshotFixture()
    afterReconnect.nodes[1].revision.session_metadata_version = 10
    vi.mocked(getActorSnapshot).mockResolvedValueOnce(afterReconnect)
    await act(async () => { handlers.onGap(); await Promise.resolve() })
    expect(getActorSnapshot).toHaveBeenCalledTimes(4)
    expect(state.snapshot?.nodes[1].revision.session_metadata_version).toBe(10)
    expect(state.gapReason).toBe("transport_gap")
  })

  it("keeps the new Actor's cached initial refresh when the old Actor already queued one", async () => {
    await mount("root", true, "actor-0")
    const oldHandlers = vi.mocked(subscribeActor).mock.calls[0][1]
    vi.mocked(subscribeActor).mockImplementationOnce((actorId, handlers) => {
      expect(actorId).toBe("actor-1")
      handlers.onControl({ type: "actor_snapshot_required", reason: "initial", cursor: 9 })
      return { close: vi.fn() }
    })
    const event = { type: "actor_changed" as const, actor_id: "actor-0", root_actor_id: "root",
      parent_actor_id: "root", activation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      attempt: 1, event_id: `ae1-${"a".repeat(64)}`, class: "lifecycle" as const }
    act(() => {
      oldHandlers.onEvent(event, 2)
      root.render(<Harness id="root" active actorId="actor-1" />)
    })
    expect(subscribeActor).toHaveBeenCalledTimes(2)
    await act(async () => { await Promise.resolve() })
    expect(getActorSnapshot).toHaveBeenCalledTimes(2)
  })

  it("runs a trailing read when an event arrives during an initial-control refresh", async () => {
    const first = deferred(); const second = deferred(); const third = deferred()
    vi.mocked(getActorSnapshot).mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise).mockReturnValueOnce(third.promise)
    await mount("root", true, "actor-0")
    await act(async () => first.resolve(actorSnapshotFixture()))
    const handlers = vi.mocked(subscribeActor).mock.calls[0][1]
    await act(async () => {
      handlers.onControl({ type: "actor_snapshot_required", reason: "initial", cursor: 1 })
      await Promise.resolve()
    })
    expect(getActorSnapshot).toHaveBeenCalledTimes(2)
    handlers.onEvent({ type: "actor_changed", actor_id: "actor-0", root_actor_id: "root",
      parent_actor_id: "root", activation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
      attempt: 1, event_id: `ae1-${"b".repeat(64)}`, class: "lifecycle" }, 2)
    await act(async () => { await Promise.resolve() })
    expect(getActorSnapshot).toHaveBeenCalledTimes(2)
    await act(async () => second.resolve(actorSnapshotFixture()))
    expect(getActorSnapshot).toHaveBeenCalledTimes(3)
    const current = actorSnapshotFixture()
    current.nodes[1].revision.session_metadata_version = 8
    await act(async () => third.resolve(current))
    expect(state.snapshot?.nodes[1].revision.session_metadata_version).toBe(8)
  })

  it("retains typed transport and activation gaps after a new snapshot with no replay cursor", async () => {
    await mount("root", true, "actor-0")
    const handlers = vi.mocked(subscribeActor).mock.calls[0][1]
    await act(async () => { handlers.onGap(); await Promise.resolve() })
    expect(state.gapReason).toBe("transport_gap")
    expect(state.snapshot?.stream_cursor).toBeNull()
    const event = { type: "actor_changed" as const, actor_id: "actor-0", root_actor_id: "root",
      parent_actor_id: "root", activation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      attempt: 2, event_id: `ae1-${"b".repeat(64)}`, class: "lifecycle" as const }
    await act(async () => { handlers.onEvent(event, 5); await Promise.resolve() })
    expect(state.gapReason).toBe("activation_mismatch")
    expect(state.snapshot?.stream_cursor).toBeNull()
  })

  it("ignores an old activation frame after a newer authorized snapshot", async () => {
    const current = actorSnapshotFixture()
    current.nodes[1].activation = {
      activation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", attempt: 2, status: "running",
    }
    vi.mocked(getActorSnapshot).mockResolvedValueOnce(current)
    await mount("root", true, "actor-0")
    const handlers = vi.mocked(subscribeActor).mock.calls[0][1]
    await act(async () => {
      handlers.onEvent({
        type: "actor_changed", actor_id: "actor-0", root_actor_id: "root", parent_actor_id: "root",
        activation_id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", attempt: 1,
        event_id: `ae1-${"a".repeat(64)}`, class: "lifecycle",
      }, 2)
      await Promise.resolve()
    })
    expect(getActorSnapshot).toHaveBeenCalledOnce()
    expect(state.snapshot).toBe(current)
    expect(state.gapReason).toBeNull()
  })

  it("closes a departed interest and fences late callbacks across Root switches", async () => {
    await mount("root", true, "actor-0")
    const oldHandlers = vi.mocked(subscribeActor).mock.calls[0][1]
    const oldLease = vi.mocked(subscribeActor).mock.results[0].value
    vi.mocked(getActorSnapshot).mockResolvedValueOnce(actorSnapshotFixture("other"))
    await mount("other", true, "actor-0")
    expect(oldLease.close).toHaveBeenCalledOnce()
    expect(subscribeActor).toHaveBeenCalledTimes(2)
    const requests = vi.mocked(getActorSnapshot).mock.calls.length
    await act(async () => { oldHandlers.onGap(); await Promise.resolve() })
    expect(vi.mocked(getActorSnapshot).mock.calls).toHaveLength(requests)
    expect(state.gapReason).toBeNull()
    await mount("other", false, "actor-0")
    expect(vi.mocked(subscribeActor).mock.results[1].value.close).toHaveBeenCalledOnce()
  })

  it("does not subscribe for an Actor absent from the authorized snapshot", async () => {
    await mount("root", true, "unknown-child")
    expect(subscribeActor).not.toHaveBeenCalled()
    expect(state.snapshot?.root_actor_id).toBe("root")
  })

  it("reauthorizes after the view closes before restoring an Actor interest", async () => {
    await mount("root", true, "actor-0")
    await mount("root", false, "actor-0")
    expect(vi.mocked(subscribeActor).mock.results[0].value.close).toHaveBeenCalledOnce()
    const pending = deferred()
    vi.mocked(getActorSnapshot).mockReturnValueOnce(pending.promise)
    await mount("root", true, "actor-0")
    expect(subscribeActor).toHaveBeenCalledTimes(1)
    await act(async () => pending.resolve(actorSnapshotFixture()))
    expect(subscribeActor).toHaveBeenCalledTimes(2)
  })
})

describe("local actor snapshot lifecycle", () => {
  it("keeps a confirmed tree subscribed and retries a temporary transaction read", async () => {
    const cursor7 = `at1-${"a".repeat(64)}-7`
    const cursor8 = `at1-${"a".repeat(64)}-8`
    vi.mocked(getActorSnapshot).mockResolvedValueOnce(actorSnapshotFixture("root", 1, cursor7))
    await mount("root")
    const confirmed = state.snapshot
    const subscription = vi.mocked(subscribeActorTree).mock.results[0].value
    const handlers = vi.mocked(subscribeActorTree).mock.calls[0][2]
    vi.useFakeTimers()
    try {
      vi.mocked(getActorSnapshot).mockRejectedValueOnce(new ApiError("pending", 503, "Unavailable"))
        .mockResolvedValueOnce(actorSnapshotFixture("root", 1, cursor8))
      await act(async () => {
        handlers.onControl({ type: "actor_snapshot_required", reason: "changed", cursor: cursor8 })
        await Promise.resolve()
      })
      expect(state.snapshot).toBe(confirmed)
      expect(state.gapReason).toBe("transport_gap")
      expect(subscription.close).not.toHaveBeenCalled()
      expect(getActorSnapshot).toHaveBeenCalledTimes(2)

      await act(async () => { await vi.advanceTimersByTimeAsync(500) })
      expect(getActorSnapshot).toHaveBeenCalledTimes(3)
      expect(state.snapshot?.stream_cursor).toBe(cursor8)
      expect(state.gapReason).toBeNull()
    } finally {
      vi.useRealTimers()
    }
  })

  it("clears a tree gap only after a Root snapshot covers the directive cursor", async () => {
    const cursor7 = `at1-${"a".repeat(64)}-7`
    const cursor8 = `at1-${"a".repeat(64)}-8`
    vi.mocked(getActorSnapshot).mockResolvedValueOnce(actorSnapshotFixture("root", 0, cursor7))
    await mount("root")
    expect(subscribeActorTree).toHaveBeenCalledExactlyOnceWith("root", cursor7, expect.any(Object))
    expect(subscribeActor).not.toHaveBeenCalled()
    const handlers = vi.mocked(subscribeActorTree).mock.calls[0][2]
    vi.mocked(getActorSnapshot).mockResolvedValueOnce(actorSnapshotFixture("root", 1, cursor7))
    await act(async () => {
      handlers.onControl({ type: "actor_snapshot_required", reason: "changed", cursor: cursor8 })
      await Promise.resolve()
    })
    expect(state.snapshot?.nodes).toHaveLength(2)
    expect(state.gapReason).toBe("transport_gap")

    vi.mocked(getActorSnapshot).mockResolvedValueOnce(actorSnapshotFixture("root", 1, cursor8))
    await act(async () => state.refresh())
    expect(state.gapReason).toBeNull()
    expect(state.snapshot?.stream_cursor).toBe(cursor8)
    expect(subscribeActorTree).toHaveBeenLastCalledWith("root", cursor8, expect.any(Object))
  })

  it("does not use a tree cursor to erase a separate Actor event gap", async () => {
    const cursor7 = `at1-${"a".repeat(64)}-7`
    const cursor8 = `at1-${"a".repeat(64)}-8`
    vi.mocked(getActorSnapshot).mockResolvedValueOnce(actorSnapshotFixture("root", 1, cursor7))
    await mount("root", true, "actor-0")
    const handlers = vi.mocked(subscribeActor).mock.calls[0][1]
    vi.mocked(getActorSnapshot).mockResolvedValueOnce(actorSnapshotFixture("root", 1, cursor8))
    await act(async () => { handlers.onGap(); await Promise.resolve() })
    expect(state.snapshot?.stream_cursor).toBe(cursor8)
    expect(state.gapReason).toBe("transport_gap")
  })

  it("retains a legacy Root tree gap when no durable cursor can prove coverage", async () => {
    await mount("root")
    expect(subscribeActorTree).toHaveBeenCalledExactlyOnceWith("root", null, expect.any(Object))
    const handlers = vi.mocked(subscribeActorTree).mock.calls[0][2]
    await act(async () => {
      handlers.onControl({ type: "actor_snapshot_required", reason: "initial", cursor: null })
      await Promise.resolve()
    })
    expect(state.snapshot?.stream_cursor).toBeNull()
    expect(state.gapReason).toBe("transport_gap")
  })

  it("refreshes an authorized Root tree when the descendant index count changes without subscribing to unseen children", async () => {
    vi.mocked(getActorSnapshot).mockResolvedValueOnce(actorSnapshotFixture("root", 0))
      .mockResolvedValueOnce(actorSnapshotFixture("root", 1))
    await mount("root", true, null, 0)
    expect(state.snapshot?.nodes).toHaveLength(1)
    await mount("root", true, null, 1)
    expect(getActorSnapshot).toHaveBeenCalledTimes(2)
    expect(state.snapshot?.nodes).toHaveLength(2)
    expect(subscribeActor).not.toHaveBeenCalled()
  })

  it("retains the last confirmed Actor revision when a later authorized read is stale", async () => {
    const current: ActorSubtreeSnapshot = actorSnapshotFixture("root", 1)
    current.nodes[1].revision.session_metadata_version = 8
    current.nodes[1].revision.actor_directory_revision = 3
    current.nodes[1].activation = {
      activation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", attempt: 2, status: "running",
    }
    vi.mocked(getActorSnapshot).mockResolvedValueOnce(current)
    await mount("root", true, "actor-0")
    expect(subscribeActor).toHaveBeenCalledOnce()
    const stale: ActorSubtreeSnapshot = actorSnapshotFixture("root", 1)
    vi.mocked(getActorSnapshot).mockResolvedValueOnce(stale)
    await act(async () => state.refresh())
    expect(state.snapshot).toBe(current)
    expect(state.gapReason).toBe("snapshot_regression")
    expect(subscribeActor).toHaveBeenCalledOnce()

    const later: ActorSubtreeSnapshot = actorSnapshotFixture("root", 1)
    later.nodes[1].revision.session_metadata_version = 9
    later.nodes[1].revision.actor_directory_revision = 4
    later.nodes[1].activation = {
      activation_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", attempt: 2, status: "running",
    }
    vi.mocked(getActorSnapshot).mockResolvedValueOnce(later)
    await act(async () => state.refresh())
    expect(state.snapshot).toBe(later)
    expect(state.gapReason).toBeNull()
  })

  it("waits for an explicit Root scope and active Inspector", async () => {
    await mount(null); await mount("root", false)
    expect(getActorSnapshot).not.toHaveBeenCalled()
    await mount("root")
    expect(getActorSnapshot).toHaveBeenCalledExactlyOnceWith("root", "root", expect.any(AbortSignal))
    expect(state.snapshot?.nodes).toHaveLength(129)
  })

  it("aborts navigation and ignores late responses even if transport ignores abort", async () => {
    const old = deferred(); const next = deferred()
    vi.mocked(getActorSnapshot).mockReturnValueOnce(old.promise).mockReturnValueOnce(next.promise)
    await mount("root")
    const oldSignal = vi.mocked(getActorSnapshot).mock.calls[0][2]!
    await mount("other")
    expect(oldSignal.aborted).toBe(true); expect(state.snapshot).toBeNull()
    await act(async () => old.resolve(actorSnapshotFixture("root")))
    expect(state.snapshot).toBeNull(); expect(state.loading).toBe(true)
    await act(async () => next.resolve(actorSnapshotFixture("other", 0)))
    expect(state.snapshot?.root_actor_id).toBe("other")
  })

  it("cancels closing the Inspector without adding a timer or retry", async () => {
    const pending = deferred(); vi.mocked(getActorSnapshot).mockReturnValueOnce(pending.promise)
    await mount("root"); const signal = vi.mocked(getActorSnapshot).mock.calls[0][2]!
    await mount("root", false); expect(signal.aborted).toBe(true)
    await act(async () => pending.reject(new Error("late")))
    expect(state.error).toBeNull(); expect(getActorSnapshot).toHaveBeenCalledOnce()
  })

  it("manual refresh cancels its predecessor and treats snapshot IDs only as equality identities", async () => {
    await mount("root")
    const abandoned = deferred(); const current = deferred()
    vi.mocked(getActorSnapshot).mockReturnValueOnce(abandoned.promise).mockReturnValueOnce(current.promise)
    let first!: Promise<void>; let second!: Promise<void>
    act(() => { first = state.refresh() })
    expect(state.snapshot?.snapshot_id).toBe(`as1-${"a".repeat(64)}`)
    act(() => { second = state.refresh() })
    expect(vi.mocked(getActorSnapshot).mock.calls[1][2]?.aborted).toBe(true)
    const source = actorSnapshotFixture(); source.snapshot_id = `as1-${"0".repeat(64)}`
    await act(async () => { current.resolve(source); await second })
    await act(async () => { abandoned.resolve(actorSnapshotFixture("root", 0)); await first })
    expect(state.snapshot?.snapshot_id).toBe(source.snapshot_id)
    expect(state.snapshot?.nodes).toHaveLength(129)
  })

  it.each([[401, "权限"], [403, "权限"], [404, "暂不提供"], [501, "暂不提供"], [409, "正在变化"], [413, "读取上限"], [503, "暂时无法确认"]])(
    "clears stale success on HTTP %s and exposes a readable error", async (status, text) => {
      await mount("root")
      vi.mocked(getActorSnapshot).mockRejectedValueOnce(new ApiError("private payload", status, "Error", "broker-token"))
      await act(async () => state.refresh())
      expect(state.snapshot).toBeNull(); expect(state.loading).toBe(false)
      expect(state.error).toContain(text); expect(state.error).not.toContain("broker-token")
    },
  )
})

describe("snapshot-only ActorTree panel", () => {
  it.each(["__proto__", "constructor"])("does not fabricate prototype rows for valid %s scope", async (id) => {
    const pending = deferred(); vi.mocked(getActorSnapshot).mockReturnValueOnce(pending.promise)
    await act(async () => root.render(<ActorSnapshotPanel rootId={id} active selectedActorId={id} onSelectActor={vi.fn()} />))
    expect(host.querySelector('[role="treeitem"]')).toBeNull()
    await act(async () => pending.reject(new Error("unavailable")))
    expect(host.querySelector('[role="treeitem"]')).toBeNull()
    vi.mocked(getActorSnapshot).mockResolvedValueOnce(actorSnapshotFixture(id, 0))
    await act(async () => host.querySelector<HTMLButtonElement>('button[aria-label="刷新代理结构"]')!.click())
    expect(host.querySelector('[role="treeitem"]')?.getAttribute("data-actor-id")).toBe(id)
  })

  it("renders unknown durable observations and keeps expansion separate from explicit selection", async () => {
    const selected = vi.fn()
    await act(async () => root.render(<ActorSnapshotPanel rootId="root" active selectedActorId="root" onSelectActor={selected} />))
    expect(host.textContent).toContain("健康与队列信息尚未提供")
    const child = host.querySelector<HTMLElement>('[data-actor-id="actor-0"]')!
    expect(child.getAttribute("aria-label")).toContain("活动记录，远端，健康状态未知")
    act(() => child.querySelector<HTMLElement>("[data-actor-toggle]")!.click())
    expect(selected).not.toHaveBeenCalled(); expect(getActorSnapshot).toHaveBeenCalledOnce()
    expect(host.querySelectorAll('[role="treeitem"]').length).toBeLessThan(30)
    act(() => host.querySelector<HTMLElement>('[data-actor-id="actor-0"]')!.click())
    expect(selected).toHaveBeenCalledExactlyOnceWith("actor-0")
    act(() => host.querySelector<HTMLElement>('[data-actor-id="root"]')!.click())
    expect(selected).toHaveBeenLastCalledWith("root")
    const handlers = vi.mocked(subscribeActor).mock.calls[0][1]
    await act(async () => { handlers.onGap(); await Promise.resolve() })
    expect(host.querySelector('[data-actor-gap="transport_gap"]')?.textContent).toContain("连续性仍无法确认")
  })

  it("reveals an initially selected depth-three child when the snapshot arrives", async () => {
    const pending = deferred(); vi.mocked(getActorSnapshot).mockReturnValueOnce(pending.promise)
    const selected = vi.fn()
    await act(async () => root.render(<ActorSnapshotPanel rootId="root" active selectedActorId="actor-64" onSelectActor={selected} />))
    expect(host.textContent).toContain("正在载入")
    await act(async () => pending.resolve(actorSnapshotFixture()))
    expect(host.querySelector('[data-actor-id="actor-64"]')?.getAttribute("aria-selected")).toBe("true")
    expect(host.querySelector('[data-actor-id="actor-0"]')?.getAttribute("aria-expanded")).toBe("true")
    expect(selected).not.toHaveBeenCalled()
  })

  it("shows no-Root and failed reads without inventing an empty success", async () => {
    await act(async () => root.render(<ActorSnapshotPanel rootId={null} active selectedActorId={null} onSelectActor={vi.fn()} />))
    expect(host.textContent).toContain("选择 Root 会话"); expect(getActorSnapshot).not.toHaveBeenCalled()
    vi.mocked(getActorSnapshot).mockRejectedValueOnce(new Error("invalid"))
    await act(async () => root.render(<ActorSnapshotPanel rootId="root" active selectedActorId="root" onSelectActor={vi.fn()} />))
    expect(host.querySelector('[role="alert"]')?.textContent).toContain("暂时无法确认")
    expect(host.textContent).toContain("代理结构尚未确认")
    expect(host.querySelector('[role="tree"]')).toBeNull()
  })
})
