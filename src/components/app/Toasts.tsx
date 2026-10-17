import { uiText, useUiLocale } from "@shared/i18n/ui"
import type { CSSProperties } from "react"
import { Info, Loader2 } from "lucide-react"
import { surfaceMotion } from "@/components/ui/motion"
import { cn } from "@/lib/utils"

/** Transient results may include errors, so use a neutral icon rather than success. */
export function Toasts({ forking, toast }: { forking: boolean; toast: string | null }) {
  useUiLocale()
  if (!forking && !toast) return null
  return (
    <div role="status" aria-atomic="true" className="pointer-events-none fixed inset-x-0 bottom-28 z-[110] flex justify-center px-4">
      <div key={forking ? "forking" : toast} className={cn(surfaceMotion,
        "surface-fade flex min-w-0 max-w-md items-start gap-2 rounded-2xl border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-lg")}
        style={{ "--tw-enter-translate-y": "8px" } as CSSProperties}>
        {forking ? <Loader2 className="mt-0.5 size-4 shrink-0 animate-spin text-primary" aria-hidden />
          : <Info className="mt-0.5 size-4 shrink-0 text-primary" aria-hidden />}
        <span className="min-w-0 break-words">{forking ? uiText("forking_bed88cb0") : toast}</span>
      </div>
    </div>
  )
}
