import { uiText, useUiLocale } from "@shared/i18n/ui"
import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { surfaceMotion } from "./motion"

/**
 * A modal that is a bottom-sheet on mobile and a centered card on desktop —
 * the single home for the `items-end … md:items-center` + `rounded-t-2xl` +
 * `env(safe-area-inset-bottom)` pattern that was hand-rolled across ~8 overlays.
 * Built on Radix Dialog → focus-trap, Esc, scroll-lock, a11y for free.
 */
function ResponsiveDialog(
  props: React.ComponentProps<typeof DialogPrimitive.Root>
) {
  useUiLocale()
  return <DialogPrimitive.Root data-slot="responsive-dialog" {...props} />
}

function ResponsiveDialogTrigger(
  props: React.ComponentProps<typeof DialogPrimitive.Trigger>
) {
  useUiLocale()
  return (
    <DialogPrimitive.Trigger data-slot="responsive-dialog-trigger" {...props} />
  )
}

function ResponsiveDialogClose(
  props: React.ComponentProps<typeof DialogPrimitive.Close>
) {
  useUiLocale()
  return <DialogPrimitive.Close data-slot="responsive-dialog-close" {...props} />
}

function ResponsiveDialogContent({
  className,
  children,
  showCloseButton = true,
  /** When false, clicking outside / pressing Esc will NOT close (required prompts). */
  dismissable = true,
  onEscapeKeyDown,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  dismissable?: boolean
}) {
  useUiLocale()
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className={cn(surfaceMotion, "surface-fade fixed inset-0 z-[120] bg-black/50")}
      />
      <DialogPrimitive.Content
        data-slot="responsive-dialog-content"
        onInteractOutside={dismissable ? undefined : (e) => e.preventDefault()}
        onEscapeKeyDown={(event) => {
          const target = event.target
          const ownerDocument =
            (target as { ownerDocument?: Document | null } | null)?.ownerDocument ?? document
          const targetElement =
            typeof (target as { closest?: unknown } | null)?.closest === "function"
              ? (target as Element)
              : ownerDocument.activeElement
          const expandedCombobox = Boolean(
            targetElement?.closest('[role="combobox"][aria-expanded="true"]'),
          )
          if (!dismissable || expandedCombobox) event.preventDefault()
          onEscapeKeyDown?.(event)
        }}
        className={cn(
          surfaceMotion,
          "surface-responsive bg-card text-card-foreground fixed z-[130] flex flex-col border shadow-xl outline-none",
          // Mobile: bottom sheet
          "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)]",
          // Desktop: centered card
          "sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-h-[85vh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-0",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && dismissable && (
          <DialogPrimitive.Close className="ring-offset-background focus:ring-ring absolute top-3.5 right-3.5 rounded-md p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:size-4">
            <X />
            <span className="sr-only">{uiText("close_3fd47edc")}</span>
          </DialogPrimitive.Close>
        )}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

function ResponsiveDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Title>) {
  useUiLocale()
  return (
    <DialogPrimitive.Title
      data-slot="responsive-dialog-title"
      className={cn("text-base leading-none font-semibold", className)}
      {...props}
    />
  )
}

function ResponsiveDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Description>) {
  useUiLocale()
  return (
    <DialogPrimitive.Description
      data-slot="responsive-dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  ResponsiveDialog,
  ResponsiveDialogTrigger,
  ResponsiveDialogClose,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
}
