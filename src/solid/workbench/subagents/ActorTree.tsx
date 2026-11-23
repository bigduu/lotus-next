import { createEffect, createMemo, createSignal, createUniqueId, For, Show, untrack, type Accessor } from "solid-js"
import { Dynamic, type JSX } from "@solidjs/web"
import { defaultRangeExtractor, observeElementRect, type Rect, type VirtualItem, type Virtualizer } from "@tanstack/virtual-core"
import {
  ChevronDown, ChevronRight, CircleAlert, CircleCheck, CircleDot, CircleMinus, CircleOff,
  CirclePause, CircleSlash, CircleX, Clock3, LoaderCircle, RefreshCw, type LucideIcon,
} from "@lucide/solid"

import { cn } from "@/lib/utils"
import type { ActorHealth } from "@services/chat/actorTopology"
import type { ActorTreeData, ActorTreeNode } from "@services/chat/actorTreeView"

import { createElementVirtualizer } from "../../history/createElementVirtualizer"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"

import { actorLifecycleLabel, actorTitle } from "./actorLabels"

const ROW_HEIGHT = 64
const INITIAL_RECT = { width: 320, height: 320 }

type Text = ReturnType<typeof createUiText>
type Key = Parameters<Text>[0]

const placementKeys: Record<ActorTreeNode["placement"], Key | null> = {
  docker: "container_6d23f04b",
  ssh: null,
  schedulable: "pending_scheduling_d8eb0fb8",
  local: "local_8a94c4a1",
  remote: "remote_edca84b9",
  container: "container_6d23f04b",
  scheduled: "pending_scheduling_d8eb0fb8",
  unknown: "actor_placement_not_reported",
}

const healthKeys: Record<ActorHealth, Key> = {
  healthy: "healthy_296de0e3",
  waiting: "waiting_26c8cfcb",
  stalled: "stalled_97daa1e1",
  failed: "unhealthy_428fb8bf",
  orphaned: "orphaned_a1d6c892",
  blocked_needs_input: "waiting_for_input_6569c6e6",
  lost: "disconnected_481cf3ad",
  unknown: "unknown_state_93e474c6",
}

/** One glanceable per-row status icon family (outlined circles), keyed by lifecycle. */
const LIFECYCLE_ICON: Record<ActorTreeNode["lifecycle"], { Icon: LucideIcon; cls: string; spin?: boolean }> = {
  active: { Icon: CircleDot, cls: "text-primary" },
  unknown: { Icon: CircleSlash, cls: "text-muted-foreground" },
  unconfirmed: { Icon: CircleSlash, cls: "text-muted-foreground" },
  cold: { Icon: CircleOff, cls: "text-muted-foreground" },
  queued: { Icon: Clock3, cls: "text-amber-500" },
  running: { Icon: LoaderCircle, cls: "text-primary", spin: true },
  suspended: { Icon: CirclePause, cls: "text-muted-foreground" },
  completed: { Icon: CircleCheck, cls: "text-emerald-500" },
  failed: { Icon: CircleX, cls: "text-destructive" },
  cancelled: { Icon: CircleMinus, cls: "text-muted-foreground" },
  retired: { Icon: CircleMinus, cls: "text-muted-foreground" },
  lost: { Icon: CircleAlert, cls: "text-destructive" },
}

/** Only an idle parent inherits a busy subtree; its own terminal outcome wins. */
const INHERITS_RUNNING: ReadonlySet<ActorTreeNode["lifecycle"]> = new Set(["active", "cold", "unknown"])

/**
 * A running descendant means its ancestors are orchestrating, not idle. Compute
 * the set of actors whose subtree contains a running node, so an idle parent
 * row can show the running indicator while keeping its own lifecycle text.
 */
function actorsWithRunningDescendant(topology: ActorTreeData): ReadonlySet<string> {
  const withRunningDescendant = new Set<string>()
  const hasRunningDescendant = (actorId: string, visited: Set<string>): boolean => {
    if (visited.has(actorId)) return false
    visited.add(actorId)
    let descendantRunning = false
    for (const childId of topology.childrenById[actorId] ?? []) {
      const child = topology.byId[childId]
      if (child && hasRunningDescendant(childId, visited)) descendantRunning = true
    }
    if (topology.byId[actorId]?.lifecycle === "running") descendantRunning = true
    if (descendantRunning) withRunningDescendant.add(actorId)
    return descendantRunning
  }
  if (topology.byId[topology.rootActorId]) {
    hasRunningDescendant(topology.rootActorId, new Set())
  }
  return withRunningDescendant
}

function showsRunning(node: ActorTreeNode | undefined, runningSubtrees: ReadonlySet<string>): boolean {
  return !!node && (node.lifecycle === "running"
    || INHERITS_RUNNING.has(node.lifecycle) && runningSubtrees.has(node.actorId))
}

