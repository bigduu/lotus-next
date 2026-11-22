import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import { ChevronDown, ChevronLeft, RefreshCw } from "lucide-react"

import { SubagentTranscriptPane } from "@/components/app/SubagentTranscriptPane"
import { ActorTree } from "@/components/chat/ActorTree"
import { actorLifecycleLabel } from "@/components/chat/actorTreeLabels"
import { Button } from "@/components/ui/button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { useActorSnapshot } from "@/hooks/useActorSnapshot"
import type { WorkbenchSubagents } from "@/hooks/useWorkbenchState"
import { cn } from "@/lib/utils"
import { actorSnapshotTree } from "@services/chat/actorSnapshot"
import type { ActorTreeData, ActorTreeNode } from "@services/chat/actorTreeView"
import { uiText, useUiLocale } from "@shared/i18n/ui"

const actorTitle = (node: ActorTreeNode) => node.title || uiText("unnamed_agent_1ff6bc72")

function parentPath(node: ActorTreeNode, topology: ActorTreeData) {
  const parents = []
  let actorId = node.parentActorId
  while (actorId) {
    const parent = topology.byId[actorId]
    if (!parent) break
    parents.push(actorTitle(parent))
    actorId = parent.parentActorId
  }
  return parents.reverse().join(" / ")
}

function SubagentPicker({ child, topology, onSelect }: {
  child: ActorTreeNode
  topology: ActorTreeData
  onSelect: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  return (
    <Popover open={open} onOpenChange={(next) => {
      if (next) setQuery("")
      setOpen(next)
    }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" className="min-w-0 max-w-full" aria-label={uiText("switch_subagent")}>
          <span className="truncate">{actorTitle(child)}</span>
          <ChevronDown />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)] p-0">
        <Command label={uiText("search_subagents")}>
          <CommandInput value={query} onValueChange={setQuery} aria-label={uiText("search_subagents")} placeholder={uiText("search_subagents")}
            className="border-b px-3 py-2" />
          <CommandList className="max-h-[min(20rem,50dvh)] p-1">
            <CommandEmpty className="p-2 text-sm text-muted-foreground">{uiText("no_matching_subagents")}</CommandEmpty>
            {Object.values(topology.byId).filter((node) => node.parentActorId !== null).map((node) => {
              const title = actorTitle(node)
              const path = parentPath(node, topology)
              const status = actorLifecycleLabel(node)
              return (
                <CommandItem key={node.actorId} value={node.actorId} keywords={[title, path, status]}
                  className="flex-col items-start rounded-md px-2 py-1.5"
                  onSelect={() => { onSelect(node.actorId); setOpen(false) }}>
                  <span className="w-full [overflow-wrap:anywhere]">{title}</span>
                  <span className="w-full text-xs text-muted-foreground [overflow-wrap:anywhere]">{status} · {path}</span>
                </CommandItem>
              )
            })}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export function SubagentsPane({ rootId, active, descendantCount, selection, onSelectChild, onShowTree, onMissingChild }: {
  rootId: string | null
  active: boolean
  descendantCount: number | null
  selection: WorkbenchSubagents
  onSelectChild: (id: string) => void
  onShowTree: () => void
  onMissingChild: (id: string) => void
}) {
  useUiLocale()
  const { childId, view } = selection
  const state = useActorSnapshot(rootId, active, view === "messages" && childId !== rootId ? childId : null, descendantCount)
  const previousTree = useRef<ActorTreeData | undefined>(undefined)
  const topology = useMemo(() => state.snapshot
    ? actorSnapshotTree(state.snapshot, state.loading, previousTree.current)
    : { rootActorId: rootId ?? "", byId: Object.create(null), childrenById: Object.create(null), needsSnapshot: state.loading },
  [rootId, state.loading, state.snapshot])
  useEffect(() => { previousTree.current = topology }, [topology])

  const selected = childId ? topology.byId[childId] : undefined
  const child = selected?.parentActorId ? selected : null
  const reading = view === "messages" && child !== null
  const pane = useRef<HTMLElement>(null)
  const nextFocus = useRef<"tree" | "messages" | null>(null)
  useLayoutEffect(() => {
    if (!active || nextFocus.current !== (reading ? "messages" : "tree")) return
    nextFocus.current = null
    const target = pane.current?.querySelector<HTMLElement>(reading ? "[data-return-to-tree]" : '[role="tree"]')
    target?.focus({ preventScroll: true })
  }, [active, reading])
  useEffect(() => {
    if (active && childId && !child && state.snapshot && !state.loading && !state.error && !state.gapReason) {
      onMissingChild(childId)
    }
  }, [active, childId, child, state.snapshot, state.loading, state.error, state.gapReason, onMissingChild])

  if (!rootId) return <p className="p-4 text-sm text-muted-foreground">{uiText("select_a_root_session_to_load_agent_structure_abe1ec98")}</p>

  const path = child && parentPath(child, topology)
  return (
    <section ref={pane} className="flex min-h-0 min-w-0 flex-1 flex-col" data-subagents-pane aria-busy={state.loading}>
      {reading ? (
        <div className="shrink-0 space-y-1 border-b px-3 py-2">
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-1.5">
            <Button size="sm" variant="ghost" data-return-to-tree onClick={() => {
              nextFocus.current = "tree"
              onShowTree()
            }}>
              <ChevronLeft />{uiText("return_to_subagent_tree")}
            </Button>
            <SubagentPicker child={child} topology={topology} onSelect={onSelectChild} />
          </div>
          <p className="px-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">{path} / {actorTitle(child)}</p>
        </div>
      ) : null}
      {state.gapReason ? (
        <p role="status" data-actor-gap={state.gapReason} data-actor-gap-origin={state.gapActorId ?? undefined}
          className="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">
          {uiText("there_is_a_gap_in_subagent_events_state_was_reloaded_bu_463a89f1")}
        </p>
      ) : null}
      <div hidden={reading} className={cn("min-h-0 min-w-0 flex-1 flex-col", reading ? "hidden" : "flex")}>
        <div className="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
          <p className="text-sm text-muted-foreground">{state.snapshot?.nodes.length === 1
            ? uiText("no_subagents_in_session") : uiText("select_a_subagent_to_load_its_message_history_d73b4879")}</p>
          <Button size="icon" variant="ghost" disabled={state.loading} onClick={() => void state.refresh()}
            aria-label={uiText("refresh_agent_structure_277bb85d")}>
            <RefreshCw />
          </Button>
        </div>
        <ActorTree topology={topology} selectedActorId={child?.actorId ?? rootId}
          revealSelected={!reading}
          onSelectActor={(id) => {
            if (id === rootId) return
            nextFocus.current = "messages"
            onSelectChild(id)
          }}
          error={state.error} onRetry={() => void state.refresh()} retryable={state.retryable}
          className="flex-1" />
      </div>
      {active && reading ? <SubagentTranscriptPane key={child.actorId} sessionId={child.actorId} /> : null}
    </section>
  )
}
