import { Copy, Ellipsis, GitFork, MessageSquarePlus, Pencil, RotateCcw, Trash2 } from "@lucide/solid"
import { createMemo, For, onSettled, Show } from "solid-js"
import i18n from "@shared/i18n/runtime"
import { sideChatQuote, type SideChatQuote } from "@services/chat/sideChat"
import { cn } from "@/lib/utils"
import { createUiLocale, createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { ConfirmationIcon } from "../../ui/confirmation-icon"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "../../ui/dropdown-menu"
import { Textarea } from "../../ui/textarea"
import type { SideChatSources } from "../history/SideChatSourceActions"
import type { createMessageActions, MessageTarget } from "./createMessageActions"
import { createCopyFeedback } from "./createCopyFeedback"

type Actions = ReturnType<typeof createMessageActions>
const actionClass = "items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-50"

export function MessageActions(props: {
  target: MessageTarget
  controller: Actions
  sideChat?: SideChatSources
}) {
  const text = createUiText()
  const locale = createUiLocale()
  const { feedback, copy } = createCopyFeedback(() => props.target.text, () => props.target.key)
  const copied = () => feedback().status === "copied"
  const user = () => props.target.message.role === "user"
  const selection = () => props.sideChat?.selected(props.target.key)
  const ask = (quote: SideChatQuote) => props.sideChat?.ask(props.target.key, quote)
  let menuTarget: MessageTarget | undefined
  let menuQuote: SideChatQuote | null | undefined
  const selected = () => menuTarget ?? props.target
  const label = () => text("more_message_actions_cecaef80")

  return (
    <div data-message-actions={props.target.message.id} data-copy-state={feedback().status}
      class={cn("relative flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity focus-within:opacity-100 group-hover:opacity-100",
        feedback().status === "idle" && !selection() && "md:opacity-0")}>
      <span role="status" class="sr-only">
        <For each={copied() ? [feedback().sequence] : []}>{() => <span>{text("copied_8f6f8d97")}</span>}</For>
      </span>
      <Show when={feedback().status === "error"}>
        <span role="alert" class="absolute bottom-full end-0 z-10 mb-1 w-max max-w-48 rounded-md bg-popover px-2 py-1 text-xs text-popover-foreground shadow-sm">
          {String(i18n.t("components.markdown.copyFailed", { lng: locale() }))}
        </span>
      </Show>
      <Show when={selection()}>
        {(quote) => <Button type="button" variant="secondary" size="sm"
          onMouseDown={(event) => event.preventDefault()} onClick={() => ask(quote())}>
          <MessageSquarePlus class="size-3.5" aria-hidden="true" />{text("side_chat_ask_selection")}
        </Button>}
      </Show>
      <button type="button" disabled={!props.target.text} class={cn(actionClass, "hidden size-7 md:inline-flex")}
        aria-label={text("copy_63d90d97")} title={text(copied() ? "copied_8f6f8d97" : "copy_63d90d97")}
        onClick={() => { void copy() }}>
        <ConfirmationIcon confirmed={copied()} sequence={feedback().sequence} class="size-3.5" />
      </button>
      <button type="button" class={cn(actionClass, "hidden size-7 md:inline-flex")}
        disabled={!props.controller.allows("fork", props.target)}
        aria-label={text("fork_from_here_28321cb9")} title={text("fork_into_a_new_session_from_here_53c2881c")}
        onClick={() => props.controller.fork(props.target)}>
        <GitFork class="size-3.5" aria-hidden="true" />
      </button>
      <DropdownMenu placement={user() ? "bottom-end" : "bottom-start"}
        onOpenChange={(open) => {
          if (open) {
            menuTarget = props.target
            menuQuote = selection()
          }
        }}>
        <DropdownMenuTrigger as={Button} type="button" variant="ghost" size="icon"
          class={cn(actionClass, "size-7")} aria-label={label()} title={label()}
          onMouseDown={(event: MouseEvent) => event.preventDefault()}>
          <Ellipsis class="hidden size-3.5 md:block" aria-hidden="true" />
          <ConfirmationIcon confirmed={copied()} sequence={feedback().sequence} fallback={Ellipsis} class="size-3.5 md:hidden" />
        </DropdownMenuTrigger>
        <DropdownMenuContent class="min-w-40 rounded-xl">
          <DropdownMenuItem class="md:hidden" disabled={!props.target.text} onSelect={() => { void copy() }}>
            <Copy aria-hidden="true" />{text("copy_63d90d97")}
          </DropdownMenuItem>
          <DropdownMenuItem class="md:hidden" disabled={!props.controller.allows("fork", props.target)}
            onSelect={() => props.controller.fork(selected())}>
            <GitFork aria-hidden="true" />{text("fork_from_here_28321cb9")}
          </DropdownMenuItem>
          <DropdownMenuSeparator class="md:hidden" />
          <Show when={props.sideChat}>
            <DropdownMenuItem onSelect={() => ask(menuQuote ?? sideChatQuote(props.target.message.id, props.target.text))}>
              <MessageSquarePlus aria-hidden="true" />{text("side_chat_ask_selection")}
            </DropdownMenuItem>
          </Show>
          <Show when={user()} fallback={
            <Show when={props.controller.isRegenerable(props.target.key)}>
              <DropdownMenuItem disabled={!props.controller.allows("regenerate", props.target)}
                onSelect={() => props.controller.regenerate(selected())}>
                <RotateCcw aria-hidden="true" />{text("regenerate_3221a042")}
              </DropdownMenuItem>
            </Show>
          }>
            <DropdownMenuItem disabled={!props.controller.allows("edit", props.target)}
              onSelect={() => props.controller.beginEdit(selected())}>
              <Pencil aria-hidden="true" />{text("edit_and_resend_f857c444")}
            </DropdownMenuItem>
          </Show>
          <Show when={user() || props.controller.isRegenerable(props.target.key)}><DropdownMenuSeparator /></Show>
          <DropdownMenuItem variant="destructive" disabled={!props.controller.allows("delete", props.target)}
            onSelect={() => props.controller.remove(selected())}>
            <Trash2 aria-hidden="true" />{text("delete_2f9daa82")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

export function MessageEdit(props: { controller: Actions; target: MessageTarget }) {
  const text = createUiText()
  let input: HTMLTextAreaElement | undefined
  const disabled = createMemo(() => !props.controller.editing?.text.trim()
    || !props.controller.allows("edit", props.target))
  onSettled(() => { input?.focus({ preventScroll: true }) })
  return (
    <div class="flex w-full flex-col items-end">
      <div class="w-full max-w-[85%]">
        <Textarea ref={(element) => { input = element }} value={props.controller.editing?.text ?? ""}
          aria-label={text("edit_and_resend_f857c444")} class="min-h-16 bg-card"
          onInput={(event) => props.controller.updateEdit(event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.isComposing || event.keyCode === 229) return
            if (event.key === "Escape") {
              event.preventDefault()
              props.controller.cancelEdit()
            } else if (event.key === "Enter" && (event.metaKey || event.ctrlKey) && !disabled()) {
              event.preventDefault()
              props.controller.saveEdit()
            }
          }} />
        <div class="mt-1.5 flex justify-end gap-2">
          <Button size="sm" variant="secondary" onClick={props.controller.cancelEdit}>{text("cancel_2cd0f3be")}</Button>
          <Button size="sm" disabled={disabled()} onClick={props.controller.saveEdit}>{text("save_and_resend_b45cc57a")}</Button>
        </div>
      </div>
    </div>
  )
}
