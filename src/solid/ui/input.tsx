import { omit } from "solid-js"
import type { ComponentProps } from "@solidjs/web"

import { cn } from "@/lib/utils"

export function Input(props: ComponentProps<"input">) {
  return (
    <input
      data-slot="input"
      class={cn(
        "file:text-foreground placeholder:text-muted-foreground selection:bg-primary selection:text-primary-foreground border-input flex h-9 w-full min-w-0 rounded-md border bg-background px-3 py-1 text-base shadow-xs transition-[color,box-shadow] outline-none file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50 md:text-sm",
        "aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive",
        props.class
      )}
      {...omit(props, "class")}
    />
  )
}
