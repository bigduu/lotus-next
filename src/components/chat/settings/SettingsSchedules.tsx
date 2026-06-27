import { useEffect, useState } from "react"
import { Trash2, Plus, Power, Pencil } from "lucide-react"
import { agentClient } from "@services/chat/AgentService"
import type { ScheduleEntry, ScheduleTrigger } from "@services/chat/AgentService"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const input =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

function triggerSummary(t: ScheduleTrigger): string {
  const tt = t as { type: string; every_seconds?: number; expression?: string }
  switch (tt.type) {
    case "interval":
      return `每 ${Math.round((tt.every_seconds ?? 0) / 60)} 分钟`
    case "daily":
      return "每天"
    case "weekly":
      return "每周"
    case "monthly":
      return "每月"
    case "cron":
      return `cron: ${tt.expression ?? ""}`
    default:
      return tt.type
  }
}

export function SettingsSchedules() {
  const [items, setItems] = useState<ScheduleEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [adding, setAdding] = useState(false)
  const [editId, setEditId] = useState<string | null>(null)
  const [name, setName] = useState("")
  const [cron, setCron] = useState("0 9 * * *")
  const [task, setTask] = useState("")

  const reload = () => {
    agentClient
      .listSchedules()
      .then((r) => setItems(r.schedules ?? []))
      .catch(() => {})
      .finally(() => setLoading(false))
  }
  useEffect(reload, [])

  const closeForm = () => {
    setAdding(false)
    setEditId(null)
    setName("")
    setTask("")
    setCron("0 9 * * *")
  }

  const startEdit = (s: ScheduleEntry) => {
    setAdding(false)
    setEditId(s.id)
    setName(s.name)
    setCron((s.trigger as { expression?: string }).expression ?? "0 9 * * *")
    setTask("")
  }

  const save = async () => {
    if (!name.trim()) return
    const trigger = { type: "cron", expression: cron.trim() } as unknown as ScheduleTrigger
    if (editId) {
      await agentClient
        .patchSchedule(editId, {
          name: name.trim(),
          trigger,
          ...(task.trim() ? { run_config: { task_message: task.trim(), auto_execute: true } } : {}),
        })
        .catch(() => {})
    } else {
      if (!task.trim()) return
      await agentClient
        .createSchedule({
          name: name.trim(),
          trigger,
          enabled: true,
          run_config: { task_message: task.trim(), auto_execute: true },
        })
        .catch(() => {})
    }
    closeForm()
    reload()
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">定时触发的任务(cron)。</p>
        {!adding ? (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> 新增
          </Button>
        ) : null}
      </div>

      {adding || editId ? (
        <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
          <input className={input} placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={input} placeholder="cron 表达式(如 0 9 * * *)" value={cron} onChange={(e) => setCron(e.target.value)} />
          <textarea
            className={cn(input, "min-h-16 resize-y")}
            placeholder={editId ? "任务内容(留空则保持不变)" : "任务内容"}
            value={task}
            onChange={(e) => setTask(e.target.value)}
          />
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={closeForm}>
              取消
            </Button>
            <Button size="sm" onClick={save} disabled={!name.trim() || (!editId && !task.trim())}>
              {editId ? "保存" : "添加"}
            </Button>
          </div>
        </div>
      ) : null}

      {loading ? (
        <p className="text-xs text-muted-foreground">加载中…</p>
      ) : items.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无定时任务</p>
      ) : (
        <ul className="space-y-2">
          {items.map((s) => (
            <li key={s.id} className="flex items-center gap-2 rounded-lg border p-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-medium">{s.name}</div>
                <div className="text-xs text-muted-foreground">{triggerSummary(s.trigger)}</div>
              </div>
              <button
                onClick={async () => {
                  await agentClient.patchSchedule(s.id, { enabled: !s.enabled }).catch(() => {})
                  reload()
                }}
                aria-label={s.enabled ? "停用" : "启用"}
                className={cn("shrink-0 rounded p-1 hover:text-foreground", s.enabled ? "text-primary" : "text-muted-foreground")}
              >
                <Power className="size-4" />
              </button>
              <button
                onClick={() => startEdit(s)}
                aria-label="编辑"
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
              >
                <Pencil className="size-3.5" />
              </button>
              <button
                onClick={async () => {
                  await agentClient.deleteSchedule(s.id).catch(() => {})
                  reload()
                }}
                aria-label="删除"
                className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
              >
                <Trash2 className="size-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
