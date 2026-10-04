import { useEffect, useRef, useState } from "react"
import { apiClient, getErrorMessage, isApiError } from "@services/api"
import { agentClient, type ChatRequest, type ChatResponse } from "@services/chat/AgentService"
import { useAppStore } from "@shared/store/appStore"
import type { SendSubmissionResult } from "./useChat"
import { getRootModeFenceState } from "@/lib/rootModeTransitionFence"

type References = Pick<ChatRequest, "thread_id" | "in_reply_to" | "correlation_id">
type Delivery = { id: string; fingerprint: string; fingerprint_version?: 2; references?: References; phase?: "activation" }
const receiptKey = (id: string) => `lotus-next.ticket-human.${id}`
const admittedSessions = new Set<string>()
const admissionListeners = new Set<() => void>()
const notifyAdmissions = () => { for (const listener of admissionListeners) listener() }
function readReceipt(id: string): Delivery | undefined {
  const raw = sessionStorage.getItem(receiptKey(id))
  if (raw === null) return
  const value = JSON.parse(raw)
  if (typeof value?.id !== "string" || value.id.length === 0 || value.id.length > 128
    || typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint)
    || (value.fingerprint_version !== undefined && value.fingerprint_version !== 2)
    || (value.phase !== undefined && value.phase !== "activation")
    || (value.references !== undefined && (typeof value.references !== "object" || value.references === null
      || Object.entries(value.references).some(([key, reference]) => !["thread_id", "in_reply_to", "correlation_id"].includes(key)
        || typeof reference !== "string" || reference.length === 0 || reference.length > 128)))) {
    throw new Error("原消息回执无法读取，请先确认上次发送结果。")
  }
  return value
}

function canonicalRequest(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalRequest)
  if (value !== null && typeof value === "object") return Object.fromEntries(
    Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([key, item]) => [key, canonicalRequest(item)]))
  return value
}

