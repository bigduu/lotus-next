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
  const systemPrompts = useAppStore((state) => state.systemPrompts)
  const addSystemPrompt = useAppStore((state) => state.addSystemPrompt)
  const updateSystemPrompt = useAppStore((state) => state.updateSystemPrompt)
  const deleteSystemPrompt = useAppStore((state) => state.deleteSystemPrompt)

  const currentProvider = useProviderStore((state) => state.currentProvider)
  const getProviderType = useProviderStore((state) => state.getProviderType)
  const showCopilotToggle = getProviderType(currentProvider) === "copilot"

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
      setListError(`删除「${prompt.name}」失败:${getErrorMessage(error)}`)
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
          <div className="text-xs font-medium text-muted-foreground">系统提示词预设</div>
          <Button size="sm" variant="secondary" onClick={() => openDialog(null)}>
            <Plus className="size-4" /> 新增
          </Button>
        </div>
        {listError ? <p className="mb-2 text-xs text-destructive">{listError}</p> : null}
        {systemPrompts.length === 0 ? (
          <p className="text-xs text-muted-foreground">暂无预设</p>
        ) : (
          <ul className="space-y-2">
            {systemPrompts.map((prompt) => (
              <li key={prompt.id} className="flex items-center gap-2 rounded-lg border p-3">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1.5">
                    <span className="truncate text-sm font-medium">{prompt.name}</span>
                    {prompt.isDefault ? (
                      <Badge variant="secondary" className="shrink-0 text-[10px]">
                        默认
                      </Badge>
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
                      aria-label="编辑"
                      className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                    >
                      <Pencil className="size-3.5" />
                    </button>
                    <button
                      onClick={() => void removePreset(prompt)}
                      aria-label="删除"
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
        <div className="mb-2 text-xs font-medium text-muted-foreground">提示词增强</div>
        <p className="mb-2 text-xs leading-relaxed text-muted-foreground">
          追加到系统提示词末尾的自定义内容,对所有会话生效。
        </p>
        <Textarea
          className="min-h-24 resize-y text-sm"
          placeholder="输入要追加的增强内容…"
          value={enhancement}
          onChange={(e) => setEnhancement(e.target.value)}
        />
        <div className="mt-2 flex items-center justify-end gap-2">
          {enhancementSaved ? <span className="text-xs text-muted-foreground">已保存</span> : null}
          <Button size="sm" onClick={saveEnhancement}>
            保存
          </Button>
        </div>
      </section>

      {/* ── enhancement toggles ── */}
      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">增强开关</div>
        <div className="space-y-3">
          <ToggleRow
            label="Mermaid 图表增强"
            description="引导模型在解释流程、架构时输出 Mermaid 图表。"
            checked={mermaidEnabled}
            onCheckedChange={(checked) => {
              setMermaidEnabled(checked)
              setMermaidEnhancementEnabled(checked)
            }}
          />
          <ToggleRow
            label="任务列表规则"
            description="引导模型用 Task 工具管理多步任务进度。"
            checked={taskEnabled}
            onCheckedChange={(checked) => {
              setTaskEnabled(checked)
              setTaskEnhancementEnabled(checked)
            }}
          />
          {showCopilotToggle ? (
            <ToggleRow
              label="Copilot 结束前确认"
              description="要求 Copilot 会话结束前必须调用 conclusion_with_options 工具向你确认,否则视为未完成。"
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
          <ResponsiveDialogTitle>{editingPrompt ? "编辑预设" : "新增预设"}</ResponsiveDialogTitle>
          <div className="mt-3 space-y-2.5">
            <Input placeholder="名称" value={name} onChange={(e) => setName(e.target.value)} />
            <Textarea
              className="min-h-40 resize-y text-sm"
              placeholder="提示词内容"
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            {dialogError ? <p className="text-xs text-destructive">{dialogError}</p> : null}
            <div className="flex justify-end gap-2">
              <Button size="sm" variant="secondary" onClick={closeDialog}>
                取消
              </Button>
              <Button
                size="sm"
                onClick={() => void savePreset()}
                disabled={saving || !name.trim() || !content.trim()}
              >
                {saving ? "保存中…" : "保存"}
              </Button>
            </div>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
