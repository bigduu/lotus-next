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
  get retired() { return uiText("stopped_f006455e") }, get unknown() { return uiText("plugin_connection_unknown") },
}

function SubAgentCard({ child, childId, onOpen }: { child: ChildProgress; childId: string; onOpen?: () => void }) {
  useUiLocale()
  const st = statusOf(child)
  const detail = child.error || child.outputPreview
  // Placement comes from the session index; it grants no control authority.
  const placement =
    (child as ChildProgress & { placement?: SessionPlacement | null }).placement ?? null

  return (
    <button
      data-subagent-id={childId}
      data-subagent-status={st}
      onClick={onOpen}
      disabled={!onOpen}
      className={cn(
        "w-full overflow-hidden rounded-lg border text-left transition-colors",
        onOpen && "hover:border-primary/50 hover:bg-accent/50",
        st === "running" ? "border-primary/40 bg-primary/5" : "bg-muted/30",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2">
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
        {onOpen ? <ChevronRight className="size-4 shrink-0 text-muted-foreground" /> : null}
      </div>
      {detail ? (
        <div
          className={cn(
            "line-clamp-2 whitespace-pre-wrap border-t px-3 py-1.5 text-xs leading-relaxed [overflow-wrap:anywhere]",
            child.error ? "text-destructive" : "text-muted-foreground",
          )}
        >
          {detail}
        </div>
      ) : null}
    </button>
  )
}

/** Claude-Code-style inline sub-agent blocks; click one to open its full transcript. */
export function SubAgents({
  agents,
  onOpen,
  originUnconfirmed = false,
}: {
  agents: Record<string, ChildProgress>
  originUnconfirmed?: boolean
  onOpen?: (childId: string) => void
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
          <SubAgentCard key={id} childId={id} child={c} onOpen={onOpen ? () => onOpen(id) : undefined} />
        ))}
      </div>
    </div>
  )
}
