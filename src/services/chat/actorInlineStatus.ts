import type { ChatItem } from "@shared/types/chatMessages"
import type { ChildProgress } from "@shared/store/appStore/slices/executionStateSlice/types"
import type { SessionPlacement } from "./AgentService"
import { actorSnapshotLifecycle, type ActorSubtreeSnapshot } from "./actorSnapshot"

/**
 * Stable card fields and the saved session birth time used for placement.
 * Per-token details stay out of this projection.
 */
export type SubAgentCard = ChildProgress & {
  placement?: SessionPlacement | null
  createdAt?: string
}

const samePlacement = (
  left: SessionPlacement | null | undefined,
  right: SessionPlacement | null | undefined,
): boolean => left === right || (
  !!left && !!right && left.kind === right.kind && left.host === right.host
)

/** True when reusing `previous` would render the identical card. */
const sameCard = (previous: SubAgentCard, next: SubAgentCard): boolean =>
  previous.title === next.title &&
  previous.status === next.status &&
  previous.createdAt === next.createdAt &&
  samePlacement(previous.placement, next.placement)

/**
 * Legacy parent events have no activation identity: they invalidate, never
 * override, a read. Field-identical entries keep their previous identity so a
 * poll that learned nothing new cannot re-render every card and re-measure the
 * message list.
 */
export function mergeSubAgentView(parentId: string | null, chats: readonly ChatItem[],
  live: Record<string, ChildProgress>, snapshot: ActorSubtreeSnapshot | null,
  confirmed: boolean, previousIds: readonly string[] = [],
  previous?: Record<string, SubAgentCard>): Record<string, SubAgentCard> {
  if (!parentId) return {}
  const sessions = chats.filter((chat) => chat.parentSessionId === parentId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const nodes = snapshot?.nodes.filter((node) => node.parent_actor_id === parentId && node.role === "child") ?? []
  const sessionById = new Map(sessions.map((chat) => [chat.id, chat]))
  const nodeById = new Map(nodes.map((node) => [node.actor_id, node]))
  const ids = new Set([...sessions.map((chat) => chat.id), ...Object.keys(live).sort(), ...nodes.map((node) => node.actor_id).sort()])
  const order = [...previousIds.filter((id) => ids.has(id)), ...[...ids].filter((id) => !previousIds.includes(id))]
  const next: Record<string, SubAgentCard> = {}
  let reusedAll = previous !== undefined && Object.keys(previous).length === order.length
  for (const id of order) {
    const chat = sessionById.get(id), node = nodeById.get(id)
    const lifecycle = confirmed && node ? actorSnapshotLifecycle(node) : "unknown"
    const projected: SubAgentCard = {
      title: node?.title || chat?.title || live[id]?.title || chat?.subagentType || undefined,
      status: lifecycle === "cold" ? "idle" : lifecycle === "active" ? "unknown" : lifecycle,
      createdAt: chat?.createdAtExact,
      // Unversioned preview/error text can belong to an earlier resident run.
      placement: chat?.placement,
    }
    const prior = previous?.[id]
    const stable = prior !== undefined && sameCard(prior, projected)
    if (!stable) reusedAll = false
    next[id] = stable ? prior : projected
  }
  // One identity for the whole view: downstream memos and the card list key off
  // it, so an unchanged poll must not allocate a fresh record.
  return reusedAll && previous ? previous : next
}
