import { useCallback, useEffect, useState } from "react"
import { Plus, RefreshCw, Trash2 } from "lucide-react"
import { commandService, type CommandItem } from "@services/command"
import { serviceFactory } from "@services/common/ServiceFactory"
import { getErrorMessage } from "@services/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"

/**
 * Frontend mirror of the backend's `is_safe_workflow_name`
 * (bamboo-config paths.rs): the file stem of `{name}.md` under the
 * workflows dir — no separators, no traversal, no control chars.
 */
function isSafeWorkflowName(name: string): boolean {
  if (!name || name.trim() !== name || name.length > 255) return false
  if (name.includes("/") || name.includes("\\") || name.includes("..")) return false
  for (const ch of name) {
    const code = ch.charCodeAt(0)
    if (code < 0x20 || code === 0x7f) return false
  }
  return true
}

export function SettingsWorkflows() {
  const [workflows, setWorkflows] = useState<CommandItem[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  // editor state — open when creating a new workflow or one is selected
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editorName, setEditorName] = useState("")
  const [editorContent, setEditorContent] = useState("")
  const [loadingContent, setLoadingContent] = useState(false)
  const [saving, setSaving] = useState(false)
  const [dirty, setDirty] = useState(false)
  const [editorError, setEditorError] = useState<string | null>(null)
  const [savedTick, setSavedTick] = useState(false)

  const reload = useCallback(async (): Promise<CommandItem[]> => {
    setLoading(true)
    setListError(null)
    try {
      const response = await commandService.listCommands()
      const items = (response.commands ?? [])
        .filter((command) => command.type === "workflow")
        .sort((left, right) => left.name.localeCompare(right.name))
      setWorkflows(items)
      return items
    } catch (error) {
      setListError(`加载 workflow 列表失败:${getErrorMessage(error)}`)
      return []
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void reload()
  }, [reload])

  const closeEditor = () => {
    setSelectedName(null)
    setCreating(false)
    setEditorName("")
    setEditorContent("")
    setDirty(false)
    setEditorError(null)
  }

  const startCreate = () => {
    closeEditor()
    setCreating(true)
  }

  const select = async (name: string) => {
    setCreating(false)
    setSelectedName(name)
    setEditorName(name)
    setEditorContent("")
    setDirty(false)
    setEditorError(null)
    setLoadingContent(true)
    try {
      const detail = await commandService.getWorkflowCommand(name)
      setEditorContent(detail.content ?? "")
    } catch (error) {
      setEditorError(`加载内容失败:${getErrorMessage(error)}`)
    } finally {
      setLoadingContent(false)
    }
  }

  const save = async () => {
    const name = editorName.trim()
    setEditorError(null)
    if (!isSafeWorkflowName(name)) {
      setEditorError("名称无效:不能为空,且不能包含 /、\\ 或 ..")
      return
    }
    if (creating && workflows.some((workflow) => workflow.name === name)) {
      setEditorError(`已存在同名 workflow「${name}」`)
      return
    }
    setSaving(true)
    try {
      await serviceFactory.saveWorkflow(name, editorContent)
      setDirty(false)
      setCreating(false)
      setSelectedName(name)
      setSavedTick(true)
      setTimeout(() => setSavedTick(false), 2000)
      await reload()
    } catch (error) {
      setEditorError(`保存失败:${getErrorMessage(error)}`)
    } finally {
      setSaving(false)
    }
  }

  const remove = async (name: string) => {
    setListError(null)
    try {
      await serviceFactory.deleteWorkflow(name)
      if (selectedName === name) closeEditor()
      await reload()
    } catch (error) {
      setListError(`删除「${name}」失败:${getErrorMessage(error)}`)
    }
  }

  const editorOpen = creating || selectedName !== null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">Markdown workflow,可在聊天中以 /名称 调用。</p>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => void reload()} aria-label="刷新">
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
          <Button size="sm" variant="secondary" onClick={startCreate}>
            <Plus className="size-4" /> 新增
          </Button>
        </div>
      </div>

      {listError ? <p className="text-xs text-destructive">{listError}</p> : null}

      {editorOpen ? (
        <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
          <Input
            placeholder="名称(不含 .md 后缀)"
            value={editorName}
            disabled={!creating}
            onChange={(e) => {
              setEditorName(e.target.value)
              setDirty(true)
            }}
          />
          <Textarea
            className="min-h-48 resize-y font-mono text-xs"
            placeholder={loadingContent ? "加载中…" : "Markdown 内容"}
            value={editorContent}
            disabled={loadingContent}
            onChange={(e) => {
              setEditorContent(e.target.value)
              setDirty(true)
            }}
          />
          {editorError ? <p className="text-xs text-destructive">{editorError}</p> : null}
          <div className="flex items-center justify-end gap-2">
            {savedTick ? <span className="text-xs text-muted-foreground">已保存</span> : null}
            <Button size="sm" variant="secondary" onClick={closeEditor}>
              关闭
            </Button>
            <Button size="sm" onClick={() => void save()} disabled={saving || !dirty || !editorName.trim()}>
              {saving ? "保存中…" : "保存"}
            </Button>
          </div>
        </div>
      ) : null}

      {loading && workflows.length === 0 ? (
        <p className="text-xs text-muted-foreground">加载中…</p>
      ) : workflows.length === 0 ? (
        <p className="text-xs text-muted-foreground">暂无 workflow</p>
      ) : (
        <ul className="space-y-2">
          {workflows.map((workflow) => {
            const filename =
              typeof workflow.metadata?.filename === "string"
                ? workflow.metadata.filename
                : `${workflow.name}.md`
            return (
              <li
                key={workflow.id}
                className={cn(
                  "flex cursor-pointer items-center gap-2 rounded-lg border p-3",
                  selectedName === workflow.name && "border-primary/50 bg-muted/40",
                )}
                onClick={() => void select(workflow.name)}
              >
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">/{workflow.name}</div>
                  <div className="truncate text-xs text-muted-foreground">{filename}</div>
                </div>
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    void remove(workflow.name)
                  }}
                  aria-label="删除"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
