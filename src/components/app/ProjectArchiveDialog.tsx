import { uiText, useUiLocale } from "@shared/i18n/ui"
import { Loader2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"

export function ProjectArchiveDialog({
  projectName,
  busy,
  error,
  onClose,
  onConfirm,
}: {
  projectName: string | null
  busy: boolean
  error: string | null
  onClose: () => void
  onConfirm: () => void
}) {
  useUiLocale()
  return (
    <ResponsiveDialog
      open={projectName !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <ResponsiveDialogContent className="gap-0 p-0 sm:max-w-sm" dismissable={!busy}>
        <div className="p-4 pb-2">
          <ResponsiveDialogTitle>{projectName ? uiText("remove_bdb7b58b", { v0: projectName }) : uiText("remove_project_6277bb2a")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="mt-2 leading-relaxed">
            {uiText("the_project_will_be_removed_from_new_session_choices_ex_d355c682")}</ResponsiveDialogDescription>
          {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 p-4 pt-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>{uiText("cancel_2cd0f3be")}</Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            {uiText("remove_project_84663136")}</Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
