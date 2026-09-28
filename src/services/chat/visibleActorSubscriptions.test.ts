import { describe, expect, it, vi } from "vitest"

import {
  applyActorTopologySnapshot,
  emptyActorTopology,
  markActorDirectoryChanged,
  type ActorTopologyRow,
  type ActorTopologyState,
} from "./actorTopology"
import {
  VisibleActorSubscriptions,
  type ActorContentPort,
} from "./visibleActorSubscriptions"

type Event = { kind: "snapshot" | "delta"; text: string }
type Handlers = Parameters<ActorContentPort<number, Event>["subscribe"]>[2]

const row = (
  actorId: string,
  parentActorId: string | null,
  activationAttempt = 0,
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
  activationAttempt,
  sequence: 0,
})

const topology = (
  revision: number,
  actors: ActorTopologyRow[],
  previous: ActorTopologyState = emptyActorTopology("root"),
): ActorTopologyState => applyActorTopologySnapshot(previous, {
  rootActorId: "root", revision, actors,
})

const deferred = <T,>() => {
  let resolve!: (value: T) => void
  let reject!: (reason: Error) => void
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no })
  return { promise, resolve, reject }
}

class FakePort implements ActorContentPort<number, Event> {
  opens: Array<{
    actorId: string
    cursor: number | null
    handlers: Handlers
    closed: boolean
  }> = []
  recoveries: Array<{
    actorId: string
    cursor: number | null
    pending: ReturnType<typeof deferred<{ snapshot: Event; cursor: number | null; terminal?: boolean }>>
  }> = []

  subscribe(actorId: string, cursor: number | null, handlers: Handlers) {
    const channel = { actorId, cursor, handlers, closed: false }
    this.opens.push(channel)
    return { close: () => { channel.closed = true } }
  }

  recover(actorId: string, cursor: number | null) {
    const pending = deferred<{ snapshot: Event; cursor: number | null; terminal?: boolean }>()
    this.recoveries.push({ actorId, cursor, pending })
    return pending.promise
  }

  active() {
    return this.opens.filter((channel) => !channel.closed)
  }

  latest(actorId: string) {
    return this.opens.filter((channel) => channel.actorId === actorId).at(-1)!
  }
}

const flush = async () => {
  await Promise.resolve()
  await Promise.resolve()
  await Promise.resolve()
}

