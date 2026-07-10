import { useCallback, useMemo, useRef, useState } from "react"
import type { MemoryTimelinePoint } from "@services/metrics"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { formatCompact, formatExact, shortDateLabel } from "./format"

const TOTAL_COLOR = "var(--mx-chat)"
const CREATED_COLOR = "var(--mx-fwd)"
const UPDATED_COLOR = "var(--mx-mem)"

const SERIES = [
  { key: "total_memories", label: "记忆总量", color: TOTAL_COLOR },
  { key: "created_memories", label: "新增记忆", color: CREATED_COLOR },
  { key: "updated_memories", label: "更新记忆", color: UPDATED_COLOR },
] as const

const PLOT_HEIGHT = 140
const MARGIN = { top: 8, right: 12, bottom: 20, left: 40 }
const SVG_HEIGHT = MARGIN.top + PLOT_HEIGHT + MARGIN.bottom

function useContainerWidth() {
  const observerRef = useRef<ResizeObserver | null>(null)
  const [width, setWidth] = useState(0)
  // Callback ref (not effect with [] deps): the chart container unmounts on the
  // 图表→表格 toggle, so the observer must re-attach when it remounts — an
  // effect-once observer would keep watching the detached node and report a
  // stale width after a window resize in table view.
  const ref = useCallback((el: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    observerRef.current = null
    if (!el) return
    const observer = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width
      if (typeof w === "number") setWidth(w)
    })
    observer.observe(el)
    observerRef.current = observer
    setWidth(el.clientWidth)
  }, [])
  return { ref, width }
}

/** Round up to a "clean" axis maximum: 1/2/5 × 10^k. */
function niceCeil(value: number): number {
  if (value <= 0) return 1
  const power = Math.pow(10, Math.floor(Math.log10(value)))
  for (const step of [1, 2, 5, 10]) {
    if (value <= step * power) return step * power
  }
  return 10 * power
}

function linePath(xs: number[], ys: number[]): string {
  return xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ")
}

function areaPath(xs: number[], ys: number[], baseline: number): string {
  if (xs.length === 0) return ""
  const line = linePath(xs, ys)
  const lastX = xs[xs.length - 1].toFixed(1)
  const firstX = xs[0].toFixed(1)
  return `${line} L${lastX} ${baseline.toFixed(1)} L${firstX} ${baseline.toFixed(1)} Z`
}

/**
 * Memory metrics over time: cumulative total plus created/updated per bucket.
 * Ported from legacy MemoryTrendChart (recharts LineChart) into next's
 * hand-rolled SVG line-chart idiom (see TimelineChart).
 */
