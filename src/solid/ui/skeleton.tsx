import { omit } from "solid-js"
import type { ComponentProps } from "@solidjs/web"

import { cn } from "@/lib/utils"

function Skeleton(props: ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      class={cn("bg-accent animate-pulse rounded-md", props.class)}
      {...omit(props, "class")}
    />
  )
}

export { Skeleton }
