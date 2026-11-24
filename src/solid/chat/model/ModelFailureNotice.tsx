import { Info, X } from "@lucide/solid"
import { createSignal } from "solid-js"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"

export function ModelFailureNotice(props: { details: string; onDismiss: () => void; onRestoreFocus: () => void }) {
  const text = createUiText()
  const [expanded, setExpanded] = createSignal(false)
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
      onFocusIn={(event) => {
        const previous = event.relatedTarget
        if (previous instanceof HTMLElement && event.currentTarget.contains(previous)) return
        returnFocus = previous instanceof HTMLElement && previous !== card.ownerDocument.body ? previous : null
      }}>
      <Info class="mt-0.5 size-4 shrink-0 text-destructive" aria-hidden="true" />
      <div class="min-w-0 flex-1 [overflow-wrap:anywhere]">
        <div role="alert" aria-atomic="true">
          <strong class="block text-destructive">{text("operation_failed_0c3b4cf7")}</strong>
          {text("could_not_save_the_model_please_try_again_631991a6")}
        </div>
        <details class="mt-2" onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary class="cursor-pointer rounded outline-none focus-visible:ring-2">
            {text(expanded() ? "hide_details_2e1b7da4" : "show_details_448d5d38")}
          </summary>
          <div class="mt-2 max-h-[min(40vh,20rem)] overflow-auto whitespace-pre-wrap text-xs text-muted-foreground">{props.details}</div>
        </details>
      </div>
      <Button variant="ghost" size="icon" class="size-6" type="button" aria-label={text("close_3fd47edc")} onClick={dismiss}>
        <X class="size-4" />
      </Button>
    </div>
  </div>
}
