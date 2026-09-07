import { useEffect, useRef, useState } from "react"
import { guidanceService, type GuidanceImage, type GuidanceMode, type PendingGuidance } from "@services/chat/guidance"
import type { SendSubmissionResult } from "./useChat"

const receiptKey = (id: string) => `lotus-next.guidance-submission.${id}`
const modeKey = (id: string) => `lotus-next.guidance-mode.${id}`
function readReceipt(id: string): { id: string; fingerprint: string } | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(receiptKey(id)) ?? "null")
    if (typeof value?.id === "string" && typeof value?.fingerprint === "string") return value
  } catch { /* An in-memory receipt still protects a retry when storage is unavailable. */ }
  return null
}
function readMode(id: string | null): GuidanceMode {
  try { if (id && sessionStorage.getItem(modeKey(id)) === "after_run") return "after_run" } catch { /* Use the default. */ }
  return "after_round"
}

export function useGuidanceQueue(sessionId: string | null, running: boolean) {
  const [snapshot, setSnapshot] = useState<{ sessionId: string; messages: PendingGuidance[] } | null>(null)
  const [failure, setFailure] = useState<{ sessionId: string; text: string } | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [modeState, setModeState] = useState({ sessionId, mode: readMode(sessionId) })
  const [uncertain, setUncertain] = useState<string | null>(sessionId && readReceipt(sessionId) ? sessionId : null)
  const active = useRef(false)
  const currentSession = useRef(sessionId)
  currentSession.current = sessionId
  const mounted = useRef(true)
  const revision = useRef(0)
  const receipts = useRef(new Map<string, { id: string; fingerprint: string }>())
  const mode = modeState.sessionId === sessionId ? modeState.mode : readMode(sessionId)
  const setMode = (next: GuidanceMode) => {
    setModeState({ sessionId, mode: next })
    try { if (sessionId) sessionStorage.setItem(modeKey(sessionId), next) } catch { /* Keep the current selection in memory. */ }
  }
  const refresh = async (id: string) => {
    const version = ++revision.current
    const result = await guidanceService.list(id)
    if (mounted.current && currentSession.current === id && version === revision.current) setSnapshot({ sessionId: id, messages: result.messages })
  }
  const invalidateRefresh = () => { ++revision.current }
  useEffect(() => { mounted.current = true; return () => { mounted.current = false } }, [])
  useEffect(() => {
    if (!sessionId) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout>
    const poll = async () => {
      try { await refresh(sessionId) } catch { /* Keep the last queue snapshot while reconnecting. */ }
      if (!disposed) timer = setTimeout(() => void poll(), running ? 1500 : 5000)
    }
    void poll()
    return () => { disposed = true; clearTimeout(timer); invalidateRefresh() }
  }, [sessionId, running])

  const send = async (text: string, images: GuidanceImage[] = []): Promise<SendSubmissionResult> => {
    if (!sessionId || (!text.trim() && !images.length)) return { kind: "ignored" }
    if (active.current) return { kind: "busy" }
    active.current = true
    const target = sessionId
    setBusy(target); setFailure(null)
    try {
      const bytes = new TextEncoder().encode(JSON.stringify({ text, images, mode }))
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("")
      const previous = receipts.current.get(target) ?? readReceipt(target)
      const receipt = previous?.fingerprint === fingerprint ? previous : { id: crypto.randomUUID(), fingerprint }
      receipts.current.set(target, receipt)
      try { sessionStorage.setItem(receiptKey(target), JSON.stringify(receipt)) } catch { /* No image bytes are stored in browser receipts. */ }
      const result = await guidanceService.send(target, receipt.id, text, mode, images)
      if (result.id !== receipt.id) throw new Error("Queue acknowledgement identity mismatch")
      receipts.current.delete(target)
      try { sessionStorage.removeItem(receiptKey(target)) } catch { /* The in-memory receipt has been cleared. */ }
      if (mounted.current && currentSession.current === target) {
        setUncertain(null)
        try { await refresh(target) } catch { /* Accepted delivery will appear on the next poll. */ }
      }
      return { kind: "accepted", operationId: 0, sessionId: target, navigated: false }
    } catch {
      if (mounted.current && currentSession.current === target) {
        setUncertain(target)
        setFailure({ sessionId: target, text: "未能确认发送状态，文字和图片已保留；重试会沿用同一条消息。" })
      }
      return { kind: "unconfirmed", operationId: 0 }
    } finally {
      active.current = false
      if (mounted.current) setBusy(null)
    }
  }
  const cancel = async (id: string) => {
    if (!sessionId || active.current) return
    const target = sessionId
    active.current = true; setBusy(target); setFailure(null)
    try {
      await guidanceService.cancel(target, id)
      ++revision.current
      if (mounted.current && currentSession.current === target) setSnapshot((value) => value?.sessionId === target ? { ...value, messages: value.messages.filter((item) => item.id !== id) } : value)
    } catch {
      if (mounted.current && currentSession.current === target) setFailure({ sessionId: target, text: "未能撤回，消息可能已经开始应用。" })
    } finally { active.current = false; if (mounted.current) setBusy(null) }
  }
  return {
    mode, setMode, send, cancel,
    pending: snapshot?.sessionId === sessionId ? snapshot.messages : [],
    error: failure?.sessionId === sessionId ? failure.text : null,
    busy: busy !== null && busy === sessionId,
    hasUnconfirmed: !!sessionId && (uncertain === sessionId || receipts.current.has(sessionId) || !!readReceipt(sessionId)),
  }
}
