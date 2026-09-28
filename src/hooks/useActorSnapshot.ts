import { useCallback, useEffect, useRef, useState } from "react"
import { isApiError } from "@services/api/errors"
import { getActorSnapshot, type ActorSubtreeSnapshot } from "@services/chat/actorSnapshot"
import { subscribeActor } from "@services/chat/v2Stream"

export type ActorSnapshotGapReason = "transport_gap" | "scope_mismatch" | "activation_mismatch"

interface SnapshotState {
  rootId: string | null
  snapshot: ActorSubtreeSnapshot | null
  loading: boolean
  error: string | null
  /** A fresh snapshot has no stream cursor, so a gap cannot be proven repaired. */
  gapReason: ActorSnapshotGapReason | null
}

function failureMessage(error: unknown): string {
  if (isApiError(error)) {
    if (error.status === 401 || error.status === 403) return "当前连接没有读取代理结构的权限；请确认 Bamboo 访问权限后重试。"
    if (error.status === 404 || error.status === 501) return "当前 Bamboo 暂不提供此代理结构；请确认后端版本后重试。"
    if (error.status === 409) return "代理结构或权限信息正在变化，暂时无法确认；请重新读取。"
    if (error.status === 413) return "代理结构超过当前读取上限，无法显示完整结构。"
  }
  return "代理结构暂时无法确认，请重新读取。"
}

/** A public snapshot view with one selected or previewed Actor interest. */
export function useActorSnapshot(rootId: string | null, active: boolean, interestedActorId: string | null = null) {
  const [state, setState] = useState<SnapshotState>({ rootId: null, snapshot: null, loading: false, error: null, gapReason: null })
  const generation = useRef(0)
  const request = useRef<AbortController | null>(null)
  const refreshQueued = useRef(false)
  const refreshAfterFlight = useRef(false)
  const snapshotRef = useRef<ActorSubtreeSnapshot | null>(null)
  const scope = useRef({ rootId, active, interestedActorId })
  scope.current = { rootId, active, interestedActorId }
  const queueRefreshRef = useRef<() => void>(() => {})
  const refresh = useCallback(async () => {
    const current = scope.current
    if (!current.rootId || !current.active) return
    const id = current.rootId
    const version = ++generation.current
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setState((previous) => ({ rootId: id, snapshot: previous.rootId === id ? previous.snapshot : null,
      loading: true, error: null, gapReason: previous.rootId === id ? previous.gapReason : null }))
    try {
      const snapshot = await getActorSnapshot(id, id, controller.signal)
      if (controller.signal.aborted || generation.current !== version || scope.current.rootId !== id || !scope.current.active) return
      snapshotRef.current = snapshot
      setState((previous) => ({ rootId: id, snapshot, loading: false, error: null,
        gapReason: previous.rootId === id ? previous.gapReason : null }))
    } catch (error) {
      if (controller.signal.aborted || generation.current !== version || scope.current.rootId !== id || !scope.current.active) return
      snapshotRef.current = null
      setState((previous) => ({ rootId: id, snapshot: null, loading: false, error: failureMessage(error),
        gapReason: previous.rootId === id ? previous.gapReason : null }))
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
    if (refreshQueued.current) return
    refreshQueued.current = true
    const { rootId: queuedRoot, interestedActorId: queuedActor } = scope.current
    queueMicrotask(() => {
      refreshQueued.current = false
      if (!queuedRoot || scope.current.rootId !== queuedRoot ||
        scope.current.interestedActorId !== queuedActor || !scope.current.active) return
      if (request.current) { refreshAfterFlight.current = true; return }
      void refresh()
    })
  }, [refresh])
  queueRefreshRef.current = queueRefresh
  const cancel = useCallback(() => {
    ++generation.current
    request.current?.abort()
    request.current = null
    refreshAfterFlight.current = false
    snapshotRef.current = null
  }, [])
  useEffect(() => {
    if (active && rootId) void refresh()
    return cancel
  }, [rootId, active, refresh, cancel])

  const authorized = active && !!rootId && !!interestedActorId && state.rootId === rootId &&
    snapshotRef.current === state.snapshot &&
    state.snapshot?.root_actor_id === rootId && state.snapshot.subtree_actor_id === rootId &&
    state.snapshot.nodes.some((node) => node.actor_id === interestedActorId && node.root_actor_id === rootId)
  useEffect(() => {
    if (!authorized || !rootId || !interestedActorId) return
    let live = true
    const markGap = (reason: ActorSnapshotGapReason) => {
      if (!live || scope.current.rootId !== rootId || scope.current.interestedActorId !== interestedActorId || !scope.current.active) return
      setState((previous) => previous.rootId === rootId ? { ...previous, gapReason: reason } : previous)
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
    loading: active && rootId !== null, error: null, gapReason: null }
  return { ...visible, refresh }
}
