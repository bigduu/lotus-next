import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useCallback, useEffect, useRef, useState } from "react"
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
  useUiLocale()
  const [workflows, setWorkflows] = useState<CommandItem[]>([])
  const [loading, setLoading] = useState(true)
  const [listError, setListError] = useState<string | null>(null)

  // editor state — open when creating a new workflow or one is selected
  const [selectedName, setSelectedName] = useState<string | null>(null)
  const [creating, setCreating] = useState(false)
  const [editorName, setEditorName] = useState("")
  const [editorContent, setEditorContent] = useState("")
  const [loadingContent, setLoadingContent] = useState(false)
  const selectSeqRef = useRef(0)
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
      setListError(uiText("could_not_load_workflow_list_2b2396a1", { v0: getErrorMessage(error) }))
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
    // Guard against out-of-order responses: rapidly clicking A then B must not
    // put A's markdown into B's editor (saving would overwrite B with A).
    const seq = ++selectSeqRef.current
    try {
      const detail = await commandService.getWorkflowCommand(name)
      if (selectSeqRef.current !== seq) return
      setEditorContent(detail.content ?? "")
    } catch (error) {
      if (selectSeqRef.current !== seq) return
      setEditorError(uiText("could_not_load_content_1df3cf32", { v0: getErrorMessage(error) }))
    } finally {
      if (selectSeqRef.current === seq) setLoadingContent(false)
    }
  }

  const save = async () => {
    const name = editorName.trim()
    setEditorError(null)
    if (!isSafeWorkflowName(name)) {
      setEditorError(uiText("invalid_name_required_and_cannot_contain_or_42cdaab3"))
      return
    }
    if (creating && workflows.some((workflow) => workflow.name === name)) {
      setEditorError(uiText("a_workflow_named_already_exists_1194d8fa", { v0: name }))
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
      setEditorError(uiText("could_not_save_c4b7c511", { v0: getErrorMessage(error) }))
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
      setListError(uiText("could_not_delete_e74a58dc", { v0: name, v1: getErrorMessage(error) }))
    }
  }

  const editorOpen = creating || selectedName !== null

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-foreground">{uiText("markdown_workflows_can_be_invoked_in_chat_with_name_8bf54549")}</p>
        <div className="flex shrink-0 gap-1.5">
          <Button size="sm" variant="ghost" onClick={() => void reload()} aria-label={uiText("refresh_aee88743")}>
            <RefreshCw className={cn("size-4", loading && "animate-spin")} />
          </Button>
          <Button size="sm" variant="secondary" onClick={startCreate}>
            <Plus className="size-4" />{uiText("add_0006d696")}</Button>
        </div>
      </div>

      {listError ? <p className="text-xs text-destructive">{listError}</p> : null}

      {editorOpen ? (
        <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
          <Input
            placeholder={uiText("name_without_md_extension_d694eedf")}
            value={editorName}
            disabled={!creating}
            onChange={(e) => {
              setEditorName(e.target.value)
              setDirty(true)
            }}
          />
          <Textarea
            className="min-h-48 resize-y font-mono text-xs"
            placeholder={loadingContent ? uiText("loading_4927a53b") : uiText("markdown_content_eefe6dfc")}
            value={editorContent}
            disabled={loadingContent}
            onChange={(e) => {
              setEditorContent(e.target.value)
              setDirty(true)
            }}
          />
          {editorError ? <p className="text-xs text-destructive">{editorError}</p> : null}
          <div className="flex items-center justify-end gap-2">
            {savedTick ? <span className="text-xs text-muted-foreground">{uiText("saved_1bd91a7d")}</span> : null}
            <Button size="sm" variant="secondary" onClick={closeEditor}>
              {uiText("close_3fd47edc")}</Button>
            <Button size="sm" onClick={() => void save()} disabled={saving || !dirty || !editorName.trim()}>
              {saving ? uiText("saving_ff509c9b") : uiText("save_a3030bf8")}
            </Button>
          </div>
        </div>
      ) : null}

      {loading && workflows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{uiText("loading_4927a53b")}</p>
      ) : workflows.length === 0 ? (
        <p className="text-xs text-muted-foreground">{uiText("no_workflows_yet_5c7b21e5")}</p>
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
                  aria-label={uiText("delete_2f9daa82")}
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
