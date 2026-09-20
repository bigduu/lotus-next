import { useState } from "react"
import { Loader2 } from "lucide-react"
import { useAppStore } from "@shared/store/appStore"
import { isApiError } from "@services/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"

const sectionErrorMessage = (error: unknown): string => {
  if (isApiError(error)) {
    if (error.status === 409 || error.status === 412) {
      return "项目刚被其他操作修改，请关闭后重试"
    }
    return error.message || "创建 Section 失败"
  }
  return error instanceof Error ? error.message : "创建 Section 失败"
}

export function ProjectSectionDialog({
  projectId,
  existingSections,
  onClose,
}: {
  projectId: string | null
  existingSections: readonly string[]
  onClose: () => void
}) {
  const project = useAppStore((state) => (projectId ? state.projects[projectId] : undefined))
  const updateProject = useAppStore((state) => state.updateProject)
  const [name, setName] = useState("")
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!projectId || !project) return null

  const trimmedName = name.trim()
  const existing = existingSections.includes(trimmedName)

  const save = async () => {
    if (!trimmedName) {
      setError("请输入 Section 名称")
      return
    }
    if ([...trimmedName].length > 80) {
      setError("Section 名称不能超过 80 个字符")
      return
    }

    setSaving(true)
    setError(null)
    try {
      const current = useAppStore.getState().projects[projectId]
      if (!current) throw new Error("项目不存在")
      await updateProject(current.id, current.revision, { section: trimmedName })
      onClose()
    } catch (reason) {
      setError(sectionErrorMessage(reason))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ResponsiveDialog open onOpenChange={(open) => (!open && !saving ? onClose() : undefined)}>
      <ResponsiveDialogContent className="gap-0 p-0 sm:max-w-sm" dismissable={!saving}>
        <div className="p-4 pb-2">
          <ResponsiveDialogTitle>新建 Section</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="mt-2 leading-relaxed">
            创建后会立即把“{project.name}”移入该 Section，并由 Bamboo 持久化。
          </ResponsiveDialogDescription>
        </div>
        <div className="grid gap-1.5 p-4">
          <label htmlFor="project-section-name" className="text-sm font-medium">Section 名称</label>
          <Input
            id="project-section-name"
            value={name}
            onChange={(event) => setName(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault()
                void save()
              }
            }}
            autoFocus
          />
          {existing ? <p className="text-xs text-muted-foreground">该 Section 已存在，项目将加入其中。</p> : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 p-4 pt-2">
          <Button variant="secondary" disabled={saving} onClick={onClose}>取消</Button>
          <Button disabled={saving || !trimmedName} onClick={() => void save()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            创建并移动
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
