import { Check, ChevronDown } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

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
  if (models.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger className="inline-flex max-w-[70vw] items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 md:max-w-xs">
        <span className="truncate">{value || "选择模型"}</span>
        <ChevronDown className="size-3 shrink-0 opacity-60" />
      </DropdownMenuTrigger>
      <DropdownMenuContent
        side={menuPlacement === "up" ? "top" : "bottom"}
        align={menuAlign === "right" ? "end" : "start"}
        className="max-h-72 w-72 max-w-[90vw] overflow-y-auto rounded-2xl"
      >
        {models.map((m) => (
          <DropdownMenuItem
            key={m}
            onClick={() => onChange(m)}
            className="gap-2 rounded-xl px-3 py-2"
          >
            <Check
              className={cn(
                "size-4 shrink-0 text-primary",
                m === value ? "opacity-100" : "opacity-0",
              )}
            />
            <span className={cn("truncate", m === value && "font-medium")}>
              {m}
            </span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
