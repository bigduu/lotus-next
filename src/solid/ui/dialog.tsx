import { omit, Show } from "solid-js"
import type { ComponentProps, JSX } from "@solidjs/web"
import * as DialogPrimitive from "@kobalte/core/dialog"
import { X } from "@lucide/solid"

import { surfaceMotion } from "@/components/ui/motion"
import { cn } from "@/lib/utils"

import { DialogLayerMount } from "./layer-scope"

export const Dialog = DialogPrimitive.Root

export function DialogTrigger(props: ComponentProps<typeof DialogPrimitive.Trigger>) {
  const dialog = DialogPrimitive.useDialogContext()
  return <DialogPrimitive.Trigger data-slot="dialog-trigger" data-state={dialog.isOpen() ? "open" : "closed"} {...props} />
}

export function DialogClose(props: ComponentProps<typeof DialogPrimitive.CloseButton>) {
  return <DialogPrimitive.CloseButton data-slot="dialog-close" {...props} />
}

type DialogContentProps = Omit<
  ComponentProps<typeof DialogPrimitive.Content>,
  "onPointerDownOutside" | "onInteractOutside"
> & {
  responsive?: boolean
  dismissable?: boolean
  showCloseButton?: boolean
  closeLabel?: string
}

export function DialogContent(props: DialogContentProps) {
  const dialog = DialogPrimitive.useDialogContext()
  const state = () => dialog.isOpen() ? "open" : "closed"

  // Kobalte's alpha dismissable-layer stack can miss the dialog while its portal
  // registers. Bind dismissal to this surface and leave open listboxes to Select.
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
    if (props.dismissable !== false) dialog.close()
  }

  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        data-slot="dialog-overlay"
        data-state={state()}
        class={cn(surfaceMotion, "surface-fade fixed inset-0 bg-black/50", props.responsive ? "z-[120]" : "z-50")}
        onClick={(event) => {
          if (!event.defaultPrevented && event.button === 0 && !event.ctrlKey && props.dismissable !== false) {
            dialog.close()
          }
        }}
      />
      <DialogPrimitive.Content
        data-slot={props.responsive ? "responsive-dialog-content" : "dialog-content"}
        data-state={state()}
        aria-modal={dialog.modal() ? "true" : undefined}
        onKeyDown={onKeyDown}
        onInteractOutside={(event) => {
          if (props.dismissable === false) event.preventDefault()
        }}
        class={cn(
          surfaceMotion,
          props.responsive
            ? "surface-responsive bg-card text-card-foreground fixed z-[130] flex flex-col border shadow-xl outline-none inset-x-0 bottom-0 max-h-[90dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)] sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-h-[85vh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-0"
            : "bg-background fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg sm:max-w-lg",
          props.class,
        )}
        {...omit(props, "children", "class", "responsive", "dismissable", "showCloseButton", "closeLabel", "onKeyDown", "onEscapeKeyDown")}
      >
        <DialogLayerMount value={dialog.contentRef}>{props.children}</DialogLayerMount>
        <Show when={props.showCloseButton !== false && props.dismissable !== false}>
          <DialogClose
            class="ring-offset-background focus:ring-ring absolute top-3.5 right-3.5 rounded-md p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:size-4"
            aria-label={props.closeLabel ?? "Close"}
          >
            <X />
          </DialogClose>
        </Show>
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

export function DialogTitle(props: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="dialog-title"
      class={cn("text-lg leading-none font-semibold", props.class)}
      {...omit(props, "class")}
    />
  )
}

export function DialogDescription(props: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="dialog-description"
      class={cn("text-muted-foreground text-sm", props.class)}
      {...omit(props, "class")}
    />
  )
}
