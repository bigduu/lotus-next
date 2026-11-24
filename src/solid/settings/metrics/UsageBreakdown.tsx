import { createMemo, For, Show } from "solid-js"
import { createUiText } from "../../shell/uiText"
import type { MetricsUsageBreakdownResponse } from "@services/metrics"
import { Badge } from "../../ui/badge"
import { createMetricFormatters } from "./format"

interface UsageRow {
  category: string
  label: string
  detail?: string
  count: number
}

const TOP_N = 5

/** Usage breakdown: summary chips + a merged top-usage table with inline proportion bars. */
export function UsageBreakdown(props: { usage: MetricsUsageBreakdownResponse }) {
  const uiText = createUiText()
  const { compact, exact } = createMetricFormatters()
  const rows = createMemo<UsageRow[]>(() => {
    const core = props.usage.top_core_tools.slice(0, TOP_N).map((item) => ({
      category: uiText("core_tools_a833e5af"),
      label: item.name,
      count: item.count,
    }))
    const skills = props.usage.top_skills.slice(0, TOP_N).map((item) => ({
      category: uiText("skills_99aea2f9"),
      label: item.skill_id,
      count: item.count,
    }))
    const mcp = props.usage.top_mcp_tools.slice(0, TOP_N).map((item) => ({
      category: "MCP",
      label: item.tool_name,
      detail: item.server_id,
      count: item.count,
    }))
    return [...core, ...skills, ...mcp]
  })

  const maxCount = createMemo(() => rows().reduce((acc, row) => Math.max(acc, row.count), 0))

  const chips = createMemo(() => [
    { label: uiText("total_tool_calls_422aab04"), value: props.usage.total_tool_calls },
    { label: uiText("core_tools_a833e5af"), value: props.usage.core_tool_calls },
    { label: uiText("skill_loads_a0e4cc4e"), value: props.usage.skill_load_calls },
    { label: uiText("mcp_calls_c237aee5"), value: props.usage.mcp_calls },
  ])

  return (
    <div class="space-y-3">
      <div class="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <For each={chips()}>{(chip) => (
          <div class="rounded-md border p-2 text-center">
            <div class="text-sm font-semibold" title={exact(chip.value)}>
              {compact(chip.value)}
            </div>
            <div class="text-xs text-muted-foreground">{chip.label}</div>
          </div>
        )}</For>
      </div>

      <Show when={rows().length} fallback={
        <p class="text-xs text-muted-foreground">{uiText("no_tool_skill_or_mcp_usage_records_in_this_range_47e6bd78")}</p>
      }>
        <div class="max-h-64 overflow-auto rounded-md border">
          <table class="w-full min-w-[440px] text-xs">
            <thead class="sticky top-0 z-10 bg-background text-muted-foreground">
              <tr class="[&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
                <th class="text-left">{uiText("category_0d12cbd6")}</th>
                <th class="text-left">{uiText("name_d44e9b3d")}</th>
                <th class="w-24 text-right">{uiText("count_05c518eb")}</th>
                <th class="w-28 text-left">{uiText("share_cc87b27b")}</th>
              </tr>
            </thead>
            <tbody>
              <For each={rows()}>{(row) => (
                <tr class="border-t [&>td]:px-2 [&>td]:py-1.5">
                  <td>
                    <Badge variant="outline" class="px-1.5 py-0 text-[10px] font-normal">
                      {row.category}
                    </Badge>
                  </td>
                  <td class="max-w-48 truncate" title={row.detail ? `${row.label} · ${row.detail}` : row.label}>
                    {row.label}
                    {row.detail ? (
                      <span class="ml-1 text-muted-foreground">({row.detail})</span>
                    ) : null}
                  </td>
                  <td class="text-right tabular-nums">{exact(row.count)}</td>
                  <td>
                    <div
                      class="h-1.5 w-full rounded-full"
                      style={{
                        background: "color-mix(in srgb, var(--mx-chat) 14%, transparent)",
                      }}
                    >
                      <div
                        class="h-full rounded-full"
                        style={{
                          width: `${maxCount() > 0 ? Math.max((row.count / maxCount()) * 100, 1.5) : 0}%`,
                          background: "var(--mx-chat)",
                        }}
                      />
                    </div>
                  </td>
                </tr>
              )}</For>
            </tbody>
          </table>
        </div>
      </Show>
    </div>
  )
}
