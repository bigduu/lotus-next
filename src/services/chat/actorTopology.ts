/**
 * A transport-independent projection of the authorized ActorDirectory tree.
 * The gateway adapter must authorize and parse its wire DTO before calling
 * these functions. Only the public fields copied below can enter tree state.
 */

export type ActorLifecycle =
  | "cold"
  | "queued"
  | "running"
  | "suspended"
  | "completed"
  | "failed"
  | "cancelled"
  | "retired"
  | "lost"

export type ActorHealth =
  | "healthy"
  | "waiting"
  | "stalled"
  | "failed"
  | "orphaned"
  | "blocked_needs_input"
  | "lost"
  | "unknown"

export type ActorPlacement = "local" | "remote" | "container" | "scheduled" | "unknown"

/** The row may be extended by a wire DTO, but extra properties are never stored. */
export interface ActorTopologyRow {
  actorId: string
  rootActorId: string
  parentActorId: string | null
  title: string
  role: string | null
  lifecycle: ActorLifecycle
  placement: ActorPlacement
  health: ActorHealth
  queuedCount: number
  waitingForCount: number
  pendingRequestCount: number
  activationAttempt: number
  sequence: number
}

export interface ActorTopologyNode extends ActorTopologyRow {
  depth: number
}

export interface ActorTopologySnapshot {
  rootActorId: string
  revision: number
  actors: readonly ActorTopologyRow[]
}

export interface ActorTopologyEvent {
  rootActorId: string
  actorId: string
  activationAttempt: number
  sequence: number
  update:
    | { type: "activation_started"; lifecycle: ActorLifecycle }
    | {
        type: "state"
        lifecycle?: ActorLifecycle
        placement?: ActorPlacement
        health?: ActorHealth
        queuedCount?: number
        waitingForCount?: number
        pendingRequestCount?: number
      }
}

interface PendingGap {
  activationAttempt: number
  observedSequence: number
  /** Unknown actor events have no directory revision; an equal-revision omission is inconclusive. */
  unknownAtRevision?: number
}

export interface ActorTopologyState {
  rootActorId: string
  revision: number
  byId: Readonly<Record<string, ActorTopologyNode>>
  childrenById: Readonly<Record<string, readonly string[]>>
  /** A directory revision or event gap that requires an authoritative snapshot. */
  needsSnapshot: boolean
  requiredRevision: number
  pendingGaps: Readonly<Record<string, PendingGap>>
}

const MAX_TITLE_LENGTH = 160
const MAX_ROLE_LENGTH = 64
const safeCount = (value: number): number =>
  Number.isSafeInteger(value) && value >= 0 ? value : 0
const isSafeVersion = (value: number): boolean => Number.isSafeInteger(value) && value >= 0
const boundedText = (value: string, maximum: number): string => value.slice(0, maximum)

export const emptyActorTopology = (rootActorId: string): ActorTopologyState => ({
  rootActorId,
  revision: 0,
  byId: Object.create(null) as Record<string, ActorTopologyNode>,
  childrenById: Object.create(null) as Record<string, readonly string[]>,
  needsSnapshot: true,
  requiredRevision: 0,
  pendingGaps: Object.create(null) as Record<string, PendingGap>,
})

const projectNode = (row: ActorTopologyRow, depth: number): ActorTopologyNode => ({
  actorId: row.actorId,
  rootActorId: row.rootActorId,
  parentActorId: row.parentActorId,
  title: boundedText(row.title, MAX_TITLE_LENGTH),
  role: row.role === null ? null : boundedText(row.role, MAX_ROLE_LENGTH),
  lifecycle: row.lifecycle,
  placement: row.placement,
  health: row.health,
  queuedCount: safeCount(row.queuedCount),
  waitingForCount: safeCount(row.waitingForCount),
  pendingRequestCount: safeCount(row.pendingRequestCount),
  activationAttempt: row.activationAttempt,
  sequence: row.sequence,
  depth,
})

