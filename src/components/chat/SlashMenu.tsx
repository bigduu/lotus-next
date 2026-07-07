import { useEffect, useRef } from "react"
import type { SkillDefinition } from "@shared/types/skill"
import type { CommandItem } from "@services/command"
import { cn } from "@/lib/utils"
import { useMenuKeyboardNav } from "./useMenuKeyboardNav"

type Entry =
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
  onDismiss,
}: {
  skills: SkillDefinition[]
  workflows: CommandItem[]
  query: string
  onPick: (skill: SkillDefinition) => void
  onPickWorkflow: (command: CommandItem) => void
  onDismiss?: () => void
}) {
  const q = query.trim().toLowerCase()
  const matches = (name: string, description: string) =>
    !q || name.toLowerCase().includes(q) || description.toLowerCase().includes(q)

  const entries: Entry[] = [
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
  ].slice(0, 8)

  const pick = (e: Entry) => {
    if (e.kind === "skill") onPick(e.skill)
    else onPickWorkflow(e.command)
  }

  const active = useMenuKeyboardNav(
    entries.length,
    (i) => {
      const entry = entries[i]
      if (entry) pick(entry)
    },
    onDismiss,
  )
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" })
  }, [active])

  if (entries.length === 0) return null

  return (
    <div className="mx-auto mb-2 max-w-2xl overflow-hidden rounded-xl border bg-popover shadow-lg">
      <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">技能 / 工作流</div>
      <div className="max-h-64 overflow-y-auto p-1">
        {entries.map((e, i) => (
          <button
            key={e.id}
            ref={i === active ? activeItemRef : undefined}
            onClick={() => pick(e)}
            className={cn(
              "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent",
              i === active && "bg-accent",
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
                {e.kind === "workflow" ? "工作流" : "技能"}
              </span>
            </span>
            {e.description ? (
              <span className="line-clamp-1 text-xs text-muted-foreground">{e.description}</span>
            ) : null}
          </button>
        ))}
      </div>
    </div>
  )
}
