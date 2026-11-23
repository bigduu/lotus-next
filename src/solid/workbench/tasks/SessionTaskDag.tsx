import { Check, ChevronDown, Maximize2, Minimize2, Minus, Plus, Scan, X } from "@lucide/solid"
import { createEffect, createMemo, createSignal, createUniqueId, For, Show } from "solid-js"
import type { JSX } from "@solidjs/web"
import { uiList } from "@shared/i18n/text"
import type { TaskItem } from "@services/chat/AgentService"
import { layoutSessionTaskDag, taskNodeHeight, taskNodeWidth } from "@/components/chat/sessionTaskDagLayout"
import { cn } from "@/lib/utils"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { selectSessionTasks } from "./createSessionTaskDag"

const MIN_ZOOM = 0.125
const MAX_ZOOM = 2
const ZOOM_STEP = 1.25

const STATUS_STYLE = {
  pending: { label: "session_task_dag_pending", color: "text-muted-foreground" },
  in_progress: { label: "ticket_in_progress_5026a63b", color: "text-primary" },
  completed: { label: "completed_f28461bb", color: "text-green-700 dark:text-green-400" },
  blocked: { label: "session_task_dag_blocked", color: "text-destructive" },
} as const

function TaskStatus(props: { status: TaskItem["status"] }) {
  const text = createUiText()
  const current = () => STATUS_STYLE[props.status] ?? STATUS_STYLE.pending
  let checkmark: SVGSVGElement | undefined
  createEffect(() => props.status, (status, previous) => {
    const icon = checkmark
    if (previous === undefined || previous === "completed" || status !== "completed" || !icon) return
    const document = icon.ownerDocument
    if (document.hidden || document.body.dataset.vdiSafe === "true" ||
      document.defaultView?.matchMedia("(prefers-reduced-motion: reduce)").matches) return
    const animation = icon.animate?.([
      { opacity: 0.4, transform: "scale(0.65)" },
      { opacity: 1, transform: "scale(1.18)", offset: 0.65 },
      { opacity: 1, transform: "scale(1)" },
    ], { duration: 280, easing: "cubic-bezier(0.2, 0.8, 0.2, 1)" })
    return () => animation?.cancel()
  })
  return (
    <span class={cn("inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium", current().color)}>
      <span class="inline-flex size-3 shrink-0 items-center justify-center" aria-hidden="true">
        <Show when={props.status === "completed"}
          fallback={<span class="size-1.5 rounded-full" style={{ "background-color": "currentColor" }} />}>
          <Check ref={(element) => { checkmark = element }} class="size-3" strokeWidth={2.5} />
        </Show>
      </span>
      {text(current().label)}
    </span>
  )
}

function GraphButton(props: { label: string; onClick: () => void; disabled?: boolean; children: JSX.Element }) {
  return (
    <Button type="button" size="icon" variant="ghost" class="size-8 shrink-0"
      aria-label={props.label} title={props.label} disabled={props.disabled}
      onClick={() => props.onClick()}>{props.children}</Button>
  )
}

