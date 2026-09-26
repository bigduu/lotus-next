import { useCallback, useEffect, useRef, useState } from "react"
import {
  agentClient, type RootModeOperationResponse, type SessionKind,
} from "@services/chat/AgentService"
import { getErrorMessage, isApiError } from "@services/api/errors"
import {
  beginRootModeOperation, finishRootModeOperation, readRootModeFence,
  rootModeStorageKeyMatches, useRootModeFenceState, type RootModeOperation,
} from "@/lib/rootModeTransitionFence"

type SavedSelection = {
  sessionId: string
  kind: SessionKind | null
  confirmed: boolean | null
  epoch: number | null
  birthToken: string | null
  loading: boolean
  error: string | null
}

function validEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

/** A 2xx response is safe only when it proves this exact operation is terminal. */
function verifiedOutcome(response: RootModeOperationResponse, operation: RootModeOperation): boolean {
  if (!response || !validEpoch(response.root_tool_authority_revision)
    || response.operation_id !== operation.operationId
    || response.expected_epoch !== operation.expectedEpoch) return false
  if (response.status === "fenced_by_successor") {
    return validEpoch(response.current_epoch) && response.current_epoch > operation.expectedEpoch
      && typeof response.current_enabled === "boolean"
  }
  return ["committed", "fenced", "rejected_incompatible"].includes(response.status)
    && response.operation_id === operation.operationId
    && response.expected_epoch === operation.expectedEpoch
    && response.resulting_epoch === operation.expectedEpoch + 1
    && typeof response.enabled_at_completion === "boolean"
    && (response.status !== "committed" || response.enabled_at_completion === operation.enabled)
}

function birthMismatch(error: unknown): boolean {
  if (!isApiError(error) || error.status !== 412 || !error.body) return false
  try {
    const body = JSON.parse(error.body) as { error?: { code?: unknown } }
    return body.error?.code === "root_mode_birth_mismatch"
  } catch { return false }
}

const outcomeNotice = (status: RootModeOperationResponse["status"]): string | null => {
  switch (status) {
    case "committed": return null
    case "rejected_incompatible": return "Bamboo 已拒绝本次 Root 模式切换；当前模式已重新读取。"
    case "fenced": return "切换请求已安全撤销；当前模式已重新读取。"
    case "fenced_by_successor": return "另一个操作已更新 Root 模式；当前模式已重新读取。"
  }
}

