import { AlertCircle, CircleDot, MoreHorizontal, Pencil, RotateCcw } from "@lucide/solid"
import { createSignal, createUniqueId, Errored, lazy, Loading, Show } from "solid-js"
import type { ChatItem } from "@shared/types/chatMessages"
import { cn } from "@/lib/utils"
import { Button } from "../ui/button"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu"
import { Input } from "../ui/input"
import { createUiText } from "./uiText"

const ManagedSessionsDialog = lazy(() => import("../workbench/inspector/SupervisorManagedSessions"), {
  export: "SupervisorManagedSessionsDialog",
})
const ProjectScopeDialog = lazy(() => import("../workbench/inspector/SupervisorProjectScopeDialog"), {
  export: "SupervisorProjectScopeDialog",
})

interface Props {
  chat?: ChatItem
  active: boolean
  unread: boolean
  busy: boolean
  running: boolean
  disabled: boolean
  onSelect: () => void
  onRename: (id: string, title: string) => void | Promise<void>
  onClear: (chat: ChatItem) => void
}

export function SupervisorEntry(props: Props) {
  const text = createUiText()
  const descriptionId = createUniqueId()
  const statusId = createUniqueId()
  const failureId = createUniqueId()
  const nameId = createUniqueId()
  const [menuOpen, setMenuOpen] = createSignal(false)
  const [surface, setSurface] = createSignal<"rename" | "sessions" | "scope" | null>(null)
  const [draft, setDraft] = createSignal("")
  const [saving, setSaving] = createSignal(false)
  const [renameError, setRenameError] = createSignal(false)
  let menuTrigger: HTMLButtonElement | undefined
  let nameInput: HTMLInputElement | undefined
  let contextFocus: HTMLElement | undefined
  let renameFocus: HTMLElement | undefined
  let renameTarget: Pick<ChatItem, "id" | "createdAtExact"> | undefined

  const title = () => props.chat?.title?.trim() || "Supervisor"
  const failed = () => !!props.chat && !props.running && props.chat.lastRunStatus === "error"
  const status = () => props.running ? text("running_1f0eb99b") : props.unread ? text("unread_messages_519491f4") : ""
  const focusMenu = () => menuTrigger?.focus({ preventScroll: true })
  const changeMenu = (open: boolean) => {
    setMenuOpen(open)
    if (open) return
    const previous = contextFocus
    contextFocus = undefined
    if (previous) queueMicrotask(() => {
      if (!menuOpen() && !surface() && previous.isConnected) previous.focus({ preventScroll: true })
    })
  }
  const openContext = (event: MouseEvent | KeyboardEvent) => {
    const target = event.target
    if (props.disabled || !(target instanceof Element) || !(event.currentTarget instanceof HTMLElement) ||
      !event.currentTarget.contains(target) ||
      target.closest('input, textarea, [contenteditable="true"], [role="menu"]')) return
    event.preventDefault()
    event.stopPropagation()
    contextFocus = target.closest<HTMLElement>("button:not(:disabled)") ?? menuTrigger
    setMenuOpen(true)
  }

  const openRename = (trigger: HTMLElement | undefined) => {
    const chat = props.chat
    if (!chat || props.disabled) return
    renameTarget = { id: chat.id, createdAtExact: chat.createdAtExact }
    renameFocus = trigger
    setDraft(title())
    setRenameError(false)
    setSurface("rename")
  }

  const save = async () => {
    const chat = props.chat
    const proposed = draft().trim()
    if (!chat || !proposed || saving() || surface() !== "rename") return
    if (chat.id !== renameTarget?.id || chat.createdAtExact !== renameTarget.createdAtExact) {
      setRenameError(true)
      return
    }
    if (proposed === title()) { setSurface(null); return }
    setSaving(true)
    setRenameError(false)
    try {
      await props.onRename(chat.id, proposed)
      setSurface(null)
    } catch {
      setRenameError(true)
    } finally {
      setSaving(false)
    }
  }

  const closeAuxiliary = (open: boolean) => { if (!open) setSurface(null) }
  const AuxiliaryNotice = (notice: { title: string; description: string }) =>
    <Dialog open onOpenChange={closeAuxiliary}>
      <DialogContent class="pointer-events-auto! z-[60]" onCloseAutoFocus={(event: Event) => {
        event.preventDefault()
        if (!surface()) focusMenu()
      }}>
        <DialogHeader>
          <DialogTitle>{notice.title}</DialogTitle>
          <DialogDescription>{notice.description}</DialogDescription>
        </DialogHeader>
      </DialogContent>
    </Dialog>

  return <>
    <div class="mb-2">
      <div class={cn("flex select-none items-center rounded-md", props.active && "bg-sidebar-accent")}
        onContextMenu={openContext} onKeyDown={(event) => {
          if (event.key === "ContextMenu" || event.shiftKey && event.key === "F10") openContext(event)
        }}>
        <Button type="button" variant="ghost" aria-current={props.active ? "page" : undefined}
          aria-describedby={`${descriptionId} ${statusId}${failed() ? ` ${failureId}` : ""}`}
          aria-busy={props.busy ? "true" : undefined} disabled={props.disabled}
          class={cn("min-w-0 flex-1 justify-start gap-2", props.unread && "font-semibold")} onClick={props.onSelect}>
          <CircleDot class="size-4 shrink-0" aria-hidden="true" />
          <span class="min-w-0 flex-1 truncate text-left" title={title()}>{title()}</span>
          <Show when={props.running} fallback={
            <Show when={failed()} fallback={
              <Show when={props.unread}><span aria-hidden="true" class="size-1.5 shrink-0 rounded-full bg-primary" /></Show>
            }>
              <span title={props.chat?.lastRunError?.trim() || text("session_last_run_failed_hint")}
                data-session-run-failure="" aria-hidden="true" class="shrink-0">
                <AlertCircle class="size-3.5 text-destructive" />
              </span>
            </Show>
          }>
            <span data-session-running="" aria-hidden="true" class="size-1.5 shrink-0 animate-pulse rounded-full bg-primary" />
          </Show>
        </Button>
        <span id={statusId} class="sr-only">{status()}</span>
        <Show when={failed()}><span id={failureId} class="sr-only">{text("session_last_run_failed_hint")}</span></Show>
        <Button type="button" variant="ghost" size="icon" class="mr-1 size-8 shrink-0 text-muted-foreground"
          aria-label={text("supervisor_rename")} title={text("supervisor_rename")} aria-haspopup="dialog"
          disabled={!props.chat || props.disabled} onClick={(event) => openRename(event.currentTarget)}>
          <Pencil class="size-3.5" aria-hidden="true" />
        </Button>
        <DropdownMenu modal={false} open={menuOpen()} onOpenChange={changeMenu} placement="bottom-end">
          <DropdownMenuTrigger ref={(node: HTMLButtonElement) => { menuTrigger = node }}
            aria-haspopup="menu" aria-label={text("session_actions_e6f6d875")} disabled={props.disabled}
            class="mr-1 rounded p-1 text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
            <MoreHorizontal class="size-4" aria-hidden="true" />
          </DropdownMenuTrigger>
          <DropdownMenuContent>
            <DropdownMenuItem disabled={!props.chat} onSelect={() => openRename(menuTrigger)}>
              <Pencil />{text("supervisor_rename")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSurface("sessions")}>{text("supervisor_sessions_manage")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setSurface("scope")}>{text("supervisor_scope_title")}</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" disabled={!props.chat} onSelect={() => {
              const chat = props.chat
              if (chat) {
                contextFocus = undefined
                focusMenu()
                props.onClear(chat)
              }
            }}>
              <RotateCcw />{text("conversation_clear_action")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p id={descriptionId} class="px-3 pb-1 text-xs leading-relaxed text-muted-foreground">{text("supervisor_entry_description")}</p>
    </div>
    <Dialog open={surface() === "rename"} onOpenChange={(open) => { if (!open && !saving()) setSurface(null) }}>
      <DialogContent dismissable={!saving()} class="pointer-events-auto! z-[60]"
        onOpenAutoFocus={(event: Event) => {
          event.preventDefault()
          nameInput?.focus()
          nameInput?.select()
        }}
        onCloseAutoFocus={(event: Event) => {
          event.preventDefault()
          if (renameFocus?.isConnected) renameFocus.focus({ preventScroll: true })
          else focusMenu()
        }}>
        <form onSubmit={(event) => { event.preventDefault(); void save() }} class="grid gap-4">
          <DialogHeader>
            <DialogTitle>{text("supervisor_rename")}</DialogTitle>
            <DialogDescription>{text("supervisor_rename_description")}</DialogDescription>
          </DialogHeader>
          <label for={nameId} class="text-sm font-medium">{text("supervisor_name")}</label>
          <Input id={nameId} ref={(node) => { nameInput = node }} value={draft()} disabled={saving()}
            onInput={(event) => setDraft(event.currentTarget.value)} onFocus={(event) => event.currentTarget.select()} />
          <Show when={renameError()}>
            <p role="alert" class="text-sm text-destructive">{text("could_not_save_please_try_again_f42a1238")}</p>
          </Show>
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving()} onClick={() => setSurface(null)}>{text("cancel_2cd0f3be")}</Button>
            <Button type="submit" disabled={saving() || !draft().trim()}>{text("save_a3030bf8")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
    <Show when={surface() === "sessions"}>
      <Errored fallback={() => <AuxiliaryNotice title={text("supervisor_sessions_title")} description={text("supervisor_sessions_render_failed")} />}>
        <Loading fallback={<AuxiliaryNotice title={text("supervisor_sessions_title")} description={text("supervisor_sessions_loading")} />}>
          <ManagedSessionsDialog open onOpenChange={closeAuxiliary} returnFocus={focusMenu} />
        </Loading>
      </Errored>
    </Show>
    <Show when={surface() === "scope"}>
      <Errored fallback={() => <AuxiliaryNotice title={text("supervisor_scope_title")}
        description={text("this_section_could_not_render_try_again_or_reload_the_p_e644d5da")} />}>
        <Loading fallback={<AuxiliaryNotice title={text("supervisor_scope_title")} description={text("supervisor_scope_loading")} />}>
          <ProjectScopeDialog open onOpenChange={closeAuxiliary} returnFocus={focusMenu} />
        </Loading>
      </Errored>
    </Show>
  </>
}