/** Keep existing running siblings ahead of newly running ones, within each parent. */
function prioritizeRunningSiblings(
  topology: ActorTreeData,
  runningSubtrees: ReadonlySet<string>,
  previous?: ActorTreeData,
): ActorTreeData {
  const prior = previous?.rootActorId === topology.rootActorId ? previous : undefined
  const childrenById: Record<string, readonly string[]> = Object.create(null)
  for (const [parentId, childIds] of Object.entries(topology.childrenById)) {
    const remaining = new Set(childIds)
    const stableIds = (prior?.childrenById[parentId] ?? []).filter((id) => remaining.delete(id))
    stableIds.push(...remaining)
    childrenById[parentId] = stableIds.sort((left, right) =>
      Number(showsRunning(topology.byId[right], runningSubtrees))
      - Number(showsRunning(topology.byId[left], runningSubtrees)))
  }
  return { ...topology, childrenById }
}

interface VisibleActorRow {
  node: ActorTreeNode
  parentActorId: string | null
  position: number
  siblingCount: number
  hasChildren: boolean
}

/** Flatten only authorized, expanded nodes. The virtualizer mounts a bounded subset. */
function visibleActorRows(
  topology: ActorTreeData,
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

export type UpdateExpansion = (previous: ReadonlySet<string>) => ReadonlySet<string>

export interface ActorTreeProps {
  topology: ActorTreeData
  selectedActorId: string | null
  onSelectActor: (actorId: string) => void
  revealSelected?: boolean
  expansion?: { ids: ReadonlySet<string>; update: (change: UpdateExpansion) => void }
  unreadActorIds?: ReadonlySet<string>
  error?: string | null
  onRetry?: () => void
  retryable?: boolean
  class?: string
}

/** Public topology is rendered independently of the caller's content authority. */
export function ActorTree(props: ActorTreeProps) {
  const text = createUiText()
  const id = createUniqueId()
  const [viewport, setViewport] = createSignal<HTMLDivElement | null>(null, { ownedWrite: true })
  const [localExpansion, setLocalExpansion] = createSignal<ReadonlySet<string>>(untrack(() => new Set([props.topology.rootActorId])))
  const expandedIds = () => props.expansion?.ids ?? localExpansion()
  const updateExpandedIds = (change: UpdateExpansion) => {
    if (props.expansion) props.expansion.update(change)
    else setLocalExpansion(change)
  }
  const [activeActorId, setActiveActorId] = createSignal<string | null>(untrack(() => props.selectedActorId ?? props.topology.rootActorId))
  let previousSelection: string | null = null
  let previousOrder: ActorTreeData | undefined

  const runningSubtrees = createMemo(() => actorsWithRunningDescendant(props.topology))
  const ordered = createMemo(() => prioritizeRunningSiblings(props.topology, runningSubtrees(), previousOrder))
  createEffect(ordered, (topology) => { previousOrder = topology })

  const rows = createMemo(() => visibleActorRows(ordered(), expandedIds()))
  const activeIndex = createMemo(() => Math.max(0, rows().findIndex((row) => row.node.actorId === activeActorId())))
  const selectedIndex = createMemo(() => rows().findIndex((row) => row.node.actorId === props.selectedActorId))
  const virtualizer = createElementVirtualizer<HTMLDivElement, HTMLDivElement>(() => {
    const entries = rows()
    const index = activeIndex()
    return {
      count: entries.length,
      getScrollElement: viewport,
      getItemKey: (index) => entries[index]?.node.actorId ?? index,
      estimateSize: () => ROW_HEIGHT,
      overscan: 4,
      initialRect: INITIAL_RECT,
      observeElementRect: observeTreeRect,
      rangeExtractor: (range) => {
        const visible = defaultRangeExtractor(range)
        // Keep the active descendant mounted even after the user scrolls away.
        return !entries.length || visible.includes(index) ? visible : [...visible, index].sort((left, right) => left - right)
      },
    }
  })

  const rootActorId = createMemo(() => props.topology.rootActorId)
  createEffect(rootActorId, (rootId) => {
    previousSelection = null
    setLocalExpansion(new Set([rootId]))
    setActiveActorId(props.selectedActorId ?? rootId)
  })
  createEffect(() => {
    const selected = props.selectedActorId
    return { selected, topology: props.topology }
  }, ({ selected, topology }) => {
    if (selected === previousSelection) return
    if (!selected) { previousSelection = null; return }
    const actor = topology.byId[selected]
    if (!actor) return
    previousSelection = selected
    setActiveActorId(selected)
    updateExpandedIds((current) => {
      const next = new Set(current)
      const visited = new Set<string>()
      let parentId = actor.parentActorId
      while (parentId && !visited.has(parentId)) {
        visited.add(parentId)
        next.add(parentId)
        parentId = topology.byId[parentId]?.parentActorId ?? null
      }
      return next.size === current.size ? current : next
    })
  })
  createEffect(() => [props.revealSelected, selectedIndex()] as const, ([reveal, index]) => {
    if (!reveal || index < 0) return
    const frame = requestAnimationFrame(() => virtualizer.instance.scrollToIndex(index, { align: "auto" }))
    return () => cancelAnimationFrame(frame)
  })

  const toggle = (actorId: string) => {
    updateExpandedIds((current) => {
      const next = new Set(current)
      if (next.has(actorId)) next.delete(actorId)
      else next.add(actorId)
      return next
    })
  }
  const activate = (index: number) => {
    const row = rows()[index]
    if (!row) return
    setActiveActorId(row.node.actorId)
    virtualizer.instance.scrollToIndex(index, { align: "auto" })
  }
  const onTreeKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    const entries = rows()
    const index = activeIndex()
    const row = entries[index]
    if (!row) return
    switch (event.key) {
      case "ArrowDown": activate(Math.min(entries.length - 1, index + 1)); break
      case "ArrowUp": activate(Math.max(0, index - 1)); break
      case "Home": activate(0); break
      case "End": activate(entries.length - 1); break
      case "ArrowRight":
        if (row.hasChildren && !expandedIds().has(row.node.actorId)) toggle(row.node.actorId)
        else if (row.hasChildren) activate(index + 1)
        break
      case "ArrowLeft":
        if (row.hasChildren && expandedIds().has(row.node.actorId)) toggle(row.node.actorId)
        else if (row.parentActorId) activate(entries.findIndex((entry) => entry.node.actorId === row.parentActorId))
        break
      case "Enter":
      case " ": props.onSelectActor(row.node.actorId); break
      default: return
    }
    event.preventDefault()
  }

  return (
    <div class={cn("@container flex min-h-0 min-w-0 flex-col", props.class)} data-actor-tree="">
      <div class="flex items-center justify-between gap-2 px-3 py-2 text-sm font-medium">
        <span>{text("agent_structure_4cf93237")}</span>
        <Show when={props.topology.needsSnapshot}>
          <span role="status" class="text-xs font-normal text-muted-foreground">{text("syncing_954ec984")}</span>
        </Show>
      </div>
      <Show when={props.error}>
        <div role="alert" class="flex items-center gap-2 px-3 py-2 text-xs text-destructive">
          <span class="min-w-0 flex-1 break-words">{props.error}</span>
          <Show when={props.onRetry && props.retryable !== false}>
            <Button size="sm" variant="outline" onClick={props.onRetry}><RefreshCw />{text("retry_b8784c8d")}</Button>
          </Show>
        </div>
      </Show>
      <Show when={rows().length > 0} fallback={
        <p class="px-3 py-4 text-sm text-muted-foreground">
          {props.topology.needsSnapshot ? text("loading_agent_structure_53ba2f19") : props.error ? null : text("no_agents_to_display_ea1f7e8b")}
        </p>
      }>
        <div
          ref={setViewport}
          role="tree"
          aria-label={text("agent_session_structure_0bfa0e40")}
          aria-activedescendant={`${id}-actor-${activeIndex()}`}
          tabindex={0}
          onKeyDown={onTreeKeyDown}
          class="min-h-0 max-h-80 overflow-y-auto outline-none focus-visible:ring-2 focus-visible:ring-ring"
          data-actor-tree-scroll=""
        >
          <div class="relative w-full" style={{ height: `${virtualizer.totalSize()}px` }} data-actor-tree-virtual="">
            <For each={virtualizer.items()} keyed={(item) => item.key}>{(item) => (
              <ActorRow
                item={item}
                row={() => rows()[item().index]}
                id={`${id}-actor-${item().index}`}
                text={text}
                active={activeIndex() === item().index}
                selected={props.selectedActorId === rows()[item().index]?.node.actorId}
                expanded={expandedIds()}
                runningSubtrees={runningSubtrees()}
                unreadIds={props.unreadActorIds}
                onClick={(actorId, disclose) => {
                  setActiveActorId(actorId)
                  viewport()?.focus()
                  if (disclose) toggle(actorId)
                  else props.onSelectActor(actorId)
                }}
              />
            )}</For>
          </div>
        </div>
      </Show>
    </div>
  )
}