describe("visible ActorSession subscriptions", () => {
  it("opens only visible logical channels for 128 descendants and shares one per ActorId", () => {
    const actors = [row("root", null)]
    for (let index = 0; index < 128; index += 1) {
      actors.push(row(`actor-${index}`, index < 8 ? "root" : `actor-${Math.floor(index / 8) - 1}`))
    }
    const port = new FakePort()
    const manager = new VisibleActorSubscriptions(topology(1, actors), port)
    const selected = vi.fn()
    const preview = vi.fn()
    const first = manager.acquire("actor-0", "selected", selected)
    const second = manager.acquire("actor-1", "expanded", vi.fn())
    const third = manager.acquire("actor-1", "previewed", preview)
    const unknown = manager.acquire("not-authorized", "selected", vi.fn())

    expect(port.active().map((channel) => channel.actorId).sort()).toEqual(["actor-0", "actor-1"])
    expect(manager.referenceCount("actor-1")).toBe(2)
    expect(manager.referenceCount("actor-1", "previewed")).toBe(1)
    expect(manager.referenceCount("not-authorized")).toBe(1)
    port.latest("actor-1").handlers.onEvent({ kind: "delta", text: "hello" }, 3)
    expect(preview).toHaveBeenCalledWith({ kind: "delta", text: "hello" })
    expect(selected).not.toHaveBeenCalled()

    third.close()
    third.close()
    expect(port.active()).toHaveLength(2)
    second.close()
    expect(port.active().map((channel) => channel.actorId)).toEqual(["actor-0"])
    first.close()
    unknown.close()
    expect(port.active()).toHaveLength(0)
    expect(manager.referenceCount("actor-1")).toBe(0)
  })

  it("reconnects only held actors from their latest cursors and fences late old-channel events", () => {
    const port = new FakePort()
    const manager = new VisibleActorSubscriptions(topology(1, [
      row("root", null), row("a", "root"), row("b", "root"),
    ]), port)
    const observed = vi.fn()
    manager.acquire("a", "selected", observed)
    const b = manager.acquire("b", "previewed", vi.fn())
    const oldA = port.latest("a")
    oldA.handlers.onEvent({ kind: "delta", text: "first" }, 12)
    port.latest("b").handlers.onEvent({ kind: "delta", text: "other" }, 5)
    b.close()

    manager.reconnect()
    expect(port.active()).toHaveLength(1)
    expect(port.latest("a").cursor).toBe(12)
    expect(port.opens.filter((channel) => channel.actorId === "b")).toHaveLength(1)
    oldA.handlers.onEvent({ kind: "delta", text: "stale" }, 13)
    expect(observed).toHaveBeenCalledTimes(1)

    port.latest("a").handlers.onTerminal()
    expect(port.active()).toHaveLength(0)
    manager.reconnect()
    expect(port.active()).toHaveLength(0)
    manager.updateTopology(topology(2, [
      row("root", null), row("a", "root", 1), row("b", "root"),
    ], topology(1, [row("root", null), row("a", "root"), row("b", "root")])) )
    expect(port.latest("a").cursor).toBeNull()
    expect(port.active()).toHaveLength(1)
  })

  it("shares one durable terminal recovery with listeners that join after the channel closes", async () => {
    const port = new FakePort()
    const manager = new VisibleActorSubscriptions(topology(1, [
      row("root", null), row("a", "root"),
    ]), port)
    const original = vi.fn()
    manager.acquire("a", "selected", original)
    port.latest("a").handlers.onEvent({ kind: "delta", text: "live" }, 7)
    port.latest("a").handlers.onTerminal()
    expect(port.active()).toHaveLength(0)

    const preview = vi.fn()
    const inspector = vi.fn()
    manager.acquire("a", "previewed", preview)
    manager.acquire("a", "selected", inspector)
    expect(port.recoveries).toMatchObject([{ actorId: "a", cursor: 7 }])
    expect(port.active()).toHaveLength(0)
    port.recoveries[0].pending.resolve({
      snapshot: { kind: "snapshot", text: "durable final history" }, cursor: 8, terminal: true,
    })
    await flush()
    expect(preview).toHaveBeenCalledExactlyOnceWith({ kind: "snapshot", text: "durable final history" })
    expect(inspector).toHaveBeenCalledExactlyOnceWith({ kind: "snapshot", text: "durable final history" })
    expect(original).toHaveBeenCalledExactlyOnceWith({ kind: "delta", text: "live" })

    const later = vi.fn()
    manager.acquire("a", "previewed", later)
    expect(later).toHaveBeenCalledExactlyOnceWith({ kind: "snapshot", text: "durable final history" })
    expect(port.recoveries).toHaveLength(1)
    manager.dispose()
  })

  it("retries failed terminal history and fences it after an activation replacement", async () => {
    const port = new FakePort()
    const first = topology(1, [row("root", null), row("a", "root")])
    const manager = new VisibleActorSubscriptions(first, port)
    manager.acquire("a", "selected", vi.fn())
    port.latest("a").handlers.onTerminal()
    const late = vi.fn()
    manager.acquire("a", "previewed", late)
    port.recoveries[0].pending.reject(new Error("temporarily offline"))
    await flush()
    expect(late).not.toHaveBeenCalled()
    manager.retry("a")
    expect(port.recoveries).toHaveLength(2)

    manager.updateTopology(markActorDirectoryChanged(first, 2))
    manager.updateTopology(topology(2, [
      row("root", null), row("a", "root", 1),
    ], first))
    port.recoveries[1].pending.resolve({
      snapshot: { kind: "snapshot", text: "stale final history" }, cursor: 9, terminal: true,
    })
    await flush()
    expect(late).not.toHaveBeenCalled()
    expect(port.active().map((channel) => channel.actorId)).toEqual(["a"])
    port.latest("a").handlers.onEvent({ kind: "delta", text: "new activation" }, 1)
    expect(late).toHaveBeenCalledExactlyOnceWith({ kind: "delta", text: "new activation" })
    manager.dispose()
  })

  it("recovers a gap from a snapshot before admitting later events", async () => {
    const port = new FakePort()
    const manager = new VisibleActorSubscriptions(topology(1, [
      row("root", null), row("a", "root"),
    ]), port)
    const observed = vi.fn()
    manager.acquire("a", "selected", observed)
    const old = port.latest("a")
    old.handlers.onEvent({ kind: "delta", text: "before" }, 10)
    old.handlers.onGap()
    expect(port.active()).toHaveLength(0)
    expect(port.recoveries).toMatchObject([{ actorId: "a", cursor: 10 }])
    old.handlers.onEvent({ kind: "delta", text: "late" }, 11)
    expect(observed).toHaveBeenCalledTimes(1)

    port.recoveries[0].pending.resolve({ snapshot: { kind: "snapshot", text: "recovered" }, cursor: 15 })
    await flush()
    expect(observed.mock.calls.map(([event]) => event.text)).toEqual(["before", "recovered"])
    expect(port.latest("a").cursor).toBe(15)
    port.latest("a").handlers.onEvent({ kind: "delta", text: "tail" }, 16)
    expect(observed.mock.calls.map(([event]) => event.text)).toEqual([
      "before", "recovered", "tail",
    ])
  })

  it("closes removed and stale-directory actors, and never revives a released recovery", async () => {
    const port = new FakePort()
    const first = topology(1, [row("root", null), row("a", "root"), row("b", "root")])
    const manager = new VisibleActorSubscriptions(first, port)
    const a = manager.acquire("a", "selected", vi.fn())
    const b = manager.acquire("b", "expanded", vi.fn())
    port.latest("a").handlers.onEvent({ kind: "delta", text: "a" }, 4)

    manager.updateTopology(markActorDirectoryChanged(first, 2))
    expect(port.active()).toHaveLength(0)
    const next = topology(2, [row("root", null), row("a", "root")], first)
    manager.updateTopology(next)
    expect(port.active().map((channel) => channel.actorId)).toEqual(["a"])
    expect(port.latest("a").cursor).toBe(4)

    port.latest("a").handlers.onGap()
    a.close()
    port.recoveries[0].pending.resolve({ snapshot: { kind: "snapshot", text: "late" }, cursor: 7 })
    await flush()
    expect(port.active()).toHaveLength(0)
    expect(manager.referenceCount("b")).toBe(1)
    b.close()
    manager.dispose()
    expect(port.active()).toHaveLength(0)
    expect(() => manager.acquire("a", "selected", vi.fn())).toThrow("disposed")
  })

  it("retains a failed gap for explicit retry without leaking a channel", async () => {
    const port = new FakePort()
    const manager = new VisibleActorSubscriptions(topology(1, [
      row("root", null), row("a", "root"),
    ]), port)
    manager.acquire("a", "previewed", vi.fn())
    port.latest("a").handlers.onGap()
    port.recoveries[0].pending.reject(new Error("temporarily offline"))
    await flush()
    expect(port.active()).toHaveLength(0)

    manager.retry("a")
    expect(port.recoveries).toHaveLength(2)
    port.recoveries[1].pending.resolve({
      snapshot: { kind: "snapshot", text: "recovered" }, cursor: 9,
    })
    await flush()
    expect(port.latest("a").cursor).toBe(9)
    manager.dispose()
    expect(port.active()).toHaveLength(0)
  })

  it("fences recovery across a directory refresh and opens newly authorized interests", async () => {
    const port = new FakePort()
    const first = topology(1, [row("root", null), row("a", "root")])
    const manager = new VisibleActorSubscriptions(first, port)
    manager.acquire("a", "selected", vi.fn())
    manager.acquire("b", "previewed", vi.fn())
    expect(port.active().map((channel) => channel.actorId)).toEqual(["a"])

    port.latest("a").handlers.onGap()
    manager.updateTopology(markActorDirectoryChanged(first, 2))
    port.recoveries[0].pending.resolve({
      snapshot: { kind: "snapshot", text: "stale" }, cursor: 3,
    })
    await flush()
    expect(port.active()).toHaveLength(0)

    manager.updateTopology(topology(2, [
      row("root", null), row("a", "root"), row("b", "root"),
    ], first))
    expect(port.active().map((channel) => channel.actorId)).toEqual(["b"])
    expect(port.recoveries).toHaveLength(2)
    port.recoveries[1].pending.resolve({
      snapshot: { kind: "snapshot", text: "current" }, cursor: 5,
    })
    await flush()
    expect(port.active().map((channel) => channel.actorId).sort()).toEqual(["a", "b"])
    expect(port.latest("a").cursor).toBe(5)
  })
})
