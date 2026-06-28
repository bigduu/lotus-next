import { cn } from "@/lib/utils"

/** Header context-usage donut: a small ring showing token usage % of the window. */
export function ContextUsageRing({
  totalTokens,
  maxContextTokens,
  onClick,
}: {
  totalTokens: number
  maxContextTokens: number | undefined
  onClick: () => void
}) {
  if (!maxContextTokens) return null
  const pct = Math.min(100, Math.round((totalTokens / maxContextTokens) * 100))
  const C = 2 * Math.PI * 7
  const color = pct > 85 ? "text-destructive" : pct > 65 ? "text-amber-500" : "text-primary"
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5"
      title={`上下文 ${totalTokens.toLocaleString()} / ${maxContextTokens.toLocaleString()} tokens (${pct}%)`}
      aria-label="上下文用量"
    >
      <svg width="20" height="20" viewBox="0 0 18 18" className="-rotate-90">
        <circle cx="9" cy="9" r="7" fill="none" strokeWidth="2.5" className="stroke-muted" />
        <circle
          cx="9"
          cy="9"
          r="7"
          fill="none"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - pct / 100)}
          className={cn("stroke-current transition-all", color)}
        />
      </svg>
      <span className="hidden text-xs tabular-nums text-muted-foreground sm:inline">{pct}%</span>
    </button>
  )
}
