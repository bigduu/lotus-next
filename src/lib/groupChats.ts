import type { ChatItem } from "@shared/types/chatMessages"

export type ChatGroup = { key: string; label: string; chats: ChatItem[] }

function chatTime(c: ChatItem): number {
  const iso = c.lastActivityAt ?? c.updatedAt
  if (iso) {
    const t = Date.parse(iso)
    if (!Number.isNaN(t)) return t
  }
  return typeof c.createdAt === "number" ? c.createdAt : 0
}

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

function dayLabel(ts: number, now: Date): string {
  const d = new Date(ts)
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (dayKey(d) === dayKey(now)) return "今天"
  if (dayKey(d) === dayKey(yesterday)) return "昨天"
  if (d.getFullYear() === now.getFullYear()) return `${d.getMonth() + 1}月${d.getDate()}日`
  return `${d.getFullYear()}年${d.getMonth() + 1}月${d.getDate()}日`
}

/**
 * Group sessions for the sidebar: pinned first, then by activity date
 * (今天 / 昨天 / M月D日), newest day first and newest chat first within a day.
 */
export function groupChats(chats: ChatItem[], now: Date): ChatGroup[] {
  const pinned = chats.filter((c) => c.pinned)
  const rest = [...chats.filter((c) => !c.pinned)].sort(
    (a, b) => chatTime(b) - chatTime(a),
  )

  const byDay = new Map<string, ChatGroup>()
  for (const c of rest) {
    const time = chatTime(c)
    const key = dayKey(new Date(time))
    const bucket = byDay.get(key)
    if (bucket) bucket.chats.push(c)
    else byDay.set(key, { key, label: dayLabel(time, now), chats: [c] })
  }

  const groups: ChatGroup[] = []
  if (pinned.length) groups.push({ key: "__pinned", label: "置顶", chats: pinned })
  groups.push(...byDay.values())
  return groups
}
