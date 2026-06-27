import { useEffect, useRef } from "react"
import { Brain } from "lucide-react"

/** Live "思考中…" reasoning stream — pinned to the latest line as it grows. */
export function StreamingReasoning({ text, spaced }: { text: string; spaced?: boolean }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = ref.current
    if (el) el.scrollTop = el.scrollHeight
  }, [text])

  return (
    <div className={spaced ? "mb-2" : ""}>
      <div className="mb-1 flex items-center gap-1.5 text-xs text-muted-foreground">
        <Brain className="size-3.5 animate-pulse" /> 思考中…
      </div>
      <div
        ref={ref}
        className="max-h-48 overflow-y-auto whitespace-pre-wrap border-l-2 border-border pl-3 text-xs leading-relaxed text-muted-foreground [overflow-wrap:anywhere]"
      >
        {text}
      </div>
    </div>
  )
}
