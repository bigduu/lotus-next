import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { ProjectManifest } from "@services/project"
import { useAppStore } from "@shared/store/appStore"
import { useUiText } from "@shared/i18n/ui"
import { readProjectSectionPreferences, serverSectionPreferences, setSessionSection } from "@/lib/projectSidebarPreferences"
import { applySidebarUpdate, assignSessionToSection as assignDurable, sidebarWriteInFlight, type SectionUpdate, type SidebarUpdateError } from "@/lib/projectSidebarWrites"

export type { SidebarUpdateError } from "@/lib/projectSidebarWrites"

export const assignSessionToSectionDurable = (
  projectId: string, sessionId: string, sectionId: string | null, legacyName?: string | null,
) => assignDurable(useAppStore.getState, projectId, sessionId, sectionId, legacyName)

export function useProjectSidebarSections(projects: Record<string, ProjectManifest>) {
  const uiText = useUiText()
  const [legacy] = useState(readProjectSectionPreferences)
  const attemptedImports = useRef(new Set<string>())
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const preferences = useMemo(() => serverSectionPreferences(projects, legacy), [projects, legacy])

  const errorText = useCallback((failure: SidebarUpdateError): string => {
    switch (failure) {
      case "unavailable": return uiText("sidebar_sections_unavailable")
      case "saved-refresh-failed": return uiText("sidebar_sections_saved_refresh_failed")
      case "conflict": return uiText("sidebar_sections_conflict")
      case "refresh-failed": return uiText("sidebar_sections_refresh_failed")
      default: return uiText("sidebar_sections_save_failed")
    }
  }, [uiText])

  const update = useCallback(async (projectId: string, transform: SectionUpdate): Promise<boolean> => {
    // A busy rejection keeps the in-flight update's state and any error it
    // raised; only a fresh write attempt clears the previous failure.
    if (sidebarWriteInFlight(projectId)) return false
    setBusy((previous) => new Set(previous).add(projectId))
    setErrors((previous) => {
      const next = { ...previous }
      delete next[projectId]
      return next
    })
    const failure = await applySidebarUpdate(useAppStore.getState, projectId, legacy, transform)
    setBusy((previous) => {
      if (!sidebarWriteInFlight(projectId)) {
        const next = new Set(previous)
        next.delete(projectId)
        return next
      }
      return previous
    })
    if (failure) setErrors((previous) => ({ ...previous, [projectId]: errorText(failure) }))
    return failure === null
  }, [legacy, errorText])

  /** Assign one session to a section (or null for unsectioned) on the owning Project. */
  const assignSessionToSection = useCallback(async (projectId: string, sessionId: string, sectionId: string | null, legacyName?: string | null): Promise<boolean> => {
    return update(projectId, (previous) => setSessionSection(previous, projectId, sessionId, sectionId, legacyName ?? undefined))
  }, [update])

  useEffect(() => {
    for (const project of Object.values(projects)) {
      if (project.sidebar !== null || !Object.hasOwn(legacy.projects, project.id) || attemptedImports.current.has(project.id)) continue
      attemptedImports.current.add(project.id)
      void update(project.id, (previous) => previous)
    }
  }, [projects, legacy, update])

  return { preferences, update, assignSessionToSection, busy, errors }
}
