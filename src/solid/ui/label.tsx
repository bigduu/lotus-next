import { omit } from "solid-js"
import type { ComponentProps } from "@solidjs/web"

import { cn } from "@/lib/utils"

function Label(props: ComponentProps<"label">) {
  return (
    <label
      data-slot="label"
      class={cn(
        "flex items-center gap-2 text-sm leading-none font-medium select-none group-data-[disabled=true]:pointer-events-none group-data-[disabled=true]:opacity-50 peer-disabled:cursor-not-allowed peer-disabled:opacity-50",
        props.class
      )}
      {...omit(props, "class")}
    />
  )
}

export { Label }