export function MemoryTrendChart({ points }: { points: MemoryTimelinePoint[] }) {
  const { ref, width } = useContainerWidth()
  const [view, setView] = useState<"chart" | "table">("chart")
  const [hoverIndex, setHoverIndex] = useState<number | null>(null)

  const n = points.length
  const plotWidth = Math.max(0, width - MARGIN.left - MARGIN.right)
  const baseline = MARGIN.top + PLOT_HEIGHT

  const geometry = useMemo(() => {
    if (n === 0 || plotWidth <= 0) return null
    const rawMax = points.reduce(
      (acc, p) => Math.max(acc, p.total_memories, p.created_memories, p.updated_memories),
      0,
    )
    const yMax = niceCeil(rawMax)
    const xFor = (i: number) =>
      MARGIN.left + (n === 1 ? plotWidth / 2 : (i / (n - 1)) * plotWidth)
    const yFor = (v: number) => MARGIN.top + PLOT_HEIGHT - (v / yMax) * PLOT_HEIGHT
    const xs = points.map((_, i) => xFor(i))
    const ysBySeries = SERIES.map((series) => points.map((p) => yFor(p[series.key])))
    return { yMax, xs, ysBySeries }
  }, [points, n, plotWidth])

  const xLabelIndices = useMemo(() => {
    if (n === 0) return []
    if (n <= 3) return points.map((_, i) => i)
    return [...new Set([0, Math.floor((n - 1) / 2), n - 1])]
  }, [n, points])

  const moveHover = (clientX: number, rect: DOMRect) => {
    if (!geometry || n === 0) return
    const x = clientX - rect.left
    let nearest = 0
    let best = Number.POSITIVE_INFINITY
    geometry.xs.forEach((px, i) => {
      const d = Math.abs(px - x)
      if (d < best) {
        best = d
        nearest = i
      }
    })
    setHoverIndex(nearest)
  }

  if (n === 0) {
    return <p className="text-xs text-muted-foreground">暂无记忆趋势数据</p>
  }

  const hovered = hoverIndex != null ? points[hoverIndex] : null
  const hoverX = hoverIndex != null && geometry ? geometry.xs[hoverIndex] : null
  const tooltipOnLeft = hoverX != null && width > 0 && hoverX > width * 0.55

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        {/* Legend: 3 series → always present, line keys + text tokens */}
        <div className="flex items-center gap-3 text-xs text-muted-foreground">
          {SERIES.map((series) => (
            <span key={series.key} className="flex items-center gap-1.5">
              <span className="h-0.5 w-3 rounded-full" style={{ background: series.color }} />
              {series.label}
            </span>
          ))}
        </div>
        <div className="flex gap-1">
          {(
            [
              ["chart", "图表"],
              ["table", "表格"],
            ] as const
          ).map(([key, label]) => (
            <Button
              key={key}
              size="sm"
              variant={view === key ? "secondary" : "ghost"}
              className="h-6 px-2 text-xs"
              onClick={() => setView(key)}
            >
              {label}
            </Button>
          ))}
        </div>
      </div>

      {view === "table" ? (
        <div className="max-h-56 overflow-auto rounded-md border">
          <table className="w-full min-w-[420px] text-xs">
            <thead className="sticky top-0 bg-background text-muted-foreground">
              <tr className="[&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
                <th className="text-left">日期</th>
                <th className="text-right">记忆总量</th>
                <th className="text-right">新增记忆</th>
                <th className="text-right">更新记忆</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.label} className="border-t [&>td]:px-2 [&>td]:py-1">
                  <td>{p.label}</td>
                  <td className="text-right tabular-nums">{formatExact(p.total_memories)}</td>
                  <td className="text-right tabular-nums">{formatExact(p.created_memories)}</td>
                  <td className="text-right tabular-nums">{formatExact(p.updated_memories)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div ref={ref} className="relative w-full">
          {width > 0 && geometry ? (
            <>
              <svg
                width={width}
                height={SVG_HEIGHT}
                role="img"
                aria-label="记忆趋势图"
                tabIndex={0}
                className="block outline-none focus-visible:ring-1 focus-visible:ring-ring"
                onPointerMove={(e) => moveHover(e.clientX, e.currentTarget.getBoundingClientRect())}
                onPointerLeave={() => setHoverIndex(null)}
                onFocus={() => setHoverIndex((i) => i ?? n - 1)}
                onBlur={() => setHoverIndex(null)}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
                    e.preventDefault()
                    const delta = e.key === "ArrowLeft" ? -1 : 1
                    setHoverIndex((i) => Math.min(n - 1, Math.max(0, (i ?? n - 1) + delta)))
                  }
                }}
              >
                {/* hairline gridlines + y ticks (0 / half / max) */}
                {[0, 0.5, 1].map((f) => {
                  const y = MARGIN.top + PLOT_HEIGHT - f * PLOT_HEIGHT
                  return (
                    <g key={f}>
                      <line
                        x1={MARGIN.left}
                        x2={width - MARGIN.right}
                        y1={y}
                        y2={y}
                        stroke="var(--border)"
                        strokeWidth={1}
                      />
                      <text
                        x={MARGIN.left - 6}
                        y={y + 3}
                        textAnchor="end"
                        fontSize={10}
                        className="fill-muted-foreground tabular-nums"
                      >
                        {formatCompact(f * geometry.yMax)}
                      </text>
                    </g>
                  )
                })}

                {/* area wash (~10% opacity) for the headline total series only —
                    three overlapping washes would muddy the plot */}
                <path
                  d={areaPath(geometry.xs, geometry.ysBySeries[0], baseline)}
                  fill={TOTAL_COLOR}
                  fillOpacity={0.1}
                />

                {/* 2px lines, round join/cap */}
                {n > 1
                  ? SERIES.map((series, s) => (
                      <path
                        key={series.key}
                        d={linePath(geometry.xs, geometry.ysBySeries[s])}
                        fill="none"
                        stroke={series.color}
                        strokeWidth={2}
                        strokeLinejoin="round"
                        strokeLinecap="round"
                      />
                    ))
                  : null}

                {/* end markers with a 2px surface ring */}
                {SERIES.map((series, s) => (
                  <circle
                    key={series.key}
                    cx={geometry.xs[n - 1]}
                    cy={geometry.ysBySeries[s][n - 1]}
                    r={4}
                    fill={series.color}
                    stroke="var(--background)"
                    strokeWidth={2}
                  />
                ))}

                {/* crosshair + hover markers */}
                {hoverX != null && hoverIndex != null ? (
                  <g>
                    <line
                      x1={hoverX}
                      x2={hoverX}
                      y1={MARGIN.top}
                      y2={baseline}
                      stroke="var(--border)"
                      strokeWidth={1}
                    />
                    {SERIES.map((series, s) => (
                      <circle
                        key={series.key}
                        cx={hoverX}
                        cy={geometry.ysBySeries[s][hoverIndex]}
                        r={3.5}
                        fill={series.color}
                        stroke="var(--background)"
                        strokeWidth={2}
                      />
                    ))}
                  </g>
                ) : null}

                {/* baseline + x labels */}
                <line
                  x1={MARGIN.left}
                  x2={width - MARGIN.right}
                  y1={baseline}
                  y2={baseline}
                  stroke="var(--border)"
                  strokeWidth={1}
                />
                {xLabelIndices.map((i) => (
                  <text
                    key={i}
                    x={geometry.xs[i]}
                    y={baseline + 14}
                    textAnchor={i === 0 ? "start" : i === n - 1 ? "end" : "middle"}
                    fontSize={10}
                    className="fill-muted-foreground"
                  >
                    {shortDateLabel(points[i].label)}
                  </text>
                ))}
              </svg>

              {/* tooltip: values lead, labels follow; line keys, not boxes */}
              {hovered && hoverX != null ? (
                <div
                  className={cn(
                    "pointer-events-none absolute top-1 z-10 rounded-md border bg-popover px-2.5 py-2 text-xs shadow-md",
                  )}
                  style={
                    tooltipOnLeft
                      ? { left: hoverX - 10, transform: "translateX(-100%)" }
                      : { left: hoverX + 10 }
                  }
                >
                  <div className="mb-1 font-medium">{hovered.label}</div>
                  {SERIES.map((series) => (
                    <div key={series.key} className="flex items-center gap-1.5">
                      <span
                        className="h-0.5 w-3 shrink-0 rounded-full"
                        style={{ background: series.color }}
                      />
                      <span className="font-semibold tabular-nums">
                        {formatExact(hovered[series.key])}
                      </span>
                      <span className="text-muted-foreground">{series.label}</span>
                    </div>
                  ))}
                </div>
              ) : null}
            </>
          ) : (
            <div style={{ height: SVG_HEIGHT }} />
          )}
        </div>
      )}
    </div>
  )
}
