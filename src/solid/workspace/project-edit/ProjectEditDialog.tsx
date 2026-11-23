import { createUniqueId, For, onCleanup, Show } from "solid-js"
import { Folder, FolderOpen, FolderPlus, Loader2, Trash2 } from "@lucide/solid"

import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "../../ui/responsive-dialog"
import { createProjectEdit } from "./createProjectEdit"

export interface ProjectEditDialogProps {
  projectId: string
  onClose: () => void
}

export function ProjectEditDialog(props: ProjectEditDialogProps) {
  return <Show when={props.projectId} keyed>{(id) => <ProjectEditModal projectId={id} onClose={props.onClose} />}</Show>
}

function ProjectEditModal(props: ProjectEditDialogProps) {
  const text = createUiText()
  const nameId = createUniqueId()
  const form = createProjectEdit(props.projectId, () => props.onClose())
  const blocked = () => form.saving() || form.picking()
  let panel: HTMLDivElement | undefined
  let opener: HTMLElement | undefined
  const captureOpener = (element: HTMLDivElement) => {
    panel = element
    const active = document.activeElement
    if (active instanceof HTMLElement && active !== document.body && !element.contains(active)) opener = active
  }
  onCleanup(() => {
    const trigger = opener
    if (!trigger) return
    requestAnimationFrame(() => {
      if (trigger.isConnected && (document.activeElement === document.body || panel?.contains(document.activeElement))) {
        trigger.focus({ preventScroll: true })
      }
    })
  })

  return (
    <ResponsiveDialog open onOpenChange={(open) => { if (!open) form.close() }}>
      <ResponsiveDialogContent ref={captureOpener} class={`gap-0 p-0 ${form.confirmRemove() ? "sm:max-w-sm" : "sm:max-w-xl"}`}
        dismissable={!blocked()}>
        <Show when={form.confirmRemove()} fallback={
          <>
            <div class="border-b p-4">
              <ResponsiveDialogTitle>{text("edit_project_577feeef")}</ResponsiveDialogTitle>
              <ResponsiveDialogDescription class="mt-1">
                {text("bamboo_persists_names_and_source_directories_in_its_pro_20919dcd")}
              </ResponsiveDialogDescription>
            </div>
            <div class="min-h-0 flex-1 space-y-4 overflow-y-auto p-4">
              <Show when={form.loading()}>
                <div role="status" class="flex items-center gap-2 py-8 text-sm text-muted-foreground">
                  <Loader2 class="size-4 animate-spin" />{text("loading_project_6d8a4e84")}
                </div>
              </Show>
              <Show when={form.project()}>
                <div class="grid gap-1.5">
                  <label for={nameId} class="text-sm font-medium">{text("project_name_867698fb")}</label>
                  <Input id={nameId} value={form.name()} disabled={blocked()} autofocus
                    onInput={(event) => form.setName(event.currentTarget.value)} />
                </div>
                <SourceDirectories form={form} blocked={blocked()} />
              </Show>
              <Show when={form.error()}>
                <p role="alert" class="rounded-md bg-destructive/10 px-3 py-2 text-xs text-destructive">{form.error()}</p>
              </Show>
            </div>
            <div class="flex items-center justify-between gap-3 border-t px-4 py-3">
              <Show when={form.project()}>{(project) => (
                project().status === "archived" ? (
                  <Button variant="outline" disabled={blocked()} onClick={() => void form.removeOrRestore()}>
                    {text("restore_project_52a1d56b")}
                  </Button>
                ) : (
                  <Button variant="ghost" class="text-destructive hover:text-destructive" disabled={blocked()}
                    onClick={() => form.changeConfirmation(true)}>
                    {text("remove_local_project_e951cbd0")}
                  </Button>
                )
              )}</Show>
              <div class="ml-auto flex gap-2">
                <Button variant="secondary" disabled={blocked()} onClick={form.close}>{text("cancel_2cd0f3be")}</Button>
                <Button disabled={blocked() || form.loading() || !form.project() || !form.name().trim() || !form.primaryPath().trim()}
                  onClick={() => void form.save()}>
                  <Show when={form.saving()}><Loader2 class="size-4 animate-spin" /></Show>
                  {text("save_a3030bf8")}
                </Button>
              </div>
            </div>
          </>
        }>
          <div class="p-4 pb-2">
            <ResponsiveDialogTitle>{text("remove_bdb7b58b", { v0: form.project()?.name ?? "" })}</ResponsiveDialogTitle>
            <ResponsiveDialogDescription class="mt-2 leading-relaxed">
              {text("the_project_will_be_removed_from_new_session_choices_ex_d355c682")}
            </ResponsiveDialogDescription>
            <Show when={form.error()}><p role="alert" class="mt-2 text-xs text-destructive">{form.error()}</p></Show>
          </div>
          <div class="flex justify-end gap-2 p-4 pt-2">
            <Button variant="secondary" disabled={blocked()} onClick={() => form.changeConfirmation(false)}>
              {text("cancel_2cd0f3be")}
            </Button>
            <Button variant="destructive" disabled={blocked()} onClick={() => void form.removeOrRestore()}>
              <Show when={form.saving()}><Loader2 class="size-4 animate-spin" /></Show>
              {text("remove_project_84663136")}
            </Button>
          </div>
        </Show>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}

const pathInputClass = "h-8 min-w-0 flex-1 border-0 bg-transparent shadow-none focus-visible:ring-0"

function SourceDirectories(props: { form: ReturnType<typeof createProjectEdit>; blocked: boolean }) {
  const text = createUiText()
  const form = () => props.form
  return (
    <div class="space-y-2">
      <div>
        <div class="text-sm font-medium">{text("source_directories_28af332c")}</div>
        <p class="mt-0.5 text-xs text-muted-foreground">{text("the_primary_directory_is_the_default_workspace_for_new__2518446f")}</p>
      </div>
      <div class="overflow-hidden rounded-lg border">
        <div class="flex items-center gap-2 border-b px-3 py-2.5">
          <Folder class="size-4 shrink-0 text-muted-foreground" />
          <Input aria-label={text("primary_project_directory_0852e851")} class={pathInputClass}
            value={form().primaryPath()} onInput={(event) => form().setPrimaryPath(event.currentTarget.value)} disabled={props.blocked}
            placeholder={text("absolute_path_to_primary_directory_ab8e5c38")} />
          <span class="shrink-0 text-[11px] text-muted-foreground">{text("primary_5ccd91f4")}</span>
          <Show when={form().canPick()}>
            <Button size="icon" variant="ghost" class="size-8" disabled={props.blocked}
              aria-label={text("select_primary_project_directory_30a25dc5")} onClick={() => void form().choosePath("primary")}>
              <FolderOpen class="size-3.5" />
            </Button>
          </Show>
        </div>
        <For each={form().bindings()} keyed={(binding) => binding.path}>{(binding) => (
          <div class="flex items-center gap-2 border-b px-3 py-2.5 last:border-0">
            <Folder class="size-4 shrink-0 text-muted-foreground" />
            <span class="min-w-0 flex-1 truncate text-sm" title={binding().path}>{binding().path}</span>
            <Button size="icon" variant="ghost" class="size-8 text-muted-foreground hover:text-destructive" disabled={props.blocked}
              aria-label={text("remove_source_directory_c14882d9", { v0: binding().path })} onClick={() => form().removePath(binding().path)}>
              <Trash2 class="size-3.5" />
            </Button>
          </div>
        )}</For>
        <div class="flex items-center gap-2 px-3 py-2.5">
          <FolderPlus class="size-4 shrink-0 text-muted-foreground" />
          <Input aria-label={text("add_source_directory_398c49c7")} class={pathInputClass} value={form().newPath()}
            onInput={(event) => form().setNewPath(event.currentTarget.value)} disabled={props.blocked}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.isComposing) return
              event.preventDefault()
              form().addPath()
            }} placeholder={text("add_an_absolute_folder_path_0a395954")} />
          <Show when={form().canPick()}>
            <Button size="icon" variant="ghost" class="size-8" disabled={props.blocked}
              aria-label={text("select_source_directory_to_add_4b3ae33c")} onClick={() => void form().choosePath("binding")}>
              <FolderOpen class="size-3.5" />
            </Button>
          </Show>
          <Button size="sm" variant="ghost" disabled={props.blocked || !form().newPath().trim()} onClick={() => form().addPath()}>
            {text("add_7a8a11ea")}
          </Button>
        </div>
      </div>
    </div>
  )
}
