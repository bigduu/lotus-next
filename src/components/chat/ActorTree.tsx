import { useCallback, useEffect, useId, useMemo, useRef, useState, type KeyboardEvent } from "react"
import { defaultRangeExtractor, observeElementRect, useVirtualizer, type Range, type Rect, type Virtualizer } from "@tanstack/react-virtual"
import { ChevronDown, ChevronRight, RefreshCw } from "lucide-react"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import type { ActorLifecycle, ActorTopologyNode, ActorTopologyState } from "@/services/chat/actorTopology"

const ROW_HEIGHT = 64
const INITIAL_RECT = { width: 320, height: 320 }

const LIFECYCLE_LABEL: Record<ActorLifecycle, string> = {
  cold: "未启动",
  queued: "排队中",
  running: "运行中",
  suspended: "已暂停",
  completed: "已完成",
  failed: "失败",
  cancelled: "已取消",
  retired: "已退出",
  lost: "已失联",
}

const PLACEMENT_LABEL: Record<ActorTopologyNode["placement"], string> = {
  local: "本机",
  remote: "远端",
  container: "容器",
  scheduled: "待调度",
  unknown: "位置未知",
}

const HEALTH_LABEL: Record<ActorTopologyNode["health"], string> = {
  healthy: "正常",
  waiting: "等待中",
  stalled: "停滞",
  failed: "异常",
  orphaned: "孤立",
  blocked_needs_input: "等待输入",
  lost: "失联",
  unknown: "状态未知",
}

interface VisibleActorRow {
  node: ActorTopologyNode
  parentActorId: string | null
  position: number
  siblingCount: number
  hasChildren: boolean
}

/** Flatten only authorized, expanded nodes. The virtualizer mounts a bounded subset. */
function visibleActorRows(
  topology: ActorTopologyState,
  expandedActorIds: ReadonlySet<string>,
): VisibleActorRow[] {
  const root = topology.byId[topology.rootActorId]
  if (!root) return []

  const result: VisibleActorRow[] = []
  const visited = new Set<string>()
  const stack: Array<{ actorId: string; parentActorId: string | null; position: number; siblingCount: number }> = [
    { actorId: topology.rootActorId, parentActorId: null, position: 1, siblingCount: 1 },
  ]
  while (stack.length > 0) {
    const next = stack.pop()!
    if (visited.has(next.actorId)) continue
    const node = topology.byId[next.actorId]
    if (!node) continue
    visited.add(next.actorId)
    const childIds = topology.childrenById[next.actorId] ?? []
    result.push({
      node,
      parentActorId: next.parentActorId,
      position: next.position,
      siblingCount: next.siblingCount,
      hasChildren: childIds.length > 0,
    })
    if (!expandedActorIds.has(next.actorId)) continue
    for (let index = childIds.length - 1; index >= 0; index -= 1) {
      stack.push({
        actorId: childIds[index],
        parentActorId: next.actorId,
        position: index + 1,
        siblingCount: childIds.length,
      })
    }
  }
  return result
}

type TreeVirtualizer = Virtualizer<HTMLDivElement, HTMLDivElement>

function observeTreeRect(instance: TreeVirtualizer, callback: (rect: Rect) => void) {
  return observeElementRect(instance, (rect) => callback({
    width: rect.width || INITIAL_RECT.width,
    height: rect.height || INITIAL_RECT.height,
  }))
}

export interface ActorTreeProps {
  topology: ActorTopologyState
  selectedActorId: string | null
  onSelectActor: (actorId: string) => void
  unreadActorIds?: ReadonlySet<string>
  error?: string | null
  onRetry?: () => void
  className?: string
}