/** Existing Roots use message-free, terminally recoverable mode operations. */
export function useRootOrchestrationMode(sessionId: string | null, kind?: SessionKind) {
  const fenceState = useRootModeFenceState(sessionId)
  const fence = sessionId ? readRootModeFence(sessionId) : { kind: "clear" as const }
  const unsafe = fenceState !== "clear"
  const [newSelection, setNewSelection] = useState(false)
  const [saved, setSaved] = useState<SavedSelection | null>(null)
  const [recoveryFailure, setRecoveryFailure] = useState<{ sessionId: string; message: string } | null>(null)
  const [recoveringId, setRecoveringId] = useState<string | null>(null)
  const readGeneration = useRef(0)
  const recoveryActive = useRef(new Map<string, Promise<void>>())
  const currentSessionId = useRef(sessionId)
  currentSessionId.current = sessionId

  const refresh = useCallback(async (id: string, notice: string | null = null) => {
    const generation = ++readGeneration.current
    setSaved((previous) => ({
      sessionId: id,
      kind: previous?.sessionId === id ? previous.kind : null,
      confirmed: previous?.sessionId === id ? previous.confirmed : null,
      epoch: previous?.sessionId === id ? previous.epoch : null,
      birthToken: previous?.sessionId === id ? previous.birthToken : null,
      loading: true,
      error: null,
    }))
    try {
      const response = await agentClient.getSession(id)
      if (readGeneration.current !== generation || currentSessionId.current !== id) return
      const session = response.session
      if (session.kind === "child") {
        setSaved({ sessionId: id, kind: "child", confirmed: null, epoch: null, birthToken: null, loading: false, error: null })
        return
      }
      if (session.kind !== "root" || typeof session.root_orchestration_only !== "boolean"
        || !validEpoch(session.root_mode_transition_epoch)
        || typeof session.root_mode_birth_token !== "string"
        || !/^[0-9a-f]{64}$/i.test(session.root_mode_birth_token)) {
        setSaved({
          sessionId: id, kind: session.kind ?? null, confirmed: null, epoch: null,
          birthToken: null, loading: false,
          error: "无法确认 Root 模式：当前 Bamboo 未返回可恢复的会话权限信息。",
        })
        return
      }
      setSaved({
        sessionId: id, kind: "root", confirmed: session.root_orchestration_only,
        epoch: session.root_mode_transition_epoch, birthToken: session.root_mode_birth_token,
        loading: false, error: notice,
      })
    } catch (error) {
      if (readGeneration.current !== generation || currentSessionId.current !== id) return
      setSaved({
        sessionId: id, kind: null, confirmed: null, epoch: null, birthToken: null,
        loading: false, error: `无法读取 Root 模式：${getErrorMessage(error)}`,
      })
    }
  }, [])

  const recoverPending = useCallback((id: string): Promise<void> => {
    const ongoing = recoveryActive.current.get(id)
    if (ongoing) return ongoing
    const pending = (async () => {
      const initial = readRootModeFence(id)
      if (initial.kind !== "pending") return
      setRecoveringId(id)
      setRecoveryFailure(null)
      let notice: string | null = null
      let failure: string | null = null
      for (const operation of initial.operations) {
        try {
          const response = await agentClient.recoverRootMode(id, operation)
          if (!verifiedOutcome(response, operation)) throw new Error("Bamboo 未返回与此请求匹配的终态证明")
          if (!finishRootModeOperation(id, operation)) throw new Error("本地安全标记无法清除")
          notice = outcomeNotice(response.status)
        } catch (error) {
          if (birthMismatch(error) && finishRootModeOperation(id, operation)) {
            notice = "会话身份已改变；已重新读取当前 Root 模式。"
          } else {
            failure = `无法确认 Root 模式切换：${getErrorMessage(error)}。请重试恢复。`
          }
        }
      }
      if (currentSessionId.current === id) {
        setRecoveringId(null)
        setRecoveryFailure(failure ? { sessionId: id, message: failure } : null)
      }
      if (readRootModeFence(id).kind === "clear" && currentSessionId.current === id) await refresh(id, notice)
    })().finally(() => { recoveryActive.current.delete(id) })
    recoveryActive.current.set(id, pending)
    return pending
  }, [refresh])

  useEffect(() => {
    if (!sessionId || kind === "child") {
      readGeneration.current += 1
      setSaved(null)
      setRecoveryFailure(null)
      if (!sessionId) setNewSelection(false)
      return
    }
    const pending = readRootModeFence(sessionId)
    if (pending.kind === "pending") void recoverPending(sessionId)
    else void refresh(sessionId)
    return () => { readGeneration.current += 1 }
  }, [sessionId, kind, refresh, recoverPending])

  useEffect(() => {
    if (!sessionId || kind === "child") return
    const externalChange = (event: StorageEvent) => {
      // Storage events come from other tabs. A new pending marker never cancels
      // an in-flight selection; clearing the last one reloads this tab's old epoch.
      if (rootModeStorageKeyMatches(sessionId, event.key)
        && readRootModeFence(sessionId).kind === "clear") void refresh(sessionId)
    }
    window.addEventListener("storage", externalChange)
    return () => window.removeEventListener("storage", externalChange)
  }, [sessionId, kind, refresh])

  const detail = saved?.sessionId === sessionId ? saved : null
  const child = Boolean(sessionId && (kind === "child" || detail?.kind === "child"))
  const confirmed = unsafe ? null : detail?.confirmed ?? null
  const selected = sessionId ? confirmed : newSelection
  const loading = Boolean(sessionId && !child && (!detail || detail.loading))

  const change = async (next: boolean) => {
    if (!sessionId) { setNewSelection(next); return }
    if (child || unsafe || loading || typeof detail?.confirmed !== "boolean"
      || !validEpoch(detail.epoch) || !detail.birthToken || recoveringId === sessionId) return
    const id = sessionId
    const operation = beginRootModeOperation(id, detail.epoch, detail.birthToken, next)
    if (!operation) {
      setRecoveryFailure({ sessionId: id, message: "无法保存 Root 模式安全标记；切换未发送。" })
      return
    }
    ++readGeneration.current
    setRecoveryFailure(null)
    try {
      const response = await agentClient.selectRootMode(id, operation)
      if (!verifiedOutcome(response, operation)) throw new Error("Bamboo 未返回与此请求匹配的终态证明")
      if (!finishRootModeOperation(id, operation)) throw new Error("本地安全标记无法清除")
      if (currentSessionId.current === id && readRootModeFence(id).kind === "clear") {
        await refresh(id, outcomeNotice(response.status))
      }
    } catch (error) {
      if (birthMismatch(error) && finishRootModeOperation(id, operation)) {
        if (currentSessionId.current === id) await refresh(id, "会话身份已改变；已重新读取当前 Root 模式。")
      } else {
        await recoverPending(id)
      }
    }
  }

  const retry = () => {
    if (!sessionId || child) return Promise.resolve()
    return readRootModeFence(sessionId).kind === "pending" ? recoverPending(sessionId) : refresh(sessionId)
  }

  const pendingError = fence.kind === "legacy"
    ? "旧版聊天模式切换没有可恢复的请求身份；此会话保持停止发送。请新建会话。"
    : fence.kind === "invalid"
      ? "本地 Root 模式请求记录无效，无法安全恢复；此会话保持停止发送。"
      : fence.kind === "storage-unavailable"
        ? "无法读取本地 Root 权限安全状态。请在可用存储的浏览器中重试。"
        : recoveringId === sessionId
          ? "正在确认 Root 模式切换的终态；此会话暂时停止发送。"
          : recoveryFailure?.sessionId === sessionId
            ? recoveryFailure.message
            : "Root 模式切换结果尚未确认；此会话暂时停止发送。请恢复该请求。"

  return {
    child, unsafe, selected, confirmed, loading,
    recovering: recoveringId === sessionId,
    recoverable: fence.kind === "pending",
    error: unsafe ? pendingError : recoveryFailure?.sessionId === sessionId
      ? recoveryFailure.message : detail?.error ?? null,
    change, refresh, retry,
    /** New-session creation remains an explicit choice in the first chat. */
    requestValue: sessionId ? undefined : newSelection,
  }
}
