import { Check, Folder, Loader2, X } from "@lucide/solid"
import { createEffect, createSignal, For, onSettled, Show } from "solid-js"
import { workspaceService } from "@services/workspace"
import type { Workspace } from "@services/workspace/types"
import { cn } from "@/lib/utils"
import { Button } from "../ui/button"
import { Input } from "../ui/input"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogTitle } from "../ui/responsive-dialog"
import { createUiText } from "./uiText"

export function WorkspacePicker(props: {
  current: string | null
  locked: boolean
  onSelect: (path: string | null) => void
  onClose: () => void
}) {
  const text = createUiText()
  const [path, setPath] = createSignal("")
  const [loading, setLoading] = createSignal(true)
  const [validating, setValidating] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [recent, setRecent] = createSignal<Workspace[]>([])
  const [folders, setFolders] = createSignal<Array<{ name: string; path: string }>>([])
  let active = true
  let input!: HTMLInputElement

  onSettled(() => {
    void workspaceService.getCombinedSuggestions()
      .then((items) => { if (active) setRecent(items) }).catch(() => {})
      .finally(() => { if (active) setLoading(false) })
    return () => { active = false }
  })

  createEffect(path, (value) => {
    if (!value.startsWith("/")) { setFolders([]); return }
    let current = true
    const index = value.lastIndexOf("/")
    const parent = index <= 0 ? "/" : value.slice(0, index)
    const prefix = value.slice(index + 1).toLowerCase()
    const timer = setTimeout(() => {
      void workspaceService.browseFolder(parent)
        .then((response) => {
          if (current) setFolders(response.folders.filter((item) => item.name.toLowerCase().startsWith(prefix)).slice(0, 500))
        })
        .catch(() => { if (current) setFolders([]) })
    }, 180)
    return () => { current = false; clearTimeout(timer) }
  })

  const choose = (value: string | null) => {
    if (!active) return
    props.onSelect(value)
    props.onClose()
  }

  const validate = async () => {
    const trimmed = path().trim()
    const candidate = trimmed.length > 1 ? trimmed.replace(/\/+$/, "") : trimmed
    if (!candidate || validating()) return
    setValidating(true)
    setError(null)
    try {
      const result = await workspaceService.validatePath(candidate)
      if (!active) return
      if (!result.is_valid) {
        setError(result.error_message || text("invalid_path_1f83ecf9"))
        return
      }
      await workspaceService.addRecent(candidate).catch(() => {})
      if (active) choose(candidate)
    } catch {
      if (active) setError(text("validation_failed_a096c117"))
    } finally {
      if (active) setValidating(false)
    }
  }

  return (
    <ResponsiveDialog open onOpenChange={(open) => { if (!open) props.onClose() }}>
      <ResponsiveDialogContent showCloseButton={false} class="p-0 sm:max-w-lg"
        onOpenAutoFocus={(event: Event) => { event.preventDefault(); input.focus() }}>
        <div class="flex items-center justify-between border-b px-4 py-3">
          <ResponsiveDialogTitle>{text("select_working_directory_18240aa3")}</ResponsiveDialogTitle>
          <Button size="icon" variant="ghost" aria-label={text("close_3fd47edc")} onClick={props.onClose}><X /></Button>
        </div>
        <div class="min-h-0 flex-1 space-y-3 overflow-y-auto p-4">
          <Show when={props.locked}>
            <p class="rounded-md bg-muted/50 px-2.5 py-2 text-xs text-muted-foreground">
              {text("workspace_locked_notice").replace(/<\/?strong>/g, "")}
            </p>
          </Show>
          <form class="flex gap-2" onSubmit={(event) => {
            event.preventDefault()
            void validate()
          }}>
            <Input ref={(element) => { input = element }} class="flex-1"
              placeholder={text("absolute_path_e_g_home_you_project_52ea40f9")} value={path()}
              onInput={(event) => setPath(event.currentTarget.value)} />
            <Button size="sm" type="submit" disabled={!path().trim() || validating()}>
              {validating() ? <Loader2 class="size-4 animate-spin" /> : text("use_cdfd0b34")}
            </Button>
          </form>
          <Show when={folders().length}>
            <ul class="-mt-1 max-h-80 overflow-y-auto rounded-md border bg-background">
              <For each={folders()} keyed={(item) => item.path}>{(item) => (
                <li><button type="button" onClick={() => setPath(item().path + "/")}
                  class="flex w-full items-center gap-2 px-2.5 py-1.5 text-left text-sm hover:bg-accent">
                  <Folder class="size-3.5 shrink-0 text-muted-foreground" />
                  <span class="truncate">{item().name}</span>
                  <span class="ml-auto truncate text-xs text-muted-foreground">{item().path}</span>
                </button></li>
              )}</For>
            </ul>
          </Show>
          <Show when={error()}><p role="alert" class="text-xs text-destructive">{error()}</p></Show>
          <Show when={props.current}>
            <button type="button" onClick={() => choose(null)}
              class="text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline">
              {text("clear_use_default_directory_5619a464")}
            </button>
          </Show>
          <div class="space-y-1.5">
            <div class="text-xs font-medium text-muted-foreground">{text("recent_suggested_035f05c6")}</div>
            <Show when={recent().length} fallback={<p class="text-xs text-muted-foreground">
              {text(loading() ? "loading_4927a53b" : "none_yet_b336a174")}
            </p>}>
              <ul class="space-y-1">
                <For each={recent()} keyed={(item) => item.path}>{(item) => (
                  <li><button type="button" onClick={() => choose(item().path)}
                    class={cn("flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-left hover:bg-accent", props.current === item().path && "bg-accent")}>
                    <Folder class="size-4 shrink-0 text-muted-foreground" />
                    <div class="min-w-0 flex-1">
                      <div class="truncate text-sm">{item().workspace_name || item().path.split("/").at(-1) || item().path}</div>
                      <div class="truncate text-xs text-muted-foreground">{item().path}</div>
                    </div>
                    <Show when={props.current === item().path}><Check class="size-4 shrink-0 text-primary" /></Show>
                  </button></li>
                )}</For>
              </ul>
            </Show>
          </div>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
