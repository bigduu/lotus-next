import { useEffect, useRef } from "react"
import type { SkillDefinition } from "@shared/types/skill"
import type { CommandItem } from "@services/command"
import { workflowUnavailableReason, type WorkflowCatalogEntry } from "@services/command/workflowCatalog"
import type { WorkflowCatalogState } from "./useWorkflowCatalog"
import { cn } from "@/lib/utils"
import { useMenuKeyboardNav } from "./useMenuKeyboardNav"

type Entry =
  | { kind: "typed"; id: string; name: string; description: string; entry: WorkflowCatalogEntry }
  | { kind: "catalog"; id: string; name: string; description: string }
  | { kind: "goal"; id: string; name: string; description: string }
  | { kind: "skill"; id: string; name: string; description: string; skill: SkillDefinition }
  | { kind: "workflow"; id: string; name: string; description: string; command: CommandItem }

/**
 * Slash-command picker shown above the composer when the draft starts with "/".
 * Lists skills AND workflows filtered by the text after the slash; picking one
 * (click or ↑↓ + Enter/Tab) attaches it to the next send — a skill via
 * selected_skill_ids, a workflow by expanding its content into the message.
 * Escape dismisses the menu without touching the draft.
 */
export function SlashMenu({
  skills,
  workflows,
  query,
  onPick,
  onPickWorkflow,
  onPickGoal,
  onPickCatalog,
  onDismiss,
  inputId,
  catalogState,
  onPickCatalogEntry,
  catalogDisabled = false,
}: {
  inputId: string
  catalogState?: WorkflowCatalogState
  onPickCatalogEntry?: (entry: WorkflowCatalogEntry) => void
  catalogDisabled?: boolean
  skills: SkillDefinition[]
  workflows: CommandItem[]
  query: string
  onPick: (skill: SkillDefinition) => void
  onPickWorkflow: (command: CommandItem) => void
  onPickGoal?: () => void
  onPickCatalog?: () => void
  onDismiss?: () => void
}) {
  const q = query.trim().toLowerCase()
  const matches = (name: string, description: string) =>
    !q || name.toLowerCase().includes(q) || description.toLowerCase().includes(q)

  const catalogEntry: Entry[] = onPickCatalog &&
    (!q || matches("目录工作流", "从 Bamboo 目录选择可执行的工作流") || "workflow".includes(q))
    ? [{ kind: "catalog", id: "builtin-catalog", name: "目录工作流", description: "打开工作流目录，选择可执行的工作流及参数" }]
    : []
  const entries: Entry[] = [
    ...(onPickGoal && matches("goal", "设置会话目标") ? [{ kind: "goal" as const, id: "builtin-goal", name: "goal", description: "/goal 目标内容 · 单独发送 /goal 打开设置" }] : []),
    ...skills
      .filter((s) => matches(s.name, s.description))
      .map((s) => ({
        kind: "skill" as const,
        id: `skill-${s.id}`,
        name: s.name,
        description: s.description,
        skill: s,
      })),
    ...workflows
      .filter((w) => matches(w.display_name || w.name, w.description))
      .map((w) => ({
        kind: "workflow" as const,
        id: `workflow-${w.id}`,
        name: w.display_name || w.name,
        description: w.description,
        command: w,
      })),
  ].slice(0, catalogEntry.length ? 7 : 8)
  const typedEntries: Entry[] = (catalogState?.catalog?.entries ?? [])
    .filter((entry) => !q || matches(entry.name, entry.description) || entry.id.toLowerCase().includes(q) || entry.source.includes(q))
    .map((entry) => ({ kind: "typed", id: `catalog:${entry.source}:${entry.id}:${entry.revision}`, name: entry.name, description: entry.description, entry }))
  entries.push(...typedEntries, ...catalogEntry)
  const disabledReason = (entry: Entry) => entry.kind === "typed"
    ? workflowUnavailableReason(entry.entry) || (catalogDisabled ? "当前暂不能选择工作流" : null) : null
  const selectable = entries.filter((entry) => !disabledReason(entry))

  const pick = (e: Entry) => {
    if (disabledReason(e)) return
    if (e.kind === "typed") onPickCatalogEntry?.(e.entry)
    else if (e.kind === "skill") onPick(e.skill)
    else if (e.kind === "workflow") onPickWorkflow(e.command)
    else if (e.kind === "catalog") onPickCatalog?.()
    else onPickGoal?.()
  }

  const active = useMenuKeyboardNav(
    selectable.length,
    (i) => {
      const entry = selectable[i]
      if (entry) pick(entry)
    },
    onDismiss,
    inputId,
  )
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" })
  }, [active])

  if (entries.length === 0 && !catalogState) return null

  return (
    <div className="mx-auto mb-2 w-full max-w-6xl overflow-hidden rounded-xl border bg-popover shadow-lg">
      <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">指令 / 技能 / 工作流</div>
      <div className="max-h-64 overflow-y-auto p-1">
        {entries.map((e, i) => (
          <div key={e.id}>
          {(i === 0 || entries[i - 1].kind !== e.kind) && <div className="px-3 pb-1 pt-2 text-[10px] text-muted-foreground">
            {e.kind === "typed" ? "目录工作流 · 本条消息" : e.kind === "workflow" ? "文本展开工作流" : e.kind === "skill" ? "技能" : e.kind === "goal" ? "指令" : "目录管理"}
          </div>}
          <button
            ref={selectable[active]?.id === e.id ? activeItemRef : undefined}
            disabled={!!disabledReason(e)}
            onClick={() => pick(e)}
            className={cn(
              "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent",
              selectable[active]?.id === e.id && "bg-accent",
              "disabled:opacity-50",
            )}
          >
            <span className="flex items-center gap-1.5 text-sm font-medium">
              /{e.name}
              <span
                className={cn(
                  "rounded-full px-1.5 py-0 text-[10px] font-normal",
                  e.kind === "workflow"
                    ? "bg-primary/15 text-primary"
                    : "bg-muted text-muted-foreground",
                )}
              >
                {e.kind === "typed" ? `${e.entry.source} · r${e.entry.revision}` : e.kind === "goal" ? "指令" : e.kind === "catalog" ? "目录选择" : e.kind === "workflow" ? "文本展开" : "技能"}
              </span>
            </span>
            {(disabledReason(e) || e.description) ? (
              <span className="line-clamp-1 text-xs text-muted-foreground">{disabledReason(e) || e.description}</span>
            ) : null}
          </button>
          </div>
        ))}
        {!entries.length && !catalogState?.loading && !catalogState?.error && <p className="px-3 py-2 text-xs text-muted-foreground">没有匹配的指令或工作流</p>}
        {catalogState?.loading && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">正在读取工作流目录…</p>}
        {catalogState?.error && <p role="alert" className="px-3 py-2 text-xs text-destructive">目录读取失败：{catalogState.error}</p>}
      </div>
    </div>
  )
}
