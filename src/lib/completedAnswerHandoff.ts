import type { AssistantTextMessage, Message } from "@shared/types/chat"

/** A completed UI tail awaiting canonical history, never a persisted message. */
export interface CompletedAnswerHandoff {
  sessionId: string
  operationId: number
  /** Unique in this UI process; operationId alone is local to one hook. */
  handoffId?: string
  /** Only a run identity confirmed by the execution response. */
  runId?: string | null
  text: string
  acknowledgedMessageId: string | null
  baselineMessageId: string | null
  /** Text already present on the baseline ID before this run began. */
  baselineMessageText?: string | null
  /** Canonical IDs already used to confirm another in-flight run. */
  excludedCanonicalIds?: ReadonlySet<string>
  baselineMessageIds: ReadonlySet<string>
  anchorSeen: boolean
}

// History may normalize line endings and surrounding whitespace. A different
// body in the same turn can be an intermediate answer, not the completed one.
const normalizeAnswer = (text: string) => text.replace(/\r\n?/g, "\n").trim()

export const matchesCompletedAnswer = (saved: string, completed: string) => {
  const expected = normalizeAnswer(completed)
  return Boolean(expected) && normalizeAnswer(saved) === expected
}

export const isStreamedAnswerPrefix = (saved: string, preview: string) => {
  const visible = normalizeAnswer(preview)
  return Boolean(visible) && normalizeAnswer(saved).startsWith(visible)
}

export const isCompletedAnswerHandoff = (message: Message) => message.role === "assistant"
  && message.type === "text" && message.metadata?.completedAnswerHandoff === true

type AnswerTurnIdentity = Pick<CompletedAnswerHandoff,
  "baselineMessageId" | "baselineMessageIds" | "acknowledgedMessageId" | "excludedCanonicalIds" | "anchorSeen">

export function readAnswerTurn(canonical: readonly Message[], entry: AnswerTurnIdentity) {
  const baseline = canonical.findIndex((message) => message.id === entry.baselineMessageId)
  const anchor = entry.acknowledgedMessageId !== null
    ? canonical.findIndex((message) => message.role === "user" && message.id === entry.acknowledgedMessageId)
    : baseline >= 0 && canonical[baseline].role === "user" ? baseline
      : canonical.findIndex((message, index) => index > baseline && message.role === "user" && !entry.baselineMessageIds.has(message.id))
  // An absent anchor may be a stale read or a deletion. Without an explicit
  // mutation receipt, retain the handoff but do not attach it to another turn.
  if (anchor < 0 && (entry.acknowledgedMessageId !== null || entry.anchorSeen
    || entry.baselineMessageId !== null && baseline < 0)) return null

  const nextUser = anchor < 0 ? -1 : canonical.findIndex((message, index) => index > anchor && message.role === "user")
  const end = nextUser < 0 ? canonical.length : nextUser
  const start = Math.max(anchor, baseline)
  // A later asynchronous delivery can already be the tail of this user turn.
  // Only an explicit final row can prove retirement before terminal delivery.
  const recordedFinals = start < 0 ? [] : canonical.slice(start + 1, end).filter((message): message is AssistantTextMessage =>
    message.role === "assistant" && message.type === "text" && message.phase === "final_answer"
    && !entry.baselineMessageIds.has(message.id) && !entry.excludedCanonicalIds?.has(message.id),
  )
  const tailIndex = canonical.findLastIndex((message, index) => index > anchor && index < end && message.role !== "system")
  const tail = canonical[tailIndex]
  const freshUnphasedTail = tailIndex > start && tail?.role === "assistant" && tail.type === "text" && !tail.phase
    && !entry.baselineMessageIds.has(tail.id) && !entry.excludedCanonicalIds?.has(tail.id) ? tail : null
  return { anchor, end, recordedFinals, tailIndex, freshUnphasedTail }
}

export function projectCompletedAnswers(canonical: Message[], entries: readonly CompletedAnswerHandoff[],
  onConfirmed?: (entry: CompletedAnswerHandoff, canonicalMessageId: string) => void) {
  const remaining: CompletedAnswerHandoff[] = []
  const claimed = new Set<string>()
  const insertions = new Map<number, Message[]>()
  const suppressed = new Set<number>()
  for (const entry of entries) {
    const turn = readAnswerTurn(canonical, entry)
    if (!turn) {
      remaining.push(entry)
      continue
    }
    const { anchor, end, recordedFinals, tailIndex } = turn
    const recorded = recordedFinals.find((message) => !claimed.has(message.id)
      && matchesCompletedAnswer(message.content, entry.text))
    if (recorded) {
      claimed.add(recorded.id)
      onConfirmed?.(entry, recorded.id)
      continue
    }
    const tail = canonical[tailIndex]
    const answerTail = tail?.role === "assistant" && tail.type === "text" && tail.phase !== "commentary" ? tail : null
    const partialTail = answerTail && !answerTail.phase && answerTail.content.trim()
      && entry.text.trim().startsWith(answerTail.content.trim()) && entry.text.trim() !== answerTail.content.trim() ? answerTail : null
    const unchangedBaseline = tail?.id === entry.baselineMessageId && typeof entry.baselineMessageText === "string"
      && matchesCompletedAnswer(entry.baselineMessageText, entry.text)
    const confirmed = answerTail && matchesCompletedAnswer(answerTail.content, entry.text)
      && (entry.acknowledgedMessageId !== null ? anchor >= 0 : !entry.baselineMessageIds.has(answerTail.id))
      && !unchangedBaseline && !entry.excludedCanonicalIds?.has(answerTail.id) && !claimed.has(answerTail.id)
    if (confirmed) { claimed.add(answerTail.id); onConfirmed?.(entry, answerTail.id); continue }
    // Only hide a newly observed prefix in the exact acknowledged turn. The
    // canonical history remains unchanged and uncertain older text stays visible.
    const superseded = partialTail && anchor >= 0 && entry.acknowledgedMessageId !== null
      && !entry.baselineMessageIds.has(partialTail.id) ? partialTail : null
    if (superseded) suppressed.add(tailIndex)
    remaining.push(anchor >= 0 && !entry.anchorSeen ? { ...entry, anchorSeen: true } : entry)
    const local: Message = { ...(superseded ?? {}), id: `completed-answer-handoff-${entry.handoffId ?? entry.operationId}`, role: "assistant", type: "text",
      content: entry.text, createdAt: superseded?.createdAt ?? "",
      metadata: { ...superseded?.metadata, completedAnswerHandoff: true } }
    insertions.set(end, [...insertions.get(end) ?? [], local])
  }
  if (!remaining.length) return { messages: canonical, remaining }
  return { messages: [...canonical.flatMap((message, index) => [...insertions.get(index) ?? [], ...(suppressed.has(index) ? [] : [message])]),
    ...insertions.get(canonical.length) ?? []], remaining }
}
