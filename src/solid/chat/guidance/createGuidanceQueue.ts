import { createEffect, createMemo, createSignal, onSettled, type Accessor } from "solid-js"
import { isSessionExecutionBlocked, observeSessionExecutionConflict } from "@services/chat/sessionExecutionCompatibility"
import { guidanceService, type GuidanceImage, type GuidanceMode, type PendingGuidance } from "@services/chat/guidance"
import { uiText } from "@shared/i18n/text"
import type { Message, UserMessage } from "@shared/types/chatMessages"
import { getRootModeFenceState } from "@/lib/rootModeTransitionState"
import { recordSessionUserInput } from "@/lib/sidebarSessionOrderState"
import type { SendSubmissionResult } from "../createChat"

type Receipt = { id: string; fingerprint: string }
export type QueuedGuidanceView = { message: UserMessage; mode: GuidanceMode }

const receiptKey = (id: string) => `lotus-next.guidance-submission.${id}`
const modeKey = (id: string) => `lotus-next.guidance-mode.${id}`
const emptyMessages: PendingGuidance[] = []
const emptyTranscript: readonly QueuedGuidanceView[] = []
const emptyHistory: readonly Message[] = []

function readReceipt(id: string): Receipt | null {
  try {
    const value = JSON.parse(sessionStorage.getItem(receiptKey(id)) ?? "null")
    if (typeof value?.id === "string" && typeof value?.fingerprint === "string") return value
  } catch { /* In-memory receipts still protect retry when storage is unavailable. */ }
  return null
}

function readMode(id: string | null): GuidanceMode {
  try {
    if (id && sessionStorage.getItem(modeKey(id)) === "after_run") return "after_run"
  } catch { /* Use the default. */ }
  return "after_round"
}

