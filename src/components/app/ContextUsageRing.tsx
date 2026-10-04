import { uiText, useUiLocale, uiLanguage } from "@shared/i18n/ui"
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
  useUiLocale()
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
    uiText("context_tokens_34cb163e", { v0: totalTokens.toLocaleString(uiLanguage()), v1: maxContextTokens.toLocaleString(uiLanguage()), v2: pct })
  const cacheStatus = cacheRetained ? uiText("previous_completed_round_836ba413") : uiText("latest_completed_round_fe872c8f")
  const prefixCacheTitle =
    typeof roundedCachePct === "number" && prefixCache
      ? uiText("prefix_cache_detail", { pct: roundedCachePct, read: prefixCache.cacheReadInputTokens.toLocaleString(uiLanguage()), input: getPrefixCacheTotalInputTokens(prefixCache).toLocaleString(uiLanguage()), status: cacheStatus })
      : typeof cacheRead === "number" && cacheRead > 0
        ? uiText("prefix_cache_read_tokens_the_backend_does_not_provide_a_6d8df76f", { v0: cacheRead.toLocaleString(uiLanguage()), v1: cacheStatus })
        : null
  const title = prefixCacheTitle ? uiText("context_cache_detail", { context: contextTitle, cache: prefixCacheTitle }) : contextTitle
  return (
    <button
      onClick={onClick}
      className="flex items-center gap-1.5"
      title={title}
      aria-label={cacheLabel === null ? uiText("context_usage_06d7b2e3") : uiText("context_usage_cache_0cd3733a", { v0: cacheLabel })}
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
