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
  return (
    <ResponsiveDialog
      open={!!pending}
      onOpenChange={(o) => {
        if (!o) onCancel()
      }}
    >
      <ResponsiveDialogContent showCloseButton={false} className="p-5">
        <ResponsiveDialogTitle>删除会话</ResponsiveDialogTitle>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
          确定删除「{pending?.title}」?此操作无法撤销。
        </p>
        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel}>
            取消
          </Button>
          <Button
            variant="destructive"
            onClick={() => {
              if (pending) onConfirm(pending.id)
            }}
          >
            删除
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
