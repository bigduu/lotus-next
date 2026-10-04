import { uiText, useUiLocale } from "@shared/i18n/ui"
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
  useUiLocale()
  const q = query.trim().toLowerCase()
  const matches = (name: string, description: string) =>
    !q || name.toLowerCase().includes(q) || description.toLowerCase().includes(q)

  const catalogEntry: Entry[] = onPickCatalog &&
    (!q || matches(uiText("catalog_workflows_b3caa7b0"), uiText("choose_an_executable_workflow_from_the_bamboo_catalog_b7020d54")) || "workflow".includes(q))
    ? [{ kind: "catalog", id: "builtin-catalog", name: uiText("catalog_workflows_b3caa7b0"), description: uiText("open_the_workflow_catalog_to_choose_a_workflow_and_argu_4359980e") }]
    : []
  const entries: Entry[] = [
    ...(onPickGoal && matches("goal", uiText("set_session_goal_98fa0b0f")) ? [{ kind: "goal" as const, id: "builtin-goal", name: "goal", description: uiText("goal_goal_text_send_goal_alone_to_open_settings_b45f54c8") }] : []),
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
    ? workflowUnavailableReason(entry.entry) || (catalogDisabled ? uiText("workflow_selection_is_currently_unavailable_94a186a4") : null) : null
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
      <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">{uiText("commands_skills_workflows_1abfc720")}</div>
      <div className="max-h-64 overflow-y-auto p-1">
        {entries.map((e, i) => (
          <div key={e.id}>
          {(i === 0 || entries[i - 1].kind !== e.kind) && <div className="px-3 pb-1 pt-2 text-[10px] text-muted-foreground">
            {e.kind === "typed" ? uiText("catalog_workflow_this_message_4bad8776") : e.kind === "workflow" ? uiText("text_expansion_workflow_8362c042") : e.kind === "skill" ? uiText("skills_99aea2f9") : e.kind === "goal" ? uiText("command_6ee4a9a8") : uiText("catalog_management_8dd26df6")}
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
                {e.kind === "typed" ? `${e.entry.source} · r${e.entry.revision}` : e.kind === "goal" ? uiText("command_6ee4a9a8") : e.kind === "catalog" ? uiText("catalog_selection_a07f95c4") : e.kind === "workflow" ? uiText("text_expansion_96adb387") : uiText("skills_99aea2f9")}
              </span>
            </span>
            {(disabledReason(e) || e.description) ? (
              <span className="line-clamp-1 text-xs text-muted-foreground">{disabledReason(e) || e.description}</span>
            ) : null}
          </button>
          </div>
        ))}
        {!entries.length && !catalogState?.loading && !catalogState?.error && <p className="px-3 py-2 text-xs text-muted-foreground">{uiText("no_matching_commands_or_workflows_bfef441f")}</p>}
        {catalogState?.loading && <p role="status" className="px-3 py-2 text-xs text-muted-foreground">{uiText("loading_workflow_catalog_59214f82")}</p>}
        {catalogState?.error && <p role="alert" className="px-3 py-2 text-xs text-destructive">{uiText("could_not_load_catalog_a2342d5f")}{catalogState.error}</p>}
      </div>
    </div>
  )
}