const sameNode = (left: ActorTopologyNode, right: ActorTopologyNode): boolean =>
  left.actorId === right.actorId &&
  left.rootActorId === right.rootActorId &&
  left.parentActorId === right.parentActorId &&
  left.title === right.title &&
  left.role === right.role &&
  left.lifecycle === right.lifecycle &&
  left.placement === right.placement &&
  left.health === right.health &&
  left.queuedCount === right.queuedCount &&
  left.waitingForCount === right.waitingForCount &&
  left.pendingRequestCount === right.pendingRequestCount &&
  left.activationAttempt === right.activationAttempt &&
  left.sequence === right.sequence &&
  left.depth === right.depth

const sameIds = (left: readonly string[] | undefined, right: readonly string[]): boolean =>
  left !== undefined &&
  left.length === right.length &&
  left.every((actorId, index) => actorId === right[index])

/**
 * Replace one complete authorized subtree. Orphans, foreign roots and cycles
 * are excluded even if a malformed snapshot contains them. Retired actors stay
 * in the tree until the authority removes them from a later snapshot.
 */
export const applyActorTopologySnapshot = (
  state: ActorTopologyState,
  snapshot: ActorTopologySnapshot,
): ActorTopologyState => {
  if (
    snapshot.rootActorId !== state.rootActorId ||
    !isSafeVersion(snapshot.revision) ||
    snapshot.revision < Math.max(state.revision, state.requiredRevision)
  ) return state

  const rows = new Map<string, ActorTopologyRow>()
  const duplicates = new Set<string>()
  for (const row of snapshot.actors) {
    if (
      !row.actorId ||
      row.rootActorId !== state.rootActorId ||
      !isSafeVersion(row.activationAttempt) ||
      !isSafeVersion(row.sequence)
    ) continue
    if (rows.has(row.actorId)) duplicates.add(row.actorId)
    else rows.set(row.actorId, row)
  }
  for (const actorId of duplicates) rows.delete(actorId)
  const root = rows.get(state.rootActorId)
  if (!root || root.parentActorId !== null) return state

  const children = new Map<string, string[]>()
  for (const row of rows.values()) {
    if (row.parentActorId === null) continue
    const siblings = children.get(row.parentActorId) ?? []
    siblings.push(row.actorId)
    children.set(row.parentActorId, siblings)
  }

  const byId: Record<string, ActorTopologyNode> = Object.create(null)
  const childrenById: Record<string, readonly string[]> = Object.create(null)
  const visited = new Set<string>()
  const queue: Array<{ actorId: string; depth: number }> = [{ actorId: state.rootActorId, depth: 0 }]
  for (let index = 0; index < queue.length; index += 1) {
    const { actorId, depth } = queue[index]
    if (visited.has(actorId)) continue
    const row = rows.get(actorId)
    if (!row) continue
    visited.add(actorId)

    const projected = projectNode(row, depth)
    const previous = Object.hasOwn(state.byId, actorId) ? state.byId[actorId] : undefined
    // A stale actor cursor cannot overwrite a newer attempt or live event.
    if (
      previous &&
      (projected.activationAttempt < previous.activationAttempt ||
        (projected.activationAttempt === previous.activationAttempt &&
          projected.sequence < previous.sequence))
    ) return state
    byId[actorId] = previous && sameNode(previous, projected) ? previous : projected

    const ids = (children.get(actorId) ?? []).filter((childId) => !visited.has(childId))
    const oldIds = Object.hasOwn(state.childrenById, actorId)
      ? state.childrenById[actorId] : undefined
    childrenById[actorId] = oldIds && sameIds(oldIds, ids) ? oldIds : ids
    for (const childId of ids) queue.push({ actorId: childId, depth: depth + 1 })
  }

  // One directory revision denotes one membership/parent topology. A delayed
  // equal-revision snapshot may refresh actor state but cannot undo a removal
  // or move (or introduce an actor absent from an accepted snapshot).
  if (snapshot.revision === state.revision && Object.hasOwn(state.byId, state.rootActorId)) {
    const previousIds = Object.keys(state.byId)
    if (
      previousIds.length !== Object.keys(byId).length ||
      previousIds.some((actorId) =>
        !Object.hasOwn(byId, actorId) ||
        state.byId[actorId].parentActorId !== byId[actorId].parentActorId)
    ) return state
  }

  for (const [actorId, gap] of Object.entries(state.pendingGaps)) {
    const row = byId[actorId]
    if (!row && gap.unknownAtRevision !== undefined && snapshot.revision <= gap.unknownAtRevision) {
      return state
    }
    if (
      row &&
      (row.activationAttempt < gap.activationAttempt ||
        (row.activationAttempt === gap.activationAttempt && row.sequence < gap.observedSequence))
    ) return state
  }

  return {
    rootActorId: state.rootActorId,
    revision: snapshot.revision,
    byId,
    childrenById,
    needsSnapshot: false,
    requiredRevision: snapshot.revision,
    pendingGaps: Object.create(null) as Record<string, PendingGap>,
  }
}

