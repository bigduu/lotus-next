import { useCallback, useEffect, useRef, useState } from "react"
import { agentClient, type SessionKind } from "@services/chat/AgentService"
import { getErrorMessage } from "@services/api/errors"
import { useRootModeFenceState } from "@/lib/rootModeTransitionFence"

type SavedSelection = {
  sessionId: string
  kind: SessionKind | null
  confirmed: boolean | null
  requested: boolean | null
  loading: boolean
  error: string | null
}

/** Keep a draft separate from the durable Root choice returned by session detail. */
export function useRootOrchestrationMode(sessionId: string | null, kind?: SessionKind) {
  const fenceState = useRootModeFenceState(sessionId)
  const unsafe = fenceState !== "clear"
  const [newSelection, setNewSelection] = useState(false)
  const [saved, setSaved] = useState<SavedSelection | null>(null)
  const readGeneration = useRef(0)
  const currentSessionId = useRef(sessionId)
  currentSessionId.current = sessionId

  const refresh = useCallback(async (id: string, admission: "accepted" | "unconfirmed" | "rejected" = "accepted") => {
    const generation = ++readGeneration.current
    setSaved((previous) => ({
      sessionId: id,
      kind: previous?.sessionId === id ? previous.kind : null,
      confirmed: previous?.sessionId === id ? previous.confirmed : null,
      requested: previous?.sessionId === id ? previous.requested : null,
      loading: true,
      error: null,
    }))
    try {
      const response = await agentClient.getSession(id)
      if (readGeneration.current !== generation || currentSessionId.current !== id) return
      const session = response.session
      if (session.kind === "child") {
        setSaved({ sessionId: id, kind: "child", confirmed: null, requested: null, loading: false, error: null })
        return
      }
      if (session.kind !== "root" || typeof session.root_orchestration_only !== "boolean") {
        setSaved({
          sessionId: id, kind: session.kind ?? null, confirmed: null, requested: null, loading: false,
          error: "无法确认 Root 模式：当前 Bamboo 未返回可用的会话详情。",
        })
        return
      }
      setSaved({
        sessionId: id,
        kind: "root",
        confirmed: session.root_orchestration_only,
        requested: session.root_orchestration_only,
        loading: false,
        error: admission === "unconfirmed"
          ? "发送未确认；已读取服务器当前快照，结果可能仍会改变。"
          : admission === "rejected"
            ? "Bamboo 已拒绝本次模式切换；已重新读取服务器当前模式。"
            : null,
      })
    } catch (error) {
      if (readGeneration.current !== generation || currentSessionId.current !== id) return
      setSaved({
        sessionId: id, kind: null, confirmed: null, requested: null, loading: false,
        error: `无法读取 Root 模式：${getErrorMessage(error)}`,
      })
    }
  }, [])

  useEffect(() => {
    if (!sessionId || kind === "child") {
      readGeneration.current += 1
      setSaved(null)
      if (!sessionId) setNewSelection(false)
      return
    }
    void refresh(sessionId)
    return () => { readGeneration.current += 1 }
  }, [sessionId, kind, refresh])

  const detail = saved?.sessionId === sessionId ? saved : null
  const child = Boolean(sessionId && (kind === "child" || detail?.kind === "child"))
  const confirmed = unsafe ? null : detail?.confirmed ?? null
  const selected = sessionId ? unsafe ? null : detail?.requested ?? null : newSelection
  const loading = Boolean(sessionId && !child && (!detail || detail.loading))

  const change = (next: boolean) => {
    if (!sessionId) {
      setNewSelection(next)
      return
    }
    if (child || unsafe) return
    setSaved((previous) => previous?.sessionId === sessionId
      && typeof previous.confirmed === "boolean" && !previous.loading
      ? { ...previous, requested: next, error: null }
      : previous)
  }

  return {
    child,
    unsafe,
    selected,
    confirmed,
    loading,
    error: fenceState === "uncertain"
      ? "此会话的 Root 权限切换结果未知，服务器状态仍可能改变。请新建会话；恢复需等待 Bamboo 提供请求终态确认。"
      : fenceState === "storage-unavailable"
        ? "无法读取本地 Root 权限安全状态。请新建会话，或在可用存储的浏览器中重试。"
        : detail?.error ?? null,
    change,
    refresh,
    retry: () => sessionId && !child ? refresh(sessionId) : Promise.resolve(),
    /** Explicit for creation or a changed Root choice; omission preserves on resume. */
    requestValue: !sessionId
      ? newSelection
      : !child && !unsafe && typeof confirmed === "boolean" && typeof selected === "boolean" && selected !== confirmed
        ? selected
        : undefined,
  }
}
