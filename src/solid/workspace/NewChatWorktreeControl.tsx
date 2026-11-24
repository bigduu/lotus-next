import { createEffect, createMemo, createSignal, createUniqueId, For, Show } from "solid-js"
import { AlertCircle, Check, ChevronDown, FolderGit2, GitBranch, LoaderCircle, RefreshCw } from "@lucide/solid"
import { createUiText } from "../shell/uiText"
import { getErrorMessage } from "@services/api/errors"
import { worktreeService, type ProjectWorktrees } from "@services/workspace/WorktreeService"
import { createWorktreeSelection, type NewChatWorktreeControlProps } from "@services/workspace/newChatWorktreeTypes"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { composerControlClassName } from "@/lib/composer/composerStyles"
import { cn } from "@/lib/utils"
import { environmentPathName } from "../chat/environment/environmentSources"

const normalizePath = (path: string | null | undefined) => path?.replace(/\/+$/, "") || "/"
const folderName = (path: string) => path.split("/").filter(Boolean).at(-1) || path

type Inventory = {
  context: string
  loading: boolean
  data?: ProjectWorktrees
  error?: string
}

/** A draft-only selector. Creating and binding a worktree belongs to first-send preparation. */
export function NewChatWorktreeControl(props: NewChatWorktreeControlProps) {
  const uiText = createUiText()
  const id = createUniqueId()
  const [open, setOpen] = createSignal(false)
  const [revision, setRevision] = createSignal(0)
  const [inventory, setInventory] = createSignal<Inventory | null>(null)
  const context = () => JSON.stringify([props.projectId, props.workspacePath ?? null])
  const current = () => inventory()?.context === context() ? inventory() : null
  const loading = () => Boolean(props.projectId && (!current() || current()?.loading))
  const repositories = createMemo(() => current()?.data?.repositories.filter((repo) => !repo.error) ?? [])
  const selectedSource = () => repositories().find((repo) => repo.path === props.value?.repository)
  const defaultSource = () => repositories().find((repo) => normalizePath(repo.path) === normalizePath(props.workspacePath)) ?? repositories()[0]
  const source = () => props.value ? selectedSource() : defaultSource()
  const sourceDiffers = () => Boolean(props.workspacePath && source() && normalizePath(source()?.path) !== normalizePath(props.workspacePath))
  const locked = () => props.disabled || Boolean(props.preparedPath)
  const newWorktree = () => props.automatic || Boolean(props.value)
  const validName = () => !props.value || /^[A-Za-z0-9_-]{1,80}$/.test(props.value.name)
  const target = () => props.value?.root && props.value.name ? `${props.value.root.replace(/\/+$/, "")}/${props.value.name}` : null

  createEffect(
    () => ({ open: open(), projectId: props.projectId, context: context(), revision: revision() }),
    ({ open, projectId, context }) => {
      if (!open || !projectId) return
      let cancelled = false
      setInventory({ context, loading: true })
      void worktreeService.list(projectId).then((data) => {
        if (!cancelled) setInventory({ context, loading: false, data })
      }).catch((failure) => {
        if (!cancelled) setInventory({ context, loading: false, error: getErrorMessage(failure) })
      })
      return () => { cancelled = true }
    },
  )

  const selectWorktree = () => {
    const repository = defaultSource()
    if (locked() || loading() || !props.projectId || !repository || props.value) return
    props.onChange(createWorktreeSelection(repository.path, current()?.data?.default_root ?? ""))
  }

  return <div class="min-w-0 max-w-full space-y-1" data-new-chat-worktree-control>
    <Popover open={open()} placement="top-start" onOpenChange={setOpen}>
      <PopoverTrigger type="button" aria-label={uiText("chat_worktree_control")} title={props.preparedPath || props.value?.repository || props.workspacePath || uiText("chat_worktree_current")}
          class={cn(composerControlClassName, newWorktree() && "bg-primary/10 text-primary")}>
          {props.error ? <AlertCircle class="size-4 shrink-0" /> : props.preparedPath ? <Check class="size-4 shrink-0" /> : newWorktree() ? <GitBranch class="size-4 shrink-0" /> : <FolderGit2 class="size-4 shrink-0" />}
          <span class="truncate">{props.preparedPath ? uiText("chat_worktree_ready") : newWorktree() ? uiText("chat_worktree_new")
            : props.projectId && props.workspacePath ? environmentPathName(props.workspacePath) : uiText("chat_worktree_current")}</span>
          <ChevronDown class="size-3 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent class="space-y-4 rounded-xl p-4" aria-label={uiText("chat_worktree_control")}
        style={{ width: "25rem", "max-width": "calc(100vw - 24px)", "max-height": "min(38rem, 75dvh)", "overflow-y": "auto" }}>
        <div class="space-y-1">
          <h3 class="text-sm font-semibold">{uiText("chat_worktree_control")}</h3>
          <p class="text-xs leading-relaxed text-muted-foreground">{uiText("chat_worktree_draft_hint")}</p>
        </div>
        <div class="grid grid-cols-2 gap-2" role="group" aria-label={uiText("chat_worktree_mode")}>
          <button type="button" aria-pressed={newWorktree() ? "false" : "true"} disabled={locked()} onClick={() => { if (!locked() && newWorktree()) props.onChange(null) }}
            class={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs disabled:opacity-50 ${!newWorktree() ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}>
            <FolderGit2 class="size-3.5" />{uiText("chat_worktree_current")}
          </button>
          <button type="button" aria-pressed={newWorktree() ? "true" : "false"} disabled={locked() || loading() || !props.projectId || !defaultSource()} onClick={selectWorktree}
            class={`flex items-center justify-center gap-1.5 rounded-lg border p-2 text-xs disabled:opacity-50 ${newWorktree() ? "border-primary/40 bg-primary/10 text-primary" : "text-muted-foreground hover:bg-muted"}`}>
            <GitBranch class="size-3.5" />{uiText("chat_worktree_new")}
          </button>
        </div>
        {props.automatic && !props.value && <p class="text-xs text-muted-foreground">{uiText("chat_worktree_project_default")}</p>}
        {!newWorktree() && <div class="space-y-1 text-xs">
          <p class="font-medium">{uiText("chat_worktree_selected_workspace")}</p>
          <p class="break-all text-muted-foreground">{props.workspacePath || uiText("chat_worktree_default_workspace")}</p>
        </div>}
        {!props.projectId ? <p role="status" class="text-xs text-muted-foreground">{uiText("chat_worktree_no_project")}</p> : <>
          {loading() && <p role="status" class="flex items-center gap-2 text-xs text-muted-foreground"><LoaderCircle class="size-3.5 animate-spin" />{uiText("chat_worktree_loading")}</p>}
          {current()?.error && <div class="space-y-2"><p role="alert" class="break-words text-xs text-destructive">{uiText("chat_worktree_inventory_failed", { error: current()?.error ?? "" })}</p>
            <Button type="button" variant="outline" size="sm" onClick={() => setRevision((n) => n + 1)}><RefreshCw class="size-3.5" />{uiText("chat_worktree_reload")}</Button></div>}
          {!loading() && current()?.data && !repositories().length && <div class="space-y-1 text-xs text-muted-foreground"><p role="status">{uiText("chat_worktree_no_git")}</p>
            <For each={(current()?.data?.repositories ?? []).filter((repo) => repo.error)}>{(repo) => <p class="break-all">{repo.path}: {repo.error}</p>}</For></div>}
          <Show when={props.value}>{(selection) => <div class="space-y-3">
            <div class="space-y-1.5">
              <label for={`${id}-source`} class="text-xs font-medium">{uiText("chat_worktree_source")}</label>
              <select id={`${id}-source`} value={selection().repository} disabled={locked() || loading() || !repositories().length}
                class="h-9 w-full min-w-0 rounded-md border bg-background px-2 text-xs disabled:opacity-50"
                onChange={(event) => { if (!locked() && repositories().some((repo) => repo.path === event.currentTarget.value)) props.onChange({ ...selection(), repository: event.currentTarget.value }) }}>
                {!selectedSource() && <option value={selection().repository}>{selection().repository}</option>}
                <For each={repositories()}>{(repo) => <option value={repo.path}>{repo.path}</option>}</For>
              </select>
              <p class="break-all text-xs text-muted-foreground">{uiText("chat_worktree_source_head", { path: selection().repository })}</p>
              {sourceDiffers() && <p role="note" class="text-xs text-amber-600 dark:text-amber-400">{uiText("chat_worktree_source_differs", { workspace: props.workspacePath })}</p>}
              {!loading() && current()?.data && !selectedSource() && <p role="alert" class="text-xs text-destructive">{uiText("chat_worktree_source_unavailable")}</p>}
            </div>
            <div class="space-y-1.5">
              <label for={`${id}-root`} class="text-xs font-medium">{uiText("chat_worktree_root")}</label>
              <Input id={`${id}-root`} value={selection().root} disabled={locked()} placeholder="/Volumes/External/worktrees" autocomplete="off"
                onInput={(event) => { if (!locked()) props.onChange({ ...selection(), root: event.currentTarget.value }) }} />
              <p class="text-xs leading-relaxed text-muted-foreground">{uiText("chat_worktree_root_hint")}</p>
            </div>
            <div class="grid grid-cols-2 gap-3">
              <div class="space-y-1.5"><label for={`${id}-name`} class="text-xs font-medium">{uiText("chat_worktree_name")}</label>
                <Input id={`${id}-name`} value={selection().name} disabled={locked()} maxlength={80} aria-invalid={validName() ? "false" : "true"} aria-describedby={`${id}-name-hint`} autocomplete="off"
                  onInput={(event) => { if (!locked()) props.onChange({ ...selection(), name: event.currentTarget.value }) }} /></div>
              <div class="space-y-1.5"><label for={`${id}-branch`} class="text-xs font-medium">{uiText("chat_worktree_branch")}</label>
                <Input id={`${id}-branch`} value={selection().branch} disabled={locked()} autocomplete="off"
                  onInput={(event) => { if (!locked()) props.onChange({ ...selection(), branch: event.currentTarget.value }) }} /></div>
            </div>
            <p id={`${id}-name-hint`} class={`text-xs ${validName() ? "text-muted-foreground" : "text-destructive"}`}>{uiText("chat_worktree_name_hint")}</p>
            <div class="space-y-1 rounded-lg bg-muted/60 p-2.5 text-xs"><p class="font-medium">{uiText("chat_worktree_target")}</p>
              <p class="break-all font-mono" data-worktree-target>{target() || uiText("chat_worktree_target_empty")}</p></div>
            <p class="text-xs leading-relaxed text-muted-foreground">{uiText("chat_worktree_clean_hint")}</p>
          </div>}</Show>
        </>}
        {props.error && <p class="break-words text-xs text-destructive">{props.error}</p>}
        {props.preparedPath && <p role="status" class="break-all rounded-lg bg-primary/10 p-2.5 text-xs">{uiText("chat_worktree_created", { path: props.preparedPath })}</p>}
        {locked() && <p class="text-xs text-muted-foreground">{uiText("chat_worktree_locked")}</p>}
      </PopoverContent>
    </Popover>
    {props.preparedPath && <p class="truncate text-xs text-muted-foreground" style={{ "max-width": "16rem" }} title={props.preparedPath}>{folderName(props.preparedPath)} · {props.preparedPath}</p>}
    {props.error && <p role="alert" class="max-w-sm break-words text-xs text-destructive">{props.error}</p>}
  </div>
}