function ActorRow(props: {
  item: Accessor<VirtualItem>
  row: Accessor<VisibleActorRow | undefined>
  id: string
  text: Text
  active: boolean
  selected: boolean
  expanded: ReadonlySet<string>
  runningSubtrees: ReadonlySet<string>
  unreadIds?: ReadonlySet<string>
  onClick: (actorId: string, disclose: boolean) => void
}) {
  return <Show when={props.row()}>{(entry) => {
    const node = () => entry().node
    const text = props.text
    const expanded = () => props.expanded.has(node().actorId)
    const unread = () => props.unreadIds?.has(node().actorId) ?? false
    const lifecycle = () => actorLifecycleLabel(node(), text)
    const stopWarning = () => node().localTaskDiagnostic === "stop_unconfirmed" && node().lifecycle !== "unknown"
      ? text("native_task_stop_unconfirmed") : null
    const placement = () => {
      const key = placementKeys[node().placement]
      return key ? text(key) : "SSH"
    }
    const description = () => node().placement !== "unknown" ? undefined : text(
      node().placementUnavailableReason === "no_activation" ? "actor_placement_no_activation"
        : node().placementUnavailableReason === "native_task" ? "actor_placement_native_task" : "actor_placement_missing",
    )
    const health = () => {
      const state = node().health
      return text(state === null ? "health_unknown_d7b6f7ae" : healthKeys[state])
    }
    const counts = () => [
      node().queuedCount !== null && node().queuedCount! > 0 ? text("queued_0d272e30", { v0: node().queuedCount }) : null,
      node().waitingForCount !== null && node().waitingForCount! > 0 ? text("waiting_23f9a84a", { v0: node().waitingForCount }) : null,
      node().pendingRequestCount !== null && node().pendingRequestCount! > 0 ? text("requests_25082fa5", { v0: node().pendingRequestCount }) : null,
    ].filter(Boolean)
    const inheritsRunning = () => node().lifecycle !== "running" && showsRunning(node(), props.runningSubtrees)
    const statusIcon = () => LIFECYCLE_ICON[inheritsRunning() ? "running" : node().lifecycle]

    return (
      <div
        id={props.id}
        role="treeitem"
        tabindex={-1}
        aria-level={node().depth + 1}
        aria-posinset={entry().position}
        aria-setsize={entry().siblingCount}
        aria-expanded={entry().hasChildren ? expanded() ? "true" : "false" : undefined}
        aria-selected={props.selected ? "true" : "false"}
        aria-label={[
          actorTitle(node(), text), node().role || text("agent_5e84ea61"), lifecycle(), stopWarning(), placement(),
          health(), ...counts(), unread() ? text("has_unread_messages") : null,
        ].filter(Boolean).join(text("list_separator"))}
        aria-description={description()}
        data-actor-id={node().actorId}
        class={cn(
          "absolute left-0 top-0 flex h-16 w-full cursor-pointer items-center gap-2 overflow-hidden border-b px-2 text-left text-sm hover:bg-accent/50",
          props.selected && "bg-muted/30",
          !props.selected && props.active && "bg-primary/5",
        )}
        style={{
          transform: `translateY(${props.item().start}px)`,
          "padding-inline-start": `calc(8px + min(${Math.min(node().depth, 8) * 16}px, ${Math.min(node().depth, 6) * 2.5}cqi))`,
        }}
        onClick={(event) => {
          props.onClick(node().actorId, entry().hasChildren && !!event.target.closest("[data-actor-toggle]"))
        }}
      >
        <span data-actor-toggle="" aria-hidden="true" class="flex size-5 shrink-0 items-center justify-center">
          <Show when={entry().hasChildren}>
            <Show when={expanded()} fallback={<ChevronRight class="size-4" />}><ChevronDown class="size-4" /></Show>
          </Show>
        </span>
        <span
          data-actor-status={node().lifecycle}
          data-inherits-running={inheritsRunning() ? "true" : undefined}
          aria-hidden="true"
          title={inheritsRunning() ? text("running_1f0eb99b") : lifecycle()}
          class={cn("flex size-3.5 shrink-0 items-center justify-center", statusIcon().cls)}
        >
          <Dynamic component={statusIcon().Icon} class={cn("size-3.5", statusIcon().spin && "animate-spin")} />
        </span>
        <span class="min-w-0 flex-1">
          <span class="flex min-w-0 items-center gap-1">
            <span data-actor-title="" class="line-clamp-2 font-medium leading-tight [overflow-wrap:anywhere]" title={node().title}>
              {actorTitle(node(), text)}
            </span>
            <Show when={unread()}><span class="size-1.5 shrink-0 rounded-full bg-primary" aria-hidden="true" /></Show>
          </span>
          <span class="block truncate text-xs text-muted-foreground">
            {node().role || text("agent_5e84ea61")} · {lifecycle()}{stopWarning() ? ` · ${stopWarning()}` : ""} · <span data-actor-placement="" title={description()}>{placement()}</span> · {health()}
            {counts().length ? ` · ${counts().join(" · ")}` : ""}
          </span>
        </span>
      </div>
    )
  }}</Show>
}
