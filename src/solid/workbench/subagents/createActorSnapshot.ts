import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import { uiText } from "@shared/i18n/text"
import { isApiError, NetworkRequestError, RequestTimeoutError } from "@services/api/errors"
import { actorSnapshotRegresses, actorTreeCursorCovers, getActorSnapshot, InvalidActorSnapshotError, type ActorSubtreeSnapshot } from "@services/chat/actorSnapshot"
import { subscribeActor, subscribeActorTree } from "@services/chat/v2Stream"

export type ActorSnapshotGapReason = "transport_gap" | "scope_mismatch" | "activation_mismatch" | "snapshot_regression"

interface SnapshotState {
  rootId: string | null
  snapshot: ActorSubtreeSnapshot | null
  loading: boolean
  error: string | null
  /** Classification of the retained error; only UI affordances read it. */
  retryable: boolean
  /** A gap clears only when its own authority domain is proven recovered. */
  gapReason: ActorSnapshotGapReason | null
  /** Origin of the retained Actor warning; null for Root/tree observations. */
  gapActorId: string | null
}

function failureMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 401 || error.status === 403) return uiText("this_connection_cannot_read_agent_structure_check_bambo_2abedc8d")
    if (error.status === 404 || error.status === 501) return uiText("this_bamboo_version_does_not_provide_agent_structure_ch_ae23a7fe")
    if (error.status === 409) return uiText("agent_structure_or_permissions_are_changing_and_cannot__bc1899b0")
    if (error.status === 413) return uiText("agent_structure_exceeds_the_current_read_limit_and_cann_a53518ef")
    if (error.status >= 500) return uiText("bamboo_is_temporarily_unavailable_check_that_the_servic_f2489632")
  }
  if (error instanceof InvalidActorSnapshotError) return uiText("the_agent_structure_response_is_invalid_or_unsupported__d3bdb4ac")
  if (error instanceof RequestTimeoutError) return uiText("actor_structure_read_timeout")
  if (error instanceof NetworkRequestError) return uiText("actor_structure_read_network")
  return uiText("agent_structure_cannot_be_confirmed_right_now_reload_st_2ba610a7")
}

function retryableSnapshotFailure(error: unknown): boolean {
  if (isApiError(error)) return error.status === 409 || (error.status >= 500 && error.status !== 501)
  return error instanceof NetworkRequestError || error instanceof RequestTimeoutError
}

