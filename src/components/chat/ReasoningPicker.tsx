import { uiText, useUiLocale } from "@shared/i18n/ui"
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
  { value: "auto", get label() { return uiText("auto_7eb336e4") } },
  { value: "none", get label() { return uiText("reasoning_none") } },
  { value: "low", get label() { return uiText("low_aa9e366f") } },
  { value: "medium", get label() { return uiText("medium_a567bdaa") } },
  { value: "high", get label() { return uiText("high_b1c27820") } },
  { value: "xhigh", get label() { return uiText("extra_high_392d0dce") } },
  { value: "max", get label() { return uiText("max_9730c15f") } },
]

const reasoningEffortLabel = (value: ReasoningEffortSelection) => EFFORTS.find((e) => e.value === value)?.label ?? uiText("auto_7eb336e4")

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
  useUiLocale()
  const current = allowUltra && thinkingMode === null ? uiText("unconfirmed_c098e854")
    : allowUltra && thinkingMode === "ultra" ? uiText("ultra_orchestration_5857fcd7") : reasoningEffortLabel(value)
  const standard = !allowUltra || thinkingMode !== "ultra"

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={uiText("reasoning_level_c8c14507")}
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
            <span className={cn("truncate", thinkingMode === "ultra" && "font-medium")}>{uiText("ultra_orchestration_5857fcd7")}</span>
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
