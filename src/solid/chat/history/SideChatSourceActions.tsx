import { Ellipsis, MessageSquarePlus } from "@lucide/solid"
import { createEffect, createSignal, onSettled, Show } from "solid-js"

import { cn } from "@/lib/utils"
import { sideChatQuote, type SideChatQuote } from "@services/chat/sideChat"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../ui/dropdown-menu"

type QuoteSelection = { sourceKey: string; quote: SideChatQuote }

export interface SideChatSources {
  allows: (key: string) => boolean
  selected: (key: string) => SideChatQuote | null
  ask: (key: string, quote: SideChatQuote) => void
}

export function createSideChatSources(
  viewport: () => HTMLElement | null,
  keys: () => ReadonlySet<string>,
  onAsk: () => ((quote: SideChatQuote) => void) | undefined,
): SideChatSources {
  const [selection, setSelection] = createSignal<QuoteSelection | null>(null)
  const allows = (key: string) => Boolean(onAsk()) && keys().has(key)
  createEffect(() => {
    const current = selection()
    return Boolean(current && !allows(current.sourceKey))
  }, (invalid) => { if (invalid) setSelection(null) })

  const update = () => {
    const container = viewport()
    const selected = container?.ownerDocument.getSelection()
    const anchorNode = selected?.anchorNode
    const anchorElement = anchorNode instanceof Element ? anchorNode : anchorNode?.parentElement
    const source = anchorElement?.closest<HTMLElement>("[data-side-chat-source][data-side-chat-occurrence]")
    const sourceKey = source?.dataset.sideChatOccurrence
    const id = source?.dataset.sideChatSource
    const text = selected?.toString().trim()
    const next = sourceKey && id && text && selected?.rangeCount === 1 &&
      source?.contains(selected.focusNode) && container?.contains(source) && allows(sourceKey)
      ? { sourceKey, quote: sideChatQuote(id, text) } : null
    setSelection((current) => current?.sourceKey === next?.sourceKey && current?.quote.text === next?.quote.text ? current : next)
  }

  onSettled(() => {
    document.addEventListener("selectionchange", update)
    return () => document.removeEventListener("selectionchange", update)
  })

  return {
    allows,
    selected: (key) => {
      const current = selection()
      return current?.sourceKey === key && allows(key) ? current.quote : null
    },
    ask: (key, quote) => {
      if (!allows(key) || !quote.text) return
      onAsk()?.(quote)
      viewport()?.ownerDocument.getSelection()?.removeAllRanges()
      setSelection(null)
    },
  }
}

export function SideChatSourceActions(props: {
  sources: SideChatSources
  sourceKey: string
  messageId: string
  messageText: string
  user: boolean
}) {
  const text = createUiText()
  let menuQuote: SideChatQuote | null = null
  const selection = () => props.sources.selected(props.sourceKey)
  const ask = (quote: SideChatQuote) => props.sources.ask(props.sourceKey, quote)

  return (
    <div data-message-actions={props.messageId}
      class={cn("flex shrink-0 flex-wrap justify-end gap-0.5 pt-1 opacity-100 transition-opacity group-hover:opacity-100 focus-within:opacity-100",
        !selection() && "md:opacity-0")}>
      <Show when={selection()}>{(quote) => (
        <Button type="button" variant="secondary" size="sm" onMouseDown={(event) => event.preventDefault()}
          onClick={() => ask(quote())}>
          <MessageSquarePlus class="size-3.5" aria-hidden="true" />{text("side_chat_ask_selection")}
        </Button>
      )}</Show>
      <DropdownMenu placement={props.user ? "bottom-end" : "bottom-start"}
        onOpenChange={(open) => { if (open) menuQuote = selection() }}>
        <DropdownMenuTrigger as={Button} type="button" variant="ghost" size="icon"
          class="size-8 rounded-lg" aria-label={text("more_message_actions_cecaef80")} onMouseDown={(event: MouseEvent) => event.preventDefault()}>
          <Ellipsis class="size-3.5" aria-hidden="true" />
        </DropdownMenuTrigger>
        <DropdownMenuContent class="min-w-40 rounded-xl">
          <DropdownMenuItem onSelect={() => ask(menuQuote ?? sideChatQuote(props.messageId, props.messageText))}>
            <MessageSquarePlus aria-hidden="true" />{text("side_chat_ask_selection")}
          </DropdownMenuItem>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}
