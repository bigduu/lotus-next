import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"

import { renderProbe } from "@/lib/renderProbe"
import { mergeSubAgentView, type SubAgentCard } from "@services/chat/actorInlineStatus"
import { collectSubAgentOrigins, indexSubAgentOrigins, placeSubAgents } from "@services/chat/subAgentGroups"
import { selectChildren } from "@shared/store/appStore/selectors/executionSelectors"
import { appStore } from "@shared/store/appStore/state"
import type { ChatItem, Message } from "@shared/types/chatMessages"

import { createUiText } from "../../shell/uiText"
import { createStoreSelector } from "../../state/createStoreSelector"
import { createActorSnapshot } from "../../workbench/subagents/createActorSnapshot"
import type { RenderItem } from "../history/historyProjection"

function subAgentToolGroups(items: readonly RenderItem[]) {
  return items.flatMap((item) => {
    if (item.kind !== "process") return []
    const messages = item.parts.flatMap((part) => part.kind === "tools" ? part.items : [])
    return messages.length ? [{ key: item.key, messages }] : []
  })
}

export function createInlineActorStatus(options: {
  session: Accessor<ChatItem | null | undefined>
  chats: Accessor<readonly ChatItem[]>
  active: Accessor<boolean>
  history: Accessor<readonly RenderItem[]>
  live: Accessor<readonly RenderItem[]>
  messages: Accessor<readonly Message[]>
}) {
  const text = createUiText()
  const parentId = createMemo(() => options.session()?.id ?? null)
  const rootId = createMemo(() => options.session()?.rootSessionId || parentId())
  const count = createMemo(() => options.session()?.subagentCount ?? null)
  const live = createStoreSelector(appStore, (store) => selectChildren(parentId())(store))
  const active = createMemo(() => {
    const id = parentId()
    return Boolean(options.active() && id && (count() || Object.keys(live()).length ||
      options.chats().some((chat) => chat.parentSessionId === id)))
  })
  // The transcript needs public topology only. Child content is authorized by
  // the Workbench when the user explicitly opens that conversation.
  const { state, refresh } = createActorSnapshot(rootId, active, () => null, count)
  const lifecycleHint = createMemo(() => JSON.stringify(Object.entries(live())
    .map(([id, child]) => [id, child.status]).sort(([left], [right]) => (left ?? "").localeCompare(right ?? ""))))
  let previousHint: { parentId: string | null; value: string } | undefined
  createEffect(() => ({ parentId: parentId(), value: lifecycleHint() }), (hint) => {
    const previous = previousHint
    previousHint = hint
    if (active() && previous?.parentId === hint.parentId && previous.value !== hint.value) void refresh()
  })

  const view = createMemo<{ parentId: string | null; rootId: string | null; ids: string[]; agents: Record<string, SubAgentCard> }>((previous) => {
    const parent = parentId()
    const root = rootId()
    const { snapshot, error, gapReason } = state()
    const sameOwner = previous?.parentId === parent && previous.rootId === root
    const confirmed = Boolean(active() && snapshot?.root_actor_id === root && !error && !gapReason)
    const agents = mergeSubAgentView(parent, options.chats(), live(), snapshot, confirmed,
      sameOwner ? previous.ids : [], sameOwner ? previous.agents : undefined)
    return sameOwner && previous.agents === agents ? previous : { parentId: parent, rootId: root, ids: Object.keys(agents), agents }
  })
  const historyOrigins = createMemo(() => indexSubAgentOrigins(subAgentToolGroups(options.history())))
  const origins = createMemo(() => collectSubAgentOrigins(subAgentToolGroups(options.live()), historyOrigins()))
  const firstMessageAt = createMemo(() => options.messages().find((message) => message.role !== "system")?.createdAt ?? null)
  const groups = createMemo(() => {
    renderProbe.count("subagent.place")
    return placeSubAgents(origins(), view().agents, firstMessageAt())
  })
  const [expanded, setExpanded] = createSignal<ReadonlySet<string>>(new Set())
  const toggle = (id: string) => setExpanded((prior) => {
    const next = new Set(prior)
    if (!next.delete(id)) next.add(id)
    return next
  })
  const error = createMemo(() => state().error || (state().gapReason
    ? text("agent_structure_cannot_be_confirmed_right_now_reload_st_2ba610a7") : null))
  return { groups, expanded, toggle, error, refresh }
}
