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

const DAY_MS = 86_400_000
const startOfDay = (d: Date) =>
  new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()

function dayLabel(ts: number, now: Date): string {
  const d = new Date(ts)
  const today = startOfDay(now)
  const that = startOfDay(d)
  if (that === today) return "今天"
  if (that === today - DAY_MS) return "昨天"
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

  const byDay = new Map<string, ChatItem[]>()
  for (const c of rest) {
    const label = dayLabel(chatTime(c), now)
    const bucket = byDay.get(label)
    if (bucket) bucket.push(c)
    else byDay.set(label, [c])
  }

  const groups: ChatGroup[] = []
  if (pinned.length) groups.push({ key: "__pinned", label: "置顶", chats: pinned })
  for (const [label, cs] of byDay) groups.push({ key: label, label, chats: cs })
  return groups
}
