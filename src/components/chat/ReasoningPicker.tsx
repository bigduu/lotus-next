import { Check, Gauge } from "lucide-react"
import { cn } from "@/lib/utils"
import type { ReasoningEffortSelection } from "@shared/utils/reasoningEffort"
import type { ThinkingMode } from "@services/chat/AgentService"
import type { ThinkingPickerSelection } from "@/hooks/useRootThinkingMode"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

const EFFORTS: { value: ReasoningEffortSelection; label: string }[] = [
  { value: "auto", label: "自动" },
  { value: "none", label: "关闭" },
  { value: "low", label: "低" },
  { value: "medium", label: "中" },
  { value: "high", label: "高" },
  { value: "xhigh", label: "极高" },
  { value: "max", label: "最大" },
]

const reasoningEffortLabel = (value: ReasoningEffortSelection) => EFFORTS.find((e) => e.value === value)?.label ?? "自动"

/** Reasoning-effort switcher — mirrors ModelPicker's pill + checkmark menu. */
export function ReasoningPicker({
  value,
  onChange,
  disabled = false,
  menuPlacement = "down",
  menuAlign = "right",
  allowUltra = false,
  thinkingMode,
}: {
  value: ReasoningEffortSelection
  onChange: (effort: ThinkingPickerSelection) => void
  disabled?: boolean
  menuPlacement?: "up" | "down"
  menuAlign?: "left" | "right"
  allowUltra?: boolean
  thinkingMode?: ThinkingMode | null
}) {
  const current = allowUltra && thinkingMode === null ? "未确认"
    : allowUltra && thinkingMode === "ultra" ? "Ultra · 编排" : reasoningEffortLabel(value)
  const standard = !allowUltra || thinkingMode !== "ultra"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="推理强度"
        disabled={disabled}
        className="inline-flex items-center gap-1 rounded-full border bg-card px-2.5 py-1 text-xs font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50"
      >
        <Gauge className="size-3.5 shrink-0 opacity-70" />
        <span>{current}</span>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={menuPlacement === "up" ? "top" : "bottom"}
        align={menuAlign === "right" ? "end" : "start"}
        className="max-h-72 w-36 overflow-y-auto rounded-2xl"
      >
        {allowUltra ? (
          <DropdownMenuItem onClick={() => onChange("ultra")} className="gap-2 rounded-xl px-3 py-2">
            <Check className={cn("size-4 shrink-0 text-primary", thinkingMode === "ultra" ? "opacity-100" : "opacity-0")} />
            <span className={cn("truncate", thinkingMode === "ultra" && "font-medium")}>Ultra · 编排</span>
          </DropdownMenuItem>
        ) : null}
        {EFFORTS.map((e) => (
          <DropdownMenuItem
            key={e.value}
            onClick={() => onChange(e.value)}
            className="gap-2 rounded-xl px-3 py-2"
          >
            <Check
              className={cn(
                "size-4 shrink-0 text-primary",
                standard && e.value === value ? "opacity-100" : "opacity-0",
              )}
            />
            <span className={cn("truncate", standard && e.value === value && "font-medium")}>
              {e.label}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
