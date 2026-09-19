import { cn } from "@/lib/utils"
import {
  getPrefixCachePercentage,
  getPrefixCacheTotalInputTokens,
  type PrefixCacheUsage,
} from "@shared/types/tokenBudget"

/** Current-session context usage plus the latest provider prefix-cache result. */
export function ContextUsageRing({
  totalTokens,
  maxContextTokens,
  cacheReadInputTokens,
  cacheReadInputTokensRetained,
  prefixCache,
  onClick,
}: {
  totalTokens: number
  maxContextTokens: number | undefined
  cacheReadInputTokens?: number
  cacheReadInputTokensRetained?: boolean
  prefixCache?: PrefixCacheUsage
  onClick: () => void
}) {
  if (!maxContextTokens) return null
  const pct = Math.min(100, Math.round((totalTokens / maxContextTokens) * 100))
  const exactCachePct = prefixCache ? getPrefixCachePercentage(prefixCache) : undefined
  const roundedCachePct =
    typeof exactCachePct === "number" ? Math.round(exactCachePct) : undefined
  const cacheRead = prefixCache?.cacheReadInputTokens ?? cacheReadInputTokens
  const cacheRetained = Boolean(
    prefixCache?.retainedFromPreviousRound || cacheReadInputTokensRetained,
  )
  const cacheLabel =
    typeof roundedCachePct === "number"
      ? `${roundedCachePct}%`
      : typeof cacheRead === "number"
        ? "--"
        : null
  const C = 2 * Math.PI * 7
  const color = pct > 85 ? "text-destructive" : pct > 65 ? "text-amber-500" : "text-primary"
  const contextTitle =
    `上下文 ${totalTokens.toLocaleString()} / ${maxContextTokens.toLocaleString()} tokens (${pct}%)`
  const cacheStatus = cacheRetained ? "上一次已完成轮次" : "最新已完成轮次"
  const prefixCacheTitle =
    typeof roundedCachePct === "number" && prefixCache
      ? `Prefix Cache ${roundedCachePct}%（${prefixCache.cacheReadInputTokens.toLocaleString()} cache-read / ${getPrefixCacheTotalInputTokens(prefixCache).toLocaleString()} provider input，${cacheStatus}）`
      : typeof cacheRead === "number" && cacheRead > 0
        ? `Prefix Cache 读取 ${cacheRead.toLocaleString()} tokens（${cacheStatus}；当前后端未提供命中率分母）`
        : null
  const title = prefixCacheTitle ? `${contextTitle}；${prefixCacheTitle}` : contextTitle
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5"
      title={title}
      aria-label={cacheLabel === null ? "上下文用量" : `上下文用量，Cache ${cacheLabel}`}
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
      {cacheLabel === null ? null : (
        <span
          data-prefix-cache
          className="hidden rounded-full bg-muted px-1.5 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground sm:inline-flex"
        >
          Cache {cacheLabel}
        </span>
      )}
    </button>
  )
}
