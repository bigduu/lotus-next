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
  return (
    <ResponsiveDialog
      open={projectName !== null}
      onOpenChange={(open) => {
        if (!open && !busy) onClose()
      }}
    >
      <ResponsiveDialogContent className="gap-0 p-0 sm:max-w-sm" dismissable={!busy}>
        <div className="p-4 pb-2">
          <ResponsiveDialogTitle>{projectName ? `移除“${projectName}”？` : "移除项目？"}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="mt-2 leading-relaxed">
            项目会从新建会话入口移除，但现有会话和项目数据不会删除；之后可以在“管理项目”中恢复。
          </ResponsiveDialogDescription>
          {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 p-4 pt-2">
          <Button variant="secondary" disabled={busy} onClick={onClose}>取消</Button>
          <Button variant="destructive" disabled={busy} onClick={onConfirm}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : null}
            移除项目
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
