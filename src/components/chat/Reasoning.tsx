import { useState } from "react"
import { Brain, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"

/** Collapsible "thinking" block for assistant reasoning (metadata.reasoning). */
export function Reasoning({ text }: { text: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className={cn(open && "mb-1.5")}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex items-center gap-1 text-xs text-muted-foreground transition-colors hover:text-foreground"
      >
        <Brain className="size-3" />
        <span>思考过程</span>
        <ChevronRight className={cn("size-3 transition-transform", open && "rotate-90")} />
      </button>
      {open ? (
        <div className="mt-1 whitespace-pre-wrap border-l-2 border-border pl-2.5 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]">
          {text}
        </div>
      ) : null}
    </div>
  )
}
