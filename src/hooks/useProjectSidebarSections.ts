import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { isApiError } from "@services/api"
import type { ProjectManifest } from "@services/project"
import { useAppStore } from "@shared/store/appStore"
import { confirmedProjectRevision } from "@shared/store/appStore/slices/projectSlice"
import { useUiText } from "@shared/i18n/ui"
import {
  clearImportedProjectSections, getProjectPreference, readProjectSectionPreferences, serverSectionPreferences, setSessionSection,
  toProjectSidebar,
  type ProjectSectionPreferences,
} from "@/lib/projectSidebarPreferences"

type SectionUpdate = (previous: ProjectSectionPreferences) => ProjectSectionPreferences

export type SidebarUpdateError = "busy" | "unavailable" | "saved-refresh-failed" | "conflict" | "refresh-failed" | "save-failed"

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

const inFlightProjects = new Set<string>()

/**
 * Module-level single-writer core for one Project's durable sidebar snapshot.
 * Concurrent `update` calls for the same Project are serialized by returning
 * `false` to every call after the first in-flight one, so exactly one PATCH
 * flow owns the Project's revision at any moment, across hook instances.
 */
async function applySidebarUpdate(projectId: string, legacy: ProjectSectionPreferences, transform: SectionUpdate): Promise<SidebarUpdateError | null> {
  if (inFlightProjects.has(projectId)) return "busy"
  inFlightProjects.add(projectId)
  let importing = false
  try {
    const store = useAppStore.getState()
    let project = store.projects[projectId]
    if (!project || project.sidebar === undefined) {
      return "unavailable"
    }
    if (project.sidebar === null && Object.hasOwn(legacy.projects, projectId)) {
      importing = true
      project = await store.updateProject(projectId, confirmedProjectRevision(project), {
        import_sidebar: toProjectSidebar(legacy.projects[projectId]!),
      })
      if (!project.sidebar) {
        return "unavailable"
      }
      await confirmSavedSidebar(projectId, project)
      clearImportedProjectSections(projectId, legacy.projects[projectId]!)
      importing = false
    }
    // Use the latest confirmed snapshot, including any event received during import.
    project = useAppStore.getState().projects[projectId]
    if (!project || project.sidebar === undefined) return "unavailable"
    const previous = serverSectionPreferences({ [projectId]: project }, legacy)
    const next = transform(previous)
    if (next === previous) return null
    const saved = await useAppStore.getState().updateProject(projectId, confirmedProjectRevision(project), {
      sidebar: toProjectSidebar(next.projects[projectId]!),
    })
    if (!saved.sidebar) {
      return "unavailable"
    }
    await confirmSavedSidebar(projectId, saved)
    return null
  } catch (failure) {
    if (failure instanceof SidebarConfirmationError) {
      return "saved-refresh-failed"
    } else if (isApiError(failure) && (failure.status === 412 || (importing && failure.status === 409))) {
      // Keep the failed intent uncommitted and fetch the winning revision.
      try {
        await refreshProjectAfterPendingRead(projectId)
        return "conflict"
      } catch {
        return "refresh-failed"
      }
    }
    return "save-failed"
  } finally {
    inFlightProjects.delete(projectId)
  }
}

/**
 * Fire-and-forget durable section assignment for a newly created session.
 * Shares the module-level single-writer core with the hook, so callers
 * outside a mounted hook instance (e.g. App-level session creation) still
 * serialize with sidebar drags and edits for the same Project.
 */
export async function assignSessionToSectionDurable(projectId: string, sessionId: string, sectionId: string | null, legacyName?: string | null): Promise<boolean> {
  const failure = await applySidebarUpdate(projectId, readProjectSectionPreferences(), (previous) => {
    const current = getProjectPreference(previous, projectId).sessionSections[sessionId]
    if (current === undefined ? sectionId === null : current === sectionId) return previous
    return setSessionSection(previous, projectId, sessionId, sectionId, legacyName ?? undefined)
  })
  return failure === null
}

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
    if (inFlightProjects.has(projectId)) return false
    setBusy((previous) => new Set(previous).add(projectId))
    setErrors((previous) => {
      const next = { ...previous }
      delete next[projectId]
      return next
    })
    const failure = await applySidebarUpdate(projectId, legacy, transform)
    setBusy((previous) => {
      if (!inFlightProjects.has(projectId)) {
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
