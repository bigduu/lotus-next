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
  const rows = useMemo<UsageRow[]>(() => {
    const core = usage.top_core_tools.slice(0, TOP_N).map((item) => ({
      key: `core:${item.name}`,
      category: "核心工具",
      label: item.name,
      count: item.count,
    }))
    const skills = usage.top_skills.slice(0, TOP_N).map((item) => ({
      key: `skill:${item.skill_id}`,
      category: "技能",
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
  }, [usage])

  const maxCount = rows.reduce((acc, row) => Math.max(acc, row.count), 0)

  const chips = [
    { label: "总工具调用", value: usage.total_tool_calls },
    { label: "核心工具", value: usage.core_tool_calls },
    { label: "技能加载", value: usage.skill_load_calls },
    { label: "MCP 调用", value: usage.mcp_calls },
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
        <p className="text-xs text-muted-foreground">此范围内暂无工具/技能/MCP 使用记录</p>
      ) : (
        <div className="max-h-64 overflow-auto rounded-md border">
          <table className="w-full min-w-[440px] text-xs">
            <thead className="sticky top-0 z-10 bg-background text-muted-foreground">
              <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
                <th className="text-left">类别</th>
                <th className="text-left">名称</th>
                <th className="w-24 text-right">次数</th>
                <th className="w-28 text-left">占比</th>
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
