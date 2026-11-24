import { omit } from "solid-js"
import type { ComponentProps } from "@solidjs/web"

import { cn } from "@/lib/utils"

type ResizeHandleProps = ComponentProps<"div"> & { disabled?: boolean }

export function ResizeHandle(props: ResizeHandleProps) {
  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-disabled={props.disabled ? "true" : undefined}
      tabindex={props.disabled ? -1 : 0}
      data-separator=""
      class={cn(
        "group relative z-30 w-px shrink-0 touch-none cursor-col-resize bg-border outline-none focus-visible:bg-primary focus-visible:ring-2 focus-visible:ring-ring",
        props.class,
      )}
      {...omit(props, "class", "children", "disabled")}
    >
      <span aria-hidden="true" class="absolute inset-y-0 -left-1.5 -right-1.5 [@media(pointer:coarse)]:-left-3.5 [@media(pointer:coarse)]:-right-3.5" />
      <span aria-hidden="true" class="absolute inset-y-0 -left-px -right-px bg-primary opacity-0 transition-opacity group-hover:opacity-100 group-active:opacity-100" />
    </div>
  )
}
