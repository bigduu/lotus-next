import { Check, Gauge } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ReasoningEffort } from "@services/chat/AgentService"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

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
  const current = EFFORTS.find((e) => e.value === value)?.label ?? "中"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="推理强度"
        className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <Gauge className="size-3.5 shrink-0 opacity-70" />
        <span>{current}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={menuPlacement === "up" ? "top" : "bottom"}
        align={menuAlign === "right" ? "end" : "start"}
        className="max-h-72 w-36 overflow-y-auto rounded-2xl"
      >
        {EFFORTS.map((e) => (
          <DropdownMenuItem
            key={e.value}
            onClick={() => onChange(e.value)}
            className="gap-2 rounded-xl px-3 py-2"
          >
            <Check
              className={cn(
                "size-4 shrink-0 text-primary",
                e.value === value ? "opacity-100" : "opacity-0",
              )}
            />
            <span className={cn("truncate", e.value === value && "font-medium")}>
              {e.label}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
