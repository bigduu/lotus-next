import type { ActorTopologyState } from "./actorTopology"

export type ActorInterest = "selected" | "expanded" | "previewed"

export interface ActorSubscriptionLease {
  close(): void
}

/**
 * The Bamboo gateway adapter owns the single authenticated v2 connection.
 * This manager only opens logical ActorId channels; it never sees endpoints,
 * credentials, broker identities or transport frames.
 *
 * Cursor is deliberately opaque until Bamboo #928/#929 fixes the actor wire
 * contract. The adapter must validate ordering and call onGap when replay is
 * incomplete. recover() must return a snapshot and a cursor that covers it.
 */
export interface ActorContentPort<Cursor, Event> {
  subscribe(
    actorId: string,
    cursor: Cursor | null,
    handlers: {
      onEvent(event: Event, cursor: Cursor): void
      onGap(): void
      /** Called only after the actor's final content is durably recoverable. */
      onTerminal(): void
    },
  ): ActorSubscriptionLease
  recover(actorId: string, cursor: Cursor | null): Promise<{
    snapshot: Event
    cursor: Cursor | null
    terminal?: boolean
  }>
}

interface Listener<Event> {
  interest: ActorInterest
  onEvent: (event: Event) => void
  needsTerminalReplay: boolean
}

interface ActorEntry<Cursor, Event> {
  actorId: string
  listeners: Set<Listener<Event>>
  subscription: ActorSubscriptionLease | null
  cursor: Cursor | null
  observedAttempt: number | null
  terminalAttempt: number | null
  terminalSnapshot: { event: Event } | null
  terminalRecovery: boolean
  epoch: number
  recovering: boolean
  needsRecovery: boolean
}

/** One manager belongs to one authorized root tree. Dispose it on navigation. */
export class VisibleActorSubscriptions<Cursor, Event> {
  private topology: ActorTopologyState
  private readonly entries = new Map<string, ActorEntry<Cursor, Event>>()
  private disposed = false

  constructor(
    topology: ActorTopologyState,
    private readonly port: ActorContentPort<Cursor, Event>,
  ) {
    this.topology = topology
  }

  acquire(
    actorId: string,
    interest: ActorInterest,
    onEvent: (event: Event) => void,
  ): ActorSubscriptionLease {
    if (this.disposed) throw new Error("Actor subscription manager is disposed")
    let entry = this.entries.get(actorId)
    if (!entry) {
      entry = {
        actorId,
        listeners: new Set(),
        subscription: null,
        cursor: null,
        observedAttempt: null,
        terminalAttempt: null,
        terminalSnapshot: null,
        terminalRecovery: false,
        epoch: 0,
        recovering: false,
        needsRecovery: false,
      }
      this.entries.set(actorId, entry)
    }
    const listener: Listener<Event> = { interest, onEvent, needsTerminalReplay: false }
    entry.listeners.add(listener)
    this.sync(entry)
    // A terminal channel is closed once its content is durable. A later pane
    // needs that durable snapshot even while another pane still holds a lease.
    if (entry.terminalAttempt !== null && entry.terminalAttempt === this.authorizedAttempt(entry)) {
      listener.needsTerminalReplay = true
      this.replayTerminal(entry)
    }

    let closed = false
    return {
      close: () => {
        if (closed) return
        closed = true
        entry.listeners.delete(listener)
        if (entry.listeners.size === 0) {
          this.closeEntry(entry)
          this.entries.delete(actorId)
        }
      },
    }
  }

  /** Reconcile authorization and attempt changes from the normalized #239 tree. */
  updateTopology(topology: ActorTopologyState): void {
    if (this.disposed) return
    if (topology.rootActorId !== this.topology.rootActorId) {
      throw new Error("Dispose the actor subscription manager before changing roots")
    }
    this.topology = topology
    for (const entry of this.entries.values()) this.sync(entry)
  }

