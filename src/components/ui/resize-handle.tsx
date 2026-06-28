import { type PointerEvent as ReactPointerEvent } from "react"

import { cn } from "@/lib/utils"

/**
 * A thin draggable divider between two panels (desktop only). Renders as a
 * 1px line with a wider invisible hit-area; highlights on hover/drag.
 */
export function ResizeHandle({
  onPointerDown,
  className,
}: {
  onPointerDown: (e: ReactPointerEvent) => void
  className?: string
}) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      onPointerDown={onPointerDown}
      className={cn(
        "group relative z-30 hidden w-px shrink-0 cursor-col-resize bg-border md:block",
        className,
      )}
    >
      {/* Wider invisible hit-area so the 1px line is easy to grab. */}
      <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
      {/* Highlight on hover / active. */}
      <span className="absolute inset-y-0 -left-px -right-px bg-primary opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100" />
    </div>
  )
}
