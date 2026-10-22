import { useId, useRef, useState } from "react"
import { CircleDot, MoreHorizontal, Pencil, RotateCcw } from "lucide-react"
import { useUiText } from "@shared/i18n/ui"
import type { ChatItem } from "@shared/types/chatMessages"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog"
import { useSidebarContextMenu } from "@/hooks/useSidebarContextMenu"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { cn } from "@/lib/utils"
import { SupervisorProjectScopeDialog } from "@/components/chat/SupervisorProjectScopeDialog"
import { ConversationClearDialog } from "@/components/chat/ConversationClearDialog"

export function SupervisorEntry({ chat, active, unread, busy, disabled, onSelect, onRename }: {
  chat?: ChatItem
  active: boolean
  unread: boolean
  busy: boolean
  disabled: boolean
  onSelect: () => void
  onRename: (id: string, title: string) => void | Promise<void>
}) {
  const uiText = useUiText()
  const menu = useSidebarContextMenu(disabled)
  const descriptionId = useId()
  const statusId = useId()
  const nameId = useId()
  const [open, setOpen] = useState(false)
  const [scopeOpen, setScopeOpen] = useState(false)
  const [clearOpen, setClearOpen] = useState(false)
  const scopeTrigger = useRef<HTMLButtonElement>(null)
  const [draft, setDraft] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState(false)
  const title = chat?.title?.trim() || "Supervisor"

  const save = async () => {
    const nextTitle = draft.trim()
    if (!chat || !nextTitle || saving) return
    if (nextTitle === title) { setOpen(false); return }
    setSaving(true)
    setError(false)
    try {
      await onRename(chat.id, nextTitle)
      setOpen(false)
    } catch {
      setError(true)
    } finally {
      setSaving(false)
    }
  }

  return <><Dialog open={open} onOpenChange={(value) => { if (!saving) setOpen(value) }}>
    <div className="mb-2">
      <div {...menu.rowProps} className={cn("flex select-none items-center rounded-md", active && "bg-sidebar-accent")}>
        <Button variant="ghost" aria-current={active ? "page" : undefined}
          aria-describedby={`${descriptionId} ${statusId}`} aria-busy={busy || undefined} disabled={disabled}
          className={cn("min-w-0 flex-1 justify-start gap-2", unread && "font-semibold")}
          onClick={onSelect}>
          <CircleDot className="size-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1 truncate text-left" title={title}>{title}</span>
          {chat?.isRunning || unread ? <span aria-hidden="true" className={cn("size-1.5 shrink-0 rounded-full bg-primary", chat?.isRunning && "animate-pulse")} /> : null}
          <span id={statusId} className="sr-only">{chat?.isRunning ? uiText("running_1f0eb99b") : unread ? uiText("unread_messages_519491f4") : ""}</span>
        </Button>
        <DialogTrigger asChild>
          <Button variant="ghost" size="icon" className="mr-1 size-8 shrink-0 text-muted-foreground"
            aria-label={uiText("supervisor_rename")} title={uiText("supervisor_rename")} disabled={!chat || disabled}
            onClick={() => { setDraft(title); setError(false) }}>
            <Pencil className="size-3.5" aria-hidden="true" />
          </Button>
        </DialogTrigger>
        <DropdownMenu open={menu.open} onOpenChange={menu.onOpenChange}>
          <DropdownMenuTrigger ref={scopeTrigger} aria-label={uiText("session_actions_e6f6d875")} disabled={disabled}
            className="mr-1 rounded p-1 text-muted-foreground outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
            <MoreHorizontal className="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" onCloseAutoFocus={open || scopeOpen || clearOpen ? (event) => event.preventDefault() : menu.onCloseAutoFocus}>
            <DropdownMenuItem disabled={!chat} onSelect={() => { setDraft(title); setError(false); setOpen(true) }}>
              <Pencil />{uiText("supervisor_rename")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={() => setScopeOpen(true)}>{uiText("supervisor_scope_title")}</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" disabled={!chat} onSelect={() => setClearOpen(true)}>
              <RotateCcw />{uiText("conversation_clear_action")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
      <p id={descriptionId} className="px-3 pb-1 text-xs leading-relaxed text-muted-foreground">{uiText("supervisor_entry_description")}</p>
      <DialogContent showCloseButton={!saving}>
        <form onSubmit={(event) => { event.preventDefault(); void save() }} className="grid gap-4">
          <DialogHeader>
            <DialogTitle>{uiText("supervisor_rename")}</DialogTitle>
            <DialogDescription>{uiText("supervisor_rename_description")}</DialogDescription>
          </DialogHeader>
          <label htmlFor={nameId} className="text-sm font-medium">{uiText("supervisor_name")}</label>
          <Input id={nameId} value={draft} disabled={saving} onChange={(event) => setDraft(event.target.value)}
            onFocus={(event) => event.target.select()} />
          {error ? <p role="alert" className="text-sm text-destructive">{uiText("could_not_save_please_try_again_f42a1238")}</p> : null}
          <DialogFooter>
            <Button type="button" variant="outline" disabled={saving} onClick={() => setOpen(false)}>{uiText("cancel_2cd0f3be")}</Button>
            <Button type="submit" disabled={saving || !draft.trim()}>{uiText("save_a3030bf8")}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </div>
  </Dialog>
    {scopeOpen ? <SupervisorProjectScopeDialog open onOpenChange={setScopeOpen} returnFocus={() => scopeTrigger.current?.focus()} /> : null}
    {clearOpen && chat ? <ConversationClearDialog sessionId={chat.id} title={title} onClose={() => {
      setClearOpen(false)
      scopeTrigger.current?.focus()
    }} /> : null}
  </>
}
