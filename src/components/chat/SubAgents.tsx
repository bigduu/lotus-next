import { Bot, Loader2, Check, AlertCircle, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { MachineTag } from "@/components/chat/MachineTag"
import type { SessionPlacement } from "@services/chat/AgentService"
import type { ChildProgress } from "@shared/store/appStore/slices/executionStateSlice/types"

type Status = "running" | "done" | "error"

function statusOf(c: ChildProgress): Status {
  const s = (c.status || "").toLowerCase()
  if (c.error || s.includes("error") || s.includes("fail")) return "error"
  if (s.includes("complet") || s.includes("done") || s.includes("success") || s.includes("finish"))
    return "done"
  return "running"
}

const LABEL: Record<Status, string> = { running: "运行中", done: "完成", error: "失败" }

function SubAgentCard({ child, onOpen }: { child: ChildProgress; onOpen?: () => void }) {
  const st = statusOf(child)
  const detail = child.error || child.outputPreview
  // Which machine this child runs on. ChildProgress doesn't carry placement
  // yet — read it defensively so remote children badge up as soon as the
  // event pipeline forwards it, and nothing renders meanwhile.
  const placement =
    (child as ChildProgress & { placement?: SessionPlacement | null }).placement ?? null

  return (
    <button
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
        ) : (
          <Check className="size-3.5 shrink-0 text-emerald-500" />
        )}
        <Bot className="size-3.5 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{child.title || "子代理"}</span>
        <MachineTag placement={placement} compact className="max-w-32 shrink-0" />
        <span className="shrink-0 text-xs text-muted-foreground">
          {LABEL[st]}
          {typeof child.roundCount === "number" ? ` · ${child.roundCount}轮` : ""}
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
}: {
  agents: Record<string, ChildProgress>
  onOpen?: (childId: string) => void
}) {
  const entries = Object.entries(agents)
  if (entries.length === 0) return null

  return (
    <div className="flex justify-start">
      <div className="ml-1 w-full max-w-[85%] space-y-1.5 border-l-2 border-border/60 pl-3">
        <div className="text-xs font-medium text-muted-foreground">子代理 ({entries.length})</div>
        {entries.map(([id, c]) => (
          <SubAgentCard key={id} child={c} onOpen={onOpen ? () => onOpen(id) : undefined} />
        ))}
      </div>
    </div>
  )
}
