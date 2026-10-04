import { uiText, useUiLocale } from "@shared/i18n/ui"
import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"

/** Confirm-before-delete for a session (irreversible). */
export function DeleteSessionDialog({
  pending,
  onCancel,
  onConfirm,
}: {
  pending: { id: string; title: string } | null
  onCancel: () => void
  onConfirm: (id: string) => void
}) {
  useUiLocale()
  return (
    <ResponsiveDialog
      open={!!pending}
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
    >
      <ResponsiveDialogContent showCloseButton={false} className="p-5">
        <ResponsiveDialogTitle>{uiText("delete_session_d51250d1")}</ResponsiveDialogTitle>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          {uiText("delete_session_description", { title: pending?.title ?? "" })}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            {uiText("cancel_2cd0f3be")}</Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (pending) onConfirm(pending.id)
            }}
          >
            {uiText("delete_2f9daa82")}</Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
