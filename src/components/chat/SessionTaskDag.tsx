import { Check, ChevronDown, Maximize2, Minimize2, Minus, Plus, Scan, X } from "lucide-react"
import { useId, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react"
import { uiList, uiText, useUiLocale } from "@shared/i18n/ui"
import { useAppStore } from "@shared/store/appStore"
import type { TaskItem } from "@services/chat/AgentService"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"
import { layoutSessionTaskDag, taskNodeHeight, taskNodeWidth } from "@/lib/chat/sessionTaskDagLayout"

const emptyTasks: readonly TaskItem[] = []
const minZoom = 0.125
const maxZoom = 2
const zoomStep = 1.25

const taskStatus = {
  pending: { label: "session_task_dag_pending", color: "text-muted-foreground" },
  in_progress: { label: "ticket_in_progress_5026a63b", color: "text-primary" },
  completed: { label: "completed_f28461bb", color: "text-green-700 dark:text-green-400" },
  blocked: { label: "session_task_dag_blocked", color: "text-destructive" },
} as const

function TaskStatus({ status }: { status: TaskItem["status"] }) {
  const { label, color } = taskStatus[status] ?? taskStatus.pending
  const checkmark = useRef<SVGSVGElement>(null)
  const previousStatus = useRef(status)
  useLayoutEffect(() => {
    const justCompleted = status === "completed" && previousStatus.current !== "completed"
    previousStatus.current = status
    const icon = checkmark.current
    if (!justCompleted || !icon) return
    const document = icon.ownerDocument
    if (document.hidden || document.body.dataset.vdiSafe === "true" ||
      document.defaultView?.matchMedia?.("(prefers-reduced-motion: reduce)").matches) return
    const animation = icon.animate?.([
      { opacity: 0.4, transform: "scale(0.65)" },
      { opacity: 1, transform: "scale(1.18)", offset: 0.65 },
      { opacity: 1, transform: "scale(1)" },
    ], { duration: 280, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" })
    return () => animation?.cancel()
  }, [status])
  return <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium", color)}>
    <span className="inline-flex size-3 shrink-0 items-center justify-center" aria-hidden="true">
      {status === "completed" ? <Check ref={checkmark} className="size-3" strokeWidth={2.5} />
        : <span className="size-1.5 rounded-full" style={{ backgroundColor: "currentColor" }} />}
    </span>
    {uiText(label)}
  </span>
}

function TaskDagDetails({ task, items, id, onClose }: {
  task: TaskItem
  items: readonly TaskItem[]
  id: string
  onClose: () => void
}) {
  const steps = items.filter((item) => item.parent_id === task.id && item.id !== task.id)
  const names = new Map(items.map((item) => [item.id, item.description]))
  const parentName = task.parent_id && task.parent_id !== task.id ? names.get(task.parent_id) : undefined
  const prerequisites = (item: TaskItem) => item.depends_on?.length ? (
    <p className="break-words text-xs text-muted-foreground">
      {uiText("session_task_dag_prerequisites", { tasks: uiList(item.depends_on.map((key) => names.get(key) ?? key)) })}
    </p>
  ) : null
  return <section id={id} aria-label={task.description} style={{ maxHeight: "40%" }}
    className="shrink-0 space-y-2 overflow-y-auto border-t px-3 py-2">
    <div className="flex items-start gap-2">
      <h3 className="min-w-0 flex-1 break-words text-sm font-medium">{task.description}</h3>
      <TaskStatus status={task.status} />
      <GraphButton label={uiText("project_work_close_details")} onClick={onClose}><X /></GraphButton>
    </div>
    {parentName ? (
      <p className="break-words text-xs text-muted-foreground">
        {uiText("session_task_dag_parent", { task: parentName })}
      </p>
    ) : null}
    {prerequisites(task)}
    {steps.length ? <ol className="space-y-2 border-l pl-3" aria-label={uiText("session_task_dag_steps")}>
      {steps.map((step) => <li key={step.id}>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
          <span className="min-w-0 break-words">{step.description}</span>
          <TaskStatus status={step.status} />
        </div>
        {prerequisites(step)}
      </li>)}
    </ol> : null}
  </section>
}

function GraphButton({ label, onClick, disabled, children }: {
  label: string
  onClick: () => void
  disabled?: boolean
  children: ReactNode
}) {
  return <Button type="button" size="icon" variant="ghost" className="size-8 shrink-0"
    aria-label={label} title={label} disabled={disabled} onClick={onClick}>{children}</Button>
}

export function SessionTaskDag({ sessionId, expanded, onToggleExpanded }: {
  sessionId: string
  expanded?: boolean
  onToggleExpanded?: () => void
}) {
  useUiLocale()
  const items = useAppStore((state) => state.taskLists[sessionId]?.items) ?? emptyTasks
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [scale, setScale] = useState(1)
  const viewport = useRef<HTMLDivElement>(null)
  const selectedButton = useRef<HTMLButtonElement>(null)
  const scrollAfterZoom = useRef<{ left: number; top: number } | null>(null)
  const drag = useRef<{ pointerId: number; left: number; top: number } | null>(null)
  const arrowId = useId()
  const selectedArrowId = useId()
  const detailId = useId()
  const layout = useMemo(() => items.length ? layoutSessionTaskDag(items) : null, [items])
  const hasLayout = layout !== null
  const selected = items.find((item) => item.id === selectedId)
  const completed = items.filter((item) => item.status === "completed").length
  const parents = useMemo(() => new Set(items.flatMap((item) =>
    item.parent_id && item.parent_id !== item.id ? [item.parent_id] : [],
  )), [items])

  useLayoutEffect(() => {
    const element = viewport.current
    if (hasLayout && element) {
      // Keep the first row in view when a later row is wider than the panel.
      element.scrollLeft = (element.scrollWidth - element.clientWidth) / 2
    }
  }, [hasLayout])

  useLayoutEffect(() => {
    const next = scrollAfterZoom.current
    if (next) viewport.current?.scrollTo(next)
    scrollAfterZoom.current = null
  }, [scale])

  const zoom = (nextScale: number) => {
    const element = viewport.current
    if (!element || !layout || nextScale === scale) return
    const ratio = nextScale / scale
    const margin = Math.max(0, (element.clientWidth - layout.width * scale) / 2)
    const left = (element.scrollLeft + element.clientWidth / 2 - margin) * ratio - element.clientWidth / 2
    const top = (element.scrollTop + element.clientHeight / 2) * ratio - element.clientHeight / 2
    scrollAfterZoom.current = { left, top }
    setScale(nextScale)
  }

  const fit = () => {
    const element = viewport.current
    if (!element || !layout || !element.clientWidth || !element.clientHeight) return
    const nextScale = Math.min(1, element.clientWidth / layout.width, element.clientHeight / layout.height)
    element.scrollTo(0, 0)
    setScale(nextScale)
  }

  const node = (item: TaskItem, style?: CSSProperties) => (
    <button key={item.id} ref={selected?.id === item.id ? selectedButton : undefined}
      type="button" title={item.description} style={style}
      aria-expanded={selected?.id === item.id} aria-controls={selected?.id === item.id ? detailId : undefined}
      onClick={() => setSelectedId((previous) => previous === item.id ? null : item.id)}
      className={cn("flex cursor-pointer flex-col justify-center gap-1 rounded-lg border bg-card px-2.5 py-1.5 text-left shadow-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ring-inset", style ? "absolute" : "min-w-0", selected?.id === item.id && "border-primary")}>
      <span className="flex w-full items-start gap-1">
        <span className="line-clamp-2 min-w-0 flex-1 break-words text-xs font-medium leading-4">{item.description}</span>
        {parents.has(item.id) ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
      </span>
      <TaskStatus status={item.status} />
    </button>
  )

  const hasStepLines = layout?.edges.some((edge) => edge.kind === "step")
  return <section aria-label={uiText("session_task_dag_title")} className="flex min-h-0 min-w-0 flex-1 flex-col">
    {items.length || expanded ? (
      <div className="flex shrink-0 flex-wrap items-center justify-between gap-x-3 border-b px-3 py-1">
        <span className="text-xs tabular-nums text-muted-foreground" aria-live="polite">
          {items.length ? uiText("session_task_dag_progress", { completed, total: items.length }) : null}
        </span>
        <div className="flex items-center gap-0.5">
          {layout ? <>
            <GraphButton label={uiText("session_task_dag_zoom_out")} disabled={scale <= minZoom}
              onClick={() => zoom(Math.max(minZoom, scale / zoomStep))}><Minus /></GraphButton>
            <span className="w-10 text-center text-xs tabular-nums">{Math.round(scale * 100)}%</span>
            <GraphButton label={uiText("session_task_dag_zoom_in")} disabled={scale >= maxZoom}
              onClick={() => zoom(Math.min(maxZoom, Math.max(minZoom, scale * zoomStep)))}><Plus /></GraphButton>
            <GraphButton label={uiText("session_task_dag_fit")} onClick={fit}><Scan /></GraphButton>
          </> : null}
          {onToggleExpanded ? (
            <GraphButton label={uiText(expanded ? "session_task_dag_restore" : "session_task_dag_expand")}
              onClick={onToggleExpanded}>{expanded ? <Minimize2 /> : <Maximize2 />}</GraphButton>
          ) : null}
        </div>
      </div>
    ) : null}
    {hasStepLines ? (
      <div className="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-b px-3 py-2 text-xs text-muted-foreground">
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-4 border-t border-current" />
          {uiText("session_task_dag_dependency_line")}</span>
        <span className="inline-flex items-center gap-1.5"><span aria-hidden="true" className="w-4 border-t border-dashed border-current" />
          {uiText("session_task_dag_step_line")}</span>
      </div>
    ) : null}
    {layout ? <div role="region" aria-label={uiText("session_task_dag_dependencies")} tabIndex={0}
      ref={viewport}
      className="min-h-0 flex-1 cursor-grab select-none overflow-auto overscroll-contain bg-muted/30 ring-inset active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      onPointerDown={(event) => {
        if (event.pointerType === "touch" || event.button !== 0 || drag.current
          || (event.target instanceof Element && event.target.closest("button"))) return
        const element = event.currentTarget
        element.setPointerCapture(event.pointerId)
        drag.current = { pointerId: event.pointerId, left: element.scrollLeft + event.clientX, top: element.scrollTop + event.clientY }
      }}
      onPointerMove={(event) => {
        const start = drag.current
        if (start?.pointerId === event.pointerId) {
          event.currentTarget.scrollTo(start.left - event.clientX, start.top - event.clientY)
        }
      }}
      onLostPointerCapture={(event) => {
        if (drag.current?.pointerId === event.pointerId) drag.current = null
      }}>
      <div className="relative mx-auto overflow-hidden"
        style={{ width: Math.ceil(layout.width * scale), height: Math.ceil(layout.height * scale) }}>
        <div className="absolute left-0 top-0"
          style={{ width: layout.width, height: layout.height, transform: `scale(${scale})`, transformOrigin: "top left" }}>
          <svg aria-hidden="true" width={layout.width} height={layout.height}
            className="pointer-events-none absolute inset-0 text-muted-foreground">
            <defs>{[arrowId, selectedArrowId].map((id) => (
              <marker key={id} id={id} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"
                className={id === selectedArrowId ? "text-primary" : undefined}>
                <path d="M 0 0 L 8 4 L 0 8 Z" fill="currentColor" />
              </marker>
            ))}</defs>
            {layout.edges.map(({ from, to, kind, path }) => {
              const highlighted = from === selected?.id || to === selected?.id
              return <path key={JSON.stringify([from, to])} d={path}
                className={highlighted ? "text-primary" : undefined}
                fill="none" stroke="currentColor" strokeWidth={highlighted ? 2 : 1.5} strokeLinejoin="round"
                strokeDasharray={kind === "step" ? "4 3" : undefined}
                markerEnd={kind === "dependency" ? `url(#${highlighted ? selectedArrowId : arrowId})` : undefined} />
            })}
          </svg>
          {items.map((item) => {
            const { x, y } = layout.positions.get(item.id)!
            return node(item, { left: x, top: y, width: taskNodeWidth, height: taskNodeHeight })
          })}
        </div>
      </div>
    </div> : items.length ? <div className="min-h-0 flex-1 space-y-2 overflow-auto bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{uiText("session_task_dag_cycle")}</p>
      <div className="grid gap-2 sm:grid-cols-2">{items.map((item) => node(item))}</div>
    </div> : <p className="p-4 text-sm text-muted-foreground">{uiText("session_task_dag_empty")}</p>}
    {selected ? <TaskDagDetails task={selected} items={items} id={detailId} onClose={() => {
      (selectedButton.current ?? viewport.current)?.focus()
      setSelectedId(null)
    }} /> : null}
  </section>
}
