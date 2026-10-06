import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useId, useState } from "react"
import { Brain, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/** The same compact disclosure for live reasoning and saved reasoning. */
export function Reasoning({ text, active = false, spaced = false }: { text: string; active?: boolean; spaced?: boolean }) {
  useUiLocale()
  const [open, setOpen] = useState(false)
  const contentId = useId()
  return (
    <div className={cn((open || spaced) && "mb-1.5")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        data-reasoning-toggle
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
      >
        <Brain className={cn("size-3.5 shrink-0", active && "animate-pulse")} />
        <span>{active ? uiText("thinking_64088d8c") : uiText("reasoning_a62acb18")}</span>
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
      </button>
      {open ? (
        <div id={contentId} tabIndex={0} role="region" aria-label={active ? uiText("live_reasoning_b8c0edb7") : uiText("reasoning_a62acb18")} className="mt-1 max-h-32 overflow-y-auto overscroll-contain whitespace-pre-wrap border-l-2 border-border pl-2.5 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {text}
        </div>
      ) : null}
    </div>
  )
}
