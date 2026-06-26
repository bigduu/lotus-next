import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"

/**
 * Composer model switcher — a pill that opens a clean checkmark menu (upward,
 * since it sits above the composer). Replaces the plain native <select>.
 */
export function ModelPicker({
  models,
  value,
  onChange,
  menuPlacement = "up",
  menuAlign = "left",
}: {
  models: string[]
  value: string
  onChange: (model: string) => void
  menuPlacement?: "up" | "down"
  menuAlign?: "left" | "right"
}) {
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

  if (models.length === 0) return null

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="inline-flex max-w-[70vw] items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent md:max-w-xs"
      >
        <span className="truncate">{value || "选择模型"}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </button>

      {open ? (
        <div
          className={cn(
            "absolute z-50 max-h-72 w-72 max-w-[90vw] overflow-y-auto rounded-2xl border bg-popover p-1 shadow-xl",
            menuPlacement === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5",
            menuAlign === "right" ? "right-0" : "left-0",
          )}
        >
          {models.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => {
                onChange(m)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
            >
              <Check
                className={cn(
                  "size-4 shrink-0 text-primary",
                  m === value ? "opacity-100" : "opacity-0",
                )}
              />
              <span className={cn("truncate", m === value && "font-medium")}>{m}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
