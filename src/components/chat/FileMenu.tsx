import { uiText, useUiLocale } from "@shared/i18n/ui"
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
  inputId,
}: {
  inputId: string
  files: WorkspaceFileEntry[]
  query: string
  onPick: (entry: WorkspaceFileEntry) => void
  onDismiss?: () => void
}) {
  useUiLocale()
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
    inputId,
  )
  const activeItemRef = useRef<HTMLButtonElement | null>(null)
  useEffect(() => {
    activeItemRef.current?.scrollIntoView({ block: "nearest" })
  }, [active])

  useEffect(() => {
    const input = document.getElementById(inputId)
    if (!input || filtered.length === 0) return
    input.setAttribute("aria-controls", `${inputId}-files`)
    input.setAttribute("aria-expanded", "true")
    input.setAttribute("aria-autocomplete", "list")
    input.setAttribute("aria-activedescendant", `${inputId}-file-${active}`)
    return () => {
      for (const attribute of ["aria-controls", "aria-expanded", "aria-autocomplete", "aria-activedescendant"]) input.removeAttribute(attribute)
    }
  }, [inputId, active, filtered.length])

  if (filtered.length === 0) return null

  return (
    <div className="mx-auto mb-2 w-full max-w-6xl overflow-hidden rounded-xl border bg-popover shadow-lg">
      <div className="border-b px-3 py-1.5 text-xs text-muted-foreground">{uiText("workspace_files_c0c1e416")}</div>
      <div role="listbox" id={`${inputId}-files`} aria-label={uiText("workspace_files_c0c1e416")} className="max-h-64 overflow-y-auto p-1">
        {filtered.map((f, i) => (
          <button
            key={f.path}
            role="option"
            id={`${inputId}-file-${i}`}
            aria-selected={i === active}
            tabIndex={-1}
            onMouseDown={(event) => event.preventDefault()}
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
