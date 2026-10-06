import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useState } from "react"
import { Trash2 } from "lucide-react"
import { useAppStore } from "@shared/store/appStore"
import type { ProjectSidebarSection } from "@/lib/projectSidebarPreferences"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from "@/components/ui/responsive-dialog"

export function ProjectSectionDialog({ projectId, existingSections, mode = "create", onCreate, onRemove, onClose }: {
  projectId: string | null
  existingSections: readonly ProjectSidebarSection[]
  mode?: "create" | "manage"
  onCreate: (name: string) => void
  onRemove: (sectionId: string) => void
  onClose: () => void
}) {
  useUiLocale()
  const project = useAppStore((state) => (projectId ? state.projects[projectId] : undefined))
  const [name, setName] = useState("")
  const [error, setError] = useState<string | null>(null)
  if (!projectId || !project) return null

  const save = () => {
    const trimmed = name.trim()
    if (!trimmed || [...trimmed].length > 80 || Array.from(trimmed).some((character) => { const code = character.codePointAt(0)!; return code < 32 || code === 127 })) {
      setError(uiText("sidebar_section_invalid_name"))
      return
    }
    if (existingSections.some((section) => section.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase())) {
      setError(uiText("sidebar_section_duplicate"))
      return
    }
    onCreate(trimmed)
    setName("")
    setError(null)
    if (mode === "create") onClose()
  }

  return (
    <ResponsiveDialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <ResponsiveDialogContent className="gap-0 p-0 sm:max-w-sm">
        <div className="p-4 pb-2">
          <ResponsiveDialogTitle>{uiText(mode === "create" ? "sidebar_create_section" : "sidebar_manage_sections")} · {project.name}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription className="mt-2 leading-relaxed">
            {uiText("sidebar_section_device_hint")}
          </ResponsiveDialogDescription>
        </div>
        <form onSubmit={(event) => { event.preventDefault(); save() }} className="grid gap-1.5 p-4">
          <label htmlFor="project-section-name" className="text-sm font-medium">{uiText("sidebar_section_name")}</label>
          <div className="flex gap-2">
            <Input id="project-section-name" value={name} onChange={(event) => { setName(event.target.value); setError(null) }} autoFocus aria-invalid={!!error} aria-describedby={error ? "project-section-error" : undefined} />
            <Button type="submit" disabled={!name.trim()}>{uiText("create_cde2cd07")}</Button>
          </div>
          {error ? <p id="project-section-error" role="alert" className="text-xs text-destructive">{error}</p> : null}
        </form>
        {mode === "manage" && existingSections.length > 0 ? (
          <div className="grid gap-2 border-t p-4">
            <p className="text-xs text-muted-foreground">{uiText("sidebar_section_remove_hint")}</p>
            {existingSections.map((section) => (
              <div key={section.id} className="flex min-w-0 items-center gap-2">
                <span className="flex-1 truncate text-sm">{section.name}</span>
                <Button size="icon" variant="ghost" aria-label={`${uiText("sidebar_section_remove")} ${section.name}`} onClick={() => onRemove(section.id)}>
                  <Trash2 className="size-4" />
                </Button>
              </div>
            ))}
          </div>
        ) : null}
        <div className="flex justify-end p-4 pt-2">
          <Button variant="secondary" onClick={onClose}>{uiText("cancel_2cd0f3be")}</Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
