import { useRef, type ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"

type ApprovalAction = {
  id: string
  label: string
  onSelect: () => void
}

/** Presentation only: each adapter supplies its already-authorized actions. */
export function ApprovalPresentation({
  title,
  description,
  actions,
  disabled = false,
  children,
  footer,
}: {
  title: string
  description: string
  actions: ApprovalAction[]
  disabled?: boolean
  children?: ReactNode
  footer?: ReactNode
}) {
  const contentRef = useRef<HTMLDivElement>(null)
  return (
    <ResponsiveDialog open>
      <ResponsiveDialogContent
        ref={contentRef}
        dismissable={false}
        showCloseButton={false}
        className="overflow-y-auto p-5 sm:pb-5"
        data-approval-presentation
        onOpenAutoFocus={(event) => {
          // Opening a request does not select an action. Keyboard users can
          // Tab to a choice; Enter carried over from the composer stays inert.
          event.preventDefault()
          contentRef.current?.focus()
        }}
        onKeyDownCapture={(event) => {
          if (event.key === "Enter" && (event.repeat || event.nativeEvent.isComposing)) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
      >
        <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="mt-2 whitespace-pre-wrap break-words text-sm leading-relaxed text-foreground">
          {description}
        </ResponsiveDialogDescription>
        {children}
        <div className="mt-4 flex flex-col gap-2">
          {actions.map((action) => (
            <Button
              key={action.id}
              variant="secondary"
              className="h-auto justify-start whitespace-normal py-2 text-left"
              disabled={disabled}
              onClick={action.onSelect}
            >
              {action.label}
            </Button>
          ))}
        </div>
        {footer}
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