/** Public topology only. Selecting a row is the caller's explicit content boundary. */
export function ActorTree({
  topology,
  selectedActorId,
  onSelectActor,
  unreadActorIds,
  error,
  onRetry,
  className,
}: ActorTreeProps) {
  const treeId = useId()
  const scrollRef = useRef<HTMLDivElement | null>(null)
  const [expandedActorIds, setExpandedActorIds] = useState<ReadonlySet<string>>(
    () => new Set([topology.rootActorId]),
  )
  const [activeActorId, setActiveActorId] = useState<string | null>(
    selectedActorId ?? topology.rootActorId,
  )
  const selectedActorIdRef = useRef(selectedActorId)
  selectedActorIdRef.current = selectedActorId
  const previousSelectedActorId = useRef(selectedActorId)
  const rows = useMemo(
    () => visibleActorRows(topology, expandedActorIds),
    [topology, expandedActorIds],
  )
  const rowsRef = useRef(rows)
  rowsRef.current = rows
  const getItemKey = useCallback((index: number) => rowsRef.current[index]?.node.actorId ?? index, [])
  const activeIndex = rows.findIndex((row) => row.node.actorId === activeActorId)
  const visibleActiveIndex = activeIndex < 0 ? 0 : activeIndex
  const rangeExtractor = useCallback((range: Range) => {
    const window = defaultRangeExtractor(range)
    if (rows.length === 0 || window.includes(visibleActiveIndex)) return window
    // Keep the active descendant mounted even when a user scrolls away from it.
    return [...window, visibleActiveIndex].sort((left, right) => left - right)
  }, [rows.length, visibleActiveIndex])
  const virtualizer = useVirtualizer<HTMLDivElement, HTMLDivElement>({
    count: rows.length,
    getScrollElement: () => scrollRef.current,
    getItemKey,
    estimateSize: () => ROW_HEIGHT,
    overscan: 4,
    initialRect: INITIAL_RECT,
    observeElementRect: observeTreeRect,
    rangeExtractor,
  })
  const virtualRows = virtualizer.getVirtualItems()

  useEffect(() => {
    setExpandedActorIds(new Set([topology.rootActorId]))
    setActiveActorId(selectedActorIdRef.current ?? topology.rootActorId)
  }, [topology.rootActorId])

  useEffect(() => {
    if (previousSelectedActorId.current === selectedActorId) return
    if (!selectedActorId) {
      previousSelectedActorId.current = null
      return
    }
    const selected = topology.byId[selectedActorId]
    if (!selected) return
    previousSelectedActorId.current = selectedActorId
    setActiveActorId(selectedActorId)
    setExpandedActorIds((current) => {
      const next = new Set(current)
      let parentActorId = selected.parentActorId
      while (parentActorId) {
        next.add(parentActorId)
        parentActorId = topology.byId[parentActorId]?.parentActorId ?? null
      }
      return next.size === current.size ? current : next
    })
  }, [selectedActorId, topology.byId]) // Refreshing the same selection preserves keyboard focus.

  const toggle = useCallback((actorId: string) => {
    setExpandedActorIds((previous) => {
      const next = new Set(previous)
      if (next.has(actorId)) next.delete(actorId)
      else next.add(actorId)
      return next
    })
  }, [])

  const activateIndex = (index: number) => {
    const row = rows[index]
    if (!row) return
    setActiveActorId(row.node.actorId)
    virtualizer.scrollToIndex(index, { align: "auto" })
  }

  const onTreeKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    if (rows.length === 0) return
    const row = rows[visibleActiveIndex]
    if (!row) return
    switch (event.key) {
      case "ArrowDown": activateIndex(Math.min(rows.length - 1, visibleActiveIndex + 1)); break
      case "ArrowUp": activateIndex(Math.max(0, visibleActiveIndex - 1)); break
      case "Home": activateIndex(0); break
      case "End": activateIndex(rows.length - 1); break
      case "ArrowRight":
        if (row.hasChildren && !expandedActorIds.has(row.node.actorId)) toggle(row.node.actorId)
        else if (row.hasChildren) activateIndex(visibleActiveIndex + 1)
        break
      case "ArrowLeft":
        if (row.hasChildren && expandedActorIds.has(row.node.actorId)) toggle(row.node.actorId)
        else if (row.parentActorId) {
          activateIndex(rows.findIndex((candidate) => candidate.node.actorId === row.parentActorId))
        }
        break
      case "Enter":
      case " ": onSelectActor(row.node.actorId); break
      default: return
    }
    event.preventDefault()
  }

  return (
    <div className={cn("flex min-h-0 min-w-0 flex-col", className)} data-actor-tree>
      <div className="flex items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
        <span>代理结构</span>
        {topology.needsSnapshot ? <span role="status" className="text-xs font-normal text-muted-foreground">正在同步…</span> : null}
      </div>
      {error ? (
        <div role="alert" className="flex items-center gap-2 px-3 py-2 text-xs text-destructive">
          <span className="min-w-0 flex-1 break-words">{error}</span>
          {onRetry ? <Button size="sm" variant="outline" onClick={onRetry}><RefreshCw />重试</Button> : null}
        </div>
      ) : null}
      {rows.length === 0 ? (
        <p className="px-3 py-4 text-sm text-muted-foreground">
          {topology.needsSnapshot ? "正在载入代理结构…" : "没有可显示的代理。"}
        </p>
      ) : (
        <div
          ref={scrollRef}
          role="tree"
          aria-label="代理会话结构"
          aria-activedescendant={`${treeId}-actor-${visibleActiveIndex}`}
          tabIndex={0}
          onKeyDown={onTreeKeyDown}
          className="min-h-0 max-h-80 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-actor-tree-scroll
        >
          <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }} data-actor-tree-virtual>
            {virtualRows.map((virtualRow) => {
              const row = rows[virtualRow.index]
              if (!row) return null
              const { node } = row
              const expanded = expandedActorIds.has(node.actorId)
              const selected = selectedActorId === node.actorId
              const unread = unreadActorIds?.has(node.actorId) ?? false
              const counts = [
                node.queuedCount > 0 ? `排队 ${node.queuedCount}` : null,
                node.waitingForCount > 0 ? `等待 ${node.waitingForCount}` : null,
                node.pendingRequestCount > 0 ? `请求 ${node.pendingRequestCount}` : null,
              ].filter((count): count is string => count !== null)
              return (
                <div
                  key={virtualRow.key}
                  id={`${treeId}-actor-${virtualRow.index}`}
                  role="treeitem"
                  tabIndex={-1}
                  aria-level={node.depth + 1}
                  aria-posinset={row.position}
                  aria-setsize={row.siblingCount}
                  aria-expanded={row.hasChildren ? expanded : undefined}
                  aria-selected={selected}
                  aria-label={`${node.title || "未命名代理"}，${node.role || "代理"}，${LIFECYCLE_LABEL[node.lifecycle]}，${PLACEMENT_LABEL[node.placement]}，${HEALTH_LABEL[node.health]}${counts.length ? `，${counts.join("，")}` : ""}${unread ? "，有未读消息" : ""}`}
                  data-actor-id={node.actorId}
                  className={cn(
                    "absolute left-0 top-0 flex h-16 w-full cursor-pointer items-center gap-2 overflow-hidden border-b px-2 text-left text-sm hover:bg-accent/50",
                    selected && "bg-muted/30",
                    !selected && visibleActiveIndex === virtualRow.index && "bg-primary/5",
                  )}
                  style={{ transform: `translateY(${virtualRow.start}px)`, paddingLeft: Math.min(node.depth, 8) * 16 + 8 }}
                  onClick={(event) => {
                    if ((event.target as HTMLElement).closest("[data-actor-toggle]")) toggle(node.actorId)
                    else onSelectActor(node.actorId)
                    setActiveActorId(node.actorId)
                    scrollRef.current?.focus()
                  }}
                >
                  <span data-actor-toggle aria-hidden="true" className="flex size-5 shrink-0 items-center justify-center">
                    {row.hasChildren ? expanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" /> : null}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex min-w-0 items-center gap-1">
                      <span className="truncate font-medium">{node.title || "未命名代理"}</span>
                      {unread ? <span className="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" /> : null}
                    </span>
                    <span className="block truncate text-xs text-muted-foreground">
                      {node.role || "代理"} · {LIFECYCLE_LABEL[node.lifecycle]} · {PLACEMENT_LABEL[node.placement]} · {HEALTH_LABEL[node.health]}
                      {counts.length ? ` · ${counts.join(" · ")}` : ""}
                    </span>
                  </span>
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}
