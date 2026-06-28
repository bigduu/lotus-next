import { GitFork, Loader2 } from "lucide-react"

/** Transient bottom-center pills: fork-in-progress spinner + a generic toast. */
export function Toasts({ forking, toast }: { forking: boolean; toast: string | null }) {
  if (forking) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[110] flex justify-center px-4">
        <div className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-xl animate-in fade-in slide-in-from-bottom-2">
          <Loader2 className="size-4 animate-spin text-primary" />
          分叉中…
        </div>
      </div>
    )
  }
  if (toast) {
    return (
      <div className="pointer-events-none fixed inset-x-0 bottom-28 z-[110] flex justify-center px-4">
        <div className="flex items-center gap-2 rounded-full border bg-card px-4 py-2 text-sm font-medium text-foreground shadow-xl animate-in fade-in slide-in-from-bottom-2">
          <GitFork className="size-4 text-primary" />
          {toast}
        </div>
      </div>
    )
  }
  return null
}
