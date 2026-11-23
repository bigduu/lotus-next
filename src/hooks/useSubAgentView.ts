import { useEffect, useMemo, useRef } from "react"
import { uiText } from "@shared/i18n/ui"
import type { ChatItem } from "@shared/types/chatMessages"
import type { ChildProgress } from "@shared/store/appStore/slices/executionStateSlice/types"
import { useRenderProbe, renderProbe } from "@/lib/renderProbe"
import { mergeSubAgentView, type SubAgentCard } from "@services/chat/actorInlineStatus"
import { useActorSnapshot } from "./useActorSnapshot"

export { mergeSubAgentView, type SubAgentCard } from "@services/chat/actorInlineStatus"

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
  const previous = useRef<{ parentId: string | null; ids: string[]; agents?: Record<string, SubAgentCard> }>({ parentId: null, ids: [] })
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
