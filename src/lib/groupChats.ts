import type { ChatItem } from "@shared/types/chatMessages"
import { NO_PROJECT_GROUP_KEY } from "@services/project"

export type ChatGroup = { key: string; label: string; chats: ChatItem[] }

function chatTime(c: ChatItem): number {
  // Sidebar ordering follows creation time: a session stays in the day group
  // where it was created instead of jumping to the top whenever it is updated.
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
 * Group sessions for the sidebar: pinned first, then by creation date
 * (今天 / 昨天 / M月D日), newest day first and newest created first within a day.
 */
export function groupChats(chats: ChatItem[], now: Date): ChatGroup[] {
  const pinned = chats.filter((c) => c.pinned).sort((a, b) => chatTime(b) - chatTime(a))
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

/**
 * Group sessions by their authoritative Project: pinned first, then one group
 * per Project (label resolved from the Project store by the caller), with
 * unassigned sessions falling into a trailing "未分配" group. Within a group,
 * newest created first.
 */
export function groupChatsByProject(
  chats: ChatItem[],
  resolveLabel: (projectId: string | null) => string,
): ChatGroup[] {
  const pinned = chats.filter((c) => c.pinned).sort((a, b) => chatTime(b) - chatTime(a))
  const rest = [...chats.filter((c) => !c.pinned)].sort(
    (a, b) => chatTime(b) - chatTime(a),
  )

  const order: string[] = []
  const byProject = new Map<string, ChatGroup>()
  for (const c of rest) {
    const raw = c.config?.projectId?.trim()
    const key = raw || NO_PROJECT_GROUP_KEY
    const bucket = byProject.get(key)
    if (bucket) bucket.chats.push(c)
    else {
      byProject.set(key, { key, label: resolveLabel(raw || null), chats: [c] })
      order.push(key)
    }
  }

  const groups: ChatGroup[] = []
  if (pinned.length) groups.push({ key: "__pinned", label: "置顶", chats: pinned })
  // Unassigned sessions always render last; keep first-seen order otherwise
  // (already sorted by newest creation time).
  const sortedKeys = [
    ...order.filter((key) => key !== NO_PROJECT_GROUP_KEY),
    ...(order.includes(NO_PROJECT_GROUP_KEY) ? [NO_PROJECT_GROUP_KEY] : []),
  ]
  for (const key of sortedKeys) {
    const group = byProject.get(key)
    if (group) groups.push(group)
  }
  return groups
}
