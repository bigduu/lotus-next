import { omit } from "solid-js"
import type { ComponentProps } from "@solidjs/web"

import { cn } from "@/lib/utils"

type SeparatorProps = ComponentProps<"div"> & {
  orientation?: "horizontal" | "vertical"
}

export function Separator(props: SeparatorProps) {
  const orientation = () => props.orientation ?? "horizontal"
  return (
    <div
      data-slot="separator"
      role="separator"
      aria-orientation={orientation()}
      class={cn(
        "bg-border shrink-0",
        orientation() === "horizontal" ? "h-px w-full" : "h-full w-px",
        props.class,
      )}
      {...omit(props, "class", "orientation")}
    />
  )
}
