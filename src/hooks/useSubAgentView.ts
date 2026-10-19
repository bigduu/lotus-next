import { useEffect, useMemo, useRef } from "react"
import { uiText } from "@shared/i18n/ui"
import type { ChatItem } from "@shared/types/chatMessages"
import type { ChildProgress } from "@shared/store/appStore/slices/executionStateSlice/types"
import { actorSnapshotLifecycle, type ActorSubtreeSnapshot } from "@services/chat/actorSnapshot"
import { useActorSnapshot } from "./useActorSnapshot"

/** Legacy parent events have no activation identity: they invalidate, never override, a read. */
export function mergeSubAgentView(parentId: string | null, chats: readonly ChatItem[],
  live: Record<string, ChildProgress>, snapshot: ActorSubtreeSnapshot | null,
  confirmed: boolean, previousIds: readonly string[] = []): Record<string, ChildProgress> {
  if (!parentId) return {}
  const sessions = chats.filter((chat) => chat.parentSessionId === parentId)
    .sort((a, b) => a.createdAt - b.createdAt || a.id.localeCompare(b.id))
  const nodes = snapshot?.nodes.filter((node) => node.parent_actor_id === parentId && node.role === "child") ?? []
  const sessionById = new Map(sessions.map((chat) => [chat.id, chat]))
  const nodeById = new Map(nodes.map((node) => [node.actor_id, node]))
  const ids = new Set([...sessions.map((chat) => chat.id), ...Object.keys(live).sort(), ...nodes.map((node) => node.actor_id).sort()])
  const order = [...previousIds.filter((id) => ids.has(id)), ...[...ids].filter((id) => !previousIds.includes(id))]
  return Object.fromEntries(order.map((id) => {
    const chat = sessionById.get(id), node = nodeById.get(id)
    const lifecycle = confirmed && node ? actorSnapshotLifecycle(node) : "unknown"
    return [id, {
      title: node?.title || chat?.title || live[id]?.title || chat?.subagentType || undefined,
      status: lifecycle === "cold" ? "idle" : lifecycle === "active" ? "unknown" : lifecycle,
      // Unversioned preview/error text can belong to an earlier resident run.
      placement: chat?.placement,
    }]
  }))
}

export function useSubAgentView(current: ChatItem | null | undefined, chats: readonly ChatItem[],
  live: Record<string, ChildProgress>, active: boolean) {
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
  const previous = useRef<{ parentId: string | null; ids: string[] }>({ parentId: null, ids: [] })
  const agents = useMemo(() => mergeSubAgentView(parentId, chats, live, state.snapshot, confirmed,
    previous.current.parentId === parentId ? previous.current.ids : []), [parentId, chats, live, state.snapshot, confirmed])
  useEffect(() => { previous.current = { parentId, ids: Object.keys(agents) } }, [parentId, agents])
  return { agents, refresh, error: state.error || (state.gapReason
    ? uiText("agent_structure_cannot_be_confirmed_right_now_reload_st_2ba610a7") : null) }
}
