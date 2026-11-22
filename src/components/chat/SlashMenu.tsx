import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useRef } from "react"
import type { SkillDefinition } from "@shared/types/skill"
import { cn } from "@/lib/utils"
import { useMenuKeyboardNav } from "./useMenuKeyboardNav"

type Entry =
  | { kind: "command"; id: string; name: string; description: string; action: () => void; unavailable?: string | null }
  | { kind: "skill"; id: string; name: string; description: string; skill: SkillDefinition }

/**
 * Built-in commands open their destination or run directly. Picking a Skill
 * prepares it for the next send. Escape preserves the draft.
 */
export function SlashMenu({
  skills,
  query,
  onPick,
  onPickGoal,
  onPickCompact,
  compactUnavailable,
  onOpenWorkflowRuns,
  onDismiss,
  inputId,
}: {
  inputId: string
  skills: SkillDefinition[]
  query: string
  onPick: (skill: SkillDefinition) => void
  onPickGoal?: () => void
  onPickCompact?: () => void
  compactUnavailable?: string | null
  onOpenWorkflowRuns?: () => void
  onDismiss?: () => void
}) {
  useUiLocale()
  const q = query.trim().toLowerCase()
  const matches = (name: string, description: string) =>
    !q || name.toLowerCase().includes(q) || description.toLowerCase().includes(q)

  const compactDescription = uiText("compact_context_command")
  const compactEntry: Entry | null = onPickCompact && matches("compact", compactDescription)
    ? { kind: "command", id: "builtin-compact", name: "compact", description: compactDescription,
        action: onPickCompact, unavailable: compactUnavailable }
    : null
  const workflowDescription = uiText("workflow_run_title")
  const entries: Entry[] = [
    ...(onPickGoal && matches("goal", uiText("set_session_goal_98fa0b0f")) ? [{ kind: "command" as const, id: "builtin-goal", name: "goal", description: uiText("goal_goal_text_send_goal_alone_to_open_settings_b45f54c8"), action: onPickGoal }] : []),
    ...(compactEntry ? [compactEntry] : []),
    ...(onOpenWorkflowRuns && matches("workflow", workflowDescription) ? [{
      kind: "command" as const, id: "builtin-workflow", name: "workflow", description: workflowDescription,
      action: onOpenWorkflowRuns,
    }] : []),
    ...skills
      .filter((skill) => matches(skill.name, skill.description))
      .map((skill) => ({
        kind: "skill" as const,
        id: "skill-" + skill.id,
        name: skill.name,
        description: skill.description,
        skill,
      })),
  ].slice(0, 8)
  // The exact built-in command is reserved, including when it is unavailable.
  const shownEntries = q === "compact" && compactEntry ? [compactEntry] : entries
  const disabledReason = (entry: Entry) => entry.kind === "command" ? entry.unavailable : null
  const selectable = shownEntries.filter((entry) => !disabledReason(entry))

  const pick = (entry: Entry) => {
    if (disabledReason(entry)) return
    if (entry.kind === "skill") onPick(entry.skill)
    else entry.action()
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

  if (shownEntries.length === 0) return null

  return (
    <div className="mx-auto mb-2 w-full max-w-6xl overflow-hidden rounded-xl border bg-popover shadow-lg">
      <div className="max-h-64 overflow-y-auto p-1">
        {shownEntries.map((entry, i) => {
          const unavailable = disabledReason(entry)
          return (
            <div key={entry.id}>
              {(i === 0 || shownEntries[i - 1].kind !== entry.kind) && (
                <div className="px-3 pb-1 pt-2 text-[10px] text-muted-foreground">
                  {entry.kind === "skill" ? uiText("skills_99aea2f9") : uiText("command_6ee4a9a8")}
                </div>
              )}
              <button
                ref={selectable[active]?.id === entry.id ? activeItemRef : undefined}
                disabled={!!unavailable}
                onClick={() => pick(entry)}
                className={cn(
                  "flex w-full flex-col gap-0.5 rounded-lg px-3 py-2 text-left transition-colors hover:bg-accent",
                  selectable[active]?.id === entry.id && "bg-accent",
                  "disabled:opacity-50",
                )}
              >
                <span className="text-sm font-medium">/{entry.name}</span>
                {(unavailable || entry.description) && (
                  <span className="line-clamp-1 text-xs text-muted-foreground">{unavailable || entry.description}</span>
                )}
              </button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
