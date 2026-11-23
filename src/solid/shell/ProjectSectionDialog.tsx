import { Trash2 } from "@lucide/solid"
import { createSignal, createUniqueId, For, Show } from "solid-js"
import type { ProjectSidebarSection } from "@/lib/projectSidebarPreferences"
import type { SidebarUpdateError } from "@/lib/projectSidebarWrites"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogTitle, ResponsiveDialogDescription } from "../ui/responsive-dialog"
import { createUiText } from "./uiText"

const requestErrors = {
  busy: "sidebar_sections_save_failed",
  unavailable: "sidebar_sections_unavailable",
  "save-failed": "sidebar_sections_save_failed",
  "saved-refresh-failed": "sidebar_sections_saved_refresh_failed",
  conflict: "sidebar_sections_conflict",
  "refresh-failed": "sidebar_sections_refresh_failed",
} as const satisfies Record<SidebarUpdateError, string>

export function ProjectSectionDialog(props: {
  projectName: string; mode: "create" | "manage"; sections: readonly ProjectSidebarSection[];
  busy: boolean; unavailable: boolean; error?: SidebarUpdateError;
  onCreate: (name: string) => Promise<boolean>; onRemove: (id: string) => Promise<boolean>; onClose: () => void;
}) {
  const text = createUiText()
  const inputId = createUniqueId()
  const [name, setName] = createSignal("")
  const [error, setError] = createSignal<string | null>(null)
  const blocked = () => props.unavailable || props.busy
  const save = async () => {
    if (blocked()) return
    const next = name().trim()
    if (!next || [...next].length > 80 || [...next].some((character) => {
      const code = character.codePointAt(0)!
      return code < 32 || code === 127
    })) {
      setError(text("sidebar_section_invalid_name"))
      return
    }
    if (props.sections.some((section) => section.name.toLocaleLowerCase() === next.toLocaleLowerCase())) {
      setError(text("sidebar_section_duplicate"))
      return
    }
    if (!await props.onCreate(next)) return
    setName("")
    setError(null)
    if (props.mode === "create") props.onClose()
  }
  const failure = () => props.unavailable ? "sidebar_sections_unavailable" : props.error ? requestErrors[props.error] : null

  return (
    <ResponsiveDialog open onOpenChange={(open) => { if (!open && !props.busy) props.onClose() }}>
      <ResponsiveDialogContent class="gap-0 p-0 sm:max-w-sm" aria-busy={props.busy ? "true" : "false"} dismissable={!props.busy}>
        <div class="p-4 pb-2">
          <ResponsiveDialogTitle>{text(props.mode === "create" ? "sidebar_create_section" : "sidebar_manage_sections")} · {props.projectName}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription class="mt-2 leading-relaxed">{text("sidebar_section_server_hint")}</ResponsiveDialogDescription>
        </div>
        <form class="grid gap-1.5 p-4" onSubmit={(event) => { event.preventDefault(); void save() }}>
          <label for={inputId} class="text-sm font-medium">{text("sidebar_section_name")}</label>
          <div class="flex gap-2">
            <Input id={inputId} value={name()} disabled={blocked()} aria-invalid={error() ? "true" : "false"} aria-describedby={error() ? `${inputId}-error` : undefined}
              onInput={(event) => { setName(event.currentTarget.value); setError(null) }} />
            <Button type="submit" disabled={!name().trim() || blocked()}>{text("create_cde2cd07")}</Button>
          </div>
          <Show when={error()}><p id={`${inputId}-error`} role="alert" class="text-xs text-destructive">{error()}</p></Show>
          <Show when={failure()}>{(message) => <p role="alert" class="text-xs text-destructive">{text(message())}</p>}</Show>
        </form>
        <Show when={props.mode === "manage" && props.sections.length > 0}>
          <div class="grid gap-2 border-t p-4">
            <p class="text-xs text-muted-foreground">{text("sidebar_section_remove_hint")}</p>
            <For each={props.sections} keyed={(section) => section.id}>{(section) => (
              <div class="flex min-w-0 items-center gap-2">
                <span class="flex-1 truncate text-sm">{section().name}</span>
                <Button size="icon" variant="ghost" disabled={blocked()} aria-label={`${text("sidebar_section_remove")} ${section().name}`}
                  onClick={() => { void props.onRemove(section().id) }}><Trash2 class="size-4" /></Button>
              </div>
            )}</For>
          </div>
        </Show>
        <div class="flex justify-end p-4 pt-2">
          <Button variant="secondary" disabled={props.busy} onClick={props.onClose}>{text("cancel_2cd0f3be")}</Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