// One ordinary composer, one canonical Human ingress. An uncertain delivery
// retains its exact payload/ID; no automatic retry of a changed instruction.
export function useTicketIngress(sessionId?: string | null) {
  const sequence = useRef(0)
  const view = useRef({ sessionId })
  if (view.current.sessionId !== sessionId) view.current = { sessionId }
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [executePending, setExecutePending] = useState<string | null>(null)
  type View = typeof view.current
  const isCurrent = (captured: View, target: string) => view.current === captured && captured.sessionId === target
  const updateError = (captured: View, target: string, message: string | null) => {
    if (isCurrent(captured, target)) setError(message)
  }
  const refreshReceipt = (target: string) => {
    if (view.current.sessionId !== target) return
    try {
      const pending = readReceipt(target)?.phase === "activation"
      setExecutePending(pending ? target : null)
      setError(pending ? "消息已保存，启动尚未确认；可以重试启动。" : null)
    } catch (failure) { setError(getErrorMessage(failure)) }
  }
  useEffect(() => {
    const refreshBusy = () => setBusy(!!view.current.sessionId && admittedSessions.has(view.current.sessionId))
    admissionListeners.add(refreshBusy); refreshBusy()
    return () => { admissionListeners.delete(refreshBusy) }
  }, [sessionId])
  useEffect(() => {
    setExecutePending(null); setError(null)
    if (!sessionId) return
    try {
      if (readReceipt(sessionId)?.phase === "activation") {
        setExecutePending(sessionId); setError("消息已保存，启动尚未确认；可以重试启动。")
      }
    } catch (failure) { setError(getErrorMessage(failure)) }
  }, [sessionId])
  const hasPending = (sessionId: string | null | undefined) => {
    if (!sessionId) return false
    try { return sessionStorage.getItem(receiptKey(sessionId)) !== null } catch { return false }
  }
  const references = (sessionId: string | null | undefined) => {
    if (!sessionId) return undefined
    try { return readReceipt(sessionId)?.references } catch { return undefined }
  }
  const clearOwnedReceipt = (sessionId: string, deliveryId: string) => {
    const stored = readReceipt(sessionId)
    if (stored && stored.id !== deliveryId) return false
    if (stored) sessionStorage.removeItem(receiptKey(sessionId))
    refreshReceipt(sessionId)
    return true
  }
  const execute = async (sessionId: string, delivery: Delivery, captured: View) => {
    if (getRootModeFenceState(sessionId) !== "clear") {
      refreshReceipt(sessionId); updateError(captured, sessionId, "消息已保存；Root 模式切换尚未确认，启动已暂停。")
      return false
    }
    try {
      const result = await agentClient.execute(sessionId)
      if (!["started", "already_running", "completed"].includes(result.status)) throw new Error("消息已保存，运行尚未启动。")
      if (!clearOwnedReceipt(sessionId, delivery.id)) throw new Error("消息回执已变化，请刷新后核对。")
      void useAppStore.getState().loadChatHistory(sessionId).catch(() => {})
      return true
    } catch { refreshReceipt(sessionId); updateError(captured, sessionId, "消息已保存，启动尚未确认；可以重试启动。"); return false }
  }
  const send = async (request: ChatRequest): Promise<SendSubmissionResult> => {
    const sessionId = request.session_id
    if (!sessionId) return { kind: "blocked" }
    if (admittedSessions.has(sessionId)) return { kind: "busy" }
    if (getRootModeFenceState(sessionId) !== "clear") return { kind: "blocked" }
    const captured = view.current
    const operationId = ++sequence.current
    let replay = false
    let deliveryId: string | undefined
    admittedSessions.add(sessionId); notifyAdmissions(); updateError(captured, sessionId, null)
    try {
      const prior = readReceipt(sessionId)
      replay = !!prior
      if (prior?.phase === "activation") {
        refreshReceipt(sessionId); updateError(captured, sessionId, "消息已保存，请先确认启动，避免重复发送。")
        return { kind: "blocked" }
      }
      if (prior?.references && Object.entries(prior.references).some(([key, value]) =>
        request[key as keyof References] !== undefined && request[key as keyof References] !== value)) {
        updateError(captured, sessionId, "上次消息尚未确认，请保持原引用后重试。")
        return { kind: "blocked" }
      }
      const restored = prior?.references ? { ...request, ...prior.references } : request
      const bytes = new TextEncoder().encode(JSON.stringify(prior && prior.fingerprint_version === undefined ? restored : canonicalRequest(restored)))
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("")
      if (prior && prior.fingerprint !== fingerprint) {
        updateError(captured, sessionId, "上次消息尚未确认，请先用原文重试，避免重复创建工作。")
        return { kind: "blocked" }
      }
      if (getRootModeFenceState(sessionId) !== "clear") return { kind: "blocked" }
      const saved = prior ?? { fingerprint, fingerprint_version: 2 as const, id: crypto.randomUUID(), references: {
        ...(request.thread_id ? { thread_id: request.thread_id } : {}),
        ...(request.in_reply_to ? { in_reply_to: request.in_reply_to } : {}),
        ...(request.correlation_id ? { correlation_id: request.correlation_id } : {}),
      } }
      deliveryId = saved.id
      // No text/image/credential bytes in the reload receipt.
      sessionStorage.setItem(receiptKey(sessionId), JSON.stringify(saved))
      const response = await apiClient.postOnce<ChatResponse>("chat", { ...restored, message_id: saved.id, correlation_id: restored.correlation_id ?? saved.id })
      if (response.session_id !== sessionId || response.message_id !== saved.id
        || !Number.isSafeInteger(response.ingress_seq) || (response.ingress_seq ?? 0) < 1) throw new Error("未收到同一条消息的持久化确认。")
      if (readReceipt(sessionId)?.id !== saved.id) throw new Error("消息回执已变化，请刷新后核对。")
      const acknowledged: Delivery = { ...saved, phase: "activation" }
      sessionStorage.setItem(receiptKey(sessionId), JSON.stringify(acknowledged))
      refreshReceipt(sessionId)
      await execute(sessionId, acknowledged, captured)
      return { kind: "accepted", operationId, sessionId, navigated: false }
    } catch (failure) {
      if (!replay && deliveryId && isApiError(failure) && failure.status >= 400 && failure.status < 500) {
        try { clearOwnedReceipt(sessionId, deliveryId) } catch { /* Preserve an unreadable recovery receipt. */ }
      }
      updateError(captured, sessionId, getErrorMessage(failure) + " 草稿已保留；重试将使用同一条消息。")
      return { kind: "unconfirmed", operationId }
    } finally { admittedSessions.delete(sessionId); notifyAdmissions() }
  }
  const retryExecute = async () => {
    const target = executePending
    if (!target || admittedSessions.has(target)) return false
    const captured = view.current
    admittedSessions.add(target); notifyAdmissions()
    try {
      const delivery = readReceipt(target)
      if (delivery?.phase !== "activation") { refreshReceipt(target); return false }
      return await execute(target, delivery, captured)
    } catch (failure) { updateError(captured, target, getErrorMessage(failure)); return false }
    finally { admittedSessions.delete(target); notifyAdmissions() }
  }
  return { send, busy, error, executePending, hasPending, references, retryExecute }
}
