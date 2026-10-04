import { useUiText } from "@shared/i18n/ui"
import { useMemo } from "react"
import type { MetricsUsageBreakdownResponse } from "@services/metrics"
import { Badge } from "@/components/ui/badge"
import { formatCompact, formatExact } from "./format"

interface UsageRow {
  key: string
  category: string
  label: string
  detail?: string
  count: number
}

const TOP_N = 5

/** Usage breakdown: summary chips + a merged top-usage table with inline proportion bars. */
export function UsageBreakdown({ usage }: { usage: MetricsUsageBreakdownResponse }) {
  const uiText = useUiText()
  const rows = useMemo<UsageRow[]>(() => {
    const core = usage.top_core_tools.slice(0, TOP_N).map((item) => ({
      key: `core:${item.name}`,
      category: uiText("core_tools_a833e5af"),
      label: item.name,
      count: item.count,
    }))
    const skills = usage.top_skills.slice(0, TOP_N).map((item) => ({
      key: `skill:${item.skill_id}`,
      category: uiText("skills_99aea2f9"),
      label: item.skill_id,
      count: item.count,
    }))
    const mcp = usage.top_mcp_tools.slice(0, TOP_N).map((item) => ({
      key: `mcp:${item.alias}`,
      category: "MCP",
      label: item.tool_name,
      detail: item.server_id,
      count: item.count,
    }))
    return [...core, ...skills, ...mcp]
  }, [usage, uiText])

  const maxCount = rows.reduce((acc, row) => Math.max(acc, row.count), 0)

  const chips = [
    { label: uiText("total_tool_calls_422aab04"), value: usage.total_tool_calls },
    { label: uiText("core_tools_a833e5af"), value: usage.core_tool_calls },
    { label: uiText("skill_loads_a0e4cc4e"), value: usage.skill_load_calls },
    { label: uiText("mcp_calls_c237aee5"), value: usage.mcp_calls },
  ]

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {chips.map((chip) => (
          <div key={chip.label} className="rounded-md border p-2 text-center">
            <div className="text-sm font-semibold" title={formatExact(chip.value)}>
              {formatCompact(chip.value)}
            </div>
            <div className="text-xs text-muted-foreground">{chip.label}</div>
          </div>
        ))}
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{uiText("no_tool_skill_or_mcp_usage_records_in_this_range_47e6bd78")}</p>
      ) : (
        <div className="max-h-64 overflow-auto rounded-md border">
          <table className="w-full min-w-[440px] text-xs">
            <thead className="sticky top-0 z-10 bg-background text-muted-foreground">
              <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
                <th className="text-left">{uiText("category_0d12cbd6")}</th>
                <th className="text-left">{uiText("name_d44e9b3d")}</th>
                <th className="w-24 text-right">{uiText("count_05c518eb")}</th>
                <th className="w-28 text-left">{uiText("share_cc87b27b")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.key} className="border-t [&>td]:px-2 [&>td]:py-1.5">
                  <td>
                    <Badge variant="outline" className="px-1.5 py-0 text-[10px] font-normal">
                      {row.category}
                    </Badge>
                  </td>
                  <td className="max-w-48 truncate" title={row.detail ? `${row.label} · ${row.detail}` : row.label}>
                    {row.label}
                    {row.detail ? (
                      <span className="ml-1 text-muted-foreground">({row.detail})</span>
                    ) : null}
                  </td>
                  <td className="text-right tabular-nums">{formatExact(row.count)}</td>
                  <td>
                    <div
                      className="h-1.5 w-full rounded-full"
                      style={{
                        background: "color-mix(in srgb, var(--mx-chat) 14%, transparent)",
                      }}
                    >
                      <div
                        className="h-full rounded-full"
                        style={{
                          width: `${maxCount > 0 ? Math.max((row.count / maxCount) * 100, 1.5) : 0}%`,
                          background: "var(--mx-chat)",
                        }}
                      />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
