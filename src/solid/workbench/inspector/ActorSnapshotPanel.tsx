import { createEffect, createMemo, Show } from "solid-js"
import { RefreshCw } from "@lucide/solid"
import { actorSnapshotTree } from "@services/chat/actorSnapshot"
import type { ActorTreeData } from "@services/chat/actorTreeView"

import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { ActorSnapshotNotice } from "../subagents/ActorSnapshotNotice"
import { ActorTree } from "../subagents/ActorTree"
import { createActorSnapshot } from "../subagents/createActorSnapshot"

export function ActorSnapshotPanel(props: {
  rootId: string | null
  active: boolean
  selectedActorId: string | null
  descendantCountHint: number | null
  onSelectActor: (actorId: string) => void
}) {
  const text = createUiText()
  const rootId = createMemo(() => props.rootId)
  const active = createMemo(() => props.active)
  const { state, refresh } = createActorSnapshot(rootId, active,
    () => props.selectedActorId, () => props.descendantCountHint)
  let previousTree: ActorTreeData | undefined
  const tree = createMemo(() => {
    const { snapshot, loading } = state()
    return snapshot ? actorSnapshotTree(snapshot, loading, previousTree) : {
      rootActorId: rootId() ?? "", byId: Object.create(null), childrenById: Object.create(null), needsSnapshot: loading,
    }
  })
  createEffect(tree, (next) => { previousTree = next })
  return (
    <section class="rounded-lg border" data-actor-snapshot-panel aria-busy={state().loading ? "true" : "false"}>
      <div class="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span>{text("actor_saved_state")}</span>
        <div class="flex shrink-0 items-center gap-1">
          <Show when={rootId()}>
            <ActorSnapshotNotice reason={state().gapReason} actorId={state().gapActorId}
              error={state().snapshot ? state().error : null}
              onRetry={state().retryable ? () => void refresh() : undefined} />
          </Show>
          <Show when={rootId() && (state().snapshot || !state().error)}>
            <Button size="sm" variant="ghost" disabled={state().loading || !active()}
              onClick={() => void refresh()} aria-label={text("refresh_agent_structure_277bb85d")}><RefreshCw /></Button>
          </Show>
        </div>
      </div>
      <Show when={rootId()} keyed fallback={<p class="px-3 py-4 text-sm text-muted-foreground">{text("select_a_root_session_to_load_agent_structure_abe1ec98")}</p>}>
        {(_root) => <ActorTree topology={tree()} selectedActorId={props.selectedActorId} onSelectActor={props.onSelectActor}
          error={state().snapshot ? null : state().error} onRetry={() => void refresh()} retryable={state().retryable} />}
      </Show>
    </section>
  )
}
