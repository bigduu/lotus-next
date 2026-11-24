import { createMemo, createSignal, For, onSettled, Show } from "solid-js"
import type { MemoryTimelinePoint, UnifiedTimelinePoint } from "@services/metrics"
import { shortDateLabel } from "@/lib/settings/metricsFormat"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { createMetricFormatters } from "./format"

type Column = { label: string; color?: string; area?: boolean }
type Point = { label: string; values: number[] }
type View = "chart" | "table"

const PLOT_HEIGHT = 140
const MARGIN = { top: 8, right: 12, bottom: 20, left: 40 }
const BASELINE = MARGIN.top + PLOT_HEIGHT
const HEIGHT = BASELINE + MARGIN.bottom
const CHAT_COLOR = "var(--mx-chat)"
const FORWARD_COLOR = "var(--mx-fwd)"
const MEMORY_COLOR = "var(--mx-mem)"

function axisMax(value: number): number {
  if (value <= 0) return 1
  const power = 10 ** Math.floor(Math.log10(value))
  return ([1, 2, 5, 10].find((step) => value <= step * power) ?? 10) * power
}

function linePath(xs: number[], ys: number[]): string {
  return xs.map((x, i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)} ${ys[i].toFixed(1)}`).join(" ")
}

function areaPath(xs: number[], line: string): string {
  return `${line} L${xs[xs.length - 1].toFixed(1)} ${BASELINE} L${xs[0].toFixed(1)} ${BASELINE} Z`
}

interface PlotProps {
  points: Point[]
  columns: Column[]
  label: string
  footer?: (point: Point) => string
}

function TimelinePlot(props: PlotProps) {
  const { compact, exact } = createMetricFormatters()
  let frame: HTMLDivElement | undefined
  const [width, setWidth] = createSignal(0)
  const [active, setActive] = createSignal<number | null>(null)
  const n = () => props.points.length
  const series = createMemo(() => props.columns.filter((column) => column.color))
  const labelIndices = createMemo(() => n() <= 3
    ? props.points.map((_, i) => i)
    : [0, Math.floor((n() - 1) / 2), n() - 1],
  )

  onSettled(() => {
    if (!frame) return
    setWidth(frame.clientWidth)
    const observer = new ResizeObserver(([entry]) => {
      if (entry) setWidth(entry.contentRect.width)
    })
    observer.observe(frame)
    return () => observer.disconnect()
  })

  const plot = createMemo(() => {
    const span = width() - MARGIN.left - MARGIN.right
    if (span <= 0 || n() === 0) return null
    const count = series().length
    const max = axisMax(props.points.reduce((value, point) => Math.max(value, ...point.values.slice(0, count)), 0))
    const xs = props.points.map((_, i) => MARGIN.left + (n() === 1 ? span / 2 : i * span / (n() - 1)))
    const ys = series().map((_, i) => props.points.map((p) => BASELINE - PLOT_HEIGHT * p.values[i] / max))
    return { max, xs, ys, paths: ys.map((line) => linePath(xs, line)), span }
  })
  const inspected = createMemo(() => {
    const cursor = active()
    const geometry = plot()
    if (cursor === null || !geometry) return null
    const index = Math.min(cursor, n() - 1)
    return { index, point: props.points[index], x: geometry.xs[index] }
  })

  return (
    <div class="relative min-w-0" ref={(element) => { frame = element }}>
      <Show when={plot()} fallback={<div style={{ height: `${HEIGHT}px` }} />}>{(geometry) => (
        <svg
          width={width()}
          height={HEIGHT}
          role="img"
          aria-label={props.label}
          tabindex={0}
          class="block outline-none focus-visible:ring-1 focus-visible:ring-ring"
          onPointerMove={(event) => {
            const x = event.clientX - event.currentTarget.getBoundingClientRect().left - MARGIN.left
            const index = Math.round(x * (n() - 1) / geometry().span)
            setActive(Math.min(n() - 1, Math.max(0, index)))
          }}
          onPointerLeave={() => setActive(null)}
          onFocus={() => setActive((index) => index ?? n() - 1)}
          onBlur={() => setActive(null)}
          onKeyDown={(event) => {
            if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
              event.preventDefault()
              const step = event.key === "ArrowLeft" ? -1 : 1
              setActive((index) => Math.min(n() - 1, Math.max(0, (index ?? n() - 1) + step)))
            }
          }}
        >
          <For each={[0, 0.5, 1]}>{(fraction) => {
            const y = BASELINE - fraction * PLOT_HEIGHT
            return (
              <g>
                <line x1={MARGIN.left} x2={width() - MARGIN.right} y1={y} y2={y} stroke="var(--border)" stroke-width={1} />
                <text x={MARGIN.left - 6} y={y + 3} text-anchor="end" font-size="10" class="fill-muted-foreground tabular-nums">
                  {compact(fraction * geometry().max)}
                </text>
              </g>
            )
          }}</For>
          <For each={series()}>{(column, index) => (
            <Show when={column.area}>
              <path d={areaPath(geometry().xs, geometry().paths[index()])} fill={column.color} fill-opacity={0.1} />
            </Show>
          )}</For>
          <For each={series()}>{(column, index) => (
            <>
              <Show when={n() > 1}>
                <path d={geometry().paths[index()]} fill="none" stroke={column.color} stroke-width={2} stroke-linejoin="round" stroke-linecap="round" />
              </Show>
              <circle cx={geometry().xs[n() - 1]} cy={geometry().ys[index()][n() - 1]} r={4} fill={column.color} stroke="var(--background)" stroke-width={2} />
            </>
          )}</For>
          <Show when={inspected()}>{(target) => (
            <g>
              <line x1={target().x} x2={target().x} y1={MARGIN.top} y2={BASELINE} stroke="var(--border)" stroke-width={1} />
              <For each={series()}>{(column, index) => (
                <circle cx={target().x} cy={geometry().ys[index()][target().index]} r={3.5} fill={column.color} stroke="var(--background)" stroke-width={2} />
              )}</For>
            </g>
          )}</Show>
          <For each={labelIndices()}>{(i) => (
            <text
              x={geometry().xs[i]}
              y={BASELINE + 14}
              text-anchor={i === 0 ? "start" : i === n() - 1 ? "end" : "middle"}
              font-size="10"
              class="fill-muted-foreground"
            >
              {shortDateLabel(props.points[i].label)}
            </text>
          )}</For>
        </svg>
      )}</Show>
      <Show when={inspected()}>{(target) => {
        const onLeft = () => target().x > width() * 0.55
        return (
          <div
            class="pointer-events-none absolute top-1 z-10 rounded-md border bg-popover px-2.5 py-2 text-xs shadow-md"
            style={{
              left: `${target().x + (onLeft() ? -10 : 10)}px`,
              transform: onLeft() ? "translateX(-100%)" : undefined,
            }}
          >
            <div class="mb-1 font-medium">{target().point.label}</div>
            <For each={series()}>{(column, index) => (
              <div class="flex items-center gap-1.5">
                <span class="h-0.5 w-3 shrink-0 rounded-full" style={{ background: column.color }} />
                <span class="font-semibold tabular-nums">{exact(target().point.values[index()])}</span>
                <span class="text-muted-foreground">{column.label}</span>
              </div>
            )}</For>
            <Show when={props.footer}>
              <div class="mt-1 text-muted-foreground">{props.footer?.(target().point)}</div>
            </Show>
          </div>
        )
      }}</Show>
    </div>
  )
}

function MetricTimeline(props: PlotProps & { emptyText: string }) {
  const uiText = createUiText()
  const { exact } = createMetricFormatters()
  const [view, setView] = createSignal<View>("chart")
  return (
    <Show when={props.points.length} fallback={<p class="text-xs text-muted-foreground">{props.emptyText}</p>}>
      <div class="min-w-0 space-y-2">
        <div class="flex flex-wrap items-center justify-between gap-2">
          <div class="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
            <For each={props.columns.filter((column) => column.color)}>{(column) => (
              <span class="flex items-center gap-1.5">
                <span class="h-0.5 w-3 rounded-full" style={{ background: column.color }} />
                {column.label}
              </span>
            )}</For>
          </div>
          <div class="flex gap-1">
            <For each={[["chart", "chart_8cb443ab"], ["table", "table_22d9e7c5"]] as const}>{([key, label]) => (
              <Button
                type="button"
                size="sm"
                variant={view() === key ? "secondary" : "ghost"}
                aria-pressed={view() === key ? "true" : "false"}
                class="h-6 px-2 text-xs"
                onClick={() => setView(key)}
              >
                {uiText(label)}
              </Button>
            )}</For>
          </div>
        </div>
        <Show when={view() === "chart"} fallback={
          <div class="max-h-56 overflow-auto rounded-md border">
            <table class="w-full min-w-[420px] text-xs">
              <thead class="sticky top-0 bg-background text-muted-foreground">
                <tr class="[&>th]:px-2 [&>th]:py-1.5 [&>th]:font-medium">
                  <th class="text-left">{uiText("date_70d0c1b3")}</th>
                  <For each={props.columns}>{(column) => <th class="text-right">{column.label}</th>}</For>
                </tr>
              </thead>
              <tbody>
                <For each={props.points}>{(point) => (
                  <tr class="border-t [&>td]:px-2 [&>td]:py-1.5">
                    <td class="whitespace-nowrap">{point.label}</td>
                    <For each={point.values}>{(value) => <td class="text-right tabular-nums">{exact(value)}</td>}</For>
                  </tr>
                )}</For>
              </tbody>
            </table>
          </div>
        }>
          <TimelinePlot points={props.points} columns={props.columns} label={props.label} footer={props.footer} />
        </Show>
      </div>
    </Show>
  )
}

export function TokenTrend(props: { points: UnifiedTimelinePoint[] }) {
  const uiText = createUiText()
  const { exact } = createMetricFormatters()
  const columns = createMemo(() => [
    { label: uiText("session_tokens_17dc5fdb"), color: CHAT_COLOR, area: true },
    { label: "Forward Tokens", color: FORWARD_COLOR, area: true },
    { label: uiText("sessions_578c55a3") },
    { label: uiText("forward_requests_8afb028b") },
  ])
  const points = createMemo(() => props.points.map((p) => ({
    label: p.date,
    values: [p.chat_tokens, p.forward_tokens, p.chat_sessions, p.forward_requests],
  })))
  return (
    <MetricTimeline
      points={points()}
      columns={columns()}
      label={uiText("token_trend_chart_5ce8cd83")}
      emptyText={uiText("no_data_yet_497c8569")}
      footer={(point) => `${exact(point.values[2])} ${uiText("sessions_d2a38975")} ${exact(point.values[3])} ${uiText("forward_requests_4ec8d920")}`}
    />
  )
}

export function MemoryTrend(props: { points: MemoryTimelinePoint[] }) {
  const uiText = createUiText()
  const columns = createMemo(() => [
    { label: uiText("total_memories_cfd0f732"), color: CHAT_COLOR, area: true },
    { label: uiText("created_memories_ec5500c1"), color: FORWARD_COLOR },
    { label: uiText("updated_memories_2f282ad5"), color: MEMORY_COLOR },
  ])
  const points = createMemo(() => props.points.map((p) => ({
    label: p.label,
    values: [p.total_memories, p.created_memories, p.updated_memories],
  })))
  return (
    <MetricTimeline
      points={points()}
      columns={columns()}
      label={uiText("memory_trend_chart_f317b7a3")}
      emptyText={uiText("no_memory_trend_available_bae93929")}
    />
  )
}
