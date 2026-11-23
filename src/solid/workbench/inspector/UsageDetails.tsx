import { createMemo, Show } from "solid-js"
import { formatTokenCount, getPrefixCachePercentage, getPrefixCacheTotalInputTokens, type TokenUsage } from "@shared/types/tokenBudget"

import { createUiText } from "../../shell/uiText"

export function InspectorRow(props: { label: string; value: string }) {
  return <div class="flex items-center justify-between gap-3 py-0.5 text-sm">
    <span class="text-muted-foreground">{props.label}</span>
    <span class="truncate font-medium">{props.value}</span>
  </div>
}

const tokenValue = (count: number) => `${formatTokenCount(count)} tokens`
const percentage = (count: number) => `${count.toFixed(1).replace(/\.0$/, "")}%`

export function PrefixCacheDetails(props: { usage?: TokenUsage }) {
  const text = createUiText()
  const source = createMemo(() => {
    const cache = props.usage?.prefixCache
    const rate = cache ? getPrefixCachePercentage(cache) : undefined
    return {
      exact: cache && typeof rate === "number" ? { cache, percentage: percentage(rate) } : null,
      read: cache?.cacheReadInputTokens ?? props.usage?.cacheReadInputTokens,
      retained: Boolean(cache?.retainedFromPreviousRound || props.usage?.cacheReadInputTokensRetained),
    }
  })
  return <div data-prefix-cache-details>
    <div class="mb-1 text-xs text-muted-foreground">Prefix Cache</div>
    <Show when={source().exact} fallback={
      <Show when={(source().read ?? 0) > 0} fallback={<>
        <InspectorRow label={text("hit_rate_da9e37af")} value={text("no_data_yet_497c8569")} />
        <p class="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{text("shown_after_a_model_call_reports_provider_usage_709de1e3")}</p>
      </>}>
        <InspectorRow label={text("cache_reads_1ded6559")} value={tokenValue(source().read!)} />
        <InspectorRow label={text("provider_input_cbf1d1f1")} value={text("waiting_for_complete_data_a333ea86")} />
        <InspectorRow label={text("hit_rate_da9e37af")} value={text("waiting_for_exact_data_42730723")} />
        <InspectorRow label={text("data_status_bbd51f73")} value={text(source().retained ? "previous_valid_value_84e70723" : "latest_compatible_data_a6b924c0")} />
        <p class="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{text("hit_rate_requires_provider_input_from_the_same_round_th_3f9518c8")}</p>
      </Show>
    }>{(exact) => <>
      <InspectorRow label={text("hit_rate_da9e37af")} value={exact().percentage} />
      <InspectorRow label={text("cache_reads_1ded6559")} value={tokenValue(exact().cache.cacheReadInputTokens)} />
      <InspectorRow label={text("new_input_56164cf0")} value={tokenValue(exact().cache.inputTokens)} />
      <InspectorRow label={text("cache_creation_92797c69")} value={tokenValue(exact().cache.cacheCreationInputTokens)} />
      <InspectorRow label={text("provider_input_cbf1d1f1")} value={tokenValue(getPrefixCacheTotalInputTokens(exact().cache))} />
      <InspectorRow label={text("data_status_bbd51f73")} value={text(source().retained ? "previous_completed_round_836ba413" : "latest_completed_round_fe872c8f")} />
      <p class="mt-1.5 text-[11px] leading-relaxed text-muted-foreground">{text("hit_rate_cache_reads_new_input_cache_creation_cache_rea_ae5ec6f5")}</p>
    </>}</Show>
  </div>
}

export function ContextUsageDetails(props: { usage: TokenUsage }) {
  const text = createUiText()
  const occupied = () => props.usage.maxContextTokens ? Math.min(100, (props.usage.totalTokens / props.usage.maxContextTokens) * 100) : 0
  return <div data-context-usage-details>
    <div class="mb-1 text-xs text-muted-foreground">{text("context_estimate_11f23d14")}</div>
    <InspectorRow label={text("estimated_total_58f48562")} value={tokenValue(props.usage.totalTokens)} />
    <InspectorRow label={text("system_prompt_0894b78b")} value={tokenValue(props.usage.systemTokens)} />
    <InspectorRow label={text("session_window_7b78e572")} value={tokenValue(props.usage.windowTokens)} />
    <Show when={props.usage.summaryTokens > 0}><InspectorRow label={text("summary_21c04b2e")} value={tokenValue(props.usage.summaryTokens)} /></Show>
    <Show when={(props.usage.thinkingTokens ?? 0) > 0}><InspectorRow label={text("reasoning_132411ba")} value={tokenValue(props.usage.thinkingTokens!)} /></Show>
    <Show when={props.usage.maxContextTokens}>{(limit) => <>
      <InspectorRow label={text("context_window_bb074b86")} value={tokenValue(limit())} />
      <InspectorRow label={text("context_occupancy_ba08613d")} value={percentage(occupied())} />
      <div class="mt-2 h-1.5 w-full overflow-hidden rounded-full bg-muted">
        <div class="h-full rounded-full bg-primary" style={{ width: `${Math.round(occupied())}%` }} />
      </div>
    </>}</Show>
  </div>
}
