import { useUiText } from "@shared/i18n/ui"
import { useLayoutEffect, useMemo, useRef, useState } from "react"
import { Search, Plus, Settings as SettingsIcon, MessageSquare } from "lucide-react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Dialog } from "@/components/ui/dialog"
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { isCommandComposing } from "@/lib/commandComposition"

type Chat = {
  id: string
  title?: string | null
  kind?: "root" | "child"
  parentSessionId?: string | null
}

type Item =
  | { kind: "action"; id: string; label: string; icon: React.ReactNode; run: () => void }
  | { kind: "session"; id: string; label: string; run: () => void }

/**
 * Cmd/Ctrl+K command palette: quick session switcher + top actions.
 */
export function CommandPalette({
  open,
  onClose,
  chats,
  onSelect,
  onNewChat,
  onSettings,
  getReturnFocusTarget,
}: {
  open: boolean
  onClose: () => void
  chats: Chat[]
  onSelect: (id: string) => void
  onNewChat: () => void
  onSettings: () => void
  getReturnFocusTarget?: () => HTMLElement | null
}) {
  const uiText = useUiText()
  const [q, setQ] = useState("")
  const returnFocusRef = useRef<HTMLElement | null>(null)

  useLayoutEffect(() => {
    if (open) {
      // Clear the previous search before this input can be painted/edited.
      // A passive effect can otherwise erase a quickly entered new query.
      setQ("")
    }
  }, [open])

  const items = useMemo<Item[]>(() => {
    const query = q.trim().toLowerCase()
    const actions: Item[] = [
      {
        kind: "action",
        id: "new",
        label: uiText("new_conversation_6897a8ef"),
        icon: <Plus className="size-4" />,
        run: onNewChat,
      },
      {
        kind: "action",
        id: "settings",
        label: uiText("system_settings_68ea5dd4"),
        icon: <SettingsIcon className="size-4" />,
        run: onSettings,
      },
    ]
    // Child sessions belong to the currently hydrated sub-agent tree. Keeping
    // them out of this global switcher prevents an inactive, preserved tree
    // from exposing a child that may already have been deleted remotely.
    const sessionItems: Item[] = chats
      .filter((c) => c.kind !== "child" && !c.parentSessionId)
      .filter((c) => !query || (c.title || "").toLowerCase().includes(query))
      .slice(0, 50)
      .map((c) => ({
        kind: "session",
        id: c.id,
        label: c.title || uiText("new_session_c57c30bc"),
        run: () => onSelect(c.id),
      }))
    const acts = query
      ? actions.filter((a) => a.label.toLowerCase().includes(query))
      : actions
    return [...acts, ...sessionItems]
  }, [q, chats, onNewChat, onSettings, onSelect, uiText])

  if (!open) return null

  const choose = (item: Item) => {
    item.run()
    onClose()
  }

  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
    <DialogPrimitive.Overlay className="fixed inset-0 z-[130] flex items-start justify-center bg-black/50 p-4 pt-[12vh]">
      <DialogPrimitive.Content
        aria-describedby={undefined}
        className="w-full max-w-lg overflow-hidden rounded-2xl border bg-popover shadow-2xl"
        onEscapeKeyDown={(event) => { if (isCommandComposing(event)) event.preventDefault() }}
        onOpenAutoFocus={() => {
          returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const opener = getReturnFocusTarget ? getReturnFocusTarget() : returnFocusRef.current
          const active = document.activeElement
          // The parent trap can land on its ASIDE when a drag preview vanishes.
          // Preserve real new control focus, but recover from that inert fallback.
          const parentFallback = opener?.closest("#right-workbench")
          if (active instanceof HTMLElement && active !== document.body && active !== parentFallback && !active.closest('[hidden], [inert], [aria-hidden="true"]')) return
          if (opener?.isConnected && opener !== document.body && !opener.matches(":disabled") && !opener.closest('[hidden], [inert], [aria-hidden="true"]')) opener.focus()
        }}
      >
        <DialogPrimitive.Title className="sr-only">{uiText("search_sessions_or_actions_b2a0f9e8")}</DialogPrimitive.Title>
        <Command shouldFilter={false} label={uiText("search_sessions_or_actions_b2a0f9e8")}>
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <CommandInput
            value={q}
            onValueChange={setQ}
            placeholder={uiText("search_sessions_or_actions_b2a0f9e8")}
            className="w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground"
          />
        </div>
        <CommandList className="max-h-80 p-1">
          {items.length === 0 ? <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">{uiText("no_matches_7a54f3fc")}</p> : null}
          {items.map((it) => (
              <CommandItem
                key={`${it.kind}-${it.id}`}
                value={JSON.stringify([it.kind, it.id])}
                onSelect={() => choose(it)}
                className="w-full gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent/60"
              >
                {it.kind === "action" ? (
                  it.icon
                ) : (
                  <MessageSquare className="size-4 shrink-0 text-muted-foreground" />
                )}
                <span className="truncate">{it.label}</span>
              </CommandItem>
            ))}
        </CommandList>
        </Command>
      </DialogPrimitive.Content>
    </DialogPrimitive.Overlay>
    </Dialog>
  )
}
