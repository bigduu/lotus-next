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

class SidebarConfirmationError extends Error {}

async function refreshProjectAfterPendingRead(projectId: string) {
  // A forced read can join a request that predates the conflict/save response.
  // Drain it first, then require a read started after that request settled.
  await useAppStore.getState().ensureProject(projectId, { force: true }).catch(() => {})
  await useAppStore.getState().ensureProject(projectId, { force: true })
  const current = useAppStore.getState().projects[projectId]
  if (!current || confirmedProjectRevision(current) < current.revision) throw new Error("Project snapshot is unavailable")
}

async function confirmSavedSidebar(projectId: string, saved: ProjectManifest) {
  const reflected = () => {
    const current = useAppStore.getState().projects[projectId]
    return !!current?.sidebar && confirmedProjectRevision(current) >= saved.revision
  }
  if (reflected()) return
  try {
    await refreshProjectAfterPendingRead(projectId)
  } catch {
    throw new SidebarConfirmationError()
  }
  if (!reflected()) throw new SidebarConfirmationError()
}

export function useProjectSidebarSections(projects: Record<string, ProjectManifest>) {
  const uiText = useUiText()
  const [legacy] = useState(readProjectSectionPreferences)
  const inFlight = useRef(new Set<string>())
  const attemptedImports = useRef(new Set<string>())
  const [busy, setBusy] = useState<ReadonlySet<string>>(new Set())
  const [errors, setErrors] = useState<Record<string, string>>({})
  const preferences = useMemo(() => serverSectionPreferences(projects, legacy), [projects, legacy])

  const update = useCallback(async (projectId: string, transform: SectionUpdate): Promise<boolean> => {
    if (inFlight.current.has(projectId)) return false
    inFlight.current.add(projectId)
    setBusy(new Set(inFlight.current))
    setErrors((previous) => {
      const next = { ...previous }
      delete next[projectId]
      return next
    })
    const reportError = (message: string) => setErrors((previous) => ({ ...previous, [projectId]: message }))
    let importing = false
    try {
      const store = useAppStore.getState()
      let project = store.projects[projectId]
      if (!project || project.sidebar === undefined) {
        reportError(uiText("sidebar_sections_unavailable"))
        return false
      }
      if (project.sidebar === null && Object.hasOwn(legacy.projects, projectId)) {
        importing = true
        project = await store.updateProject(projectId, confirmedProjectRevision(project), {
          import_sidebar: toProjectSidebar(legacy.projects[projectId]!),
        })
        if (!project.sidebar) {
          reportError(uiText("sidebar_sections_unavailable"))
          return false
        }
        await confirmSavedSidebar(projectId, project)
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
        reportError(uiText("sidebar_sections_unavailable"))
        return false
      }
      await confirmSavedSidebar(projectId, saved)
      return true
    } catch (failure) {
      if (failure instanceof SidebarConfirmationError) {
        reportError(uiText("sidebar_sections_saved_refresh_failed"))
      } else if (isApiError(failure) && (failure.status === 412 || (importing && failure.status === 409))) {
        // Keep the failed intent uncommitted and fetch the winning revision.
        try {
          await refreshProjectAfterPendingRead(projectId)
          reportError(uiText("sidebar_sections_conflict"))
        } catch {
          reportError(uiText("sidebar_sections_refresh_failed"))
        }
      } else {
        reportError(uiText("sidebar_sections_save_failed"))
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

  return { preferences, update, busy, errors }
}
