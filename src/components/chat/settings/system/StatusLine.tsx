import { cn } from "@/lib/utils"
import type { SectionMessage } from "./useSystemConfig"

/** Inline save/failure feedback line used by every section form. */
export function StatusLine({ msg }: { msg: SectionMessage }) {
  if (!msg) return null
  return (
    <p
      className={cn(
        "text-xs",
        msg.kind === "error" ? "text-destructive" : "text-muted-foreground"
      )}
    >
      {msg.text}
    </p>
  )
}