  /**
   * Called by a gateway adapter only when it does not resubscribe itself.
   * The existing message v2 client already does that on socket reconnect.
   */
  reconnect(): void {
    if (this.disposed) return
    for (const entry of this.entries.values()) {
      if (entry.recovering) continue
      this.closeChannel(entry)
      if (entry.needsRecovery) this.beginRecovery(entry)
      else this.sync(entry)
    }
  }

  /** Retry a failed snapshot recovery or failed logical subscribe. */
  retry(actorId: string): void {
    if (this.disposed) return
    const entry = this.entries.get(actorId)
    if (!entry || entry.recovering) return
    if (entry.needsRecovery) this.beginRecovery(entry)
    else this.sync(entry)
  }

  activeActorIds(): string[] {
    return [...this.entries.values()]
      .filter((entry) => entry.subscription !== null)
      .map((entry) => entry.actorId)
  }

  referenceCount(actorId: string, interest?: ActorInterest): number {
    const listeners = this.entries.get(actorId)?.listeners
    if (!listeners) return 0
    if (!interest) return listeners.size
    return [...listeners].filter((listener) => listener.interest === interest).length
  }

  dispose(): void {
    if (this.disposed) return
    this.disposed = true
    for (const entry of this.entries.values()) this.closeEntry(entry)
    this.entries.clear()
  }

  private authorizedAttempt(entry: ActorEntry<Cursor, Event>): number | null {
    // A directory revision still in flight could have removed access. Keep
    // leases dormant until a sufficiently new complete snapshot arrives.
    if (this.topology.requiredRevision > this.topology.revision) return null
    const node = Object.hasOwn(this.topology.byId, entry.actorId)
      ? this.topology.byId[entry.actorId] : undefined
    return node?.activationAttempt ?? null
  }

  private sync(entry: ActorEntry<Cursor, Event>): void {
    if (this.disposed || entry.listeners.size === 0) return
    const attempt = this.authorizedAttempt(entry)
    if (attempt === null) {
      const wasRecovering = entry.recovering
      this.closeChannel(entry)
      entry.terminalSnapshot = null
      entry.terminalRecovery = false
      if (wasRecovering) {
        entry.recovering = false
        entry.needsRecovery = true
      }
      // Removal from a complete snapshot invalidates a previous content cursor.
      if (!Object.hasOwn(this.topology.byId, entry.actorId)) {
        entry.cursor = null
        entry.observedAttempt = null
        entry.terminalAttempt = null
        entry.needsRecovery = false
        entry.recovering = false
      }
      return
    }
    if (entry.observedAttempt !== null && entry.observedAttempt !== attempt) {
      this.closeChannel(entry)
      entry.cursor = null
      entry.terminalAttempt = null
      entry.terminalSnapshot = null
      entry.terminalRecovery = false
      for (const listener of entry.listeners) listener.needsTerminalReplay = false
      entry.needsRecovery = false
      entry.recovering = false
    }
    entry.observedAttempt = attempt
    if (entry.recovering) return
    if (entry.terminalAttempt === attempt) {
      this.replayTerminal(entry)
      return
    }
    if (entry.needsRecovery) {
      this.beginRecovery(entry)
      return
    }
    if (entry.subscription === null) this.open(entry)
  }

  private open(entry: ActorEntry<Cursor, Event>): void {
    const epoch = ++entry.epoch
    let subscription: ActorSubscriptionLease
    try {
      subscription = this.port.subscribe(entry.actorId, entry.cursor, {
        onEvent: (event, cursor) => {
          if (this.disposed || entry.epoch !== epoch || entry.recovering) return
          entry.cursor = cursor
          this.publish(entry, event)
        },
        onGap: () => {
          if (this.disposed || entry.epoch !== epoch) return
          this.beginRecovery(entry)
        },
        onTerminal: () => {
          if (this.disposed || entry.epoch !== epoch) return
          entry.terminalAttempt = entry.observedAttempt
          entry.needsRecovery = false
          this.closeChannel(entry)
        },
      })
    } catch {
      // A failed subscribe cannot create a hot loop. retry() or a future
      // transport reconnect attempts it again while the interest remains.
      return
    }
    if (entry.epoch !== epoch || this.disposed || this.authorizedAttempt(entry) === null) {
      subscription.close()
      return
    }
    entry.subscription = subscription
  }

