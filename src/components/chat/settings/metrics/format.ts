const compactFormatter = new Intl.NumberFormat("en", {
  notation: "compact",
  maximumFractionDigits: 1,
})

const exactFormatter = new Intl.NumberFormat("en-US")

export function formatCompact(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "0"
  return compactFormatter.format(value)
}

export function formatExact(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "0"
  return exactFormatter.format(value)
}

export function formatPercent(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return "0%"
  return `${value.toFixed(1)}%`
}

export function formatDuration(durationMs?: number | null): string {
  if (!durationMs || durationMs <= 0) return "-"
  const totalSeconds = Math.floor(durationMs / 1000)
  const minutes = Math.floor(totalSeconds / 60)
  const seconds = totalSeconds % 60
  if (minutes >= 60) {
    const hours = Math.floor(minutes / 60)
    return `${hours}h ${minutes % 60}m`
  }
  if (minutes > 0) return `${minutes}m ${seconds}s`
  return `${seconds}s`
}

export function formatDateTime(value?: string | null): string {
  if (!value) return "-"
  const parsed = new Date(value)
  if (Number.isNaN(parsed.getTime())) return value
  return parsed.toLocaleString("zh-CN", {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
}

/** "2026-07-06" → "07-06" (leaves other labels untouched, e.g. weekly buckets). */
export function shortDateLabel(label: string): string {
  const match = /^\d{4}-(\d{2}-\d{2})$/.exec(label)
  return match ? match[1] : label
}

function pad2(n: number): string {
  return String(n).padStart(2, "0")
}

/** Local date as YYYY-MM-DD (what the backend's NaiveDate query params expect). */
export function toDateString(date: Date): string {
  return `${date.getFullYear()}-${pad2(date.getMonth() + 1)}-${pad2(date.getDate())}`
}

export function todayString(): string {
  return toDateString(new Date())
}

export function addDays(dateStr: string, delta: number): string {
  const [y, m, d] = dateStr.split("-").map(Number)
  const date = new Date(y, (m ?? 1) - 1, d ?? 1)
  date.setDate(date.getDate() + delta)
  return toDateString(date)
}

/** Inclusive day count between two YYYY-MM-DD dates; ≥ 1. */
export function inclusiveDayCount(startStr: string, endStr: string): number {
  const [sy, sm, sd] = startStr.split("-").map(Number)
  const [ey, em, ed] = endStr.split("-").map(Number)
  const start = new Date(sy, (sm ?? 1) - 1, sd ?? 1)
  const end = new Date(ey, (em ?? 1) - 1, ed ?? 1)
  const diff = Math.round((end.getTime() - start.getTime()) / 86_400_000)
  return Math.max(1, diff + 1)
}
