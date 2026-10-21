import { type ComponentProps } from "react"
import { Separator } from "react-resizable-panels"

import { cn } from "@/lib/utils"

/**
 * A thin draggable divider between two panels (desktop only). Renders as a
 * 1px line with a wider invisible hit-area; highlights on hover/drag.
 */
export function ResizeHandle({
  className,
  ...props
}: ComponentProps<typeof Separator>) {
  return (
    <Separator
      disableDoubleClick
      {...props}
      className={cn(
        "group relative z-30 w-px cursor-col-resize bg-border outline-none focus-visible:bg-primary focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      {/* Keep the DOM target clear of nearby content. Group expands coarse-pointer hits. */}
      <span className="absolute inset-y-0 -left-1.5 -right-1.5" />
      {/* Highlight on hover / active. */}
      <span className="absolute inset-y-0 -left-px -right-px bg-primary opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100" />
    </Separator>
  )
}
