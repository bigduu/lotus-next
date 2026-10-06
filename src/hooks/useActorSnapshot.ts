import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useCallback, useEffect, useRef, useState } from "react"
import { isApiError, NetworkRequestError, RequestTimeoutError } from "@services/api/errors"
import { actorSnapshotRegresses, actorTreeCursorCovers, getActorSnapshot, type ActorSubtreeSnapshot } from "@services/chat/actorSnapshot"
import { subscribeActor, subscribeActorTree } from "@services/chat/v2Stream"

export type ActorSnapshotGapReason = "transport_gap" | "scope_mismatch" | "activation_mismatch" | "snapshot_regression"

interface SnapshotState {
  rootId: string | null
  snapshot: ActorSubtreeSnapshot | null
  loading: boolean
  error: string | null
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
  }
  return uiText("agent_structure_cannot_be_confirmed_right_now_reload_st_2ba610a7")
}

function retryableSnapshotFailure(error: unknown): boolean {
  if (isApiError(error)) return error.status === 409 || (error.status >= 500 && error.status !== 501)
  return error instanceof NetworkRequestError || error instanceof RequestTimeoutError
}

/** A public snapshot view with one selected or previewed Actor interest. */
export function useActorSnapshot(rootId: string | null, active: boolean, interestedActorId: string | null = null, descendantCountHint: number | null = null) {
  useUiLocale()
  const [state, setState] = useState<SnapshotState>({ rootId: null, snapshot: null, loading: false, error: null, gapReason: null, gapActorId: null })
  const generation = useRef(0)
  const request = useRef<AbortController | null>(null)
  const retryTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryAttempts = useRef(0)
  const refreshQueued = useRef<string | null>(null)
  const refreshAfterFlight = useRef(false)
  const snapshotRef = useRef<ActorSubtreeSnapshot | null>(null)
  // Keep the latest unresolved Actor observation tied to its subscription,
  // even when another Child is selected. A tree snapshot cannot repair replay.
  const workerGap = useRef<{ reason: ActorSnapshotGapReason; actorId: string } | null>(null)
  /** undefined means no tree gap; null means the old Root has no proof cursor. */
  const requiredTreeCursor = useRef<string | null | undefined>(undefined)
  const lastCountHint = useRef<{ rootId: string | null; count: number | null }>({ rootId: null, count: null })
  const scope = useRef({ rootId, active, interestedActorId })
  scope.current = { rootId, active, interestedActorId }
  const queueRefreshRef = useRef<() => void>(() => {})
  const refresh = useCallback(async () => {
    const current = scope.current
    if (!current.rootId || !current.active) return
    const id = current.rootId
    const version = ++generation.current
    if (retryTimer.current !== null) { clearTimeout(retryTimer.current); retryTimer.current = null }
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setState((previous) => ({ rootId: id, snapshot: previous.rootId === id ? previous.snapshot : null,
      loading: true, error: null, gapReason: previous.rootId === id ? previous.gapReason : null,
      gapActorId: previous.rootId === id ? previous.gapActorId : null }))
    try {
      const snapshot = await getActorSnapshot(id, id, controller.signal)
      if (controller.signal.aborted || generation.current !== version || scope.current.rootId !== id || !scope.current.active) return
      if (snapshotRef.current && actorSnapshotRegresses(snapshotRef.current, snapshot)) {
        setState((previous) => previous.rootId === id ? {
          ...previous, loading: false, error: null, gapReason: "snapshot_regression", gapActorId: null,
        } : previous)
        return
      }
      snapshotRef.current = snapshot
      retryAttempts.current = 0
      if (requiredTreeCursor.current !== undefined &&
        actorTreeCursorCovers(snapshot.stream_cursor, requiredTreeCursor.current)) {
        requiredTreeCursor.current = undefined
      }
      setState(() => ({ rootId: id, snapshot, loading: false, error: null,
        gapReason: workerGap.current?.reason ?? (requiredTreeCursor.current !== undefined ? "transport_gap" : null),
        gapActorId: workerGap.current?.actorId ?? null }))
    } catch (error) {
      if (controller.signal.aborted || generation.current !== version || scope.current.rootId !== id || !scope.current.active) return
      if (snapshotRef.current && requiredTreeCursor.current !== undefined && retryableSnapshotFailure(error)) {
        // A pending Host transaction or interrupted read cannot revoke the
        // last confirmed tree. Keep its subscription and retry at a bounded
        // rate until a covering Root snapshot proves the gap repaired.
        setState((previous) => previous.rootId === id ? {
          ...previous, loading: false, error: failureMessage(error),
          gapReason: workerGap.current?.reason ?? "transport_gap", gapActorId: workerGap.current?.actorId ?? null,
        } : previous)
        const delay = Math.min(500 * 2 ** Math.min(retryAttempts.current, 6), 30_000)
        retryAttempts.current += 1
        retryTimer.current = setTimeout(() => {
          retryTimer.current = null
          if (scope.current.rootId === id && scope.current.active) queueRefreshRef.current()
        }, delay)
        return
      }
      snapshotRef.current = null
      setState((previous) => ({ rootId: id, snapshot: null, loading: false, error: failureMessage(error),
        gapReason: previous.rootId === id ? previous.gapReason : null,
        gapActorId: previous.rootId === id ? previous.gapActorId : null }))
    } finally {
      if (request.current === controller) {
        request.current = null
        if (refreshAfterFlight.current) {
          refreshAfterFlight.current = false
          queueRefreshRef.current()
        }
      }
    }
  }, [])
  const queueRefresh = useCallback(() => {
    const { rootId: queuedRoot } = scope.current
    const alreadyQueued = refreshQueued.current !== null
    refreshQueued.current = queuedRoot
    if (alreadyQueued) return
    queueMicrotask(() => {
      const queued = refreshQueued.current
      refreshQueued.current = null
      if (!queued || scope.current.rootId !== queued || !scope.current.active) return
      if (request.current) { refreshAfterFlight.current = true; return }
      void refresh()
    })
  }, [refresh])
  queueRefreshRef.current = queueRefresh
  const cancel = useCallback(() => {
    ++generation.current
    if (retryTimer.current !== null) { clearTimeout(retryTimer.current); retryTimer.current = null }
    retryAttempts.current = 0
    request.current?.abort()
    request.current = null
    refreshAfterFlight.current = false
    snapshotRef.current = null
    workerGap.current = null
    requiredTreeCursor.current = undefined
  }, [])
  useEffect(() => {
    if (active && rootId) void refresh()
    return cancel
  }, [rootId, active, refresh, cancel])
  useEffect(() => {
    const previous = lastCountHint.current
    lastCountHint.current = { rootId, count: descendantCountHint }
    if (active && rootId && previous.rootId === rootId && previous.count !== null &&
      descendantCountHint !== null && previous.count !== descendantCountHint) void refresh()
  }, [rootId, active, descendantCountHint, refresh])

  const treeAuthorized = active && !!rootId && state.rootId === rootId &&
    state.snapshot?.root_actor_id === rootId &&
    state.snapshot.subtree_actor_id === rootId
  const treeCursor = treeAuthorized ? state.snapshot?.stream_cursor ?? null : null
  useEffect(() => {
    if (!treeAuthorized || !rootId) return
    let live = true
    const requireTreeSnapshot = (cursor: string | null, gap: boolean) => {
      if (!live || scope.current.rootId !== rootId || !scope.current.active) return
      const prior = requiredTreeCursor.current
      if (prior === undefined) requiredTreeCursor.current = cursor
      else if (prior === null || cursor === null) requiredTreeCursor.current = null
      else if (actorTreeCursorCovers(cursor, prior)) requiredTreeCursor.current = cursor
      else if (!actorTreeCursorCovers(prior, cursor)) requiredTreeCursor.current = null
      // Initial and changed directives invalidate the read, not the transport.
      // Still track their cursor so an unsuccessful or stale read cannot hide
      // an unresolved update, but do not flash a gap warning during normal reads.
      if (gap) setState((previous) => previous.rootId === rootId ? {
        ...previous, gapReason: workerGap.current?.reason ?? "transport_gap", gapActorId: workerGap.current?.actorId ?? null,
      } : previous)
      queueRefresh()
    }
    const subscription = subscribeActorTree(rootId, treeCursor, {
      onControl: (control) => requireTreeSnapshot(control.cursor, control.reason === "gap" || control.reason === "unavailable"),
      onGap: () => requireTreeSnapshot(snapshotRef.current?.stream_cursor ?? null, true),
    })
    return () => { live = false; subscription.close() }
  }, [treeAuthorized, rootId, treeCursor, queueRefresh])

  const authorized = active && !!rootId && !!interestedActorId && state.rootId === rootId &&
    snapshotRef.current === state.snapshot &&
    state.snapshot?.root_actor_id === rootId && state.snapshot.subtree_actor_id === rootId &&
    state.snapshot.nodes.some((node) => node.actor_id === interestedActorId && node.root_actor_id === rootId)
  useEffect(() => {
    if (!authorized || !rootId || !interestedActorId) return
    let live = true
    const markGap = (reason: ActorSnapshotGapReason) => {
      if (!live || scope.current.rootId !== rootId || scope.current.interestedActorId !== interestedActorId || !scope.current.active) return
      workerGap.current = { reason, actorId: interestedActorId }
      setState((previous) => previous.rootId === rootId ? {
        ...previous, gapReason: reason, gapActorId: interestedActorId,
      } : previous)
      queueRefresh()
    }
    const subscription = subscribeActor(interestedActorId, {
      onEvent: (event) => {
        if (!live || scope.current.rootId !== rootId || scope.current.interestedActorId !== interestedActorId || !scope.current.active) return
        const snapshot = snapshotRef.current
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
        if (!live || scope.current.rootId !== rootId || scope.current.interestedActorId !== interestedActorId || !scope.current.active) return
        if (control.reason === "gap") markGap("transport_gap")
        else queueRefresh()
      },
      onGap: () => markGap("transport_gap"),
    })
    return () => { live = false; subscription.close() }
  }, [authorized, rootId, interestedActorId, queueRefresh])

  const visible = state.rootId === rootId ? state : { rootId, snapshot: null,
    loading: active && rootId !== null, error: null, gapReason: null, gapActorId: null }
  return { ...visible, refresh }
}
