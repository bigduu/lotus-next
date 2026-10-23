import * as React from "react"
import { Command as CommandPrimitive, useCommandState } from "cmdk"

import { cn } from "@/lib/utils"
import { isCommandComposing } from "@/lib/commandComposition"

function Command({
  className,
  onCompositionStartCapture,
  onCompositionEndCapture,
  onBlurCapture,
  onKeyDownCapture,
  ...props
}: React.ComponentProps<typeof CommandPrimitive>) {
  return <CommandPrimitive
    data-slot="command"
    vimBindings={false}
    className={cn("flex w-full flex-col overflow-hidden bg-popover text-popover-foreground", className)}
    {...props}
    onCompositionStartCapture={(event) => {
      event.currentTarget.dataset.commandComposing = "true"
      onCompositionStartCapture?.(event)
    }}
    onCompositionEndCapture={(event) => {
      delete event.currentTarget.dataset.commandComposing
      onCompositionEndCapture?.(event)
    }}
    onBlurCapture={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) delete event.currentTarget.dataset.commandComposing
      onBlurCapture?.(event)
    }}
    onKeyDownCapture={(event) => {
      onKeyDownCapture?.(event)
      // Keep candidate navigation/confirmation inside the IME, including
      // engines that omit isComposing on the final Enter or Escape event.
      if (isCommandComposing(event.nativeEvent)) event.stopPropagation()
    }}
  />
}

function CommandInput({ className, ref, ...props }: React.ComponentProps<typeof CommandPrimitive.Input>) {
  const inputRef = React.useRef<HTMLInputElement>(null)
  useCommandState((state) => state.value)
  useCommandState((state) => state.filtered.count)
  useCommandState((state) => state.selectedItemId)
  React.useImperativeHandle(ref, () => inputRef.current!, [])
  React.useLayoutEffect(() => {
    const input = inputRef.current
    const selected = input?.closest("[cmdk-root]")?.querySelector<HTMLElement>('[cmdk-item][aria-selected="true"]')
    // cmdk 1.1.1 can omit the initial active descendant while already
    // highlighting an option. Derive ARIA from its actual selected DOM item;
    // the library continues to own selection, navigation and item identity.
    if (selected?.id) input?.setAttribute("aria-activedescendant", selected.id)
    else input?.removeAttribute("aria-activedescendant")
  })
  return <CommandPrimitive.Input data-slot="command-input"
    ref={inputRef}
    className={cn("w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50", className)}
    {...props} />
}

function CommandList({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.List>) {
  return <CommandPrimitive.List data-slot="command-list"
    className={cn("overflow-x-hidden overflow-y-auto scroll-py-1", className)} {...props} />
}

function CommandItem({ className, ...props }: React.ComponentProps<typeof CommandPrimitive.Item>) {
  return <CommandPrimitive.Item data-slot="command-item"
    className={cn("relative flex cursor-default select-none items-center outline-none data-[selected=true]:bg-accent data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50", className)}
    {...props} />
}

export { Command, CommandInput, CommandList, CommandItem }
