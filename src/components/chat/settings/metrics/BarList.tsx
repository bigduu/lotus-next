import { formatCompact } from "./format"

export interface BarListItem {
  key: string
  label: string
  value: number
  /** Muted annotation after the label, e.g. "12 会话". */
  meta?: string
}

/**
 * Compact horizontal bar list (single series → single color). Every row carries
 * its exact value as text, so the bars are never the only encoding.
 */
export function BarList({
  items,
  color = "var(--mx-chat)",
  emptyText = "暂无数据",
  formatValue = formatCompact,
}: {
  items: BarListItem[]
  color?: string
  emptyText?: string
  formatValue?: (value: number) => string
}) {
  if (items.length === 0) {
    return <p className="text-xs text-muted-foreground">{emptyText}</p>
  }
  const max = items.reduce((acc, item) => Math.max(acc, item.value), 0)

  return (
    <ul className="space-y-2">
      {items.map((item) => (
        <li key={item.key} title={`${item.label}: ${item.value.toLocaleString()}`}>
          <div className="flex items-baseline justify-between gap-2">
            <span className="min-w-0 truncate text-xs">
              {item.label}
              {item.meta ? (
                <span className="ml-1.5 text-muted-foreground">{item.meta}</span>
              ) : null}
            </span>
            <span className="shrink-0 text-xs font-medium tabular-nums">
              {formatValue(item.value)}
            </span>
          </div>
          <div
            className="mt-1 h-1.5 w-full rounded-full"
            style={{ background: `color-mix(in srgb, ${color} 14%, transparent)` }}
          >
            <div
              className="h-full rounded-full"
              style={{
                width: `${max > 0 ? Math.max((item.value / max) * 100, item.value > 0 ? 1.5 : 0) : 0}%`,
                background: color,
              }}
            />
          </div>
        </li>
      ))}
    </ul>
  )
}
