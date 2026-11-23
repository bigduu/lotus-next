import { createEffect, createSignal, omit, useContext } from "solid-js"
import type { ComponentProps, JSX } from "@solidjs/web"
import * as PopoverPrimitive from "@kobalte/core/popover"

import { surfaceMotion } from "@/components/ui/motion"
import { cn } from "@/lib/utils"

import { DialogLayerMount } from "./layer-scope"

const focusableSelector = [
  "input:not([type=hidden]):not(:disabled)",
  "button:not(:disabled)",
  "textarea:not(:disabled)",
  "select:not(:disabled)",
  "a[href]",
  "[tabindex]:not([tabindex='-1'])",
].join(",")

export function Popover(props: ComponentProps<typeof PopoverPrimitive.Root>) {
  return <PopoverPrimitive.Root placement="bottom" gutter={4} {...props} />
}

export function PopoverTrigger(props: ComponentProps<typeof PopoverPrimitive.Trigger>) {
  const popover = PopoverPrimitive.usePopoverContext()
  return <PopoverPrimitive.Trigger data-slot="popover-trigger" data-state={popover.isOpen() ? "open" : "closed"} {...props} />
}

export function PopoverAnchor(props: ComponentProps<typeof PopoverPrimitive.Anchor>) {
  return <PopoverPrimitive.Anchor data-slot="popover-anchor" {...props} />
}

export function PopoverClose(props: ComponentProps<typeof PopoverPrimitive.CloseButton>) {
  return <PopoverPrimitive.CloseButton data-slot="popover-close" {...props} />
}

export function PopoverContent(props: ComponentProps<typeof PopoverPrimitive.Content>) {
  const popover = PopoverPrimitive.usePopoverContext()
  const dialogMount = useContext(DialogLayerMount)
  const [content, setContent] = createSignal<HTMLDivElement>()
  let interactedOutside = false

  createEffect(
    () => ({ element: content(), open: popover.isOpen(), modal: popover.isModal() }),
    ({ element, open, modal }) => {
      if (!element || !open || modal) return

      interactedOutside = false
      const event = new Event("popoverOpenAutoFocus", { cancelable: true })
      props.onOpenAutoFocus?.(event)
      if (!event.defaultPrevented) {
        const target = element.querySelector<HTMLElement>("[autofocus]") ??
          element.querySelector<HTMLElement>(focusableSelector) ??
          element
        target.focus({ preventScroll: true })
      }

      return () => {
        const event = new Event("popoverCloseAutoFocus", { cancelable: true })
        props.onCloseAutoFocus?.(event)
        if (!event.defaultPrevented && !interactedOutside) {
          popover.triggerRef()?.focus({ preventScroll: true })
        }
      }
    },
  )

  const onKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    const handler = props.onKeyDown
    if (typeof handler === "function") handler(event)
    else handler?.[0](handler[1], event)

    if (
      event.key !== "Escape" || event.defaultPrevented || event.isComposing ||
      event.currentTarget.querySelector('[aria-haspopup="listbox"][aria-expanded="true"]')
    ) return

    props.onEscapeKeyDown?.(event)
    if (event.defaultPrevented) return
    event.preventDefault()
    popover.close()
  }

  return (
    <PopoverPrimitive.Portal mount={dialogMount()}>
      <PopoverPrimitive.Content
        ref={[setContent, props.ref]}
        data-slot="popover-content"
        data-state={popover.isOpen() ? "open" : "closed"}
        class={cn(
          "bg-popover text-popover-foreground z-50 w-72 origin-(--kb-popover-content-transform-origin) rounded-md border p-4 shadow-md outline-hidden",
          surfaceMotion,
          props.class,
        )}
        {...omit(props, "ref", "class", "onKeyDown", "onEscapeKeyDown", "onOpenAutoFocus", "onCloseAutoFocus", "onInteractOutside")}
        onKeyDown={onKeyDown}
        onOpenAutoFocus={props.onOpenAutoFocus}
        onCloseAutoFocus={props.onCloseAutoFocus}
        onInteractOutside={(event) => {
          props.onInteractOutside?.(event)
          if (!event.defaultPrevented && !popover.triggerRef()?.contains(event.target as Node)) {
            interactedOutside = true
          }
        }}
      />
    </PopoverPrimitive.Portal>
  )
}
