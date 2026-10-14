import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { isApiError } from "@services/api"
import type { ProjectManifest } from "@services/project"
import { useAppStore } from "@shared/store/appStore"
import { confirmedProjectRevision } from "@shared/store/appStore/slices/projectSlice"
import { useUiText } from "@shared/i18n/ui"
import {
  clearImportedProjectSections, readProjectSectionPreferences, serverSectionPreferences, toProjectSidebar,
  type ProjectSectionPreferences,
} from "@/lib/projectSidebarPreferences"

type SectionUpdate = (previous: ProjectSectionPreferences) => ProjectSectionPreferences

export function useProjectSidebarSections(projects: Record<string, ProjectManifest>) {
  const uiText = useUiText()
  const [legacy] = useState(readProjectSectionPreferences)
  const inFlight = useRef(new Set<string>())
  const attemptedImports = useRef(new Set<string>())
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [error, setError] = useState<string | null>(null)
  const preferences = useMemo(() => serverSectionPreferences(projects, legacy), [projects, legacy])

  const update = useCallback(async (projectId: string, transform: SectionUpdate): Promise<boolean> => {
    if (inFlight.current.has(projectId)) return false
    inFlight.current.add(projectId)
    setBusy(new Set(inFlight.current))
    setError(null)
    let importing = false
    try {
      const store = useAppStore.getState()
      let project = store.projects[projectId]
      if (!project || project.sidebar === undefined) {
        setError(uiText("sidebar_sections_unavailable"))
        return false
      }
      if (project.sidebar === null && Object.hasOwn(legacy.projects, projectId)) {
        importing = true
        project = await store.updateProject(projectId, confirmedProjectRevision(project), {
          import_sidebar: toProjectSidebar(legacy.projects[projectId]!),
        })
        if (!project.sidebar) {
          setError(uiText("sidebar_sections_unavailable"))
          return false
        }
        clearImportedProjectSections(projectId, legacy.projects[projectId]!)
        importing = false
      }
      // Use the latest confirmed snapshot, including any event received during import.
      project = useAppStore.getState().projects[projectId]
      if (!project || project.sidebar === undefined) return false
      const previous = serverSectionPreferences({ [projectId]: project }, legacy)
      const next = transform(previous)
      if (next === previous) return true
      const saved = await useAppStore.getState().updateProject(projectId, confirmedProjectRevision(project), {
        sidebar: toProjectSidebar(next.projects[projectId]!),
      })
      if (!saved.sidebar) {
        setError(uiText("sidebar_sections_unavailable"))
        return false
      }
      return true
    } catch (failure) {
      if (isApiError(failure) && (failure.status === 412 || (importing && failure.status === 409))) {
        // Keep the failed intent uncommitted and fetch the winning revision.
        try {
          await useAppStore.getState().ensureProject(projectId, { force: true })
          setError(uiText("sidebar_sections_conflict"))
        } catch {
          setError(uiText("sidebar_sections_refresh_failed"))
        }
      } else {
        setError(uiText("sidebar_sections_save_failed"))
      }
      return false
    } finally {
      inFlight.current.delete(projectId)
      setBusy(new Set(inFlight.current))
    }
  }, [legacy, uiText])

  useEffect(() => {
    for (const project of Object.values(projects)) {
      if (project.sidebar !== null || !Object.hasOwn(legacy.projects, project.id) || attemptedImports.current.has(project.id)) continue
      attemptedImports.current.add(project.id)
      void update(project.id, (previous) => previous)
    }
  }, [projects, legacy, update])

  return { preferences, update, busy, error }
}