export function createGuidanceQueue(
  sessionId: Accessor<string | null>,
  running: Accessor<boolean>,
  history: Accessor<readonly Message[]> = () => emptyHistory,
) {
  const [snapshot, setSnapshot] = createSignal<{ sessionId: string; messages: PendingGuidance[] } | null>(null)
  // An unclaimed-list disappearance can mean that a delivery was claimed
  // before history became readable. Retain only locally acknowledged payloads
  // through that gap, until their exact history ID or a successful withdrawal.
  const [accepted, setAccepted] = createSignal(new Map<string, readonly QueuedGuidanceView[]>())
  const [failure, setFailure] = createSignal<{ sessionId: string; text: string } | null>(null)
  const [busy, setBusy] = createSignal<string | null>(null)
  const [modeState, setModeState] = createSignal<{ sessionId: string | null; mode: GuidanceMode } | null>(null)
  const [uncertain, setUncertain] = createSignal<string | null>(null)
  let active = false
  let mounted = true
  let revision = 0
  const receipts = new Map<string, Receipt>()
  const canonicalIds = createMemo(() => new Set(history().flatMap((message) =>
    message.role === "user" ? [message.id] : [],
  )))
  const pending = createMemo(() => {
    const current = snapshot()
    if (!current?.messages.length || current.sessionId !== sessionId()) return emptyMessages
    const confirmed = canonicalIds()
    const unconfirmed = current.messages.filter((message) => !confirmed.has(message.id))
    return unconfirmed.length ? unconfirmed : emptyMessages
  })
  const transcript = createMemo(() => {
    const id = sessionId()
    if (!id) return emptyTranscript
    const queued = pending()
    const acknowledged = accepted().get(id)
    if (!queued.length && !acknowledged?.length) return emptyTranscript
    const confirmed = canonicalIds()
    const local = new Map(acknowledged?.map((item) => [item.message.id, item]))
    const projected = queued.map((item): QueuedGuidanceView => {
      const known = local.get(item.id)
      local.delete(item.id)
      return known ?? {
        mode: item.mode ?? "after_round",
        message: { id: item.id, role: "user", content: item.text, createdAt: item.created_at,
          images: item.images?.map((imageId) => ({
            id: imageId, url: guidanceService.imageUrl(id, imageId), name: imageId, size: 0, type: "",
          })) },
      }
    })
    return [...projected, ...[...local.values()].filter((item) => !confirmed.has(item.message.id))]
  })
  const removeAccepted = (target: string, remove: (id: string) => boolean) => {
    setAccepted((current) => {
      const items = current.get(target)
      if (!items) return current
      const remaining = items.filter((item) => !remove(item.message.id))
      if (remaining.length === items.length) return current
      const next = new Map(current)
      if (remaining.length) next.set(target, remaining)
      else next.delete(target)
      return next
    })
  }
  createEffect(() => [sessionId(), canonicalIds()] as const, ([activeSessionId, confirmed]) => {
    if (activeSessionId) removeAccepted(activeSessionId, (id) => confirmed.has(id))
  })
  const mode = () => {
    const id = sessionId()
    const selected = modeState()
    return selected?.sessionId === id ? selected.mode : readMode(id)
  }

  const setMode = (next: GuidanceMode) => {
    const id = sessionId()
    setModeState({ sessionId: id, mode: next })
    try {
      if (id) sessionStorage.setItem(modeKey(id), next)
    } catch { /* Keep the current choice in memory. */ }
  }

  const refresh = async (id: string) => {
    const version = ++revision
    const result = await guidanceService.list(id)
    if (mounted && sessionId() === id && version === revision) setSnapshot({ sessionId: id, messages: result.messages })
  }

  onSettled(() => () => { mounted = false })
  createEffect(() => [sessionId(), running()] as const, ([id, isRunning]) => {
    if (!id) return
    let disposed = false
    let timer: ReturnType<typeof setTimeout> | undefined
    const poll = async () => {
      try { await refresh(id) } catch { /* Keep the last queue snapshot while reconnecting. */ }
      if (!disposed) timer = setTimeout(() => { void poll() }, isRunning ? 1_500 : 5_000)
    }
    void poll()
    return () => {
      disposed = true
      clearTimeout(timer)
      ++revision
    }
  })

  const saveReceipt = (target: string, receipt: Receipt | null) => {
    if (receipt) receipts.set(target, receipt)
    else receipts.delete(target)
    try {
      if (receipt) sessionStorage.setItem(receiptKey(target), JSON.stringify(receipt))
      else sessionStorage.removeItem(receiptKey(target))
    } catch { /* Receipt lifetime is still preserved in memory. */ }
  }

  const send = async (text: string, images: GuidanceImage[] = []): Promise<SendSubmissionResult> => {
    const target = sessionId()
    if (!target || (!text.trim() && !images.length)) return { kind: "ignored" }
    if (getRootModeFenceState(target) !== "clear" || isSessionExecutionBlocked(target)) return { kind: "blocked" }
    if (active) return { kind: "busy" }
    active = true
    setBusy(target)
    setFailure(null)
    const timing = mode()
    const submittedImages = images.map((image) => ({ ...image }))
    let createdReceiptId: string | null = null
    let replacedReceipt: Receipt | null = null

    try {
      const bytes = new TextEncoder().encode(JSON.stringify({ text, images: submittedImages, mode: timing }))
      const fingerprint = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes)), (byte) => byte.toString(16).padStart(2, "0")).join("")
      const previous = receipts.get(target) ?? readReceipt(target)
      const receipt = previous?.fingerprint === fingerprint ? previous : { id: crypto.randomUUID(), fingerprint }
      if (receipt !== previous) {
        createdReceiptId = receipt.id
        replacedReceipt = previous
      }
      saveReceipt(target, receipt)

      // A concurrent mode change or compatibility refusal can land while hashing.
      if (getRootModeFenceState(target) !== "clear" || isSessionExecutionBlocked(target)) {
        if (receipt !== previous) saveReceipt(target, previous)
        return { kind: "blocked" }
      }

      const result = await guidanceService.send(target, receipt.id, text, timing, submittedImages)
      if (result.id !== receipt.id) throw new Error("Queue acknowledgement identity mismatch")
      if (mounted && (sessionId() !== target || !canonicalIds().has(receipt.id))) {
        const view: QueuedGuidanceView = {
          mode: timing,
          message: { id: receipt.id, role: "user", content: text, createdAt: new Date().toISOString(),
            images: submittedImages.map((image, index) => ({
              id: `${receipt.id}-image-${index}`, base64: image.base64,
              name: image.name ?? "image", size: image.size ?? 0, type: image.type ?? "image/png",
            })) },
        }
        setAccepted((current) => new Map(current).set(target, [
          ...(current.get(target) ?? []).filter((item) => item.message.id !== receipt.id), view,
        ]))
      }
      recordSessionUserInput(target)
      receipts.delete(target)
      try {
        if (readReceipt(target)?.id === receipt.id) sessionStorage.removeItem(receiptKey(target))
      } catch { /* An acknowledgement may retire only its own stored receipt. */ }
      if (mounted && sessionId() === target) {
        setUncertain(null)
        void refresh(target).catch(() => { /* Keep the acknowledged provisional row. */ })
      }
      return { kind: "accepted", operationId: 0, sessionId: target, navigated: false }
    } catch (error) {
      if (observeSessionExecutionConflict(target, error)) {
        // A definite refusal does not invalidate an older ambiguous attempt.
        if (createdReceiptId !== null) {
          if (receipts.get(target)?.id === createdReceiptId) {
            if (replacedReceipt) receipts.set(target, replacedReceipt)
            else receipts.delete(target)
          }
          try {
            if (readReceipt(target)?.id === createdReceiptId) {
              if (replacedReceipt) sessionStorage.setItem(receiptKey(target), JSON.stringify(replacedReceipt))
              else sessionStorage.removeItem(receiptKey(target))
            }
          } catch { /* Preserve an unreadable receipt. */ }
        }
        return { kind: "blocked" }
      }
      if (mounted && sessionId() === target) {
        setUncertain(target)
        setFailure({ sessionId: target, text: uiText("sending_could_not_be_confirmed_text_and_images_are_pres_65db5d72") })
      }
      return { kind: "unconfirmed", operationId: 0 }
    } finally {
      active = false
      if (mounted) setBusy(null)
    }
  }

  const cancel = async (id: string) => {
    const target = sessionId()
    if (!target || active) return
    active = true
    setBusy(target)
    setFailure(null)
    try {
      await guidanceService.cancel(target, id)
      if (mounted) {
        removeAccepted(target, (messageId) => messageId === id)
        if (sessionId() === target) ++revision
        setSnapshot((value) =>
          value?.sessionId === target ? { ...value, messages: value.messages.filter((item) => item.id !== id) } : value,
        )
      }
    } catch {
      if (mounted && sessionId() === target) {
        setFailure({ sessionId: target, text: uiText("could_not_withdraw_the_message_may_already_be_applying_f01042f1") })
      }
    } finally {
      active = false
      if (mounted) setBusy(null)
    }
  }

  return {
    get mode() { return mode() },
    setMode, send, cancel,
    get pending() { return pending() },
    get transcript() { return transcript() },
    get error() {
      const current = failure()
      return current?.sessionId === sessionId() ? current.text : null
    },
    get busy() {
      const target = busy()
      return target !== null && target === sessionId()
    },
    get hasUnconfirmed() {
      const id = sessionId()
      // Busy changes after mutating the receipt, including a definitive refusal.
      busy()
      return !!id && (uncertain() === id || receipts.has(id) || !!readReceipt(id))
    },
  }
}
