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
  const state = useActorSnapshot(rootId, active, selectedActorId, descendantCountHint)
  const previousTree = useRef<ActorTreeData | undefined>(undefined)
  const tree = useMemo(() => state.snapshot ? actorSnapshotTree(state.snapshot, state.loading, previousTree.current) : {
    rootActorId: rootId ?? "", byId: Object.create(null), childrenById: Object.create(null), needsSnapshot: state.loading,
  }, [state.snapshot, state.loading, rootId])
  useEffect(() => { previousTree.current = tree }, [tree])
  return (
    <section className="rounded-lg border" data-actor-snapshot-panel aria-busy={state.loading}>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span>已保存的代理状态 · 健康与队列信息尚未提供</span>
        {rootId ? <Button size="sm" variant="ghost" disabled={state.loading} onClick={() => { void state.refresh() }} aria-label="刷新代理结构"><RefreshCw /></Button> : null}
      </div>
      {state.gapReason ? <p role="status" data-actor-gap={state.gapReason} className="px-3 pb-2 text-xs text-muted-foreground">
        {state.gapReason === "snapshot_regression"
          ? "代理结构返回了较旧版本；已保留上次确认的状态，请重新读取。"
          : "代理事件出现间隙；已重新读取状态，但事件连续性仍无法确认。"}
      </p> : null}
      {rootId ? <ActorTree topology={tree} selectedActorId={selectedActorId} onSelectActor={onSelectActor}
        error={state.error} onRetry={() => { void state.refresh() }} />
        : <p className="px-3 py-4 text-sm text-muted-foreground">选择 Root 会话后读取代理结构。</p>}
    </section>
  )
}
