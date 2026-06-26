import { useState } from "react"
import { Globe, ChevronRight } from "lucide-react"
import { cn } from "@/lib/utils"
import { LazyMarkdown as Markdown } from "./LazyMarkdown"

/**
 * Collapsible block for a provider "built-in tool" (e.g. GLM / Z.ai's
 * server-side analyze_image / web search) that the model narrates inline as
 * text. Keeps the verbose Input/Output (giant signed URLs, JSON) out of the way.
 */
export function BuiltinToolBlock({ name, body }: { name: string; body: string }) {
  const [open, setOpen] = useState(false)
  return (
    <div className="my-1.5">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground transition-colors hover:bg-muted"
      >
        <Globe className="size-3 shrink-0" />
        <span className="truncate">内置工具 · {name}</span>
        <ChevronRight className={cn("size-3 shrink-0 transition-transform", open && "rotate-90")} />
      </button>
      {open ? (
        <div className="mt-1.5 overflow-x-auto rounded-lg border bg-card/50 p-2.5 text-xs">
          <Markdown>{body}</Markdown>
        </div>
      ) : null}
    </div>
  )
}
