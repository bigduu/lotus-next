import type { ReactNode } from "react"
import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"

/**
 * Small destructive-action confirmation, stacked on top of the Settings
 * dialog (Radix portals nest fine; this content mounts after and paints above).
 */
export function ConfirmDialog({
  open,
  onOpenChange,
  title,
  description,
  confirmLabel = "确认",
  destructive = true,
  busy = false,
  error,
  onConfirm,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  title: string
  description: ReactNode
  confirmLabel?: string
  destructive?: boolean
  busy?: boolean
  /** Failure from the last confirm attempt, surfaced inside the dialog. */
  error?: string | null
  onConfirm: () => void
}) {
  return (
    <ResponsiveDialog open={open} onOpenChange={(o) => (busy ? undefined : onOpenChange(o))}>
      <ResponsiveDialogContent className="gap-0 p-4 sm:max-w-sm">
        <ResponsiveDialogTitle>{title}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription className="mt-2 leading-relaxed">
          {description}
        </ResponsiveDialogDescription>
        {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => onOpenChange(false)}>
            取消
          </Button>
          <Button
            size="sm"
            variant={destructive ? "destructive" : "default"}
            disabled={busy}
            onClick={onConfirm}
          >
            {busy ? "处理中…" : confirmLabel}
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