/** A public snapshot view with one selected or previewed Actor interest. */
export function createActorSnapshot(
  rootId: Accessor<string | null>,
  active: Accessor<boolean>,
  interestedActorId: Accessor<string | null>,
  descendantCountHint: Accessor<number | null>,
) {
  const [state, setState] = createSignal<SnapshotState>({ rootId: null, snapshot: null, loading: false, error: null, retryable: false, gapReason: null, gapActorId: null })
  let generation = 0
  let request: AbortController | null = null
  let retryTimer: ReturnType<typeof setTimeout> | null = null
  let retryAttempts = 0
  let expiryTimer: ReturnType<typeof setTimeout> | null = null
  // One bounded observation set, independent of titles, transport hints and cursors.
  let expiryObservation: { key: string; due: number; consumed: boolean } | null = null
  let refreshQueued: string | null = null
  let refreshAfterFlight = false
  let snapshotRef: ActorSubtreeSnapshot | null = null
  // Keep the latest unresolved Actor observation tied to its subscription,
  // even when another Child is selected. A tree snapshot cannot repair replay.
  let workerGap: { reason: ActorSnapshotGapReason; actorId: string } | null = null
  /** undefined means no tree gap; null means the old Root has no proof cursor. */
  let requiredTreeCursor: string | null | undefined = undefined
  let lastCountHint: { rootId: string | null; count: number | null } = { rootId: null, count: null }
  const scope = () => ({ rootId: rootId(), active: active(), interestedActorId: interestedActorId() })
  const refresh = async () => {
    const current = scope()
    if (!current.rootId || !current.active) return
    const id = current.rootId
    const version = ++generation
    if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null }
    request?.abort()
    const controller = new AbortController()
    request = controller
    setState((previous) => ({ rootId: id, snapshot: previous.rootId === id ? previous.snapshot : null,
      loading: true, error: null, retryable: false, gapReason: previous.rootId === id ? previous.gapReason : null,
      gapActorId: previous.rootId === id ? previous.gapActorId : null }))
    try {
      const snapshot = await getActorSnapshot(id, id, controller.signal)
      if (controller.signal.aborted || generation !== version || scope().rootId !== id || !scope().active) return
      if (snapshotRef && actorSnapshotRegresses(snapshotRef, snapshot)) {
        setState((previous) => previous.rootId === id ? {
          ...previous, loading: false, error: null, gapReason: "snapshot_regression", gapActorId: null,
        } : previous)
        return
      }
      snapshotRef = snapshot
      retryAttempts = 0
      if (requiredTreeCursor !== undefined &&
        actorTreeCursorCovers(snapshot.stream_cursor, requiredTreeCursor)) {
        requiredTreeCursor = undefined
      }
      setState(() => ({ rootId: id, snapshot, loading: false, error: null, retryable: false,
        gapReason: workerGap?.reason ?? (requiredTreeCursor !== undefined ? "transport_gap" : null),
        gapActorId: workerGap?.actorId ?? null }))
    } catch (error) {
      if (controller.signal.aborted || generation !== version || scope().rootId !== id || !scope().active) return
      const retryable = retryableSnapshotFailure(error)
      const pendingTreeGap = requiredTreeCursor !== undefined
      if (snapshotRef && pendingTreeGap && retryable) {
        // A pending Host transaction or interrupted read cannot revoke the
        // last confirmed tree. Keep its subscription and retry at a bounded
        // rate until a covering Root snapshot proves the gap repaired.
        setState((previous) => previous.rootId === id ? {
          ...previous, loading: false, error: failureMessage(error), retryable: true,
          gapReason: workerGap?.reason ?? "transport_gap", gapActorId: workerGap?.actorId ?? null,
        } : previous)
        const delay = Math.min(500 * 2 ** Math.min(retryAttempts, 6), 30_000)
        retryAttempts += 1
        retryTimer = setTimeout(() => {
          retryTimer = null
          if (scope().rootId === id && scope().active) queueRefresh()
        }, delay)
        return
      }
      // Transport failures leave the last confirmed tree usable. A conflict
      // outside gap recovery can change the authority behind that tree.
      const lastConfirmed = retryable && !(isApiError(error) && error.status === 409) ? snapshotRef : null
      snapshotRef = lastConfirmed
      setState((previous) => ({ rootId: id, snapshot: lastConfirmed, loading: false, error: failureMessage(error), retryable,
        gapReason: previous.rootId === id ? previous.gapReason : null,
        gapActorId: previous.rootId === id ? previous.gapActorId : null }))
    } finally {
      if (request === controller) {
        request = null
        if (refreshAfterFlight) {
          refreshAfterFlight = false
          queueRefresh()
        }
      }
    }
  }
  const queueRefresh = () => {
    const { rootId: queuedRoot } = scope()
    const alreadyQueued = refreshQueued !== null
    refreshQueued = queuedRoot
    if (alreadyQueued) return
    queueMicrotask(() => {
      const queued = refreshQueued
      refreshQueued = null
      if (!queued || scope().rootId !== queued || !scope().active) return
      if (request) { refreshAfterFlight = true; return }
      void refresh()
    })
  }
  const cancel = () => {
    ++generation
    if (retryTimer !== null) { clearTimeout(retryTimer); retryTimer = null }
    retryAttempts = 0
    if (expiryTimer !== null) { clearTimeout(expiryTimer); expiryTimer = null }
    expiryObservation = null
    request?.abort()
    request = null
    refreshQueued = null
    refreshAfterFlight = false
    snapshotRef = null
    workerGap = null
    requiredTreeCursor = undefined
  }

  const openRoot = createMemo(() => active() ? rootId() : null)
  const descendantCount = createMemo(descendantCountHint)
  createEffect(openRoot, (id) => {
    if (id) void refresh()
    return cancel
  })
  createEffect(() => [openRoot(), descendantCount()] as const, ([rootId, count]) => {
    const previous = lastCountHint
    lastCountHint = { rootId, count }
    if (rootId && previous.rootId === rootId && previous.count !== null &&
      count !== null && previous.count !== count) void refresh()
  })

  const activeSnapshot = createMemo(() => {
    const current = state()
    return active() && current.rootId === rootId() ? current.snapshot : null
  })
  createEffect(() => [openRoot(), activeSnapshot()] as const, ([rootId, snapshot]) => {
    if (expiryTimer !== null) { clearTimeout(expiryTimer); expiryTimer = null }
    if (!rootId || snapshot?.schema_version !== 2) return
    const hint = snapshot.refresh_after_ms
    const now = performance.now()
    const native = snapshot.nodes.filter((node) => node.local_task !== null && node.local_task !== undefined)
      .sort((left, right) => left.actor_id.localeCompare(right.actor_id))
    const key = JSON.stringify(native.map((node) => [node.actor_id, node.activation, node.local_task]))
    const prior = expiryObservation
    const observation = prior?.key === key ? prior : { key, due: Infinity, consumed: false }
    expiryObservation = observation
    if (hint === null || hint === undefined || observation.consumed || !native.some((node) => node.local_task?.state === "running")) return
    // A repeated read may shorten an existing deadline, never postpone it.
    observation.due = Math.min(observation.due, now + hint)
    expiryTimer = setTimeout(() => {
      expiryTimer = null
      if (scope().rootId !== rootId || !scope().active) return
      // A changed observation set can schedule the next earliest lease; an
      // unchanged expired response cannot start a refresh loop.
      observation.consumed = true
      queueRefresh()
    }, Math.max(0, observation.due - performance.now()))
    return () => {
      if (expiryTimer !== null) { clearTimeout(expiryTimer); expiryTimer = null }
    }
  })

  const authorizedRoot = createMemo(() => {
    const id = rootId()
    const snapshot = activeSnapshot()
    return id && snapshot?.root_actor_id === id && snapshot.subtree_actor_id === id ? id : null
  })
  const treeCursor = createMemo(() => authorizedRoot() ? activeSnapshot()?.stream_cursor ?? null : null)
  createEffect(() => [authorizedRoot(), treeCursor()] as const, ([rootId, treeCursor]) => {
    if (!rootId) return
    let live = true
    const requireTreeSnapshot = (cursor: string | null, gap: boolean) => {
      if (!live || scope().rootId !== rootId || !scope().active) return
      // Another active read view can announce its confirmed cursor locally.
      // A covered read or an already-pending proof needs no duplicate request.
      if (!gap && actorTreeCursorCovers(snapshotRef?.stream_cursor ?? null, cursor)) return
      const prior = requiredTreeCursor
      const alreadyReading = !gap && request !== null && prior !== undefined && actorTreeCursorCovers(prior, cursor)
      if (prior === undefined) requiredTreeCursor = cursor
      else if (prior === null || cursor === null) requiredTreeCursor = null
      else if (actorTreeCursorCovers(cursor, prior)) requiredTreeCursor = cursor
      else if (!actorTreeCursorCovers(prior, cursor)) requiredTreeCursor = null
      // Initial and changed directives invalidate the read, not the transport.
      // Still track their cursor so an unsuccessful or stale read cannot hide
      // an unresolved update, but do not flash a gap warning during normal reads.
      if (gap) setState((previous) => previous.rootId === rootId ? {
        ...previous, gapReason: workerGap?.reason ?? "transport_gap", gapActorId: workerGap?.actorId ?? null,
      } : previous)
      if (!alreadyReading) queueRefresh()
    }
    const subscription = subscribeActorTree(rootId, treeCursor, {
      onControl: (control) => requireTreeSnapshot(control.cursor, control.reason === "gap" || control.reason === "unavailable"),
      onGap: () => requireTreeSnapshot(snapshotRef?.stream_cursor ?? null, true),
    })
    return () => { live = false; subscription.close() }
  })

  const authorizedActor = createMemo(() => {
    const root = authorizedRoot()
    const actor = interestedActorId()
    const snapshot = activeSnapshot()
    if (!root || !actor || !snapshot || snapshotRef !== snapshot) return null
    return snapshot.nodes.some((node) => node.actor_id === actor && node.root_actor_id === root && node.parent_actor_id !== null)
      ? actor : null
  })
  createEffect(() => [authorizedRoot(), authorizedActor()] as const, ([rootId, interestedActorId]) => {
    if (!rootId || !interestedActorId) return
    let live = true
    const markGap = (reason: ActorSnapshotGapReason) => {
      if (!live || scope().rootId !== rootId || scope().interestedActorId !== interestedActorId || !scope().active) return
      workerGap = { reason, actorId: interestedActorId }
      setState((previous) => previous.rootId === rootId ? {
        ...previous, gapReason: reason, gapActorId: interestedActorId,
      } : previous)
      queueRefresh()
    }
    const subscription = subscribeActor(interestedActorId, {
      onEvent: (event) => {
        if (!live || scope().rootId !== rootId || scope().interestedActorId !== interestedActorId || !scope().active) return
        const snapshot = snapshotRef
        const actor = snapshot?.nodes.find((node) => node.actor_id === interestedActorId)
        if (event.root_actor_id !== rootId || event.actor_id !== interestedActorId ||
          event.parent_actor_id !== actor?.parent_actor_id ||
          snapshot?.root_actor_id !== rootId || actor?.root_actor_id !== rootId) {
          markGap("scope_mismatch")
          return
        }
        // A previous activation can still have a frame in the shared socket
        // queue after the newer authorized snapshot has been installed.
        if (actor.activation && event.attempt < actor.activation.attempt) return
        if (!actor.activation || actor.activation.activation_id !== event.activation_id ||
          actor.activation.attempt !== event.attempt) {
          markGap("activation_mismatch")
          return
        }
        queueRefresh()
      },
      onControl: (control) => {
        if (!live || scope().rootId !== rootId || scope().interestedActorId !== interestedActorId || !scope().active) return
        if (control.reason === "gap") markGap("transport_gap")
        else queueRefresh()
      },
      onGap: () => markGap("transport_gap"),
    })
    return () => { live = false; subscription.close() }
  })

  const visible = createMemo<SnapshotState>(() => {
    const id = rootId()
    const current = state()
    return current.rootId === id ? current : {
      rootId: id, snapshot: null, loading: active() && id !== null, error: null, retryable: false, gapReason: null, gapActorId: null,
    }
  })
  return { state: visible, authorizedActor, refresh }
}
