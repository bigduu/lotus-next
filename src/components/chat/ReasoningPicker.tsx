import { useEffect, useRef, useState } from "react"
import { Check, Gauge } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ReasoningEffort } from "@services/chat/AgentService"

const EFFORTS: { value: ReasoningEffort; label: string }[] = [
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "极高" },
  { value: "max", label: "最大" },
]

/** Reasoning-effort switcher — mirrors ModelPicker's pill + checkmark menu. */
export function ReasoningPicker({
  value,
  onChange,
  menuPlacement = "down",
  menuAlign = "right",
}: {
  value: ReasoningEffort
  onChange: (effort: ReasoningEffort) => void
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

  const current = EFFORTS.find((e) => e.value === value)?.label ?? "中"

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-label="推理强度"
        className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-foreground transition-colors hover:bg-accent"
      >
        <Gauge className="size-3.5 shrink-0 opacity-70" />
        <span>{current}</span>
      </button>

      {open ? (
        <div
          className={cn(
            "absolute z-50 max-h-72 w-36 overflow-y-auto rounded-2xl border bg-popover p-1 shadow-xl",
            menuPlacement === "up" ? "bottom-full mb-1.5" : "top-full mt-1.5",
            menuAlign === "right" ? "right-0" : "left-0",
          )}
        >
          {EFFORTS.map((e) => (
            <button
              key={e.value}
              type="button"
              onClick={() => {
                onChange(e.value)
                setOpen(false)
              }}
              className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors hover:bg-accent"
            >
              <Check
                className={cn(
                  "size-4 shrink-0 text-primary",
                  e.value === value ? "opacity-100" : "opacity-0",
                )}
              />
              <span className={cn("truncate", e.value === value && "font-medium")}>{e.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}
