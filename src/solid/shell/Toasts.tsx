import { Info, Loader2, X } from "@lucide/solid"
import { createEffect, createSignal, Show } from "solid-js"
import { surfaceMotion } from "@shared/theme/motion"
import { cn } from "@/lib/utils"
import { Button } from "../ui/button"
import { createUiText } from "./uiText"

export interface ToastNotice {
  id: number
  message: string
  kind: "info" | "error"
  details?: string
}

function Notice(props: { notice: ToastNotice; onDismiss: () => void; onRestoreFocus?: () => void }) {
  const text = createUiText()
  const [hovered, setHovered] = createSignal(false)
  const [focused, setFocused] = createSignal(false)
  const [expanded, setExpanded] = createSignal(false)
  let card!: HTMLDivElement
  let returnFocus: HTMLElement | null = null
  let remaining = 5_000

  createEffect(() => props.notice.kind === "error" || hovered() || focused() || expanded(), (paused) => {
    if (paused) return
    const started = Date.now()
    const timer = setTimeout(() => props.onDismiss(), remaining)
    return () => {
      clearTimeout(timer)
      remaining = Math.max(0, remaining - (Date.now() - started))
    }
  })
  const summary = () => props.notice.message.length > 160 ? `${props.notice.message.slice(0, 160)}…` : props.notice.message
  const details = () => [
    summary() !== props.notice.message ? props.notice.message : null,
    props.notice.details !== props.notice.message ? props.notice.details : null,
  ].filter(Boolean).join("\n\n")
  const failure = () => text("operation_failed_0c3b4cf7")
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
    props.onRestoreFocus?.()
  }

  return <div ref={(element) => { card = element }}
    class={cn(surfaceMotion, "surface-fade pointer-events-auto flex w-full min-w-0 max-w-md items-start gap-2 overflow-y-auto rounded-2xl border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-lg")}
    style={{ "--tw-enter-translate-y": "8px", "max-height": "calc(100dvh - 8rem)" }}
    onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
    onFocusIn={(event) => {
      const previous = event.relatedTarget
      if (!(previous instanceof Node) || !event.currentTarget.contains(previous)) {
        returnFocus = previous instanceof HTMLElement && previous !== card.ownerDocument.body ? previous : null
      }
      setFocused(true)
    }}
    onFocusOut={(event) => { if (!(event.relatedTarget instanceof Node) || !event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
    <Info class={cn("mt-0.5 size-4 shrink-0", props.notice.kind === "error" ? "text-destructive" : "text-primary")} aria-hidden="true" />
    <div class="min-w-0 flex-1 [overflow-wrap:anywhere]">
      <div role={props.notice.kind === "error" ? "alert" : "status"} aria-atomic="true">
        <Show when={props.notice.kind === "error"}><strong class="block text-destructive">{failure()}</strong></Show>
        <Show when={props.notice.kind === "info" || summary() !== failure()}>{summary()}</Show>
      </div>
      <Show when={details()}>{(detail) => <details class="mt-2" onToggle={(event) => setExpanded(event.currentTarget.open)}>
        <summary class="cursor-pointer rounded outline-none focus-visible:ring-2">
          {text(expanded() ? "hide_details_2e1b7da4" : "show_details_448d5d38")}
        </summary>
        <div class="mt-2 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground" style={{ "max-height": "min(40vh, 20rem)" }}>{detail()}</div>
      </details>}</Show>
    </div>
    <Button variant="ghost" size="icon" class="size-6 shrink-0" type="button" aria-label={text("close_3fd47edc")} onClick={dismiss}>
      <X class="size-4" />
    </Button>
  </div>
}

export function Toasts(props: { forking: boolean; toast: ToastNotice | null; onDismiss: () => void; onRestoreFocus?: () => void }) {
  const text = createUiText()
  return <Show when={props.forking || props.toast}>
    <div class="pointer-events-none fixed inset-x-0 bottom-28 z-[110] flex justify-center px-4">
      <Show when={props.forking} fallback={<Show when={props.toast?.id} keyed>{(_id) => (
        <Notice notice={props.toast!} onDismiss={props.onDismiss} onRestoreFocus={props.onRestoreFocus} />
      )}</Show>}>
        <div role="status" aria-atomic="true" class="flex items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-sm shadow-lg">
          <Loader2 class="size-4 animate-spin text-primary" aria-hidden="true" />{text("forking_bed88cb0")}
        </div>
      </Show>
    </div>
  </Show>
}
