import { useRef, useState } from "react"
import { apiClient, getErrorMessage, isApiError } from "@services/api"
import { agentClient, type ChatRequest, type ChatResponse } from "@services/chat/AgentService"
import { useAppStore } from "@shared/store/appStore"
import type { SendSubmissionResult } from "./useChat"
import { getRootModeFenceState } from "@/lib/rootModeTransitionFence"

type Delivery = { id: string; fingerprint: string }
const receiptKey = (id: string) => `lotus-next.ticket-human.${id}`
function readReceipt(id: string): Delivery | undefined {
  try {
    const value = JSON.parse(sessionStorage.getItem(receiptKey(id)) ?? "null")
    if (typeof value?.id === "string" && value.id.length <= 128
      && typeof value.fingerprint === "string" && /^[a-f0-9]{64}$/.test(value.fingerprint)) return value
  } catch { /* Memory still protects the current mounted composer. */ }
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
  const execute = async (sessionId: string) => {
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
    active.current = true; setBusy(true); setError(null)
    try {
      const bytes = new TextEncoder().encode(JSON.stringify(request))
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("")
      const prior = pending.current.get(sessionId) ?? readReceipt(sessionId)
      if (prior && prior.fingerprint !== fingerprint) {
        setError("上次消息尚未确认，请先用原文重试，避免重复创建工作。")
        return { kind: "blocked" }
      }
      if (getRootModeFenceState(sessionId) !== "clear") return { kind: "blocked" }
      const saved = prior ?? { fingerprint, id: crypto.randomUUID() }
      pending.current.set(sessionId, saved)
      // No text/image/credential bytes in the reload receipt.
      try { sessionStorage.setItem(receiptKey(sessionId), JSON.stringify(saved)) } catch { /* Retain memory receipt. */ }
      const response = await apiClient.postOnce<ChatResponse>("chat", { ...request, message_id: saved.id, correlation_id: request.correlation_id ?? saved.id })
      if (response.session_id !== sessionId || response.message_id !== saved.id
        || !Number.isSafeInteger(response.ingress_seq) || (response.ingress_seq ?? 0) < 1) throw new Error("未收到同一条消息的持久化确认。")
      pending.current.delete(sessionId)
      try { sessionStorage.removeItem(receiptKey(sessionId)) } catch { /* Memory receipt cleared. */ }
      await execute(sessionId)
      return { kind: "accepted", operationId, sessionId, navigated: false }
    } catch (failure) {
      if (isApiError(failure) && failure.status >= 400 && failure.status < 500) {
        pending.current.delete(sessionId)
        try { sessionStorage.removeItem(receiptKey(sessionId)) } catch { /* No ambiguous write was accepted. */ }
      }
      setError(getErrorMessage(failure) + " 草稿已保留；重试将使用同一条消息。")
      return { kind: "unconfirmed", operationId }
    } finally { active.current = false; setBusy(false) }
  }
  return { send, busy, error, executePending, retryExecute: () => executePending ? execute(executePending) : Promise.resolve(false) }
}
