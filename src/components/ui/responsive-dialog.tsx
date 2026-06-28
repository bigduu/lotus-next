import * as React from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"

/**
 * A modal that is a bottom-sheet on mobile and a centered card on desktop —
 * the single home for the `items-end … md:items-center` + `rounded-t-2xl` +
 * `env(safe-area-inset-bottom)` pattern that was hand-rolled across ~8 overlays.
 * Built on Radix Dialog → focus-trap, Esc, scroll-lock, a11y for free.
 */
function ResponsiveDialog(
  props: React.ComponentProps<typeof DialogPrimitive.Root>
) {
  return <DialogPrimitive.Root data-slot="responsive-dialog" {...props} />
}

function ResponsiveDialogTrigger(
  props: React.ComponentProps<typeof DialogPrimitive.Trigger>
) {
  return (
    <DialogPrimitive.Trigger data-slot="responsive-dialog-trigger" {...props} />
  )
}

function ResponsiveDialogClose(
  props: React.ComponentProps<typeof DialogPrimitive.Close>
) {
  return <DialogPrimitive.Close data-slot="responsive-dialog-close" {...props} />
}

function ResponsiveDialogContent({
  className,
  children,
  showCloseButton = true,
  /** When false, clicking outside / pressing Esc will NOT close (required prompts). */
  dismissable = true,
  ...props
}: React.ComponentProps<typeof DialogPrimitive.Content> & {
  showCloseButton?: boolean
  dismissable?: boolean
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay
        className="data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed inset-0 z-[120] bg-black/50"
      />
      <DialogPrimitive.Content
        data-slot="responsive-dialog-content"
        onInteractOutside={dismissable ? undefined : (e) => e.preventDefault()}
        onEscapeKeyDown={dismissable ? undefined : (e) => e.preventDefault()}
        className={cn(
          "bg-card text-card-foreground data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 fixed z-[130] flex flex-col border shadow-xl outline-none duration-200",
          // Mobile: bottom sheet
          "inset-x-0 bottom-0 max-h-[90dvh] rounded-t-2xl pb-[env(safe-area-inset-bottom)] data-[state=open]:slide-in-from-bottom-4 data-[state=closed]:slide-out-to-bottom-4",
          // Desktop: centered card
          "sm:inset-x-auto sm:bottom-auto sm:top-1/2 sm:left-1/2 sm:max-h-[85vh] sm:w-full sm:max-w-md sm:-translate-x-1/2 sm:-translate-y-1/2 sm:rounded-2xl sm:pb-0 sm:data-[state=open]:slide-in-from-bottom-0 sm:data-[state=open]:zoom-in-95 sm:data-[state=closed]:zoom-out-95",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && dismissable && (
          <DialogPrimitive.Close className="ring-offset-background focus:ring-ring absolute top-3.5 right-3.5 rounded-md p-1 text-muted-foreground opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:size-4">
            <X />
            <span className="sr-only">关闭</span>
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
