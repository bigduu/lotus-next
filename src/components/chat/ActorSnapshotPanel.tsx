import { useMemo } from "react"
import { RefreshCw } from "lucide-react"
import { Button } from "@/components/ui/button"
import { useActorSnapshot } from "@/hooks/useActorSnapshot"
import { actorSnapshotTree } from "@/services/chat/actorSnapshot"
import { ActorTree } from "./ActorTree"

export function ActorSnapshotPanel({ rootId, active, selectedActorId, onSelectActor }: {
  rootId: string | null
  active: boolean
  selectedActorId: string | null
  onSelectActor: (actorId: string) => void
}) {
  const state = useActorSnapshot(rootId, active)
  const tree = useMemo(() => state.snapshot ? actorSnapshotTree(state.snapshot, state.loading) : {
    rootActorId: rootId ?? "", byId: Object.create(null), childrenById: Object.create(null), needsSnapshot: state.loading,
  }, [state.snapshot, state.loading, rootId])
  return (
    <section className="rounded-lg border" data-actor-snapshot-panel aria-busy={state.loading}>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-xs text-muted-foreground">
        <span>已保存的代理状态 · 健康与队列信息尚未提供</span>
        {rootId ? <Button size="sm" variant="ghost" disabled={state.loading} onClick={() => { void state.refresh() }} aria-label="刷新代理结构"><RefreshCw /></Button> : null}
      </div>
      {rootId ? <ActorTree topology={tree} selectedActorId={selectedActorId} onSelectActor={onSelectActor}
        error={state.error} onRetry={() => { void state.refresh() }} />
        : <p className="px-3 py-4 text-sm text-muted-foreground">选择 Root 会话后读取代理结构。</p>}
    </section>
  )
}
