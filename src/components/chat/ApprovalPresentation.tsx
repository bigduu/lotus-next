import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"

type ApprovalAction = {
  id: string
  label: string
  onSelect: () => void
}

/** Presentation only: each adapter supplies its already-authorized actions. */
export function ApprovalPresentation({
  title,
  label,
  description,
  source,
  actions,
  disabled = false,
  children,
  footer,
}: {
  title: string
  label?: string
  description?: string
  source?: ReactNode
  actions: ApprovalAction[]
  disabled?: boolean
  children?: ReactNode
  footer?: ReactNode
}) {
  return (
      <article
        aria-label={label ?? title}
        className="min-w-0 space-y-2 rounded-xl border bg-card p-3 text-card-foreground"
        data-approval-presentation
        onKeyDownCapture={(event) => {
          if (event.key === "Enter" && (event.repeat || event.nativeEvent.isComposing)) {
            event.preventDefault()
            event.stopPropagation()
          }
        }}
      >
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <h2 className="text-sm font-semibold">{title}</h2>
          {source}
        </div>
        {description ? <p className="whitespace-pre-wrap break-words text-sm text-muted-foreground">{description}</p> : null}
        {children}
        {actions.length ? <div className="flex flex-wrap items-center gap-2">
          {actions.map((action) => (
            <Button
              key={action.id}
              type="button"
              size="sm"
              variant="secondary"
              className="h-auto justify-start whitespace-normal py-2 text-left"
              disabled={disabled}
              onClick={action.onSelect}
            >
              {action.label}
            </Button>
          ))}
        </div> : null}
        {footer}
      </article>
  )
}
