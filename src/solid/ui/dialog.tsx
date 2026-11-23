import { omit, Show } from "solid-js"
import type { ComponentProps, JSX } from "@solidjs/web"
import * as DialogPrimitive from "@kobalte/core/dialog"
import { X } from "@lucide/solid"

import { surfaceMotion } from "@shared/theme/motion"
import { cn } from "@/lib/utils"

import { DialogLayerMount } from "./layer-scope"

export const Dialog = DialogPrimitive.Root

const sheetSides = {
  right: "data-[state=closed]:slide-out-to-right data-[state=open]:slide-in-from-right inset-y-0 right-0 h-full w-3/4 border-l sm:max-w-sm",
  left: "data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left inset-y-0 left-0 h-full w-3/4 border-r sm:max-w-sm",
  top: "data-[state=closed]:slide-out-to-top data-[state=open]:slide-in-from-top inset-x-0 top-0 h-auto border-b",
  bottom: "data-[state=closed]:slide-out-to-bottom data-[state=open]:slide-in-from-bottom inset-x-0 bottom-0 h-auto border-t",
}

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
  sheetSide?: keyof typeof sheetSides
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
        data-slot={props.sheetSide ? "sheet-overlay" : "dialog-overlay"}
        data-state={state()}
        class={cn(surfaceMotion, "surface-fade fixed inset-0 bg-black/50", props.responsive ? "z-[120]" : "z-50")}
        onClick={(event) => {
          if (!event.defaultPrevented && event.button === 0 && !event.ctrlKey && props.dismissable !== false) {
            dialog.close()
          }
        }}
      />
      <DialogPrimitive.Content
        data-slot={props.sheetSide ? "sheet-content" : props.responsive ? "responsive-dialog-content" : "dialog-content"}
        data-state={state()}
        aria-modal={dialog.modal() ? "true" : undefined}
        onKeyDown={onKeyDown}
        onInteractOutside={(event) => {
          if (props.dismissable === false) event.preventDefault()
        }}
        class={cn(
          surfaceMotion,
          props.sheetSide
            ? cn("surface-fade surface-slide bg-background fixed z-50 flex flex-col gap-4 shadow-lg", sheetSides[props.sheetSide])
            : props.responsive
            ? "surface-responsive bg-card text-card-foreground fixed z-[130] flex flex-col border shadow-xl outline-none inset-x-0 bottom-0 max-h-[90dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)] sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-h-[85vh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-0"
            : "bg-background fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-lg border p-6 shadow-lg sm:max-w-lg",
          props.class,
        )}
        {...omit(props, "children", "class", "responsive", "sheetSide", "dismissable", "showCloseButton", "closeLabel", "onKeyDown", "onEscapeKeyDown")}
      >
        <DialogLayerMount value={dialog.contentRef}>{props.children}</DialogLayerMount>
        <Show when={props.showCloseButton !== false && props.dismissable !== false}>
          <DialogClose
            data-slot={props.sheetSide ? "sheet-close" : props.responsive ? "responsive-dialog-close" : "dialog-close"}
            class="ring-offset-background focus:ring-ring absolute top-3.5 right-3.5 rounded-md p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:size-4"
            aria-label={props.closeLabel ?? "Close"}
          >
            <X class={props.sheetSide ? "size-4" : undefined} />
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

export function DialogHeader(props: ComponentProps<"div">) {
  return <div data-slot="dialog-header" class={cn("flex flex-col gap-2 text-center sm:text-left", props.class)} {...omit(props, "class")} />
}

export function DialogFooter(props: ComponentProps<"div">) {
  return <div data-slot="dialog-footer" class={cn("flex flex-col-reverse gap-2 sm:flex-row sm:justify-end", props.class)} {...omit(props, "class")} />
}
