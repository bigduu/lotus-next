import { isApiError } from "@services/api"
import type { ProjectManifest } from "@services/project"
import { confirmedProjectRevision, type ProjectSlice } from "@shared/store/appStore/slices/projectSlice"
import {
  clearImportedProjectSections, getProjectPreference, readProjectSectionPreferences, serverSectionPreferences, setSessionSection,
  toProjectSidebar,
  type ProjectSectionPreferences,
} from "./projectSidebarPreferences"

type GetProjectState = () => Pick<ProjectSlice, "ensureProject" | "projects" | "updateProject">

export type SectionUpdate = (previous: ProjectSectionPreferences) => ProjectSectionPreferences

export type SidebarUpdateError = "busy" | "unavailable" | "saved-refresh-failed" | "conflict" | "refresh-failed" | "save-failed"

class SidebarConfirmationError extends Error {}

async function refreshProjectAfterPendingRead(getState: GetProjectState, projectId: string) {
  // A forced read can join a request that predates the conflict/save response.
  // Drain it first, then require a read started after that request settled.
  await getState().ensureProject(projectId, { force: true }).catch(() => {})
  await getState().ensureProject(projectId, { force: true })
  const current = getState().projects[projectId]
  if (!current || confirmedProjectRevision(current) < current.revision) throw new Error("Project snapshot is unavailable")
}

async function confirmSavedSidebar(getState: GetProjectState, projectId: string, saved: ProjectManifest) {
  const reflected = () => {
    const current = getState().projects[projectId]
    return !!current?.sidebar && confirmedProjectRevision(current) >= saved.revision
  }
  if (reflected()) return
  try {
    await refreshProjectAfterPendingRead(getState, projectId)
  } catch {
    throw new SidebarConfirmationError()
  }
  if (!reflected()) throw new SidebarConfirmationError()
}

const inFlightProjects = new Set<string>()
export const sidebarWriteInFlight = (projectId: string) => inFlightProjects.has(projectId)

/**
 * Module-level single-writer core for one Project's durable sidebar snapshot.
 * Concurrent `update` calls for the same Project are serialized by returning
 * `false` to every call after the first in-flight one, so exactly one PATCH
 * flow owns the Project's revision at any moment, across hook instances.
 */
export async function applySidebarUpdate(getState: GetProjectState, projectId: string, legacy: ProjectSectionPreferences, transform: SectionUpdate): Promise<SidebarUpdateError | null> {
  if (inFlightProjects.has(projectId)) return "busy"
  inFlightProjects.add(projectId)
  let importing = false
  try {
    const store = getState()
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
      await confirmSavedSidebar(getState, projectId, project)
      clearImportedProjectSections(projectId, legacy.projects[projectId]!)
      importing = false
    }
    // Use the latest confirmed snapshot, including any event received during import.
    project = getState().projects[projectId]
    if (!project || project.sidebar === undefined) return "unavailable"
    const previous = serverSectionPreferences({ [projectId]: project }, legacy)
    const next = transform(previous)
    if (next === previous) return null
    const saved = await getState().updateProject(projectId, confirmedProjectRevision(project), {
      sidebar: toProjectSidebar(next.projects[projectId]!),
    })
    if (!saved.sidebar) {
      return "unavailable"
    }
    await confirmSavedSidebar(getState, projectId, saved)
    return null
  } catch (failure) {
    if (failure instanceof SidebarConfirmationError) {
      return "saved-refresh-failed"
    } else if (isApiError(failure) && (failure.status === 412 || (importing && failure.status === 409))) {
      // Keep the failed intent uncommitted and fetch the winning revision.
      try {
        await refreshProjectAfterPendingRead(getState, projectId)
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
export async function assignSessionToSection(getState: GetProjectState, projectId: string, sessionId: string, sectionId: string | null, legacyName?: string | null): Promise<boolean> {
  const transform = (previous: ProjectSectionPreferences): ProjectSectionPreferences => {
    const current = getProjectPreference(previous, projectId).sessionSections[sessionId]
    if (current === undefined ? sectionId === null : current === sectionId) return previous
    return setSessionSection(previous, projectId, sessionId, sectionId, legacyName ?? undefined)
  }
  // A concurrent sidebar write holding the project can only delay this
  // assignment; wait for a quiet core so it is not silently dropped. Genuine
  // failures (conflict/network) still resolve false.
  for (let attempt = 0; ; attempt += 1) {
    const failure = await applySidebarUpdate(getState, projectId, readProjectSectionPreferences(), transform)
    if (failure !== "busy") return failure === null
    if (attempt >= 40) return false // ~10s; never wedge a session creation path.
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}
