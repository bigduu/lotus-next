import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { X } from "@lucide/solid"
import { cn } from "@/lib/utils"
import { createUiText } from "../../shell/uiText"
import type { createComposerCommands } from "./createComposerCommands"

type Commands = ReturnType<typeof createComposerCommands>
type Entry = {
  id: string
  kind: "command" | "skill" | "file"
  name: string
  description?: string
  unavailable?: string | null
  select: () => void
}

export function ComposerCommandMenus(props: { commands: Commands }) {
  const text = createUiText()
  const commands = () => props.commands
  const isSlash = () => commands().slashQuery !== null
  const suggestion = () => isSlash() ? null : commands().fileSuggestion
  const entries = createMemo<Entry[]>(() => {
    const control = commands()
    const slash = control.slashQuery
    if (slash === null) {
      const active = suggestion()
      if (!active) return []
      const query = active.query.trim().toLowerCase()
      return control.files.filter((entry) => !entry.is_directory && entry.path.toLowerCase().includes(query)).slice(0, 8)
        .map((entry) => ({ id: entry.path, kind: "file", name: entry.path, select: () => {
          if (control.fileSuggestion === active) active.pick(entry.path)
        } }))
    }
    const query = slash.trim().toLowerCase()
    const matches = (name: string, description: string) => name.toLowerCase().includes(query) || description.toLowerCase().includes(query)
    const compactDescription = text("compact_context_command")
    const goalDescription = text("set_session_goal_98fa0b0f")
    const workflowDescription = text("workflow_run_title")
    const compact: Entry | null = matches("compact", compactDescription) ? {
      kind: "command", id: "builtin-compact", name: "compact", description: compactDescription,
      unavailable: control.compactUnavailable, select: control.pickCompact,
    } : null
    const workflow: Entry | null = control.canOpenWorkflowRuns && matches("workflow", workflowDescription) ? {
      kind: "command", id: "builtin-workflow", name: "workflow", description: workflowDescription, select: control.openWorkflowRuns,
    } : null
    const exact = [compact, workflow].find((entry) => entry?.name === query)
    if (exact) return [exact]
    const goal: Entry | null = control.canOpenGoal && matches("goal", goalDescription) ? {
      kind: "command", id: "builtin-goal", name: "goal", description: text("goal_goal_text_send_goal_alone_to_open_settings_b45f54c8"),
      select: control.openGoal,
    } : null
    const builtins = [goal, compact, workflow].filter((entry): entry is Entry => entry !== null)
    const skills = control.skills.filter((skill) => matches(skill.name, skill.description)).map<Entry>((skill) => ({
      id: "skill-" + skill.id, kind: "skill", name: skill.name, description: skill.description, select: () => control.pickSkill(skill),
    }))
    return [...builtins, ...skills].slice(0, 8)
  })

  const enabled = createMemo(() => entries().filter((entry) => !entry.unavailable))
  const [index, setIndex] = createSignal(0)
  const active = () => enabled()[Math.min(index(), Math.max(0, enabled().length - 1))]
  const menuOpen = () => isSlash() || Boolean(suggestion())
  const menuType = () => isSlash() ? "commands" : "files"
  const menuId = () => `${commands().inputId}-${menuType()}`
  const optionId = (index: number) => `${menuId()}-option-${index}`

  createEffect(() => menuOpen() ? menuType() : null, () => { setIndex(0) })
  createEffect(() => enabled().length, (count) => { setIndex((current) => Math.min(current, Math.max(0, count - 1))) })

  onSettled(() => {
    const handleKey = (event: KeyboardEvent) => {
      if (!menuOpen() || event.isComposing || event.keyCode === 229) return
      const input = document.getElementById(commands().inputId)
      if (!(event.target instanceof Node) || !input?.contains(event.target) || input.dataset.composing === "true") return
      if (event.key === "Escape") {
        event.preventDefault()
        event.stopPropagation()
        if (isSlash()) commands().dismiss()
        else suggestion()?.dismiss()
        return
      }
      const count = enabled().length
      if (!count) return
      const delta = event.key === "ArrowDown" ? 1 : event.key === "ArrowUp" ? -1 : 0
      const pick = event.key === "Enter" && !event.metaKey && !event.ctrlKey && !event.shiftKey
        || event.key === "Tab" && !event.shiftKey
      if (!delta && !pick) return
      event.preventDefault()
      event.stopPropagation()
      if (delta) setIndex((current) => (Math.min(current, count - 1) + delta + count) % count)
      else active()?.select()
    }
    window.addEventListener("keydown", handleKey, true)
    return () => window.removeEventListener("keydown", handleKey, true)
  })

  createEffect(
    () => {
      const index = entries().indexOf(active())
      return { id: commands().inputId, listId: menuId(), itemId: index >= 0 ? optionId(index) : null, visible: entries().length > 0 }
    },
    ({ id, listId, itemId, visible }) => {
      if (!visible) return
      const input = document.getElementById(id)
      if (!input) return
      input.setAttribute("aria-controls", listId)
      input.setAttribute("aria-expanded", "true")
      input.setAttribute("aria-autocomplete", "list")
      if (itemId) {
        input.setAttribute("aria-activedescendant", itemId)
        document.getElementById(itemId)?.scrollIntoView({ block: "nearest" })
      }
      return () => {
        for (const attribute of ["aria-controls", "aria-expanded", "aria-autocomplete", "aria-activedescendant"]) input.removeAttribute(attribute)
      }
    },
  )

  return <>
    <Show when={commands().notice}>
      {(notice) => <div role={notice().error ? "alert" : "status"} class={cn("relative mb-2 rounded-md border px-3 py-2 pr-8 text-sm",
        notice().error ? "border-destructive/30 text-destructive" : "text-muted-foreground")}>
        <span>{notice().message}</span>
        <Show when={notice().detail}><span class="block break-words text-xs">{notice().detail}</span></Show>
        <button type="button" class="absolute right-2 top-2" aria-label={text("close_3fd47edc")} onClick={commands().clearNotice}>
          <X class="size-4" />
        </button>
      </div>}
    </Show>
    <Show when={entries().length > 0}>
      <div class="mx-auto mb-2 w-full max-w-6xl overflow-hidden rounded-xl border bg-popover shadow-lg">
        <Show when={!isSlash()}>
          <div class="border-b px-3 py-1.5 text-xs text-muted-foreground">{text("workspace_files_c0c1e416")}</div>
        </Show>
        <div role="listbox" id={menuId()} aria-label={text(isSlash() ? "command_6ee4a9a8" : "workspace_files_c0c1e416")}
          class="max-h-64 overflow-y-auto p-1">
          <For each={entries()} keyed={(entry: Entry) => entry.id}>
            {(entry, index) => (
              <div role="presentation">
                <Show when={isSlash() && (index() === 0 || entries()[index() - 1].kind !== entry().kind)}>
                  <div class="px-3 pb-1 pt-2 text-[10px] text-muted-foreground">
                    {text(entry().kind === "skill" ? "skills_99aea2f9" : "command_6ee4a9a8")}
                  </div>
                </Show>
                <button type="button" role="option" id={optionId(index())} tabindex={-1}
                  aria-selected={active()?.id === entry().id ? "true" : "false"} disabled={Boolean(entry().unavailable)}
                  onMouseDown={(event) => event.preventDefault()} onClick={() => { if (!entry().unavailable) entry().select() }}
                  class={cn(
                    "w-full rounded-lg px-3 text-left transition-colors hover:bg-accent disabled:opacity-50",
                    entry().kind === "file" ? "block truncate py-1.5 text-sm" : "flex flex-col gap-0.5 py-2",
                    active()?.id === entry().id && "bg-accent",
                  )}>
                  <span class={entry().kind === "file" ? undefined : "text-sm font-medium"}>{entry().kind === "file" ? "" : "/"}{entry().name}</span>
                  <Show when={entry().unavailable || entry().description}>
                    <span class="line-clamp-1 text-xs text-muted-foreground">{entry().unavailable || entry().description}</span>
                  </Show>
                </button>
              </div>
            )}
          </For>
        </div>
      </div>
    </Show>
    <Show when={commands().selectedSkill}>
      {(skill) => <div class="mx-auto mb-2 flex w-full max-w-full">
        <span class="inline-flex items-center gap-1 rounded-full bg-primary/15 px-2.5 py-1 text-xs font-medium text-primary">
          /{skill().name}
          <button type="button" aria-label={text("remove_skill_1324d3de")} class="opacity-70 hover:opacity-100"
            onClick={() => commands().clearSkill(skill())}>
            <X class="size-3" />
          </button>
        </span>
      </div>}
    </Show>
  </>
}