function TaskDagDetails(props: { task: TaskItem; items: readonly TaskItem[]; id: string; onClose: () => void }) {
  const text = createUiText()
  const names = createMemo(() => new Map(props.items.map((item) => [item.id, item.description])))
  const steps = createMemo(() => props.items.filter((item) => item.parent_id === props.task.id && item.id !== props.task.id))
  const parentName = createMemo(() => {
    const parent = props.task.parent_id
    return parent && parent !== props.task.id ? names().get(parent) : undefined
  })
  const prerequisites = (item: TaskItem) => (
    <Show when={item.depends_on?.length}>
      <p class="break-words text-xs text-muted-foreground">
        {text("session_task_dag_prerequisites", { tasks: uiList((item.depends_on ?? []).map((key) => names().get(key) ?? key)) })}
      </p>
    </Show>
  )
  return (
    <section id={props.id} aria-label={props.task.description} style={{ "max-height": "40%" }}
      class="shrink-0 space-y-2 overflow-y-auto border-t px-3 py-2">
      <div class="flex items-start gap-2">
        <h3 class="min-w-0 flex-1 break-words text-sm font-medium">{props.task.description}</h3>
        <TaskStatus status={props.task.status} />
        <GraphButton label={text("project_work_close_details")} onClick={props.onClose}><X /></GraphButton>
      </div>
      <Show when={parentName()}>
        <p class="break-words text-xs text-muted-foreground">{text("session_task_dag_parent", { task: parentName() })}</p>
      </Show>
      {prerequisites(props.task)}
      <Show when={steps().length}>
        <ol class="space-y-2 border-l pl-3" aria-label={text("session_task_dag_steps")}>
          <For each={steps()} keyed={(task) => task.id}>{(step) => (
            <li>
              <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-xs">
                <span class="min-w-0 break-words">{step().description}</span>
                <TaskStatus status={step().status} />
              </div>
              {prerequisites(step())}
            </li>
          )}</For>
        </ol>
      </Show>
    </section>
  )
}

function TaskNode(props: {
  task: TaskItem
  selected: boolean
  hasChildren: boolean
  detailId: string
  style?: JSX.CSSProperties
  toggle: (element: HTMLButtonElement) => void
}) {
  return (
    <button type="button" title={props.task.description} style={props.style} data-task-id={props.task.id}
      aria-expanded={props.selected ? "true" : "false"}
      aria-controls={props.selected ? props.detailId : undefined}
      onClick={(event) => props.toggle(event.currentTarget)}
      class={cn("flex cursor-pointer flex-col justify-center gap-1 rounded-lg border bg-card px-2.5 py-1.5 text-left shadow-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ring-inset",
        props.style ? "absolute" : "min-w-0", props.selected && "border-primary")}>
      <span class="flex w-full items-start gap-1">
        <span class="line-clamp-2 min-w-0 flex-1 break-words text-xs font-medium leading-4">{props.task.description}</span>
        <Show when={props.hasChildren}><ChevronDown class="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /></Show>
      </span>
      <TaskStatus status={props.task.status} />
    </button>
  )
}

export interface SessionTaskDagProps {
  sessionId: string
  expanded?: boolean
  onToggleExpanded?: () => void
}

