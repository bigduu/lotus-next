import { omit } from "solid-js"
import type { ComponentProps } from "@solidjs/web"

import { cn } from "@/lib/utils"

function Textarea(props: ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="textarea"
      class={cn(
        "field-sizing-content min-h-10 w-full min-w-0 resize-none overflow-x-hidden rounded-md bg-transparent px-3 py-2 text-base outline-none [overflow-wrap:anywhere] placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50",
        props.class
      )}
      {...omit(props, "class")}
    />
  )
}

export { Textarea }
