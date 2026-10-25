import { useEffect, useId, useState } from "react"
import { AlertCircle, Check, ChevronDown, FolderGit2, GitBranch, LoaderCircle, RefreshCw } from "lucide-react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { getErrorMessage } from "@services/api/errors"
import { worktreeService, type ProjectWorktrees } from "@services/workspace/WorktreeService"
import type { NewChatWorktreeControlProps } from "@services/workspace/newChatWorktreeTypes"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"

const normalizePath = (path: string | null | undefined) => path?.replace(/\/+$/, "") || "/"
const folderName = (path: string) => path.split("/").filter(Boolean).at(-1) || path
const generateName = () => `chat-${new Date().toISOString().slice(0, 10).replaceAll("-", "")}-${crypto.randomUUID().slice(0, 6)}`

type Inventory = {
  context: string
  loading: boolean
  data?: ProjectWorktrees
  error?: string
}

/** A draft-only selector. Creating and binding a worktree belongs to first-send preparation. */
export function NewChatWorktreeControl({
  projectId, workspacePath, value, onChange, disabled = false, preparedPath, error,
}: NewChatWorktreeControlProps) {
  useUiLocale()
  const id = useId()
  const [open, setOpen] = useState(false)
  const [revision, setRevision] = useState(0)
  const [inventory, setInventory] = useState<Inventory | null>(null)
  const context = JSON.stringify([projectId, workspacePath ?? null])
  const current = inventory?.context === context ? inventory : null
  const loading = !!projectId && (!current || current.loading)
  const repositories = current?.data?.repositories.filter((repo) => !repo.error) ?? []
  const selectedSource = repositories.find((repo) => repo.path === value?.repository)
  const defaultSource = repositories.find((repo) => normalizePath(repo.path) === normalizePath(workspacePath)) ?? repositories[0]
  const source = value ? selectedSource : defaultSource
  const sourceDiffers = !!workspacePath && !!source && normalizePath(source.path) !== normalizePath(workspacePath)
  const locked = disabled || !!preparedPath
  const validName = !value || /^[A-Za-z0-9_-]{1,80}$/.test(value.name)
  const target = value?.root && value.name ? `${value.root.replace(/\/+$/, "")}/${value.name}` : null

  useEffect(() => {
    if (!open || !projectId) return
    let cancelled = false
    setInventory({ context, loading: true })
    void worktreeService.list(projectId).then((data) => {
      if (!cancelled) setInventory({ context, loading: false, data })
    }).catch((failure) => {
      if (!cancelled) setInventory({ context, loading: false, error: getErrorMessage(failure) })
    })
    return () => { cancelled = true }
  }, [open, projectId, context, revision])

  const selectWorktree = () => {
    if (locked || loading || !projectId || !defaultSource || value) return
    const name = generateName()
    onChange({ repository: defaultSource.path, root: current?.data?.default_root ?? "", name, branch: `chat/${name}` })
  }

  return <div className="min-w-0 max-w-full space-y-1" data-new-chat-worktree-control>
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button type="button" aria-label={uiText("chat_worktree_control")} title={preparedPath || value?.repository || workspacePath || uiText("chat_worktree_current")}
          className={`flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition-colors hover:text-foreground ${value ? "border-primary/30 bg-primary/10 text-primary" : "bg-card text-muted-foreground"}`}>
          {error ? <AlertCircle className="size-3.5 shrink-0" /> : preparedPath ? <Check className="size-3.5 shrink-0" /> : value ? <GitBranch className="size-3.5 shrink-0" /> : <FolderGit2 className="size-3.5 shrink-0" />}
          <span className="truncate">{preparedPath ? uiText("chat_worktree_ready") : value ? uiText("chat_worktree_new") : uiText("chat_worktree_current")}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent side="top" align="start" className="space-y-4 rounded-xl p-4" aria-label={uiText("chat_worktree_control")}
        style={{ width: "25rem", maxWidth: "calc(100vw - 24px)", maxHeight: "min(38rem, 75dvh)", overflowY: "auto" }}>
        <div className="space-y-1">
          <h3 className="text-sm font-semibold">{uiText("chat_worktree_control")}</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">{uiText("chat_worktree_draft_hint")}</p>
        </div>
        <div className="grid grid-cols-2 gap-2" role="group" aria-label={uiText("chat_worktree_mode")}>
          <button type="button" aria-pressed={!value} disabled={locked} onClick={() => { if (!locked && value) onChange(null) }}
            className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs disabled:opacity-50 ${!value ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}>
            <FolderGit2 className="size-3.5" />{uiText("chat_worktree_current")}
          </button>
          <button type="button" aria-pressed={!!value} disabled={locked || loading || !projectId || !defaultSource} onClick={selectWorktree}
            className={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs disabled:opacity-50 ${value ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}>
            <GitBranch className="size-3.5" />{uiText("chat_worktree_new")}
          </button>
        </div>
        {!value && <div className="space-y-1 text-xs">
          <p className="font-medium">{uiText("chat_worktree_selected_workspace")}</p>
          <p className="break-all text-muted-foreground">{workspacePath || uiText("chat_worktree_default_workspace")}</p>
        </div>}
        {!projectId ? <p role="status" className="text-xs text-muted-foreground">{uiText("chat_worktree_no_project")}</p> : <>
          {loading && <p role="status" className="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle className="size-3.5 animate-spin" />{uiText("chat_worktree_loading")}</p>}
          {current?.error && <div className="space-y-2"><p role="alert" className="break-words text-xs text-destructive">{uiText("chat_worktree_inventory_failed", { error: current.error })}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setRevision((n) => n + 1)}><RefreshCw className="size-3.5" />{uiText("chat_worktree_reload")}</Button></div>}
          {!loading && current?.data && !repositories.length && <div className="space-y-1 text-xs text-muted-foreground"><p role="status">{uiText("chat_worktree_no_git")}</p>
            {current.data.repositories.filter((repo) => repo.error).map((repo) => <p key={repo.path} className="break-all">{repo.path}: {repo.error}</p>)}</div>}
          {value && <div className="space-y-3">
            <div className="space-y-1.5">
              <label htmlFor={`${id}-source`} className="text-xs font-medium">{uiText("chat_worktree_source")}</label>
              <select id={`${id}-source`} value={value.repository} disabled={locked || loading || !repositories.length}
                className="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-xs disabled:opacity-50"
                onChange={(event) => { if (!locked && repositories.some((repo) => repo.path === event.target.value)) onChange({ ...value, repository: event.target.value }) }}>
                {!selectedSource && <option value={value.repository}>{value.repository}</option>}
                {repositories.map((repo) => <option key={repo.path} value={repo.path}>{repo.path}</option>)}
              </select>
              <p className="break-all text-xs text-muted-foreground">{uiText("chat_worktree_source_head", { path: value.repository })}</p>
              {sourceDiffers && <p role="note" className="text-xs text-amber-600 dark:text-amber-400">{uiText("chat_worktree_source_differs", { workspace: workspacePath })}</p>}
              {!loading && current?.data && !selectedSource && <p role="alert" className="text-xs text-destructive">{uiText("chat_worktree_source_unavailable")}</p>}
            </div>
            <div className="space-y-1.5">
              <label htmlFor={`${id}-root`} className="text-xs font-medium">{uiText("chat_worktree_root")}</label>
              <Input id={`${id}-root`} value={value.root} disabled={locked} placeholder="/Volumes/External/worktrees" autoComplete="off"
                onChange={(event) => { if (!locked) onChange({ ...value, root: event.target.value }) }} />
              <p className="text-xs leading-relaxed text-muted-foreground">{uiText("chat_worktree_root_hint")}</p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1.5"><label htmlFor={`${id}-name`} className="text-xs font-medium">{uiText("chat_worktree_name")}</label>
                <Input id={`${id}-name`} value={value.name} disabled={locked} maxLength={80} aria-invalid={!validName} aria-describedby={`${id}-name-hint`} autoComplete="off"
                  onChange={(event) => { if (!locked) onChange({ ...value, name: event.target.value }) }} /></div>
              <div className="space-y-1.5"><label htmlFor={`${id}-branch`} className="text-xs font-medium">{uiText("chat_worktree_branch")}</label>
                <Input id={`${id}-branch`} value={value.branch} disabled={locked} autoComplete="off"
                  onChange={(event) => { if (!locked) onChange({ ...value, branch: event.target.value }) }} /></div>
            </div>
            <p id={`${id}-name-hint`} className={`text-xs ${validName ? "text-muted-foreground" : "text-destructive"}`}>{uiText("chat_worktree_name_hint")}</p>
            <div className="space-y-1 rounded-lg bg-muted/60 p-2.5 text-xs"><p className="font-medium">{uiText("chat_worktree_target")}</p>
              <p className="break-all font-mono" data-worktree-target>{target || uiText("chat_worktree_target_empty")}</p></div>
            <p className="text-xs leading-relaxed text-muted-foreground">{uiText("chat_worktree_clean_hint")}</p>
          </div>}
        </>}
        {error && <p className="break-words text-xs text-destructive">{error}</p>}
        {preparedPath && <p role="status" className="break-all rounded-lg bg-primary/10 p-2.5 text-xs">{uiText("chat_worktree_created", { path: preparedPath })}</p>}
        {locked && <p className="text-xs text-muted-foreground">{uiText("chat_worktree_locked")}</p>}
      </PopoverContent>
    </Popover>
    {preparedPath && <p className="truncate text-xs text-muted-foreground" style={{ maxWidth: "16rem" }} title={preparedPath}>{folderName(preparedPath)} · {preparedPath}</p>}
    {error && <p role="alert" className="max-w-sm break-words text-xs text-destructive">{error}</p>}
  </div>
}
