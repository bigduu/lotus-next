import { useId, useState } from "react"
import { Brain, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/** The same compact disclosure for live reasoning and saved reasoning. */
export function Reasoning({ text, active = false, spaced = false }: { text: string; active?: boolean; spaced?: boolean }) {
  const [open, setOpen] = useState(false)
  const contentId = useId()
  return (
    <div className={cn((open || spaced) && "mb-1.5")}>
      <button
        type="button"
        aria-expanded={open}
        aria-controls={contentId}
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Brain className={cn("size-3", active && "animate-pulse")} />
        <span>{active ? "思考中…" : "思考过程"}</span>
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
      </button>
      {open ? (
        <div id={contentId} tabIndex={0} role="region" aria-label={active ? "正在生成的思考过程" : "思考过程"} className="mt-1 max-h-32 overflow-y-auto overscroll-contain whitespace-pre-wrap border-l-2 border-border pl-2.5 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {text}
        </div>
      ) : null}
    </div>
  )
}
