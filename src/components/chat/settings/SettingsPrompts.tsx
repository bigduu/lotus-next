import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useState } from "react"
import { Pencil, Plus, Trash2 } from "lucide-react"
import { useAppStore } from "@shared/store/appStore"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import type { UserSystemPrompt } from "@shared/types/chat"
import {
  getSystemPromptEnhancement,
  setSystemPromptEnhancement,
} from "@shared/utils/systemPromptEnhancement"
import {
  isMermaidEnhancementEnabled,
  setMermaidEnhancementEnabled,
} from "@shared/utils/mermaidUtils"
import {
  isTaskEnhancementEnabled,
  setTaskEnhancementEnabled,
} from "@shared/utils/taskEnhancementUtils"
import {
  isCopilotConclusionWithOptionsEnhancementEnabled,
  setCopilotConclusionWithOptionsEnhancementEnabled,
} from "@shared/utils/copilotConclusionWithOptionsEnhancementUtils"
import { getErrorMessage } from "@services/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Badge } from "@/components/ui/badge"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"

/** Toggle row: label + optional description on the left, Switch on the right. */
function ToggleRow({
  label,
  description,
  checked,
  onCheckedChange,
}: {
  label: string
  description?: string
  checked: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  useUiLocale()
  return (
    <div className="flex items-start justify-between gap-3">
      <div className="min-w-0">
        <div className="text-sm font-medium">{label}</div>
        {description ? (
          <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{description}</p>
        ) : null}
      </div>
      <Switch
        checked={checked}
        onCheckedChange={onCheckedChange}
        aria-label={label}
        className="mt-0.5 shrink-0"
      />
    </div>
  )
}

export function SettingsPrompts() {
  useUiLocale()
  const systemPrompts = useAppStore((state) => state.systemPrompts)
  const addSystemPrompt = useAppStore((state) => state.addSystemPrompt)
  const updateSystemPrompt = useAppStore((state) => state.updateSystemPrompt)
  const deleteSystemPrompt = useAppStore((state) => state.deleteSystemPrompt)

  const showCopilotToggle = useProviderStore((state) => {
    const chatProvider = state.providerSnapshot?.defaults?.chat.provider
    return chatProvider ? state.getProviderType(chatProvider) === "copilot" : false
  })

  // ── preset editor dialog ──────────────────────────────────────
  const [dialogOpen, setDialogOpen] = useState(false)
  const [editingPrompt, setEditingPrompt] = useState<UserSystemPrompt | null>(null)
  const [name, setName] = useState("")
  const [content, setContent] = useState("")
  const [saving, setSaving] = useState(false)
  const [dialogError, setDialogError] = useState<string | null>(null)
  const [listError, setListError] = useState<string | null>(null)

  const openDialog = (prompt: UserSystemPrompt | null) => {
    setEditingPrompt(prompt)
    setName(prompt?.name ?? "")
    setContent(prompt?.content ?? "")
    setDialogError(null)
    setDialogOpen(true)
  }

  const closeDialog = () => {
    setDialogOpen(false)
    setEditingPrompt(null)
    setName("")
    setContent("")
    setDialogError(null)
  }

  const savePreset = async () => {
    if (!name.trim() || !content.trim()) return
    setSaving(true)
    setDialogError(null)
    try {
      if (editingPrompt) {
        await updateSystemPrompt({ ...editingPrompt, name: name.trim(), content })
      } else {
        await addSystemPrompt({ name: name.trim(), content })
      }
      closeDialog()
    } catch (error) {
      setDialogError(getErrorMessage(error))
    } finally {
      setSaving(false)
    }
  }

  const removePreset = async (prompt: UserSystemPrompt) => {
    setListError(null)
    try {
      await deleteSystemPrompt(prompt.id)
    } catch (error) {
      setListError(uiText("could_not_delete_e74a58dc", { v0: prompt.name, v1: getErrorMessage(error) }))
    }
  }

  // ── enhancement text ──────────────────────────────────────────
  const [enhancement, setEnhancement] = useState(() => getSystemPromptEnhancement())
  const [enhancementSaved, setEnhancementSaved] = useState(false)

  const saveEnhancement = () => {
    setSystemPromptEnhancement(enhancement)
    setEnhancementSaved(true)
    setTimeout(() => setEnhancementSaved(false), 2000)
  }

  // ── enhancement toggles ───────────────────────────────────────
  const [mermaidEnabled, setMermaidEnabled] = useState(() => isMermaidEnhancementEnabled())
  const [taskEnabled, setTaskEnabled] = useState(() => isTaskEnhancementEnabled())
  const [copilotEnabled, setCopilotEnabled] = useState(() =>
    isCopilotConclusionWithOptionsEnhancementEnabled(),
  )

  return (
    <div className="space-y-4">
      {/* ── presets ── */}
      <section className="rounded-lg border p-3">
        <div className="mb-2 flex items-center justify-between">
          <div className="text-xs font-medium text-muted-foreground">{uiText("system_prompt_presets_3aced1c3")}</div>
          <Button size="sm" variant="secondary" onClick={() => openDialog(null)}>
            <Plus className="size-4" />{uiText("add_0006d696")}</Button>
        </div>
        {listError ? <p className="mb-2 text-xs text-destructive">{listError}</p> : null}
        {systemPrompts.length === 0 ? (
          <p className="text-xs text-muted-foreground">{uiText("no_presets_yet_0c75be1d")}</p>
        ) : (
          <ul className="space-y-2">
            {systemPrompts.map((prompt) => (
              <li key={prompt.id} className="flex items-center gap-2 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{prompt.name}</span>
                    {prompt.isDefault ? (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        {uiText("default_844b8cc8")}</Badge>
                    ) : null}
                  </div>
                  <div className="truncate text-xs text-muted-foreground">
                    {prompt.description || prompt.content.slice(0, 120)}
                  </div>
                </div>
                {!prompt.isDefault ? (
                  <>
                    <button
                      onClick={() => openDialog(prompt)}
                      aria-label={uiText("edit_05183656")}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() => void removePreset(prompt)}
                      aria-label={uiText("delete_2f9daa82")}
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="size-3.5" />
                    </button>
                  </>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {/* ── enhancement text ── */}
      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("prompt_enhancement_e4500793")}</div>
        <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
          {uiText("custom_content_appended_to_system_prompts_for_all_sessi_7e014a9a")}</p>
        <Textarea
          className="min-h-24 resize-y text-sm"
          placeholder={uiText("enter_enhancement_text_to_append_bb366915")}
          value={enhancement}
          onChange={(e) => setEnhancement(e.target.value)}
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          {enhancementSaved ? <span className="text-xs text-muted-foreground">{uiText("saved_1bd91a7d")}</span> : null}
          <Button size="sm" onClick={saveEnhancement}>
            {uiText("save_a3030bf8")}</Button>
        </div>
      </section>

      {/* ── enhancement toggles ── */}
      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("enhancement_switches_e2a6a5a8")}</div>
        <div className="space-y-3">
          <ToggleRow
            label={uiText("mermaid_diagram_enhancement_267bc7a4")}
            description={uiText("encourage_mermaid_diagrams_when_explaining_workflows_an_d05fbd2a")}
            checked={mermaidEnabled}
            onCheckedChange={(checked) => {
              setMermaidEnabled(checked)
              setMermaidEnhancementEnabled(checked)
            }}
          />
          <ToggleRow
            label={uiText("task_list_rules_ec44f37e")}
            description={uiText("encourage_the_model_to_track_multi_step_tasks_with_the__97ac7808")}
            checked={taskEnabled}
            onCheckedChange={(checked) => {
              setTaskEnabled(checked)
              setTaskEnhancementEnabled(checked)
            }}
          />
          {showCopilotToggle ? (
            <ToggleRow
              label={uiText("copilot_completion_confirmation_735f51ca")}
              description={uiText("require_copilot_to_call_conclusion_with_options_for_you_c22f3eda")}
              checked={copilotEnabled}
              onCheckedChange={(checked) => {
                setCopilotEnabled(checked)
                setCopilotConclusionWithOptionsEnhancementEnabled(checked)
              }}
            />
          ) : null}
        </div>
      </section>

      {/* ── preset editor dialog ── */}
      <ResponsiveDialog
        open={dialogOpen}
        onOpenChange={(open) => {
          if (!open) closeDialog()
        }}
      >
        <ResponsiveDialogContent className="p-5 sm:max-w-lg">
          <ResponsiveDialogTitle>{editingPrompt ? uiText("edit_preset_4e32d8db") : uiText("add_preset_0a866812")}</ResponsiveDialogTitle>
          <div className="mt-3 space-y-2.5">
            <Input placeholder={uiText("name_d44e9b3d")} value={name} onChange={(e) => setName(e.target.value)} />
            <Textarea
              className="min-h-40 resize-y text-sm"
              placeholder={uiText("prompt_content_cc1ab53a")}
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            {dialogError ? <p className="text-xs text-destructive">{dialogError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={closeDialog}>
                {uiText("cancel_2cd0f3be")}</Button>
              <Button
                size="sm"
                onClick={() => void savePreset()}
                disabled={saving || !name.trim() || !content.trim()}
              >
                {saving ? uiText("saving_ff509c9b") : uiText("save_a3030bf8")}
              </Button>
            </div>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
