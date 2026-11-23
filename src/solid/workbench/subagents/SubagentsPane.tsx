import { createEffect, createMemo, createSignal, For, onCleanup, Show } from "solid-js"
import { ChevronDown, ChevronLeft, RefreshCw } from "@lucide/solid"

import { cn } from "@/lib/utils"
import type { WorkbenchSubagents } from "@/lib/workbenchState"
import { actorSnapshotTree } from "@services/chat/actorSnapshot"
import type { ActorTreeData, ActorTreeNode } from "@services/chat/actorTreeView"

import type { HistoryReadingAnchor } from "../../history/VirtualHistory"
import { createUiLocale, createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Command, CommandEmpty, CommandInput, CommandItem, CommandList } from "../../ui/command"
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover"

import { ActorTree, type UpdateExpansion } from "./ActorTree"
import { actorLifecycleLabel, actorTitle } from "./actorLabels"
import { createActorSnapshot } from "./createActorSnapshot"
import { SubagentTranscriptPane, type SubagentTranscriptPaneProps } from "./SubagentTranscriptPane"

type Text = ReturnType<typeof createUiText>

function parentPath(node: ActorTreeNode, topology: ActorTreeData, text: Text) {
  const parents: string[] = []
  const visited = new Set<string>()
  let actorId = node.parentActorId
  while (actorId && !visited.has(actorId)) {
    visited.add(actorId)
    const parent = topology.byId[actorId]
    if (!parent) break
    parents.push(actorTitle(parent, text))
    actorId = parent.parentActorId
  }
  return parents.reverse().join(" / ")
}

