import { useEffect, useMemo, useRef } from "react"
import { uiText } from "@shared/i18n/ui"
import type { ChatItem } from "@shared/types/chatMessages"
import type { SessionPlacement } from "@services/chat/AgentService"
import type { ChildProgress } from "@shared/store/appStore/slices/executionStateSlice/types"
import { actorSnapshotLifecycle, type ActorSubtreeSnapshot } from "@services/chat/actorSnapshot"
import { useRenderProbe, renderProbe } from "@/lib/renderProbe"
import { useActorSnapshot } from "./useActorSnapshot"

/**
 * Exactly what a collapsed card renders. A view that carried `outputPreview`
 * or `roundCount` would change on every child token while showing nothing new,
 * so the projection stays this narrow on purpose.
 */
type CardState = Pick<ChildProgress, "title" | "status"> & {
  placement?: SessionPlacement | null
}

const samePlacement = (
  left: SessionPlacement | null | undefined,
  right: SessionPlacement | null | undefined,
): boolean => left === right || (
  !!left && !!right && left.kind === right.kind && left.host === right.host
)

/** True when reusing `previous` would render the identical card. */
const sameCard = (previous: ChildProgress, next: CardState): boolean =>
  previous.title === next.title &&
  previous.status === next.status &&
  samePlacement((previous as CardState).placement, next.placement)

/**
 * Legacy parent events have no activation identity: they invalidate, never
 * override, a read. Field-identical entries keep their previous identity so a
 * poll that learned nothing new cannot re-render every card and re-measure the
 * message list.
 */
export function mergeSubAgentView(parentId: string | null, chats: readonly ChatItem[],
  live: Record<string, ChildProgress>, snapshot: ActorSubtreeSnapshot | null,
  confirmed: boolean, previousIds: readonly string[] = [],
  previous?: Record<string, ChildProgress>): Record<string, ChildProgress> {
  if (!parentId) return {}
  const sessions = chats.filter((chat) => chat.parentSessionId === parentId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const nodes = snapshot?.nodes.filter((node) => node.parent_actor_id === parentId && node.role === "child") ?? []
  const sessionById = new Map(sessions.map((chat) => [chat.id, chat]))
  const nodeById = new Map(nodes.map((node) => [node.actor_id, node]))
  const ids = new Set([...sessions.map((chat) => chat.id), ...Object.keys(live).sort(), ...nodes.map((node) => node.actor_id).sort()])
  const order = [...previousIds.filter((id) => ids.has(id)), ...[...ids].filter((id) => !previousIds.includes(id))]
  const next: Record<string, ChildProgress> = {}
  let reusedAll = previous !== undefined && Object.keys(previous).length === order.length
  for (const id of order) {
    const chat = sessionById.get(id), node = nodeById.get(id)
    const lifecycle = confirmed && node ? actorSnapshotLifecycle(node) : "unknown"
    const projected: CardState = {
      title: node?.title || chat?.title || live[id]?.title || chat?.subagentType || undefined,
      status: lifecycle === "cold" ? "idle" : lifecycle === "active" ? "unknown" : lifecycle,
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

export function useSubAgentView(current: ChatItem | null | undefined, chats: readonly ChatItem[],
  live: Record<string, ChildProgress>, active: boolean) {
  useRenderProbe("hook.useSubAgentView")
  const parentId = current?.id ?? null
  const rootId = current?.rootSessionId || parentId
  const hasChildren = !!current?.subagentCount || Object.keys(live).length > 0 || chats.some((chat) => chat.parentSessionId === parentId)
  const state = useActorSnapshot(rootId, active && hasChildren, null, current?.subagentCount ?? null)
  const { refresh } = state
  const lifecycleHint = JSON.stringify(Object.entries(live).map(([id, child]) => [id, child.status]).sort(([a], [b]) => (a ?? "").localeCompare(b ?? "")))
  const priorHint = useRef({ parentId, lifecycleHint })
  useEffect(() => {
    const previous = priorHint.current
    priorHint.current = { parentId, lifecycleHint }
    if (active && hasChildren && previous.parentId === parentId && previous.lifecycleHint !== lifecycleHint) void refresh()
  }, [parentId, lifecycleHint, active, hasChildren, refresh])
  const confirmed = !!state.snapshot && state.snapshot.root_actor_id === rootId && !state.error && !state.gapReason
  const previous = useRef<{ parentId: string | null; ids: string[]; agents?: Record<string, ChildProgress> }>({ parentId: null, ids: [] })
  const agents = useMemo(() => {
    renderProbe.count("subagent.view.merge")
    const prior = previous.current
    const merged = mergeSubAgentView(parentId, chats, live, state.snapshot, confirmed,
      prior.parentId === parentId ? prior.ids : [],
      prior.parentId === parentId ? prior.agents : undefined)
    if (prior.agents !== undefined && prior.agents === merged) renderProbe.count("subagent.view.reuse")
    return merged
  }, [parentId, chats, live, state.snapshot, confirmed])
  useEffect(() => { previous.current = { parentId, ids: Object.keys(agents), agents } }, [parentId, agents])
  return { agents, refresh, error: state.error || (state.gapReason
    ? uiText("agent_structure_cannot_be_confirmed_right_now_reload_st_2ba610a7") : null) }
}
