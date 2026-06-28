import { type ReactNode } from "react"
import { MoreHorizontal } from "lucide-react"

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

type Item = { label: string; icon?: ReactNode; onClick: () => void }

/** Header "⋯" overflow menu for secondary actions (export, split, …). */
export function OverflowMenu({ items }: { items: Item[] }) {
  if (items.length === 0) return null

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label="更多"
        className="inline-flex size-9 items-center justify-center rounded-md text-muted-foreground transition-colors outline-none hover:bg-accent hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
      >
        <MoreHorizontal className="size-5" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-44 rounded-2xl">
        {items.map((it, i) => (
          <DropdownMenuItem
            key={i}
            onClick={it.onClick}
            className="gap-2.5 rounded-xl px-3 py-2"
          >
            {it.icon}
            <span>{it.label}</span>
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}