/** Directory add/move/remove events request a complete snapshot. */
export const markActorDirectoryChanged = (
  state: ActorTopologyState,
  revision: number,
): ActorTopologyState => {
  if (!isSafeVersion(revision) || revision <= state.revision && !state.needsSnapshot) return state
  const requiredRevision = Math.max(state.requiredRevision, revision)
  return state.needsSnapshot && requiredRevision === state.requiredRevision
    ? state
    : { ...state, needsSnapshot: true, requiredRevision }
}

const markActorGap = (
  state: ActorTopologyState,
  actorId: string,
  activationAttempt: number,
  sequence: number,
  unknownAtRevision?: number,
): ActorTopologyState => {
  const current = Object.hasOwn(state.pendingGaps, actorId)
    ? state.pendingGaps[actorId] : undefined
  const nextUnknownAtRevision = current?.unknownAtRevision ?? unknownAtRevision
  const newer = !current || activationAttempt > current.activationAttempt ||
    (activationAttempt === current.activationAttempt && sequence > current.observedSequence)
  if (!newer && nextUnknownAtRevision === current?.unknownAtRevision) return state
  return {
    ...state,
    needsSnapshot: true,
    pendingGaps: {
      ...state.pendingGaps,
      [actorId]: {
        activationAttempt: newer ? activationAttempt : current!.activationAttempt,
        observedSequence: newer ? sequence : current!.observedSequence,
        ...(nextUnknownAtRevision === undefined ? {} : { unknownAtRevision: nextUnknownAtRevision }),
      },
    },
  }
}

/** Apply low-volume actor state only. Transcript/token events stay isolated. */
export const applyActorTopologyEvent = (
  state: ActorTopologyState,
  event: ActorTopologyEvent,
): ActorTopologyState => {
  if (
    event.rootActorId !== state.rootActorId ||
    !isSafeVersion(event.activationAttempt) ||
    !isSafeVersion(event.sequence)
  ) return state
  const current = Object.hasOwn(state.byId, event.actorId)
    ? state.byId[event.actorId] : undefined
  if (!current) {
    return markActorGap(
      state, event.actorId, event.activationAttempt, event.sequence, state.revision,
    )
  }
  if (event.activationAttempt < current.activationAttempt) return state
  if (
    event.activationAttempt === current.activationAttempt &&
    event.sequence <= current.sequence
  ) return state
  if (Object.hasOwn(state.pendingGaps, event.actorId)) {
    return markActorGap(state, event.actorId, event.activationAttempt, event.sequence)
  }
  if (
    event.activationAttempt > current.activationAttempt
      ? event.sequence !== 1 || event.update.type !== "activation_started"
      : event.sequence !== current.sequence + 1
  ) return markActorGap(state, event.actorId, event.activationAttempt, event.sequence)

  const update = event.update
  const next: ActorTopologyNode = {
    ...current,
    activationAttempt: event.activationAttempt,
    sequence: event.sequence,
    lifecycle: update.lifecycle ?? current.lifecycle,
    placement: update.type === "state" && update.placement !== undefined
      ? update.placement : current.placement,
    health: update.type === "state" && update.health !== undefined
      ? update.health : current.health,
    queuedCount: update.type === "state" && update.queuedCount !== undefined
      ? safeCount(update.queuedCount) : current.queuedCount,
    waitingForCount: update.type === "state" && update.waitingForCount !== undefined
      ? safeCount(update.waitingForCount) : current.waitingForCount,
    pendingRequestCount: update.type === "state" && update.pendingRequestCount !== undefined
      ? safeCount(update.pendingRequestCount) : current.pendingRequestCount,
  }
  return {
    ...state,
    byId: Object.assign(Object.create(null) as Record<string, ActorTopologyNode>, state.byId, {
      [event.actorId]: next,
    }),
  }
}
