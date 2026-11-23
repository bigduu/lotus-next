import { createEffect, createSignal, onSettled } from "solid-js"
import { sideChatQuote, type SideChatQuote } from "@services/chat/sideChat"

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
