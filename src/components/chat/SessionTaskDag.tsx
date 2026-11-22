import { ChevronDown, Workflow } from "lucide-react"
import { useEffect, useId, useMemo, useRef, useState, type CSSProperties } from "react"
import { uiList, uiText } from "@shared/i18n/ui"
import { useAppStore } from "@shared/store/appStore"
import type { TaskItem } from "@services/chat/AgentService"
import { observeSessionTaskList } from "@services/chat/accountFeed"
import { cn } from "@/lib/utils"
import { layoutSessionTaskDag, taskNodeHeight, taskNodeWidth } from "./sessionTaskDagLayout"

const taskStatus = {
  pending: { label: "session_task_dag_pending", color: "text-muted-foreground" },
  in_progress: { label: "ticket_in_progress_5026a63b", color: "text-primary" },
  completed: { label: "completed_f28461bb", color: "text-green-700 dark:text-green-400" },
  blocked: { label: "session_task_dag_blocked", color: "text-destructive" },
} as const

function TaskStatus({ status }: { status: TaskItem["status"] }) {
  const { label, color } = taskStatus[status] ?? taskStatus.pending
  return <span className={cn("inline-flex shrink-0 items-center gap-1.5 text-[11px] font-medium", color)}>
    <span className="size-1.5 rounded-full" style={{ backgroundColor: "currentColor" }} aria-hidden="true" />
    {uiText(label)}
  </span>
}

function TaskDagDetails({ task, items, id }: { task: TaskItem; items: readonly TaskItem[]; id: string }) {
  const steps = items.filter((item) => item.parent_id === task.id && item.id !== task.id)
  const names = new Map(items.map((item) => [item.id, item.description]))
  const prerequisites = (item: TaskItem) => item.depends_on?.length ? (
    <p className="break-words text-xs text-muted-foreground">
      {uiText("session_task_dag_prerequisites", { tasks: uiList(item.depends_on.map((key) => names.get(key) ?? key)) })}
    </p>
  ) : null
  return <section id={id} className="space-y-2 border-t px-3 py-2.5" aria-label={task.description}>
    <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
      <h3 className="min-w-0 break-words text-sm font-medium">{task.description}</h3>
      <TaskStatus status={task.status} />
    </div>
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

function TaskDagGraph({ items }: { items: readonly TaskItem[] }) {
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const arrowId = useId()
  const detailId = useId()
  const layout = useMemo(() => layoutSessionTaskDag(items), [items])
  const selected = items.find((item) => item.id === selectedId)
  const parents = useMemo(() => new Set(items.flatMap((item) =>
    item.parent_id && item.parent_id !== item.id ? [item.parent_id] : [],
  )), [items])

  const node = (item: TaskItem, style?: CSSProperties) => (
    <button key={item.id} type="button" title={item.description} style={style}
      aria-expanded={selected?.id === item.id} aria-controls={selected?.id === item.id ? detailId : undefined}
      onClick={() => setSelectedId((previous) => previous === item.id ? null : item.id)}
      className={cn("flex flex-col justify-center gap-1 rounded-lg border bg-card px-2.5 py-1.5 text-left shadow-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ring-inset", style ? "absolute" : "min-w-0", selected?.id === item.id && "border-primary")}>
      <span className="flex w-full items-start gap-1">
        <span className="line-clamp-2 min-w-0 flex-1 break-words text-xs font-medium leading-4">{item.description}</span>
        {parents.has(item.id) ? <ChevronDown className="size-3.5 shrink-0 text-muted-foreground" aria-hidden="true" /> : null}
      </span>
      <TaskStatus status={item.status} />
    </button>
  )

  return <>
    {layout ? <div role="region" aria-label={uiText("session_task_dag_dependencies")} tabIndex={0}
      style={{ maxHeight: "min(14rem, 32dvh)" }}
      className="overflow-auto bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ring-inset">
      <div className="relative" style={{ width: layout.width, height: layout.height }}>
        <svg aria-hidden="true" width={layout.width} height={layout.height}
          className="pointer-events-none absolute inset-0 text-muted-foreground/70">
          <defs><marker id={arrowId} viewBox="0 0 8 8" refX="7" refY="4" markerWidth="6" markerHeight="6" orient="auto">
            <path d="M 0 0 L 8 4 L 0 8 Z" fill="currentColor" />
          </marker></defs>
          {layout.edges.map(({ from, to, path }) => <path key={JSON.stringify([from, to])} d={path}
            fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" markerEnd={`url(#${arrowId})`} />)}
        </svg>
        {items.map((item) => {
          const { x, y } = layout.positions.get(item.id)!
          return node(item, { left: x, top: y, width: taskNodeWidth, height: taskNodeHeight })
        })}
      </div>
    </div> : <div className="space-y-2 bg-muted/30 p-3">
      <p className="text-xs text-muted-foreground">{uiText("session_task_dag_cycle")}</p>
      <div className="grid gap-2 sm:grid-cols-2">{items.map((item) => node(item))}</div>
    </div>}
    {selected ? <TaskDagDetails task={selected} items={items} id={detailId} /> : null}
  </>
}

export function SessionTaskDag({ sessionId, running }: { sessionId: string; running: boolean }) {
  const items = useAppStore((state) => state.taskLists[sessionId]?.items)
  const loadTaskList = useAppStore((state) => state.loadTaskList)
  const previous = useRef<{ sessionId: string; running: boolean } | null>(null)
  const [open, setOpen] = useState(false)
  const graphId = useId()

  useEffect(() => observeSessionTaskList(sessionId), [sessionId])
  useEffect(() => {
    const old = previous.current
    previous.current = { sessionId, running }
    if (!old || old.sessionId !== sessionId || (old.running && !running)) {
      void loadTaskList(sessionId).catch(() => {})
    }
  }, [sessionId, running, loadTaskList])

  if (!items?.length) return null
  const completed = items.filter((item) => item.status === "completed").length
  return <section aria-label={uiText("session_task_dag_title")} className="mx-3 my-1.5 shrink-0 overflow-hidden rounded-xl border bg-card">
    <button type="button" aria-expanded={open} aria-controls={graphId} onClick={() => setOpen((expanded) => !expanded)}
      className="flex min-h-10 w-full items-center gap-2 px-3 py-2 text-left text-xs hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring ring-inset">
      <Workflow className="size-4 shrink-0 text-primary" aria-hidden="true" />
      <span className="min-w-0 flex-1 font-medium">{uiText("session_task_dag_title")}</span>
      <span className="shrink-0 tabular-nums text-muted-foreground">{uiText("session_task_dag_progress", { completed, total: items.length })}</span>
      <ChevronDown className={cn("size-3.5 shrink-0 text-muted-foreground", open && "rotate-180")} aria-hidden="true" />
    </button>
    <div id={graphId} hidden={!open} style={{ maxHeight: "min(24rem, 45dvh)" }} className="overflow-y-auto border-t">
      {open ? <TaskDagGraph items={items} /> : null}
    </div>
  </section>
}
