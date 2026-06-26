import { useEffect, useRef, useState, type ReactNode } from "react"
import { MoreHorizontal } from "lucide-react"

type Item = { label: string; icon?: ReactNode; onClick: () => void }

/** Header "⋯" overflow menu for secondary actions (export, split, …). */
export function OverflowMenu({ items }: { items: Item[] }) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener("mousedown", onDoc)
    return () => document.removeEventListener("mousedown", onDoc)
  }, [open])

  if (items.length === 0) return null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="更多"
        className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-accent hover:text-foreground"
      >
        <MoreHorizontal className="size-5" />
      </button>
      {open ? (
        <div className="absolute right-0 top-full z-50 mt-1 min-w-44 rounded-2xl border bg-popover p-1 shadow-xl">
          {items.map((it, i) => (
            <button
              key={i}
              type="button"
              onClick={() => {
                it.onClick()
                setOpen(false)
              }}
              className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
            >
              {it.icon}
              <span>{it.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
