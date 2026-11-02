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

/** Newest creation in a bucket; group order must not follow row order. */
const newestCreation = (group: ChatGroup) =>
  group.chats.reduce((newest, chat) => Math.max(newest, typeof chat.createdAt === "number" ? chat.createdAt : 0), 0)

/**
 * Group sessions for the sidebar: pinned first, then by the session's ordering
 * date (今天 / 昨天 / M月D日), newest day first and newest row first within a day.
 *
 * A session's ordering date is its creation day until the user submits input to
 * it; that submission is the recency signal, so the session the user is talking
 * to now moves to the front instead of staying buried under its creation day.
 *
 * Days are ordered by date alone. A drag position or a submission only orders
 * rows inside their own day, so yesterday's session cannot push Yesterday above
 * Today just because the user touched it.
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
  // Day keys are zero-padded `YYYY-MM-DD`, so a plain string compare is newest-first.
  groups.push(...[...byDay.values()].sort((left, right) => right.key.localeCompare(left.key)))
  return groups
}

/**
 * Group sessions by their authoritative Project: pinned first, then one group
 * per Project (label resolved from the Project store by the caller), with
 * unassigned sessions falling into a trailing "未分配" group. Within a group,
 * the user's drag position wins, then newest user input first.
 *
 * Projects keep their pre-existing order (newest created session first) and the
 * unassigned group stays last, so dragging or writing inside one Project never
 * reshuffles the Project list itself.
 */
export function groupChatsByProject(
  chats: ChatItem[],
  resolveLabel: (projectId: string | null) => string,
  order: SessionOrder = emptySessionOrder,
): ChatGroup[] {
  const pinned = sortChats(chats.filter((c) => c.pinned), order)
  const rest = sortChats(chats.filter((c) => !c.pinned), order)

  const byProject = new Map<string, ChatGroup>()
  for (const c of rest) {
    const raw = c.config?.projectId?.trim()
    const key = raw || NO_PROJECT_GROUP_KEY
    const bucket = byProject.get(key)
    if (bucket) bucket.chats.push(c)
    else byProject.set(key, { key, label: resolveLabel(raw || null), chats: [c] })
  }

  const groups: ChatGroup[] = []
  if (pinned.length) groups.push({ key: "__pinned", label: uiText("pinned_section"), chats: pinned })
  const projectGroups = [...byProject.values()].filter((group) => group.key !== NO_PROJECT_GROUP_KEY)
  projectGroups.sort((left, right) => newestCreation(right) - newestCreation(left))
  groups.push(...projectGroups)
  const unassigned = byProject.get(NO_PROJECT_GROUP_KEY)
  if (unassigned) groups.push(unassigned)
  return groups
}
