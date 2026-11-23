import { AlertCircle, Check, Copy, List, MoreHorizontal, Pencil, Pin, PinOff, RotateCcw, Sparkles, Trash2 } from "@lucide/solid"
import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js"
import type { ChatItem } from "@shared/types/chatMessages"
import { cn } from "@/lib/utils"
import { SIDEBAR_SESSION_DRAG_TYPE, type ProjectSidebarSection } from "@/lib/projectSidebarPreferences"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSub,
  DropdownMenuSubContent,
  DropdownMenuSubTrigger,
  DropdownMenuTrigger,
} from "../ui/dropdown-menu"
import { createUiText } from "./uiText"

export function SessionRow(props: {
  chat: ChatItem
  active: boolean
  unread: boolean
  running: boolean
  projectId?: string
  sectionId?: string | null
  sections?: readonly ProjectSidebarSection[]
  onMoveToSection?: (sectionId: string | null) => void
  onSelect: () => void
  onRename: (title: string) => void
  onTogglePin: () => void
  onRegenerateTitle: () => void
  onCopySessionId: () => void
  onClear: () => void
  onDelete: () => void
}) {
  const text = createUiText()
  const unreadId = createUniqueId()
  const failureId = createUniqueId()
  const [editing, setEditing] = createSignal(false)
  const [draft, setDraft] = createSignal("")
  const [menuOpen, setMenuOpen] = createSignal(false)
  let dragged = false

  const runFailed = () => !props.running && props.chat.lastRunStatus === "error"
  const failureDetail = () => runFailed()
    ? props.chat.lastRunError?.trim() || text("session_last_run_failed_hint")
    : undefined
  const description = createMemo(() =>
    [props.unread ? unreadId : null, runFailed() ? failureId : null].filter(Boolean).join(" ") || undefined,
  )

  const rename = () => {
    setDraft(props.chat.title)
    setEditing(true)
  }
  const commit = () => {
    if (!editing()) return
    const title = draft().trim()
    setEditing(false)
    if (title && title !== props.chat.title) props.onRename(title)
  }

  return (
    <Show when={!editing()} fallback={(
      <div class="mb-0.5 px-2 py-1">
        <input
          ref={(element) => queueMicrotask(() => {
            if (element.isConnected) {
              element.focus()
              element.select()
            }
          })}
          value={draft()}
          onInput={(event) => setDraft(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.isComposing) return
            if (event.key === "Enter") commit()
            if (event.key === "Escape") setEditing(false)
          }}
          onBlur={commit}
          aria-label={text("rename_0d0cbac2")}
          class="w-full rounded-md border bg-background px-2 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        />
      </div>
    )}>
      <div
        data-sidebar-session={props.chat.id}
        data-session-project={props.projectId}
        draggable="true"
        onPointerDown={() => { dragged = false }}
        onDragStart={(event) => {
          dragged = true
          event.dataTransfer?.setData(SIDEBAR_SESSION_DRAG_TYPE, JSON.stringify({
            projectId: props.projectId ?? null,
            sessionId: props.chat.id,
          }))
          if (event.dataTransfer) event.dataTransfer.effectAllowed = "copyMove"
        }}
        onContextMenu={(event) => {
          event.preventDefault()
          setMenuOpen(true)
        }}
        style={props.active ? { "box-shadow": "inset 0 0 0 1px var(--border)" } : undefined}
        class={cn(
          "group/row relative mb-0.5 flex select-none items-center rounded-md feedback-motion switch-feedback hover:bg-sidebar-accent",
          props.active && "bg-sidebar-accent",
        )}
      >
        <button
          type="button"
          aria-current={props.active ? "page" : undefined}
          aria-describedby={description()}
          onClick={(event) => {
            if (dragged && event.detail !== 0) return
            props.onSelect()
          }}
          class={cn(
            "flex min-w-0 flex-1 items-center gap-2 py-2 pl-2 pr-1 text-left text-sm rounded-md outline-none focus-visible:ring-2 focus-visible:ring-ring",
            (props.active || props.unread) && "font-medium",
          )}
        >
          <span title={failureDetail()} data-session-run-failure={runFailed() ? "" : undefined}
            class="flex size-3.5 shrink-0 items-center justify-center">
            {props.running ? (
              <span data-session-running="" role="img" aria-label={text("running_1f0eb99b")}
                title={text("running_1f0eb99b")} class="size-1.5 animate-pulse rounded-full bg-primary" />
            ) : runFailed() ? (
              <AlertCircle aria-hidden="true" class="size-3.5 text-destructive" />
            ) : props.unread ? (
              <span aria-hidden="true" title={text("new_messages_ce3b9bb1")} class="size-1.5 rounded-full bg-primary" />
            ) : null}
          </span>
          <span class="truncate">{props.chat.title || text("new_session_c57c30bc")}</span>
        </button>
        <Show when={props.unread}>
          <span id={unreadId} class="sr-only">{text("unread_messages_519491f4")}</span>
        </Show>
        <Show when={runFailed()}>
          <span id={failureId} class="sr-only">{text("session_last_run_failed_hint")}</span>
        </Show>
        <DropdownMenu open={menuOpen()} onOpenChange={setMenuOpen}>
          <DropdownMenuTrigger
            aria-label={text("session_actions_e6f6d875")}
            style={props.active ? { opacity: "1" } : undefined}
            class="mr-1 shrink-0 rounded p-1 text-muted-foreground outline-none feedback-motion transition-opacity hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring hover:text-foreground opacity-100 data-[state=open]:opacity-100 focus-within:opacity-100 md:opacity-0 md:group-hover/row:opacity-100 md:group-focus-within/row:opacity-100"
          >
            <MoreHorizontal class="size-4" />
          </DropdownMenuTrigger>
          <DropdownMenuContent class="min-w-32 rounded-xl">
            <Show when={props.projectId && props.onMoveToSection}>
              <DropdownMenuSub>
                <DropdownMenuSubTrigger><List />{text("sidebar_move_to_section")}</DropdownMenuSubTrigger>
                <DropdownMenuSubContent aria-label={text("sidebar_section_select_target")}>
                  <For each={props.sections}>{(section) => (
                    <DropdownMenuItem disabled={section.id === props.sectionId}
                      onSelect={() => props.onMoveToSection?.(section.id)}>
                      {section.id === props.sectionId ? <Check /> : <List />}{section.name}
                    </DropdownMenuItem>
                  )}</For>
                  <DropdownMenuItem disabled={props.sectionId === null} onSelect={() => props.onMoveToSection?.(null)}>
                    {props.sectionId === null ? <Check /> : <List />}{text("sidebar_no_section")}
                  </DropdownMenuItem>
                </DropdownMenuSubContent>
              </DropdownMenuSub>
            </Show>
            <DropdownMenuItem onSelect={props.onTogglePin}>
              {props.chat.pinned ? <PinOff /> : <Pin />}
              {props.chat.pinned ? text("unpin_c92179b7") : text("pin_173f88d2")}
            </DropdownMenuItem>
            <DropdownMenuItem onSelect={rename}><Pencil />{text("rename_0d0cbac2")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onRegenerateTitle}><Sparkles />{text("generate_title_with_ai_f327dbdd")}</DropdownMenuItem>
            <DropdownMenuItem onSelect={props.onCopySessionId}><Copy />{text("copy_session_id_7df96a6b")}</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={props.onClear}><RotateCcw />{text("conversation_clear_action")}</DropdownMenuItem>
            <DropdownMenuItem variant="destructive" onSelect={props.onDelete}><Trash2 />{text("delete_2f9daa82")}</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </Show>
  )
}
