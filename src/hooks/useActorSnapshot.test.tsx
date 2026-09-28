import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { ApiError } from "@services/api/errors"
import { getActorSnapshot, type ActorSubtreeSnapshot } from "@services/chat/actorSnapshot"
import { ActorSnapshotPanel } from "@/components/chat/ActorSnapshotPanel"
import { actorSnapshotFixture } from "@/test/fixtures/actorSnapshot"
import { useActorSnapshot } from "./useActorSnapshot"

vi.mock("@services/chat/actorSnapshot", async (importOriginal) => ({
  ...await importOriginal<typeof import("@services/chat/actorSnapshot")>(), getActorSnapshot: vi.fn(),
}))
let root: Root
let host: HTMLDivElement
let state: ReturnType<typeof useActorSnapshot>
function Harness({ id, active = true }: { id: string | null; active?: boolean }) {
  state = useActorSnapshot(id, active)
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
  host = document.createElement("div"); document.body.appendChild(host); root = createRoot(host)
})
afterEach(() => { act(() => root.unmount()); host.remove(); vi.restoreAllMocks() })
const mount = async (id: string | null, active = true) => { await act(async () => root.render(<Harness id={id} active={active} />)) }

describe("local actor snapshot lifecycle", () => {
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
