import { useRef, useState } from "react"
import { apiClient, getErrorMessage, isApiError } from "@services/api"
import { agentClient, type ChatRequest, type ChatResponse } from "@services/chat/AgentService"
import { useAppStore } from "@shared/store/appStore"
import type { SendSubmissionResult } from "./useChat"
import { getRootModeFenceState } from "@/lib/rootModeTransitionFence"

type References = Pick<ChatRequest, "thread_id" | "in_reply_to" | "correlation_id">
type Delivery = { id: string; fingerprint: string; fingerprint_version?: 2; references?: References }
const receiptKey = (id: string) => `lotus-next.ticket-human.${id}`
function readReceipt(id: string): Delivery | undefined {
  const raw = sessionStorage.getItem(receiptKey(id))
  if (raw === null) return
  const value = JSON.parse(raw)
  if (typeof value?.id !== "string" || value.id.length === 0 || value.id.length > 128
    || typeof value.fingerprint !== "string" || !/^[a-f0-9]{64}$/.test(value.fingerprint)
    || (value.fingerprint_version !== undefined && value.fingerprint_version !== 2)
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
export function useTicketIngress() {
  const pending = useRef(new Map<string, Delivery>())
  const active = useRef(false)
  const sequence = useRef(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [executePending, setExecutePending] = useState<string | null>(null)
  const hasPending = (sessionId: string | null | undefined) => {
    if (!sessionId) return false
    if (pending.current.has(sessionId)) return true
    try { return sessionStorage.getItem(receiptKey(sessionId)) !== null } catch { return false }
  }
  const references = (sessionId: string | null | undefined) => {
    if (!sessionId) return undefined
    try { return (pending.current.get(sessionId) ?? readReceipt(sessionId))?.references } catch { return undefined }
  }
  const execute = async (sessionId: string) => {
    if (getRootModeFenceState(sessionId) !== "clear") {
      setExecutePending(sessionId); setError("消息已保存；Root 模式切换尚未确认，启动已暂停。")
      return false
    }
    try {
      const result = await agentClient.execute(sessionId)
      if (!["started", "already_running", "completed"].includes(result.status)) throw new Error("消息已保存，运行尚未启动。")
      setExecutePending(null); setError(null)
      void useAppStore.getState().loadChatHistory(sessionId).catch(() => {})
      return true
    } catch { setExecutePending(sessionId); setError("消息已保存，启动尚未确认；可以重试启动。"); return false }
  }
  const send = async (request: ChatRequest): Promise<SendSubmissionResult> => {
    if (active.current) return { kind: "busy" }
    const sessionId = request.session_id
    if (!sessionId) return { kind: "blocked" }
    if (getRootModeFenceState(sessionId) !== "clear") return { kind: "blocked" }
    const operationId = ++sequence.current
    let replay = false
    active.current = true; setBusy(true); setError(null)
    try {
      const prior = pending.current.get(sessionId) ?? readReceipt(sessionId)
      replay = !!prior
      if (prior?.references && Object.entries(prior.references).some(([key, value]) =>
        request[key as keyof References] !== undefined && request[key as keyof References] !== value)) {
        setError("上次消息尚未确认，请保持原引用后重试。")
        return { kind: "blocked" }
      }
      const restored = prior?.references ? { ...request, ...prior.references } : request
      const bytes = new TextEncoder().encode(JSON.stringify(prior && prior.fingerprint_version === undefined ? restored : canonicalRequest(restored)))
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("")
      if (prior && prior.fingerprint !== fingerprint) {
        setError("上次消息尚未确认，请先用原文重试，避免重复创建工作。")
        return { kind: "blocked" }
      }
      if (getRootModeFenceState(sessionId) !== "clear") return { kind: "blocked" }
      const saved = prior ?? { fingerprint, fingerprint_version: 2 as const, id: crypto.randomUUID(), references: {
        ...(request.thread_id ? { thread_id: request.thread_id } : {}),
        ...(request.in_reply_to ? { in_reply_to: request.in_reply_to } : {}),
        ...(request.correlation_id ? { correlation_id: request.correlation_id } : {}),
      } }
      pending.current.set(sessionId, saved)
      // No text/image/credential bytes in the reload receipt.
      sessionStorage.setItem(receiptKey(sessionId), JSON.stringify(saved))
      const response = await apiClient.postOnce<ChatResponse>("chat", { ...restored, message_id: saved.id, correlation_id: restored.correlation_id ?? saved.id })
      if (response.session_id !== sessionId || response.message_id !== saved.id
        || !Number.isSafeInteger(response.ingress_seq) || (response.ingress_seq ?? 0) < 1) throw new Error("未收到同一条消息的持久化确认。")
      pending.current.delete(sessionId)
      try { sessionStorage.removeItem(receiptKey(sessionId)) } catch { /* Memory receipt cleared. */ }
      await execute(sessionId)
      return { kind: "accepted", operationId, sessionId, navigated: false }
    } catch (failure) {
      if (!replay && isApiError(failure) && failure.status >= 400 && failure.status < 500) {
        pending.current.delete(sessionId)
        try { sessionStorage.removeItem(receiptKey(sessionId)) } catch { /* No ambiguous write was accepted. */ }
      }
      setError(getErrorMessage(failure) + " 草稿已保留；重试将使用同一条消息。")
      return { kind: "unconfirmed", operationId }
    } finally { active.current = false; setBusy(false) }
  }
  return { send, busy, error, executePending, hasPending, references, retryExecute: () => executePending ? execute(executePending) : Promise.resolve(false) }
}
