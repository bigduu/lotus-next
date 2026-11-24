import { Info, X } from "@lucide/solid"
import { createUiText } from "../shell/uiText"
import { Button } from "../ui/button"

export function WorktreePreparationNotice(props: {
  message: string
  onDismiss: () => void
  onRestoreFocus: () => void
}) {
  const text = createUiText()
  let card!: HTMLDivElement
  let returnFocus: HTMLElement | null = null
  const dismiss = () => {
    const document = card.ownerDocument
    const restore = card.contains(document.activeElement)
    const target = returnFocus
    props.onDismiss()
    if (!restore) return
    if (target?.isConnected && !target.matches(":disabled, [aria-disabled=true]") && !target.closest("[hidden], [inert], [aria-hidden=true]")) {
      target.focus({ preventScroll: true })
      if (document.activeElement === target) return
    }
    props.onRestoreFocus()
  }

  return <div class="pointer-events-none fixed inset-x-0 bottom-28 z-[110] flex justify-center px-4">
    <div ref={(element) => { card = element }}
      class="surface-motion surface-fade pointer-events-auto flex max-h-[calc(100dvh-8rem)] w-full min-w-0 max-w-md items-start gap-2 overflow-y-auto rounded-2xl border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-lg"
      style={{ "--tw-enter-translate-y": "8px" }}
      onFocusIn={(event) => {
        const previous = event.relatedTarget
        if (previous instanceof HTMLElement && event.currentTarget.contains(previous)) return
        returnFocus = previous instanceof HTMLElement && previous !== card.ownerDocument.body ? previous : null
      }}>
      <Info class="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div role="alert" aria-atomic="true" class="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <strong class="block text-destructive">{text("operation_failed_0c3b4cf7")}</strong>
        {props.message}
      </div>
      <Button variant="ghost" size="icon" class="size-6 shrink-0" type="button" aria-label={text("close_3fd47edc")} onClick={dismiss}>
        <X class="size-4" />
      </Button>
    </div>
  </div>
}
