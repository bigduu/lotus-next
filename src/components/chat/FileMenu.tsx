import { useEffect, useRef } from "react"
import type { WorkspaceFileEntry } from "@services/workspace/types"
import { cn } from "@/lib/utils"
import { useMenuKeyboardNav } from "./useMenuKeyboardNav"

/**
 * "@" file-reference picker shown above the composer when the draft ends with an
 * "@query". Lists workspace files filtered by the query; picking one (click or
 * ↑↓ + Enter/Tab) inserts its path into the message; Escape dismisses.
 */
export function FileMenu({
  files,
  query,
  onPick,
  onDismiss,
}: {
  files: WorkspaceFileEntry[]
  query: string
  onPick: (entry: WorkspaceFileEntry) => void
  onDismiss?: () => void
}) {
  const q = query.trim().toLowerCase()
  const filtered = files
    .filter((f) => !f.is_directory && (!q || f.path.toLowerCase().includes(q)))
    .slice(0, 8)

  const active = useMenuKeyboardNav(
    filtered.length,
    (i) => {
      const entry = filtered[i]
      if (entry) onPick(entry)
    },
    onDismiss,
  )
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" })
  }, [active])

  if (filtered.length === 0) return null

  return (
    <div className="mx-auto mb-2 max-w-2xl overflow-hidden rounded-xl border bg-popover shadow-lg">
      <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">工作区文件</div>
      <div className="max-h-64 overflow-y-auto p-1">
        {filtered.map((f, i) => (
          <button
            key={f.path}
            ref={i === active ? activeItemRef : undefined}
            onClick={() => onPick(f)}
            className={cn(
              "block w-full truncate rounded-lg px-3 py-1.5 text-left text-sm transition-colors hover:bg-accent",
              i === active && "bg-accent",
            )}
          >
            {f.path}
          </button>
        ))}
      </div>
    </div>
  )
}
