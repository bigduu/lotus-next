import { AlertCircle, Bot, Check, ChevronRight, Container, Loader2, Monitor, Server } from "@lucide/solid"
import { createMemo, createSignal, createUniqueId, For, Match, Show, Switch } from "solid-js"

import { cn } from "@/lib/utils"
import type { SubAgentCard } from "@services/chat/actorInlineStatus"
import type { SessionPlacement } from "@services/chat/AgentService"

import { createUiText } from "../../shell/uiText"
import { Badge } from "../../ui/badge"
import { Button } from "../../ui/button"
import type { createInlineActorStatus } from "./createInlineActorStatus"

export type InlineActorStatus = ReturnType<typeof createInlineActorStatus>

type Status = keyof typeof statusLabel
const statusLabel = {
  running: "running_1f0eb99b", done: "done_c0b3fbff", error: "failed_28384d7a",
  cancelled: "workflow_run_status_cancelled", queued: "workflow_run_status_queued",
  idle: "idle_dae661d1", retired: "exited_899df7e2", unknown: "plugin_connection_unknown",
} as const

function statusOf(status?: string): Status {
  switch (status?.toLowerCase()) {
    case "running": return "running"
    case "completed": case "succeeded": case "done": return "done"
    case "error": case "failed": return "error"
    case "cancelled": return "cancelled"
    case "queued": case "reserved": return "queued"
    case "idle": case "cold": case "created": return "idle"
    case "retired": return "retired"
    default: return "unknown"
  }
}

function Placement(props: { placement: SessionPlacement }) {
  const text = createUiText()
  return (
    <Badge variant="outline" title={text("running_on_caee1687", { v0: props.placement.kind, v1: props.placement.host })}
      class={cn("max-w-32 shrink-0 gap-1 font-normal text-muted-foreground",
        props.placement.kind !== "local" && "border-transparent bg-blue-500/15 text-blue-600 dark:text-blue-400")}>
      <Switch fallback={<Monitor />}>
        <Match when={props.placement.kind === "ssh"}><Server /></Match>
        <Match when={props.placement.kind === "docker"}><Container /></Match>
      </Switch>
      <span class="truncate">{props.placement.kind} · {props.placement.host}</span>
    </Badge>
  )
}

function InlineActorCard(props: {
  id: string
  actor: SubAgentCard
  status: InlineActorStatus
  onOpen?: (id: string) => void
}) {
  const text = createUiText()
  const detailsId = createUniqueId()
  const open = () => props.status.expanded().has(props.id)
  const status = createMemo(() => statusOf(props.actor.status))
  const title = () => props.actor.title || text("sub_agent_acd37b4c")
  return (
    <article data-subagent-id={props.id} data-subagent-status={status()} data-expansion-key={`subagent-${props.id}`}
      class={cn("w-full overflow-hidden rounded-lg border text-left transition-colors",
        status() === "running" ? "border-primary/40 bg-primary/5" : "bg-muted/30")}>
      <button type="button" data-subagent-toggle="" aria-expanded={open() ? "true" : "false"} aria-controls={detailsId}
        onClick={() => props.status.toggle(props.id)}
        class="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <Switch fallback={<AlertCircle class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />}>
          <Match when={status() === "running"}><Loader2 class="size-3.5 shrink-0 animate-spin text-primary" aria-hidden="true" /></Match>
          <Match when={status() === "error"}><AlertCircle class="size-3.5 shrink-0 text-destructive" aria-hidden="true" /></Match>
          <Match when={status() === "done"}><Check class="size-3.5 shrink-0 text-emerald-500" aria-hidden="true" /></Match>
        </Switch>
        <Bot class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span class="min-w-0 flex-1 truncate text-sm font-medium">{title()}</span>
        <Show when={props.actor.placement?.host ? props.actor.placement : undefined}>
          {(placement) => <Placement placement={placement()} />}
        </Show>
        <span class="shrink-0 text-xs text-muted-foreground">{text(statusLabel[status()])}</span>
        <ChevronRight aria-hidden="true" class={cn("size-4 shrink-0 text-muted-foreground transition-transform", open() && "rotate-90")} />
      </button>
      <div id={detailsId} data-subagent-details="" hidden={!open()} class="space-y-2 border-t px-3 py-2">
        <Show when={props.onOpen}>
          <button type="button" onClick={() => props.onOpen?.(props.id)}
            class="text-xs underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {text("subagent_open_conversation", { title: title() })}
          </button>
        </Show>
      </div>
    </article>
  )
}

export function InlineActorGroup(props: {
  agents?: Record<string, SubAgentCard>
  status: InlineActorStatus
  onOpen?: (id: string) => void
  originUnconfirmed?: boolean
}) {
  const text = createUiText()
  const ids = createMemo(() => Object.keys(props.agents ?? {}))
  return (
    <Show when={ids().length}>
      <div class="flex justify-start" data-subagent-group="">
        <div class="ml-1 w-full max-w-[85%] space-y-1.5 border-l-2 border-border/60 pl-3">
          <div class="text-xs font-medium text-muted-foreground">{text("subagents_76d97a95")}{ids().length})</div>
          <Show when={props.originUnconfirmed}><p class="text-xs text-muted-foreground">{text("subagent_origin_unknown")}</p></Show>
          <For each={ids()} keyed={(id) => id}>{(id) => <InlineActorCard id={id()} actor={props.agents![id()]} status={props.status} onOpen={props.onOpen} />}</For>
        </div>
      </div>
    </Show>
  )
}

export function InlineActorPrefix(props: { status: InlineActorStatus; onOpen?: (id: string) => void }) {
  const text = createUiText()
  const [expanded, setExpanded] = createSignal(false)
  const group = () => props.status.groups()
  const count = createMemo(() => Object.keys(group().folded).length)
  return (
    <div class="flex w-full flex-col gap-2 empty:hidden">
      <Show when={props.status.error()}>{(error) => (
        <div role="status" class="text-xs text-muted-foreground" data-subagent-error="">
          {error()}<Button variant="ghost" size="sm" onClick={() => void props.status.refresh()}>{text("subagent_refresh")}</Button>
        </div>
      )}</Show>
      <Show when={count() > 0}>
        <div data-cleared-subagents="">
          <button type="button" data-cleared-subagents-toggle="" aria-expanded={expanded() ? "true" : "false"}
            onClick={() => setExpanded((previous) => !previous)}
            class="flex w-full items-center gap-2 rounded-lg px-2 py-1 text-left text-xs text-muted-foreground hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <ChevronRight aria-hidden="true" class={cn("size-3 shrink-0 text-muted-foreground transition-transform", expanded() && "rotate-90")} />
            <span data-cleared-subagents-brief="" class="min-w-0 truncate">
              {group().hasUnconfirmedAge ? `${text("subagents_76d97a95")}${count()})` : text("cleared_session_subagents", { count: count() })}
            </span>
          </button>
          <Show when={expanded()}><InlineActorGroup agents={group().folded} status={props.status} onOpen={props.onOpen} originUnconfirmed /></Show>
        </div>
      </Show>
      <InlineActorGroup agents={group().unplaced} status={props.status} onOpen={props.onOpen} originUnconfirmed />
    </div>
  )
}
