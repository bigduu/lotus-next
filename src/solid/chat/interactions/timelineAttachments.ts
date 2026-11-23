import type { JSX } from "@solidjs/web"
import type { MessageHistoryEntry } from "../history/historyProjection"

export type TimelineAttachment = { key: string; afterMessageId: string | null; render: () => JSX.Element }
export type TimelineHistoryEntry = MessageHistoryEntry | { key: string; attachment: TimelineAttachment }

export function placeTimelineAttachments(history: MessageHistoryEntry[], attachments: readonly TimelineAttachment[] = []) {
  if (!attachments.length) return { entries: history, tail: [] as TimelineAttachment[] }
  const byMessage = new Map<string, string>()
  if (attachments.some((attachment) => attachment.afterMessageId)) {
    for (const { key, item } of history) {
      const members = item.kind === "collapsedTurn" ? item.items : [item]
      for (const member of members) {
        if (member.kind === "msg") byMessage.set(member.m.id, key)
        else for (const part of member.parts) {
          if (part.kind === "tools") {
            for (const message of part.items) byMessage.set(message.id, key)
          }
        }
      }
    }
  }

  const after = new Map<string, TimelineAttachment[]>()
  const tail: TimelineAttachment[] = []
  for (const attachment of attachments) {
    const key = attachment.afterMessageId ? byMessage.get(attachment.afterMessageId) : undefined
    if (key) {
      const group = after.get(key) ?? []
      group.push(attachment)
      after.set(key, group)
    } else {
      tail.push(attachment)
    }
  }

  // A card's size belongs to its own measured row. Adjacent history keeps its
  // offset and reveal keys when the card is replaced by a read-only receipt.
  const entries = after.size ? history.flatMap<TimelineHistoryEntry>((entry) => [
    entry,
    ...(after.get(entry.key) ?? []).map((attachment) => ({ key: `timeline-${attachment.key}`, attachment })),
  ]) : history
  return { entries, tail }
}
