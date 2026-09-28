import { useCallback, useEffect, useRef, useState } from "react"
import { isApiError } from "@services/api/errors"
import { getActorSnapshot, type ActorSubtreeSnapshot } from "@services/chat/actorSnapshot"

interface SnapshotState {
  rootId: string | null
  snapshot: ActorSubtreeSnapshot | null
  loading: boolean
  error: string | null
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

/** One local, cancellable snapshot view. No timers, stream or synthetic revision. */
export function useActorSnapshot(rootId: string | null, active: boolean) {
  const [state, setState] = useState<SnapshotState>({ rootId: null, snapshot: null, loading: false, error: null })
  const generation = useRef(0)
  const request = useRef<AbortController | null>(null)
  const scope = useRef({ rootId, active })
  scope.current = { rootId, active }
  const refresh = useCallback(async () => {
    const current = scope.current
    if (!current.rootId || !current.active) return
    const id = current.rootId
    const version = ++generation.current
    request.current?.abort()
    const controller = new AbortController()
    request.current = controller
    setState((previous) => ({ rootId: id, snapshot: previous.rootId === id ? previous.snapshot : null, loading: true, error: null }))
    try {
      const snapshot = await getActorSnapshot(id, id, controller.signal)
      if (controller.signal.aborted || generation.current !== version || scope.current.rootId !== id || !scope.current.active) return
      setState({ rootId: id, snapshot, loading: false, error: null })
    } catch (error) {
      if (controller.signal.aborted || generation.current !== version || scope.current.rootId !== id || !scope.current.active) return
      setState({ rootId: id, snapshot: null, loading: false, error: failureMessage(error) })
    } finally {
      if (request.current === controller) request.current = null
    }
  }, [])
  const cancel = useCallback(() => { ++generation.current; request.current?.abort(); request.current = null }, [])
  useEffect(() => {
    if (active && rootId) void refresh()
    return cancel
  }, [rootId, active, refresh, cancel])
  const visible = state.rootId === rootId ? state : { rootId, snapshot: null, loading: active && rootId !== null, error: null }
  return { ...visible, refresh }
}
