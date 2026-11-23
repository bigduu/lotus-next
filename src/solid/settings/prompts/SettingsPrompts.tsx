import { Pencil, Plus, Trash2 } from "@lucide/solid"
import { createSignal, For, onSettled, Show } from "solid-js"
import { getErrorMessage } from "@services/api"
import { appStore } from "@shared/store/appStore/state"
import type { UserSystemPrompt } from "@shared/types/chat"
import { isMermaidEnhancementEnabled, setMermaidEnhancementEnabled } from "@shared/utils/mermaidUtils"
import { getSystemPromptEnhancement, setSystemPromptEnhancement } from "@shared/utils/systemPromptEnhancement"
import { isTaskEnhancementEnabled, setTaskEnhancementEnabled } from "@shared/utils/taskEnhancementUtils"
import { createUiText } from "../../shell/uiText"
import { createStoreSelector } from "../../state/createStoreSelector"
import { Badge } from "../../ui/badge"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogTitle } from "../../ui/responsive-dialog"
import { Switch } from "../../ui/switch"
import { Textarea } from "../../ui/textarea"

function PromptToggle(props: { label: string; description: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <div class="flex items-start justify-between gap-3">
      <div class="min-w-0">
        <div class="text-sm font-medium">{props.label}</div>
        <p class="mt-0.5 text-xs leading-relaxed text-muted-foreground">{props.description}</p>
      </div>
      <Switch checked={props.checked} onCheckedChange={props.onChange} aria-label={props.label} class="mt-0.5 shrink-0" />
    </div>
  )
}

