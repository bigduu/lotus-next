import { useId, useState } from "react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { Bot, Loader2, Check, AlertCircle, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { MachineTag } from "@/components/chat/MachineTag"
import type { SessionPlacement } from "@services/chat/AgentService"
import type { ChildProgress } from "@shared/store/appStore/slices/executionStateSlice/types"

type Status = "running" | "done" | "error" | "cancelled" | "queued" | "idle" | "retired" | "unknown"

function statusOf(c: ChildProgress): Status {
  switch (c.status?.toLowerCase()) {
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

const LABEL = {
  get running() { return uiText("running_1f0eb99b") }, get done() { return uiText("done_c0b3fbff") },
  get error() { return uiText("failed_28384d7a") }, get cancelled() { return uiText("workflow_run_status_cancelled") },
  get queued() { return uiText("workflow_run_status_queued") }, get idle() { return uiText("idle_dae661d1") },
  get retired() { return uiText("exited_899df7e2") }, get unknown() { return uiText("plugin_connection_unknown") },
}

function SubAgentCard({ child, childId, onOpen, expanded, onExpandedChange }: {
  child: ChildProgress; childId: string; onOpen?: () => void
  expanded?: boolean; onExpandedChange?: (expanded: boolean) => void
}) {
  useUiLocale()
  const [localExpanded, setLocalExpanded] = useState(false)
  const open = expanded ?? localExpanded
  const detailsId = useId()
  const st = statusOf(child)
  const detail = child.error || child.outputPreview
  // Placement comes from the session index; it grants no control authority.
  const placement =
    (child as ChildProgress & { placement?: SessionPlacement | null }).placement ?? null

  return (
    <article
      data-subagent-id={childId}
      data-subagent-status={st}
      data-expansion-key={`subagent-${childId}`}
      className={cn(
        "w-full overflow-hidden rounded-lg border text-left transition-colors",
        st === "running" ? "border-primary/40 bg-primary/5" : "bg-muted/30",
      )}
    >
      <button
        type="button"
        data-subagent-toggle
        aria-expanded={open}
        aria-controls={detailsId}
        onClick={() => onExpandedChange ? onExpandedChange(!open) : setLocalExpanded(!open)}
        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left hover:bg-accent/50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        {st === "running" ? (
          <Loader2 className="size-3.5 shrink-0 animate-spin text-primary" />
        ) : st === "error" ? (
          <AlertCircle className="size-3.5 shrink-0 text-destructive" />
        ) : st === "done" ? (
          <Check className="size-3.5 shrink-0 text-emerald-500" />
        ) : (
          <AlertCircle className="size-3.5 shrink-0 text-muted-foreground" />
        )}
        <Bot className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{child.title || uiText("sub_agent_acd37b4c")}</span>
        <MachineTag placement={placement} compact className="max-w-32 shrink-0" />
        <span className="shrink-0 text-xs text-muted-foreground">
          {LABEL[st]}
          {typeof child.roundCount === "number" ? uiText("rounds_6ff24cb5", { v0: child.roundCount , count: child.roundCount }) : ""}
        </span>
        <ChevronRight aria-hidden="true" className={cn("size-4 shrink-0 text-muted-foreground transition-transform", open && "rotate-90")} />
      </button>
      <div id={detailsId} data-subagent-details hidden={!open} className="space-y-2 border-t px-3 py-2">
        {detail ? (
          <div
            className={cn(
              "whitespace-pre-wrap text-xs leading-relaxed [overflow-wrap:anywhere]",
              st === "error" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {detail}
          </div>
        ) : null}
        {onOpen ? <button type="button" onClick={onOpen} className="text-xs underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {uiText("subagent_open_conversation", { title: child.title || uiText("sub_agent_acd37b4c") })}
        </button> : null}
      </div>
    </article>
  )
}

/** Compact child summaries; expansion is presentation state, never execution authority. */
export function SubAgents({
  agents,
  onOpen,
  originUnconfirmed = false,
  expandedIds,
  onExpandedChange,
}: {
  agents: Record<string, ChildProgress>
  originUnconfirmed?: boolean
  onOpen?: (childId: string) => void
  expandedIds?: ReadonlySet<string>
  onExpandedChange?: (childId: string, expanded: boolean) => void
}) {
  useUiLocale()
  const entries = Object.entries(agents)
  if (entries.length === 0) return null

  return (
    <div className="flex justify-start" data-subagent-group>
      <div className="ml-1 w-full max-w-[85%] space-y-1.5 border-l-2 border-border/60 pl-3">
        <div className="text-xs font-medium text-muted-foreground">{uiText("subagents_76d97a95")}{entries.length})</div>
        {originUnconfirmed ? <p className="text-xs text-muted-foreground">{uiText("subagent_origin_unknown")}</p> : null}
        {entries.map(([id, c]) => (
          <SubAgentCard key={id} childId={id} child={c} onOpen={onOpen ? () => onOpen(id) : undefined}
            expanded={expandedIds?.has(id)} onExpandedChange={onExpandedChange ? (open) => onExpandedChange(id, open) : undefined} />
        ))}
      </div>
    </div>
  )
}
