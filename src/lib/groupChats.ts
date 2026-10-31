import { uiText, uiLanguage } from "@shared/i18n/ui"
import type { ChatItem } from "@shared/types/chatMessages"
import { NO_PROJECT_GROUP_KEY } from "@services/project"
import {
  compareSidebarSessions,
  emptySessionOrder,
  sessionSortTime,
  type SessionOrder,
} from "./sidebarSessionOrder"

export type ChatGroup = { key: string; label: string; chats: ChatItem[] }

const dayKey = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`

function dayLabel(ts: number, now: Date): string {
  const d = new Date(ts)
  const yesterday = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1)
  if (dayKey(d) === dayKey(now)) return uiText("today_d5f5a7a0")
  if (dayKey(d) === dayKey(yesterday)) return uiText("yesterday_0c184871")
  return new Intl.DateTimeFormat(uiLanguage(), {
    ...(d.getFullYear() === now.getFullYear() ? {} : { year: "numeric" as const }),
    month: "long", day: "numeric",
  }).format(d)
}

const sortChats = (chats: readonly ChatItem[], order: SessionOrder) =>
  [...chats].sort((left, right) => compareSidebarSessions(left, right, order))

/**
 * Group sessions for the sidebar: pinned first, then by the session's ordering
 * date (今天 / 昨天 / M月D日), newest day first and newest row first within a day.
 *
 * A session's ordering date is its creation day until the user submits input to
 * it; that submission is the recency signal, so the session the user is talking
 * to now moves to the front instead of staying buried under its creation day.
 */
export function groupChats(chats: ChatItem[], now: Date, order: SessionOrder = emptySessionOrder): ChatGroup[] {
  const pinned = sortChats(chats.filter((c) => c.pinned), order)
  const rest = sortChats(chats.filter((c) => !c.pinned), order)

  const byDay = new Map<string, ChatGroup>()
  for (const c of rest) {
    const time = sessionSortTime(c, order)
    const key = dayKey(new Date(time))
    const bucket = byDay.get(key)
    if (bucket) bucket.chats.push(c)
    else byDay.set(key, { key, label: dayLabel(time, now), chats: [c] })
  }

  const groups: ChatGroup[] = []
  if (pinned.length) groups.push({ key: "__pinned", label: uiText("pinned_section"), chats: pinned })
  groups.push(...byDay.values())
  return groups
}

/**
 * Group sessions by their authoritative Project: pinned first, then one group
 * per Project (label resolved from the Project store by the caller), with
 * unassigned sessions falling into a trailing "未分配" group. Within a group,
 * the user's drag position wins, then newest user input first.
 */
export function groupChatsByProject(
  chats: ChatItem[],
  resolveLabel: (projectId: string | null) => string,
  order: SessionOrder = emptySessionOrder,
): ChatGroup[] {
  const pinned = sortChats(chats.filter((c) => c.pinned), order)
  const rest = sortChats(chats.filter((c) => !c.pinned), order)

  const order_: string[] = []
  const byProject = new Map<string, ChatGroup>()
  for (const c of rest) {
    const raw = c.config?.projectId?.trim()
    const key = raw || NO_PROJECT_GROUP_KEY
    const bucket = byProject.get(key)
    if (bucket) bucket.chats.push(c)
    else {
      byProject.set(key, { key, label: resolveLabel(raw || null), chats: [c] })
      order_.push(key)
    }
  }

  const groups: ChatGroup[] = []
  if (pinned.length) groups.push({ key: "__pinned", label: uiText("pinned_section"), chats: pinned })
  // Unassigned sessions always render last; keep first-seen order otherwise
  // (already sorted by the sidebar ordering comparator).
  const sortedKeys = [
    ...order_.filter((key) => key !== NO_PROJECT_GROUP_KEY),
    ...(order_.includes(NO_PROJECT_GROUP_KEY) ? [NO_PROJECT_GROUP_KEY] : []),
  ]
  for (const key of sortedKeys) {
    const group = byProject.get(key)
    if (group) groups.push(group)
  }
  return groups
}
