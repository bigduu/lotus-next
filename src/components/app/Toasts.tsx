import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useRef, useState, type CSSProperties } from "react"
import { Info, Loader2, X } from "lucide-react"
import { surfaceMotion } from "@/components/ui/motion"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export type ToastNotice = { id: number; message: string; kind: "info" | "error"; details?: string }

function Notice({ notice, onDismiss, onRestoreFocus }: { notice: ToastNotice; onDismiss: () => void; onRestoreFocus?: () => void }) {
  const card = useRef<HTMLDivElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)
  const [hovered, setHovered] = useState(false)
  const [focused, setFocused] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const remaining = useRef(5000)
  const dismiss = useRef(onDismiss)
  dismiss.current = onDismiss
  useEffect(() => {
    if (notice.kind === "error" || hovered || focused || expanded) return
    const started = Date.now()
    const timer = setTimeout(() => dismiss.current(), remaining.current)
    return () => {
      clearTimeout(timer)
      remaining.current = Math.max(0, remaining.current - (Date.now() - started))
    }
  }, [notice.kind, hovered, focused, expanded])
  const summary = notice.message.length > 160 ? `${notice.message.slice(0, 160)}…` : notice.message
  const details = [summary !== notice.message ? notice.message : null,
    notice.details !== notice.message ? notice.details : null].filter(Boolean).join("\n\n")
  return (
    <div ref={card} className={cn(surfaceMotion, "surface-fade pointer-events-auto flex min-w-0 max-w-md items-start gap-2 rounded-2xl border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-lg")}
      style={{ "--tw-enter-translate-y": "8px", width: "100%", maxHeight: "calc(100dvh - 8rem)", overflowY: "auto" } as CSSProperties}
      onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}
      onFocusCapture={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) {
          const previous = event.relatedTarget
          returnFocus.current = previous instanceof HTMLElement && previous !== document.body ? previous : null
        }
        setFocused(true)
      }}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget)) setFocused(false) }}>
      <Info className={cn("mt-0.5 size-4 shrink-0", notice.kind === "error" ? "text-destructive" : "text-primary")} aria-hidden />
      <div className="min-w-0 flex-1" style={{ overflowWrap: "anywhere" }}>
        <div role={notice.kind === "error" ? "alert" : "status"} aria-atomic="true">{notice.kind === "error" && <strong className="block text-destructive">{uiText("operation_failed_0c3b4cf7")}</strong>}{summary}</div>
        {details && <details className="mt-2" onToggle={(event) => setExpanded(event.currentTarget.open)}>
          <summary className="cursor-pointer rounded outline-none focus-visible:ring-2">{uiText(expanded ? "hide_details_2e1b7da4" : "show_details_448d5d38")}</summary>
          <div className="mt-2 overflow-auto whitespace-pre-wrap text-xs text-muted-foreground" style={{ maxHeight: "min(40vh, 20rem)" }}>{details}</div>
        </details>}
      </div>
      <Button variant="ghost" size="icon" className="size-6 shrink-0" aria-label={uiText("close_3fd47edc")} onClick={() => {
        const restore = card.current?.contains(document.activeElement)
        onDismiss()
        if (!restore) return
        const target = returnFocus.current
        if (target?.isConnected && !target.matches(":disabled, [aria-disabled=true]") && !target.closest("[hidden], [inert], [aria-hidden=true]")) {
          target.focus({ preventScroll: true })
          if (document.activeElement === target) return
        }
        onRestoreFocus?.()
      }}><X className="size-4" /></Button>
    </div>
  )
}

/** Errors remain readable until dismissed; timers belong to each notification identity. */
export function Toasts({ forking, toast, onDismiss, onRestoreFocus }: { forking: boolean; toast: ToastNotice | null; onDismiss: () => void; onRestoreFocus?: () => void }) {
  useUiLocale()
  if (!forking && !toast) return null
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[110] flex justify-center px-4">
      {forking ? <div role="status" aria-atomic="true" className="flex items-center gap-2 rounded-2xl border bg-card px-4 py-3 text-sm shadow-lg">
        <Loader2 className="size-4 animate-spin text-primary" aria-hidden />{uiText("forking_bed88cb0")}
      </div> : toast && <Notice key={toast.id} notice={toast} onDismiss={onDismiss} onRestoreFocus={onRestoreFocus} />}
    </div>
  )
}
