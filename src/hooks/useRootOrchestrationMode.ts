import { useCallback, useEffect, useRef, useState } from "react"
import {
  agentClient, isThinkingMode, type ThinkingMode, type ReasoningEffort,
  type RootModeOperationResponse, type SessionKind,
} from "@services/chat/AgentService"
import { isReasoningEffort } from "@shared/utils/reasoningEffort"
import { getErrorMessage, isApiError } from "@services/api/errors"
import { useAppStore } from "@shared/store/appStore"
import {
  beginRootModeOperation, finishRootModeOperation, readRootModeFence,
  rootModeStorageKeyMatches, useRootModeFenceState, type RootModeOperation,
} from "@/lib/rootModeTransitionFence"

export type RootModeAuthority = {
  sessionId: string
  enabled: boolean
  thinkingMode: ThinkingMode
  ordinaryEffort: ReasoningEffort | null
  epoch: number
  birthToken: string
  isRunning: boolean
}
type Outcome = RootModeOperationResponse["status"] | "birth_mismatch"
export type RootModeChangeResult = { status: Outcome | "unchanged" | "unconfirmed"; authority: RootModeAuthority | null }
type RecoveryResult = { outcomes: Map<string, Outcome>; authority: RootModeAuthority | null }
type SavedSelection = {
  sessionId: string
  kind: SessionKind | null
  authority: RootModeAuthority | null
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
      && isThinkingMode(response.current_thinking_mode)
      && (response.current_thinking_mode === "ultra") === response.current_enabled
  }
  return ["committed", "fenced", "rejected_incompatible"].includes(response.status)
    && response.operation_id === operation.operationId
    && response.expected_epoch === operation.expectedEpoch
    && response.resulting_epoch === operation.expectedEpoch + 1
    && typeof response.enabled_at_completion === "boolean"
    && isThinkingMode(response.thinking_mode_at_completion)
    && (response.thinking_mode_at_completion === "ultra") === response.enabled_at_completion
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
  const recoveryActive = useRef(new Map<string, Promise<RecoveryResult>>())
  const currentSessionId = useRef(sessionId)
  currentSessionId.current = sessionId

  const refresh = useCallback(async (id: string, notice: string | null = null, minimumEpoch = 0) => {
    const generation = ++readGeneration.current
    setSaved((previous) => ({
      sessionId: id,
      kind: previous?.sessionId === id ? previous.kind : null,
      authority: previous?.sessionId === id ? previous.authority : null,
      loading: true,
      error: null,
    }))
    try {
      const response = await agentClient.getSession(id)
      if (readGeneration.current !== generation || currentSessionId.current !== id) return null
      const session = response.session
      if (session.kind === "child") {
        setSaved({ sessionId: id, kind: "child", authority: null, loading: false, error: null })
        return null
      }
      if (session.id !== id || session.kind !== "root" || typeof session.root_orchestration_only !== "boolean"
        || !isThinkingMode(session.thinking_mode)
        || (session.thinking_mode === "ultra") !== session.root_orchestration_only
        || session.reasoning_effort != null && !isReasoningEffort(session.reasoning_effort)
        || !validEpoch(session.root_mode_transition_epoch)
        || typeof session.root_mode_birth_token !== "string"
        || !/^[0-9a-f]{64}$/i.test(session.root_mode_birth_token)) {
        setSaved({
          sessionId: id, kind: session.kind ?? null, authority: null, loading: false,
          error: "无法确认思考模式：Bamboo 未返回一致的独立 Ultra 模式和 Root 权限信息。请更新 Bamboo 后重新读取。",
        })
        return null
      }
      const authority: RootModeAuthority = {
        sessionId: id, enabled: session.root_orchestration_only, thinkingMode: session.thinking_mode,
        ordinaryEffort: session.reasoning_effort ?? null,
        epoch: session.root_mode_transition_epoch, birthToken: session.root_mode_birth_token,
        isRunning: session.is_running === true,
      }
      if (authority.epoch < minimumEpoch) {
        setSaved({ sessionId: id, kind: "root", authority: null, loading: false,
          error: "当前状态仍早于已确认的模式切换；请重新读取服务器状态后继续。" })
        return null
      }
      setSaved({
        sessionId: id, kind: "root", authority,
        loading: false, error: notice,
      })
      useAppStore.setState((state) => ({
        chats: state.chats.map((chat) => chat.id === id
          ? { ...chat, config: { ...chat.config, reasoningEffort: authority.ordinaryEffort } }
          : chat),
      }))
      return authority
    } catch (error) {
      if (readGeneration.current !== generation || currentSessionId.current !== id) return null
      setSaved({
        sessionId: id, kind: null, authority: null,
        loading: false, error: `无法读取 Root 模式：${getErrorMessage(error)}`,
      })
      return null
    }
  }, [])

  const recoverPending = useCallback((id: string): Promise<RecoveryResult> => {
    const ongoing = recoveryActive.current.get(id)
    if (ongoing) return ongoing
    const pending = (async () => {
      const initial = readRootModeFence(id)
      const outcomes = new Map<string, Outcome>()
      if (initial.kind !== "pending") return { outcomes, authority: null }
      setRecoveringId(id)
      setRecoveryFailure(null)
      let notice: string | null = null
      let failure: string | null = null
      let minimumEpoch = 0
      for (const operation of initial.operations) {
        try {
          const response = await agentClient.recoverRootMode(id, operation)
          if (!verifiedOutcome(response, operation)) throw new Error("Bamboo 未返回与此请求匹配的终态证明")
          if (!finishRootModeOperation(id, operation)) throw new Error("本地安全标记无法清除")
          outcomes.set(operation.operationId, response.status)
          minimumEpoch = Math.max(minimumEpoch, response.status === "fenced_by_successor"
            ? response.current_epoch : response.resulting_epoch)
          notice = outcomeNotice(response.status)
        } catch (error) {
          if (birthMismatch(error) && finishRootModeOperation(id, operation)) {
            outcomes.set(operation.operationId, "birth_mismatch")
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
      const authority = readRootModeFence(id).kind === "clear" && currentSessionId.current === id
        ? await refresh(id, notice, minimumEpoch) : null
      return { outcomes, authority }
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
  const authority = detail?.authority ?? null
  const confirmed = unsafe || detail?.loading ? null : authority?.enabled ?? null
  const selected = sessionId ? confirmed : newSelection
  const loading = Boolean(sessionId && !child && (!detail || detail.loading))

  const change = async (next: boolean): Promise<RootModeChangeResult> => {
    if (!sessionId) { setNewSelection(next); return { status: "unchanged", authority: null } }
    if (child || unsafe || loading || !authority || recoveringId === sessionId
      || readRootModeFence(sessionId).kind !== "clear")
      return { status: "unconfirmed", authority: null }
    const id = sessionId
    const operation = beginRootModeOperation(id, authority.epoch, authority.birthToken, next)
    if (!operation) {
      setRecoveryFailure({ sessionId: id, message: "无法保存 Root 模式安全标记；切换未发送。" })
      return { status: "unconfirmed", authority: null }
    }
    ++readGeneration.current
    setRecoveryFailure(null)
    try {
      const response = await agentClient.selectRootMode(id, operation)
      if (!verifiedOutcome(response, operation)) throw new Error("Bamboo 未返回与此请求匹配的终态证明")
      if (!finishRootModeOperation(id, operation)) throw new Error("本地安全标记无法清除")
      if (currentSessionId.current === id && readRootModeFence(id).kind === "clear") {
        const minimumEpoch = response.status === "fenced_by_successor" ? response.current_epoch : response.resulting_epoch
        return { status: response.status, authority: await refresh(id, outcomeNotice(response.status), minimumEpoch) }
      }
    } catch (error) {
      if (birthMismatch(error) && finishRootModeOperation(id, operation)) {
        return { status: "birth_mismatch", authority: currentSessionId.current === id
          ? await refresh(id, "会话身份已改变；已重新读取当前 Root 模式。") : null }
      } else {
        const recovered = await recoverPending(id)
        return { status: recovered.outcomes.get(operation.operationId) ?? "unconfirmed", authority: recovered.authority }
      }
    }
    return { status: "unconfirmed", authority: null }
  }

  const retry = () => {
    if (!sessionId || child) return Promise.resolve()
    return readRootModeFence(sessionId).kind === "pending"
      ? recoverPending(sessionId).then((result) => result.authority) : refresh(sessionId)
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
    child, unsafe, selected, confirmed, loading, authority,
    isRoot: !sessionId || !child && (kind === "root" || detail?.kind === "root"),
    recovering: recoveringId === sessionId,
    recoverable: fence.kind === "pending",
    error: unsafe ? pendingError : recoveryFailure?.sessionId === sessionId
      ? recoveryFailure.message : detail?.error ?? null,
    change, refresh, retry,
    /** New-session creation remains an explicit choice in the first chat. */
    requestValue: sessionId ? undefined : newSelection,
  }
}
