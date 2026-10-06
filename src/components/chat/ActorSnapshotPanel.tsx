import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useMemo, useRef } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useActorSnapshot } from "@/hooks/useActorSnapshot"
import { actorSnapshotTree } from "@/services/chat/actorSnapshot"
import type { ActorTreeData } from "@/services/chat/actorTreeView"
import { ActorTree } from "./ActorTree"

export function ActorSnapshotPanel({ rootId, active, selectedActorId, descendantCountHint = null, onSelectActor }: {
  rootId: string | null
  active: boolean
  selectedActorId: string | null
  /** Invalidates the view; the authenticated snapshot remains the authority. */
  descendantCountHint?: number | null
  onSelectActor: (actorId: string) => void
}) {
  useUiLocale()
  const state = useActorSnapshot(rootId, active, selectedActorId, descendantCountHint)
  const previousTree = useRef<ActorTreeData | undefined>(undefined)
  const tree = useMemo(() => state.snapshot ? actorSnapshotTree(state.snapshot, state.loading, previousTree.current) : {
    rootActorId: rootId ?? "", byId: Object.create(null), childrenById: Object.create(null), needsSnapshot: state.loading,
  }, [state.snapshot, state.loading, rootId])
  useEffect(() => { previousTree.current = tree }, [tree])
  return (
    <section className="rounded-lg border" data-actor-snapshot-panel aria-busy={state.loading}>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span>{uiText("saved_agent_state_health_and_queue_information_unavaila_f82ce646")}</span>
        {rootId ? <Button size="sm" variant="ghost" disabled={state.loading} onClick={() => { void state.refresh() }} aria-label={uiText("refresh_agent_structure_277bb85d")}><RefreshCw /></Button> : null}
      </div>
      {state.gapReason ? <p role="status" data-actor-gap={state.gapReason} data-actor-gap-origin={state.gapActorId ?? undefined} className="px-3 pb-2 text-xs text-muted-foreground">
        {state.gapReason === "snapshot_regression"
          ? uiText("an_older_agent_structure_was_returned_the_last_confirme_15ec0d29")
          : state.gapActorId
            ? uiText("actor_event_gap_origin", { actorId: state.gapActorId })
            : uiText("there_is_a_gap_in_agent_events_state_was_reloaded_but_e_0c545fcb")}
      </p> : null}
      {rootId ? <ActorTree topology={tree} selectedActorId={selectedActorId} onSelectActor={onSelectActor}
        error={state.error} onRetry={() => { void state.refresh() }} />
        : <p className="px-3 py-4 text-sm text-muted-foreground">{uiText("select_a_root_session_to_load_agent_structure_abe1ec98")}</p>}
    </section>
  )
}
