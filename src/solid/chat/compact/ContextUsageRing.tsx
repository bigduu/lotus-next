import { createMemo, Show } from "solid-js"
import { getPrefixCachePercentage, getPrefixCacheTotalInputTokens, type TokenUsage } from "@shared/types/tokenBudget"
import { uiText } from "@shared/i18n/text"
import { cn } from "@/lib/utils"
import { createUiLocale } from "../../shell/uiText"

const circumference = 2 * Math.PI * 7

/** Current-session context usage and the latest completed provider cache rate. */
export function ContextUsageRing(props: { usage?: TokenUsage | null; onClick: () => void }) {
  const locale = createUiLocale()
  const text: typeof uiText = (key, values) => uiText(key, { ...values, lng: locale() })
  const display = createMemo(() => {
    const usage = props.usage
    if (!usage?.maxContextTokens) return undefined
    const pct = Math.min(100, Math.round(usage.totalTokens / usage.maxContextTokens * 100))
    const prefixCache = usage.prefixCache
    const exactCache = prefixCache ? getPrefixCachePercentage(prefixCache) : undefined
    const cachePct = typeof exactCache === "number" ? Math.round(exactCache) : undefined
    const cacheRead = prefixCache?.cacheReadInputTokens ?? usage.cacheReadInputTokens
    const retained = prefixCache?.retainedFromPreviousRound || usage.cacheReadInputTokensRetained
    const cacheLabel = cachePct !== undefined ? `${cachePct}%` : typeof cacheRead === "number" ? "--" : null
    const format = (count: number) => count.toLocaleString(locale())
    const contextTitle = text("context_tokens_34cb163e", { v0: format(usage.totalTokens), v1: format(usage.maxContextTokens), v2: pct })
    const cacheStatus = text(retained ? "previous_completed_round_836ba413" : "latest_completed_round_fe872c8f")
    const cacheTitle = cachePct !== undefined && prefixCache
      ? text("prefix_cache_detail", {
        pct: cachePct, read: format(prefixCache.cacheReadInputTokens),
        input: format(getPrefixCacheTotalInputTokens(prefixCache)), status: cacheStatus,
      })
      : typeof cacheRead === "number" && cacheRead > 0
        ? text("prefix_cache_read_tokens_the_backend_does_not_provide_a_6d8df76f", { v0: format(cacheRead), v1: cacheStatus })
        : null
    return {
      pct,
      cacheLabel,
      title: cacheTitle ? text("context_cache_detail", { context: contextTitle, cache: cacheTitle }) : contextTitle,
      label: cacheLabel === null ? text("context_usage_06d7b2e3") : text("context_usage_cache_0cd3733a", { v0: cacheLabel }),
    }
  })

  return <Show when={display()}>{(entry) =>
    <button type="button" onClick={() => props.onClick()}
      class="flex h-8 shrink-0 items-center gap-1.5 rounded-md px-2 text-muted-foreground hover:bg-accent hover:text-foreground"
      title={entry().title} aria-label={entry().label}>
      <svg width="16" height="16" viewBox="0 0 18 18" class="-rotate-90" aria-hidden="true">
        <circle cx="9" cy="9" r="7" fill="none" stroke-width="2.5" class="stroke-muted" />
        <circle cx="9" cy="9" r="7" fill="none" stroke-width="2.5" stroke-linecap="round"
          stroke-dasharray={String(circumference)} stroke-dashoffset={String(circumference * (1 - entry().pct / 100))}
          class={cn("stroke-current transition-all", entry().pct > 85 ? "text-destructive" : entry().pct > 65 ? "text-amber-500" : "text-primary")} />
      </svg>
      <span class="hidden text-sm tabular-nums sm:inline">{entry().pct}%</span>
      <Show when={entry().cacheLabel}>
        <span data-prefix-cache="" class="hidden text-xs tabular-nums text-muted-foreground sm:inline-flex">Cache {entry().cacheLabel}</span>
      </Show>
    </button>
  }</Show>
}