export function SessionTaskDag(props: SessionTaskDagProps) {
  const text = createUiText()
  const items = selectSessionTasks(() => props.sessionId)
  const [selectedId, setSelectedId] = createSignal<string | null>(null)
  const [scale, setScale] = createSignal(1)
  let host: HTMLElement | undefined
  let viewport: HTMLDivElement | undefined
  let selectedButton: HTMLButtonElement | undefined
  let scrollAfterZoom: { left: number; top: number } | null = null
  let drag: { pointerId: number; left: number; top: number } | null = null
  const arrowId = createUniqueId()
  const selectedArrowId = createUniqueId()
  const detailId = createUniqueId()
  const layout = createMemo(() => items().length ? layoutSessionTaskDag(items()) : null)
  const hasLayout = createMemo(() => layout() !== null)
  const selected = createMemo(() => items().find((item) => item.id === selectedId()))
  const completed = createMemo(() => items().filter((item) => item.status === "completed").length)
  const parents = createMemo(() => new Set(items().flatMap((item) =>
    item.parent_id && item.parent_id !== item.id ? [item.parent_id] : [],
  )))
  const hasStepLines = createMemo(() => layout()?.edges.some((edge) => edge.kind === "step"))

  createEffect(() => props.sessionId, () => {
    selectedButton = undefined
    scrollAfterZoom = null
    drag = null
    setSelectedId(null)
    setScale(1)
    if (viewport) {
      viewport.scrollTop = 0
      viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2
    }
  })
  createEffect(hasLayout, (ready) => {
    if (ready && viewport) viewport.scrollLeft = (viewport.scrollWidth - viewport.clientWidth) / 2
    if (!ready) drag = null
  })
  createEffect(scale, () => {
    if (scrollAfterZoom) viewport?.scrollTo(scrollAfterZoom)
    scrollAfterZoom = null
  })

  const zoom = (next: number) => {
    const graph = layout()
    const element = viewport
    const previous = scale()
    if (!element || !graph || next === previous) return
    const ratio = next / previous
    const margin = Math.max(0, (element.clientWidth - graph.width * previous) / 2)
    scrollAfterZoom = {
      left: (element.scrollLeft + element.clientWidth / 2 - margin) * ratio - element.clientWidth / 2,
      top: (element.scrollTop + element.clientHeight / 2) * ratio - element.clientHeight / 2,
    }
    setScale(next)
  }
  const fit = () => {
    const graph = layout()
    const element = viewport
    if (!element || !graph || !element.clientWidth || !element.clientHeight) return
    element.scrollTo(0, 0)
    setScale(Math.min(1, element.clientWidth / graph.width, element.clientHeight / graph.height))
  }
  const toggle = (task: TaskItem, element: HTMLButtonElement) => {
    const opening = selectedId() !== task.id
    selectedButton = opening ? element : undefined
    setSelectedId(opening ? task.id : null)
  }
  const close = () => {
    const restored = selectedButton?.isConnected ? selectedButton :
      Array.from(host?.querySelectorAll<HTMLButtonElement>("[data-task-id]") ?? [])
        .find((node) => node.dataset.taskId === selectedId())
    const fallback = viewport?.isConnected ? viewport : undefined
    ;(restored ?? fallback)?.focus()
    selectedButton = undefined
    setSelectedId(null)
  }

  return (
    <section ref={(element) => { host = element }} aria-label={text("session_task_dag_title")} class="flex min-h-0 min-w-0 flex-1 flex-col">
      <Show when={items().length || props.expanded}>
        <div class="flex shrink-0 flex-wrap items-center justify-between gap-x-3 border-b px-3 py-1">
          <span class="text-xs tabular-nums text-muted-foreground" aria-live="polite">
            {items().length ? text("session_task_dag_progress", { completed: completed(), total: items().length }) : null}
          </span>
          <div class="flex items-center gap-0.5">
            <Show when={hasLayout()}>
              <GraphButton label={text("session_task_dag_zoom_out")} disabled={scale() <= MIN_ZOOM}
                onClick={() => zoom(Math.max(MIN_ZOOM, scale() / ZOOM_STEP))}><Minus /></GraphButton>
              <span class="w-10 text-center text-xs tabular-nums">{Math.round(scale() * 100)}%</span>
              <GraphButton label={text("session_task_dag_zoom_in")} disabled={scale() >= MAX_ZOOM}
                onClick={() => zoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, scale() * ZOOM_STEP)))}><Plus /></GraphButton>
              <GraphButton label={text("session_task_dag_fit")} onClick={fit}><Scan /></GraphButton>
            </Show>
            <Show when={props.onToggleExpanded}>
              <GraphButton label={text(props.expanded ? "session_task_dag_restore" : "session_task_dag_expand")}
                onClick={() => props.onToggleExpanded?.()}>{props.expanded ? <Minimize2 /> : <Maximize2 />}</GraphButton>
            </Show>
          </div>
        </div>
      </Show>
      <Show when={hasStepLines()}>
        <div class="flex shrink-0 flex-wrap gap-x-4 gap-y-1 border-b px-3 py-2 text-xs text-muted-foreground">
          <span class="inline-flex items-center gap-1.5"><span aria-hidden="true" class="w-4 border-t border-current" />
            {text("session_task_dag_dependency_line")}</span>
          <span class="inline-flex items-center gap-1.5"><span aria-hidden="true" class="w-4 border-t border-dashed border-current" />
            {text("session_task_dag_step_line")}</span>
        </div>
      </Show>
      <Show when={layout()} fallback={
        <Show when={items().length} fallback={<p class="p-4 text-sm text-muted-foreground">{text("session_task_dag_empty")}</p>}>
          <div class="min-h-0 flex-1 space-y-2 overflow-auto bg-muted/30 p-3">
            <p class="text-xs text-muted-foreground">{text("session_task_dag_cycle")}</p>
            <div class="grid gap-2 sm:grid-cols-2">
              <For each={items()} keyed={(task) => task.id}>{(task) => (
                <TaskNode task={task()} selected={selected()?.id === task().id} hasChildren={parents().has(task().id)}
                  detailId={detailId} toggle={(element) => toggle(task(), element)} />
              )}</For>
            </div>
          </div>
        </Show>
      }>
        {(graph) => (
          <div role="region" aria-label={text("session_task_dag_dependencies")} tabindex={0}
            ref={(element) => { viewport = element }}
            class="min-h-0 flex-1 cursor-grab select-none overflow-auto overscroll-contain bg-muted/30 ring-inset active:cursor-grabbing focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
            onPointerDown={(event) => {
              if (event.pointerType === "touch" || event.button !== 0 || drag ||
                event.target instanceof Element && event.target.closest("button")) return
              const element = event.currentTarget
              element.setPointerCapture(event.pointerId)
              drag = { pointerId: event.pointerId, left: element.scrollLeft + event.clientX, top: element.scrollTop + event.clientY }
            }}
            onPointerMove={(event) => {
              if (drag?.pointerId === event.pointerId) event.currentTarget.scrollTo(drag.left - event.clientX, drag.top - event.clientY)
            }}
            onLostPointerCapture={(event) => {
              if (drag?.pointerId === event.pointerId) drag = null
            }}>
            <div class="relative mx-auto overflow-hidden"
              style={{ width: `${Math.ceil(graph().width * scale())}px`, height: `${Math.ceil(graph().height * scale())}px` }}>
              <div class="absolute left-0 top-0" style={{
                width: `${graph().width}px`, height: `${graph().height}px`, transform: `scale(${scale()})`, "transform-origin": "top left",
              }}>
                <svg aria-hidden="true" width={graph().width} height={graph().height}
                  class="pointer-events-none absolute inset-0 text-muted-foreground">
                  <defs>
                    <For each={[arrowId, selectedArrowId]}>{(id) => (
                      <marker id={id} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto"
                        class={id === selectedArrowId ? "text-primary" : undefined}>
                        <path d="M 0 0 L 8 4 L 0 8 Z" fill="currentColor" />
                      </marker>
                    )}</For>
                  </defs>
                  <For each={graph().edges} keyed={(edge) => JSON.stringify([edge.from, edge.to, edge.kind])}>{(edge) => {
                    const highlighted = () => edge().from === selected()?.id || edge().to === selected()?.id
                    return (
                      <path d={edge().path} class={highlighted() ? "text-primary" : undefined}
                        fill="none" stroke="currentColor" stroke-width={highlighted() ? 2 : 1.5} stroke-linejoin="round"
                        stroke-dasharray={edge().kind === "step" ? "4 3" : undefined}
                        marker-end={edge().kind === "dependency" ? `url(#${highlighted() ? selectedArrowId : arrowId})` : undefined} />
                    )
                  }}</For>
                </svg>
                <For each={items()} keyed={(item) => item.id}>{(item) => {
                  const position = () => graph().positions.get(item().id)
                  return (
                    <TaskNode task={item()} selected={selected()?.id === item().id} hasChildren={parents().has(item().id)}
                      detailId={detailId} toggle={(element) => toggle(item(), element)} style={{
                        left: `${position()?.x ?? 0}px`, top: `${position()?.y ?? 0}px`,
                        width: `${taskNodeWidth}px`, height: `${taskNodeHeight}px`,
                      }} />
                  )
                }}</For>
              </div>
            </div>
          </div>
        )}
      </Show>
      <Show when={selected()}>{(task) => <TaskDagDetails task={task()} items={items()} id={detailId} onClose={close} />}</Show>
    </section>
  )
}