function SubagentPicker(props: {
  child: ActorTreeNode
  topology: ActorTreeData
  onSelect: (id: string) => void
}) {
  const text = createUiText()
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  const children = createMemo(() => Object.values(props.topology.byId).filter((node) => node.parentActorId !== null))

  return (
    <Popover open={open()} placement="bottom-end" onOpenChange={(next) => {
      if (next) setQuery("")
      setOpen(next)
    }}>
      <PopoverTrigger as={Button} variant="outline" size="sm" class="min-w-0 max-w-full" aria-label={text("switch_subagent")}>
        <span class="truncate">{actorTitle(props.child, text)}</span>
        <ChevronDown />
      </PopoverTrigger>
      <PopoverContent class="w-80 max-w-[calc(100vw-2rem)] p-0" aria-label={text("switch_subagent")}>
        <Command label={text("search_subagents")}>
          <CommandInput value={query()} onValueChange={setQuery} placeholder={text("search_subagents")}
            class="border-b px-3 py-2" />
          <CommandList class="max-h-[min(20rem,50dvh)] p-1">
            <CommandEmpty class="p-2 text-sm text-muted-foreground">{text("no_matching_subagents")}</CommandEmpty>
            <For each={children()} keyed={(node) => node.actorId}>{(node) => {
              const title = () => actorTitle(node(), text)
              const path = () => parentPath(node(), props.topology, text)
              const status = () => actorLifecycleLabel(node(), text)
              return (
                <CommandItem value={node().actorId} keywords={[title(), path(), status()]}
                  class="flex-col items-start rounded-md px-2 py-1.5"
                  onSelect={() => { props.onSelect(node().actorId); setOpen(false) }}>
                  <span class="w-full [overflow-wrap:anywhere]">{title()}</span>
                  <span class="w-full text-xs text-muted-foreground [overflow-wrap:anywhere]">{status()} · {path()}</span>
                </CommandItem>
              )
            }}</For>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}

export interface SubagentsPaneProps extends Pick<SubagentTranscriptPaneProps, "theme" | "onOpenLink" | "onPreviewImage"> {
  rootId: string | null
  active: boolean
  descendantCount: number | null
  selection: WorkbenchSubagents
  onSelectChild: (id: string) => void
  onShowTree: () => void
  onMissingChild: (id: string) => void
  onExpandedChange: (update: UpdateExpansion) => void
  readingAnchors: Map<string, HistoryReadingAnchor>
}

export function SubagentsPane(props: SubagentsPaneProps) {
  const text = createUiText()
  const locale = createUiLocale()
  const interestedActor = () => props.selection.view === "messages" && props.selection.childId !== props.rootId
    ? props.selection.childId : null
  const { state, authorizedActor, refresh } = createActorSnapshot(
    () => props.rootId, () => props.active, interestedActor, () => props.descendantCount,
  )
  const snapshot = createMemo(() => state().snapshot)
  const loading = createMemo(() => state().loading)
  let previousTree: ActorTreeData | undefined
  const topology = createMemo<ActorTreeData>(() => {
    locale()
    const confirmed = snapshot()
    if (confirmed) return actorSnapshotTree(confirmed, loading(), previousTree)
    return { rootActorId: props.rootId ?? "", byId: Object.create(null), childrenById: Object.create(null), needsSnapshot: loading() }
  })
  createEffect(topology, (tree) => { previousTree = tree })

  const expandedIds = createMemo(() => new Set(props.selection.expandedActorIds ?? (props.rootId ? [props.rootId] : [])))
  const child = createMemo(() => {
    const id = props.selection.childId
    const tree = topology()
    const node = id ? tree.byId[id] : undefined
    return node?.parentActorId && tree.rootActorId === props.rootId ? node : null
  })
  const reading = () => props.selection.view === "messages" && child() !== null
  const transcriptId = () => props.active && reading() ? authorizedActor() : null
  let pane: HTMLElement | undefined
  let nextFocus: "tree" | "messages" | null = null
  let focusFrame: number | undefined
  let missingReported: string | null = null

  onCleanup(() => {
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
  })
  createEffect(() => [props.active, reading()] as const, ([active, isReading]) => {
    if (!active || nextFocus !== (isReading ? "messages" : "tree")) return
    nextFocus = null
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    focusFrame = requestAnimationFrame(() => {
      focusFrame = undefined
      if (props.active && reading() === isReading) {
        pane?.querySelector<HTMLElement>(isReading ? "[data-return-to-tree]" : '[role="tree"]')?.focus({ preventScroll: true })
      }
    })
  })

  createEffect(() => ({
    active: props.active, childId: props.selection.childId, child: child(), rootId: props.rootId, state: state(),
  }), ({ active, childId, child, rootId, state }) => {
    if (child || !childId || !rootId || childId === rootId) { missingReported = null; return }
    if (!active || !state.snapshot || state.loading || state.error || state.gapReason || state.rootId !== rootId) return
    const key = JSON.stringify([rootId, childId])
    if (missingReported === key) return
    missingReported = key
    props.onMissingChild(childId)
  })

  const selectChild = (id: string) => {
    const tree = topology()
    if (tree.rootActorId === props.rootId && tree.byId[id]?.parentActorId) props.onSelectChild(id)
  }

  return (
    <Show when={props.rootId} fallback={
      <p class="p-4 text-sm text-muted-foreground">{text("select_a_root_session_to_load_agent_structure_abe1ec98")}</p>
    }>
      <section ref={(element) => { pane = element }} class="flex min-h-0 min-w-0 flex-1 flex-col" data-subagents-pane=""
        aria-busy={loading() ? "true" : "false"}>
        <Show when={reading() && child()}>{(selected) => (
          <div class="shrink-0 space-y-1 border-b px-3 py-2">
            <div class="flex min-w-0 flex-wrap items-center justify-between gap-1.5">
              <Button size="sm" variant="ghost" data-return-to-tree="" onClick={() => {
                nextFocus = "tree"
                props.onShowTree()
              }}>
                <ChevronLeft />{text("return_to_subagent_tree")}
              </Button>
              <SubagentPicker child={selected()} topology={topology()} onSelect={selectChild} />
            </div>
            <p class="max-h-16 overflow-y-auto px-1 text-xs text-muted-foreground [overflow-wrap:anywhere]">
              {parentPath(selected(), topology(), text)} / {actorTitle(selected(), text)}
            </p>
          </div>
        )}</Show>
        <Show when={state().gapReason}>
          <p role="status" data-actor-gap={state().gapReason} data-actor-gap-origin={state().gapActorId ?? undefined}
            class="shrink-0 border-b px-3 py-2 text-xs text-muted-foreground">
            {text("there_is_a_gap_in_subagent_events_state_was_reloaded_bu_463a89f1")}
          </p>
        </Show>
        <div hidden={reading()} class={cn("min-h-0 min-w-0 flex-1 flex-col", reading() ? "hidden" : "flex")}>
          <div class="flex shrink-0 items-center justify-between gap-2 border-b px-3 py-2">
            <p class="text-sm text-muted-foreground">{snapshot()?.nodes.length === 1
              ? text("no_subagents_in_session") : text("select_a_subagent_to_load_its_message_history_d73b4879")}</p>
            <Button size="icon" variant="ghost" disabled={loading()} onClick={() => void refresh()}
              aria-label={text("refresh_agent_structure_277bb85d")}>
              <RefreshCw />
            </Button>
          </div>
          <ActorTree topology={topology()} selectedActorId={child()?.actorId ?? props.rootId}
            revealSelected={!reading()}
            expansion={{ ids: expandedIds(), update: props.onExpandedChange }}
            onSelectActor={(id) => {
              if (id === props.rootId) return
              nextFocus = "messages"
              selectChild(id)
            }}
            error={state().error} onRetry={() => void refresh()} retryable={state().retryable}
            class="flex-1" />
        </div>
        <Show when={transcriptId()} keyed>{(actorId) => (
          <SubagentTranscriptPane
            sessionId={actorId}
            readingAnchor={props.readingAnchors.get(actorId)}
            onReadingAnchor={(anchor) => {
              if (anchor) props.readingAnchors.set(actorId, anchor)
              else props.readingAnchors.delete(actorId)
            }}
            theme={props.theme}
            onOpenLink={props.onOpenLink}
            onPreviewImage={props.onPreviewImage}
          />
        )}</Show>
      </section>
    </Show>
  )
}
