import { uiText, useUiLocale } from "@shared/i18n/ui"
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
      return uiText("the_project_was_changed_by_another_operation_close_this_c06150ff")
    }
    return error.message || uiText("could_not_create_section_1341fc1d")
  }
  return error instanceof Error ? error.message : uiText("could_not_create_section_1341fc1d")
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
  useUiLocale()
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
      setError(uiText("enter_a_section_name_38cd3a84"))
      return
    }
    if ([...trimmedName].length > 80) {
      setError(uiText("section_names_must_be_at_most_80_characters_bb35b446"))
      return
    }

    setSaving(true)
    setError(null)
    try {
      const current = useAppStore.getState().projects[projectId]
      if (!current) throw new Error(uiText("project_does_not_exist_b2667460"))
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
          <ResponsiveDialogTitle>{uiText("new_section_3807938b")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="mt-2 leading-relaxed">
            {uiText("section_move_description", { name: project.name })}</ResponsiveDialogDescription>
        </div>
        <div className="grid gap-1.5 p-4">
          <label htmlFor="project-section-name" className="text-sm font-medium">{uiText("section_name_04c7cd79")}</label>
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
          {existing ? <p className="text-xs text-muted-foreground">{uiText("this_section_already_exists_the_project_will_be_added_t_336498c9")}</p> : null}
          {error ? <p className="text-xs text-destructive">{error}</p> : null}
        </div>
        <div className="flex justify-end gap-2 p-4 pt-2">
          <Button variant="secondary" disabled={saving} onClick={onClose}>{uiText("cancel_2cd0f3be")}</Button>
          <Button disabled={saving || !trimmedName} onClick={() => void save()}>
            {saving ? <Loader2 className="size-4 animate-spin" /> : null}
            {uiText("create_and_move_1ccd04d0")}</Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
