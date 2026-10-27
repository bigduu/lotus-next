import type { Message } from "@shared/types/chat"

/** A completed UI tail awaiting canonical history, never a persisted message. */
export interface CompletedAnswerHandoff {
  sessionId: string
  operationId: number
  text: string
  acknowledgedMessageId: string | null
  baselineMessageId: string | null
  baselineMessageIds: ReadonlySet<string>
  anchorSeen: boolean
}

export const isCompletedAnswerHandoff = (message: Message) => message.role === "assistant"
  && message.type === "text" && message.metadata?.completedAnswerHandoff === true

export function projectCompletedAnswers(canonical: Message[], entries: readonly CompletedAnswerHandoff[]) {
  const remaining: CompletedAnswerHandoff[] = []
  const insertions = new Map<number, Message[]>()
  for (const entry of entries) {
    const baseline = canonical.findIndex((message) => message.id === entry.baselineMessageId)
    const anchor = entry.acknowledgedMessageId !== null
      ? canonical.findIndex((message) => message.role === "user" && message.id === entry.acknowledgedMessageId)
      : baseline >= 0 && canonical[baseline].role === "user" ? baseline
        : canonical.findIndex((message, index) => index > baseline && message.role === "user" && !entry.baselineMessageIds.has(message.id))
    // An observed user disappearing is a clear/truncate/reset, not permission
    // to resurrect the completed text from a local cache.
    if (anchor < 0 && (entry.anchorSeen || entry.acknowledgedMessageId === null && entry.baselineMessageId !== null && baseline < 0)) continue
    const nextUser = anchor < 0 ? -1 : canonical.findIndex((message, index) => index > anchor && message.role === "user")
    const end = nextUser < 0 ? canonical.length : nextUser
    const tail = canonical.slice(anchor + 1, end).findLast((message) => message.role !== "system")
    const confirmed = tail?.role === "assistant" && tail.type === "text" && tail.content.trim()
      && !(entry.text.trim().startsWith(tail.content.trim()) && entry.text.trim() !== tail.content.trim())
      && (entry.acknowledgedMessageId !== null ? anchor >= 0
        : !entry.baselineMessageIds.has(tail.id) && tail.content.trim() === entry.text.trim())
    if (confirmed) continue
    remaining.push(anchor >= 0 && !entry.anchorSeen ? { ...entry, anchorSeen: true } : entry)
    const at = nextUser < 0 ? canonical.length : nextUser
    const local: Message = { id: `completed-answer-handoff-${entry.operationId}`, role: "assistant", type: "text",
      content: entry.text, createdAt: "", metadata: { completedAnswerHandoff: true } }
    insertions.set(at, [...insertions.get(at) ?? [], local])
  }
  if (!remaining.length) return { messages: canonical, remaining }
  return { messages: [...canonical.flatMap((message, index) => [...insertions.get(index) ?? [], message]),
    ...insertions.get(canonical.length) ?? []], remaining }
}
