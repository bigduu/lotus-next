import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useId, useRef, useState } from "react"
import { Brain, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { DisclosurePanel } from "./DisclosurePanel"

/** The same compact disclosure for live reasoning and saved reasoning. */
export function Reasoning({ text, active = false, spaced = false }: { text: string; active?: boolean; spaced?: boolean }) {
  useUiLocale()
  const [open, setOpen] = useState(false)
  const contentId = useId()
  const triggerRef = useRef<HTMLButtonElement>(null)
  return (
    <div className={cn(spaced && "mb-1.5")}>
      <button
        ref={triggerRef}
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        data-reasoning-toggle
        onClick={() => setOpen((v) => !v)}
        className="reasoning-toggle inline-flex items-center gap-1.5 rounded-sm text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Brain className={cn("reasoning-brain size-3.5 shrink-0", active && "animate-pulse")} />
        <span>{active ? uiText("thinking_64088d8c") : uiText("reasoning_a62acb18")}</span>
        <ChevronRight className={cn("reasoning-chevron size-3.5 transition-transform duration-(--motion-normal) ease-(--motion-ease)", open && "rotate-90")} />
      </button>
      <DisclosurePanel expanded={open} triggerRef={triggerRef}>
        <div id={contentId} tabIndex={open ? 0 : -1} role="region" aria-label={active ? uiText("live_reasoning_b8c0edb7") : uiText("reasoning_a62acb18")} className={cn("mt-1 max-h-32 overflow-y-auto overscroll-contain whitespace-pre-wrap border-l-2 border-border pl-2.5 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]", !spaced && "mb-1.5")}>
          {text}
        </div>
      </DisclosurePanel>
    </div>
  )
}