  private beginRecovery(entry: ActorEntry<Cursor, Event>): void {
    if (this.disposed || entry.listeners.size === 0 || this.authorizedAttempt(entry) === null) return
    this.closeChannel(entry)
    entry.recovering = true
    entry.needsRecovery = true
    const epoch = entry.epoch
    const cursor = entry.cursor
    let recovery: ReturnType<ActorContentPort<Cursor, Event>["recover"]>
    try {
      recovery = this.port.recover(entry.actorId, cursor)
    } catch {
      entry.recovering = false
      return
    }
    void recovery.then((result) => {
      if (this.disposed || entry.epoch !== epoch || !entry.recovering) return
      entry.recovering = false
      if (this.authorizedAttempt(entry) === null || entry.listeners.size === 0) return
      entry.cursor = result.cursor
      entry.needsRecovery = false
      this.publish(entry, result.snapshot)
      if (result.terminal) entry.terminalAttempt = entry.observedAttempt
      this.sync(entry)
    }).catch(() => {
      if (this.disposed || entry.epoch !== epoch) return
      entry.recovering = false
      // Keep the channel closed until retry/reconnect; never resume from a
      // cursor whose missing range was not recovered.
    })
  }

  private replayTerminal(entry: ActorEntry<Cursor, Event>): void {
    const attempt = this.authorizedAttempt(entry)
    if (this.disposed || attempt === null || entry.terminalAttempt !== attempt
      || ![...entry.listeners].some((listener) => listener.needsTerminalReplay)) return
    if (entry.terminalSnapshot !== null) {
      this.deliverTerminalSnapshot(entry, entry.terminalSnapshot.event)
      return
    }
    if (entry.terminalRecovery) return
    const epoch = entry.epoch
    let recovery: ReturnType<ActorContentPort<Cursor, Event>["recover"]>
    entry.terminalRecovery = true
    try {
      recovery = this.port.recover(entry.actorId, entry.cursor)
    } catch {
      entry.terminalRecovery = false
      return
    }
    void recovery.then(({ snapshot }) => {
      if (this.disposed || this.entries.get(entry.actorId) !== entry || entry.epoch !== epoch
        || entry.terminalAttempt !== attempt || this.authorizedAttempt(entry) !== attempt) return
      entry.terminalSnapshot = { event: snapshot }
      this.deliverTerminalSnapshot(entry, snapshot)
    }).catch(() => {
      // Keep interested listeners pending for an explicit retry.
    }).finally(() => {
      if (entry.epoch === epoch) entry.terminalRecovery = false
    })
  }

  private deliverTerminalSnapshot(entry: ActorEntry<Cursor, Event>, snapshot: Event): void {
    for (const listener of [...entry.listeners]) {
      if (!listener.needsTerminalReplay) continue
      listener.needsTerminalReplay = false
      try {
        listener.onEvent(snapshot)
      } catch {
        // One pane must not stop delivery to another interested pane.
      }
    }
  }

  private publish(entry: ActorEntry<Cursor, Event>, event: Event): void {
    for (const listener of [...entry.listeners]) {
      try {
        listener.onEvent(event)
      } catch {
        // One pane must not stop delivery to another interested pane.
      }
    }
  }

  private closeChannel(entry: ActorEntry<Cursor, Event>): void {
    entry.epoch += 1
    const subscription = entry.subscription
    entry.subscription = null
    subscription?.close()
  }

  private closeEntry(entry: ActorEntry<Cursor, Event>): void {
    this.closeChannel(entry)
    entry.listeners.clear()
    entry.recovering = false
    entry.needsRecovery = false
    entry.terminalSnapshot = null
    entry.terminalRecovery = false
  }
}
