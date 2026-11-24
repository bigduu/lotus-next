import { MessageSquare, Plus, Search, Settings } from "@lucide/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { Dynamic } from "@solidjs/web"
import type { ChatItem } from "@shared/types/chatMessages"
import { isCommandComposing } from "@/lib/commandComposition"
import { restoreCommandFocus } from "@/lib/commandFocusReturn"
import { Dialog, DialogContent, DialogTitle } from "../ui/dialog"
import { Command, CommandInput, CommandItem, CommandList } from "../ui/command"
import { createUiText } from "./uiText"

type Item = { key: string; label: string; icon: typeof Plus; run: () => void }

export function CommandPalette(props: {
  chats: ChatItem[]
  onClose: () => void
  onSelect: (id: string) => void
  onNewChat: () => void
  onSettings: () => void
  getReturnFocusTarget: () => HTMLElement | null
}) {
  const text = createUiText()
  const [query, setQuery] = createSignal("")
  const items = createMemo<Item[]>(() => {
    const value = query().trim().toLowerCase()
    const actions: Item[] = [
      { key: "new", label: text("new_conversation_6897a8ef"), icon: Plus, run: props.onNewChat },
      { key: "settings", label: text("system_settings_68ea5dd4"), icon: Settings, run: props.onSettings },
    ]
    const sessions = props.chats
      .filter((chat) => chat.kind !== "child" && !chat.parentSessionId)
      .filter((chat) => !value || chat.title?.toLowerCase().includes(value))
      .slice(0, 50)
      .map((chat) => ({
        key: `session:${chat.id}`,
        label: chat.title || text("new_session_c57c30bc"),
        icon: MessageSquare,
        run: () => props.onSelect(chat.id),
      }))
    return [...actions.filter((item) => !value || item.label.toLowerCase().includes(value)), ...sessions]
  })

  return (
    <Dialog open onOpenChange={(open) => { if (!open) props.onClose() }}>
      <DialogContent data-command-palette="" showCloseButton={false}
        class="top-[12vh] grid w-full max-w-[calc(100%-2rem)] translate-y-0 gap-0 overflow-hidden rounded-2xl bg-popover p-0 shadow-2xl sm:max-w-lg"
        onEscapeKeyDown={(event: KeyboardEvent) => { if (isCommandComposing(event)) event.preventDefault() }}
        onCloseAutoFocus={(event: Event) => {
          event.preventDefault()
          restoreCommandFocus(props.getReturnFocusTarget())
        }}>
        <DialogTitle class="sr-only">{text("search_sessions_or_actions_b2a0f9e8")}</DialogTitle>
        <Command shouldFilter={false} label={text("search_sessions_or_actions_b2a0f9e8")}>
          <div class="flex items-center gap-2 border-b px-3">
            <Search class="size-4 shrink-0 text-muted-foreground" />
            <CommandInput value={query()} onValueChange={setQuery}
              placeholder={text("search_sessions_or_actions_b2a0f9e8")}
              class="w-full bg-transparent py-3 text-sm outline-none placeholder:text-muted-foreground" />
          </div>
          <CommandList label={text("options_c9710c82")} class="max-h-80 p-1">
            <Show when={!items().length}>
              <p role="status" class="px-3 py-6 text-center text-sm text-muted-foreground">{text("no_matches_7a54f3fc")}</p>
            </Show>
            <For each={items()} keyed={(item) => item.key}>{(item) => {
              return <CommandItem value={item().key} onSelect={() => { item().run(); props.onClose() }}
                class="w-full gap-2.5 rounded-lg px-3 py-2 text-left text-sm transition-colors hover:bg-accent/60">
                <Dynamic component={item().icon} class="size-4 shrink-0 text-muted-foreground" />
                <span class="truncate">{item().label}</span>
              </CommandItem>
            }}</For>
          </CommandList>
        </Command>
      </DialogContent>
    </Dialog>
  )
}