export function SettingsPrompts() {
  const text = createUiText()
  const prompts = createStoreSelector(appStore, (state) => state.systemPrompts)
  const [editor, setEditor] = createSignal<{ preset: UserSystemPrompt | null } | null>(null)
  const [name, setName] = createSignal("")
  const [content, setContent] = createSignal("")
  const [busy, setBusy] = createSignal(false)
  const [dialogError, setDialogError] = createSignal<string | null>(null)
  const [listError, setListError] = createSignal<string | null>(null)
  const [enhancement, setEnhancement] = createSignal(getSystemPromptEnhancement())
  const [saved, setSaved] = createSignal(false)
  const [mermaidEnabled, setMermaidEnabled] = createSignal(isMermaidEnhancementEnabled())
  const [taskEnabled, setTaskEnabled] = createSignal(isTaskEnhancementEnabled())
  let savedTimer: ReturnType<typeof setTimeout> | undefined
  let mounted = true
  let mutating = false

  onSettled(() => () => {
    mounted = false
    clearTimeout(savedTimer)
  })

  const openEditor = (preset: UserSystemPrompt | null) => {
    if (mutating) return
    setName(preset?.name ?? "")
    setContent(preset?.content ?? "")
    setDialogError(null)
    setEditor({ preset })
  }

  const save = async () => {
    const active = editor()
    if (!active || mutating || !name().trim() || !content().trim()) return
    mutating = true
    setBusy(true)
    setDialogError(null)
    const fields = { name: name().trim(), content: content() }
    try {
      if (active.preset) await appStore.getState().updateSystemPrompt({ ...active.preset, ...fields })
      else await appStore.getState().addSystemPrompt(fields)
      if (mounted) setEditor(null)
    } catch (error) {
      if (mounted) setDialogError(getErrorMessage(error))
    } finally {
      mutating = false
      if (mounted) setBusy(false)
    }
  }

  const remove = async (preset: UserSystemPrompt) => {
    if (mutating) return
    mutating = true
    setBusy(true)
    setListError(null)
    try {
      await appStore.getState().deleteSystemPrompt(preset.id)
    } catch (error) {
      if (mounted) setListError(text("could_not_delete_e74a58dc", { v0: preset.name, v1: getErrorMessage(error) }))
    } finally {
      mutating = false
      if (mounted) setBusy(false)
    }
  }

  const saveEnhancement = () => {
    setSystemPromptEnhancement(enhancement())
    setSaved(true)
    clearTimeout(savedTimer)
    savedTimer = setTimeout(() => setSaved(false), 2000)
  }

  return (
    <div class="space-y-4">
      <section class="rounded-lg border p-3">
        <div class="mb-2 flex items-center justify-between">
          <div class="text-xs font-medium text-muted-foreground">{text("system_prompt_presets_3aced1c3")}</div>
          <Button size="sm" variant="secondary" disabled={busy()} onClick={() => openEditor(null)}>
            <Plus class="size-4" />{text("add_0006d696")}
          </Button>
        </div>
        <Show when={listError()}><p role="alert" class="mb-2 text-xs text-destructive">{listError()}</p></Show>
        <Show when={prompts().length > 0} fallback={<p class="text-xs text-muted-foreground">{text("no_presets_yet_0c75be1d")}</p>}>
          <ul class="space-y-2">
            <For each={prompts()} keyed={(preset) => preset.id}>{(preset) => (
              <li class="flex items-center gap-2 rounded-lg border p-3">
                <div class="min-w-0 flex-1">
                  <div class="flex items-center gap-1.5">
                    <span class="truncate text-sm font-medium">{preset().name}</span>
                    <Show when={preset().isDefault}>
                      <Badge variant="secondary" class="shrink-0 text-[10px]">{text("default_844b8cc8")}</Badge>
                    </Show>
                  </div>
                  <div class="truncate text-xs text-muted-foreground">{preset().description || preset().content.slice(0, 120)}</div>
                </div>
                <Show when={!preset().isDefault}>
                  <Button size="icon" variant="ghost" disabled={busy()} onClick={() => openEditor(preset())} aria-label={text("edit_05183656")}>
                    <Pencil class="size-3.5" />
                  </Button>
                  <Button size="icon" variant="ghost" disabled={busy()} onClick={() => { void remove(preset()) }} aria-label={text("delete_2f9daa82")}>
                    <Trash2 class="size-3.5" />
                  </Button>
                </Show>
              </li>
            )}</For>
          </ul>
        </Show>
      </section>

      <section class="rounded-lg border p-3">
        <div class="mb-2 text-xs font-medium text-muted-foreground">{text("prompt_enhancement_e4500793")}</div>
        <p class="mb-2 text-xs leading-relaxed text-muted-foreground">{text("custom_content_appended_to_system_prompts_for_all_sessi_7e014a9a")}</p>
        <Textarea class="min-h-24 resize-y text-sm" aria-label={text("prompt_enhancement_e4500793")} placeholder={text("enter_enhancement_text_to_append_bb366915")}
          value={enhancement()} onInput={(event) => { setEnhancement(event.currentTarget.value); setSaved(false) }} />
        <div class="mt-2 flex items-center justify-end gap-2">
          <Show when={saved()}><span role="status" class="text-xs text-muted-foreground">{text("saved_1bd91a7d")}</span></Show>
          <Button size="sm" onClick={saveEnhancement}>{text("save_a3030bf8")}</Button>
        </div>
      </section>

      <section class="rounded-lg border p-3">
        <div class="mb-2 text-xs font-medium text-muted-foreground">{text("enhancement_switches_e2a6a5a8")}</div>
        <div class="space-y-3">
          <PromptToggle label={text("mermaid_diagram_enhancement_267bc7a4")}
            description={text("encourage_mermaid_diagrams_when_explaining_workflows_an_d05fbd2a")}
            checked={mermaidEnabled()} onChange={(checked) => { setMermaidEnabled(checked); setMermaidEnhancementEnabled(checked) }} />
          <PromptToggle label={text("task_list_rules_ec44f37e")}
            description={text("encourage_the_model_to_track_multi_step_tasks_with_the__97ac7808")}
            checked={taskEnabled()} onChange={(checked) => { setTaskEnabled(checked); setTaskEnhancementEnabled(checked) }} />
        </div>
      </section>

      <ResponsiveDialog open={editor() !== null} onOpenChange={(open) => { if (!open && !busy()) setEditor(null) }}>
        <ResponsiveDialogContent class="p-5 sm:max-w-lg">
          <ResponsiveDialogTitle>{text(editor()?.preset ? "edit_preset_4e32d8db" : "add_preset_0a866812")}</ResponsiveDialogTitle>
          <form class="mt-3 space-y-2.5" onSubmit={(event) => { event.preventDefault(); void save() }}>
            <Input aria-label={text("name_d44e9b3d")} placeholder={text("name_d44e9b3d")} value={name()}
              disabled={busy()} onInput={(event) => setName(event.currentTarget.value)} />
            <Textarea class="min-h-40 resize-y text-sm" aria-label={text("prompt_content_cc1ab53a")} placeholder={text("prompt_content_cc1ab53a")}
              value={content()} disabled={busy()} onInput={(event) => setContent(event.currentTarget.value)} />
            <Show when={dialogError()}><p role="alert" class="text-xs text-destructive">{dialogError()}</p></Show>
            <div class="flex justify-end gap-2">
              <Button type="button" size="sm" variant="secondary" disabled={busy()} onClick={() => setEditor(null)}>{text("cancel_2cd0f3be")}</Button>
              <Button type="submit" size="sm" disabled={busy() || !name().trim() || !content().trim()}>
                {text(busy() ? "saving_ff509c9b" : "save_a3030bf8")}
              </Button>
            </div>
          </form>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
