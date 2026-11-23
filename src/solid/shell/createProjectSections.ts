import { createEffect, createMemo, createSignal } from "solid-js"
import type { ProjectManifest } from "@services/project"
import { readProjectSectionPreferences, serverSectionPreferences } from "@/lib/projectSidebarPreferences"
import { applySidebarUpdate, sidebarWriteInFlight, type SectionUpdate, type SidebarUpdateError } from "@/lib/projectSidebarWrites"

type GetProjectState = Parameters<typeof applySidebarUpdate>[0]

export function createProjectSections(
  projects: () => Record<string, ProjectManifest>,
  getProjectState: GetProjectState,
) {
  const legacy = readProjectSectionPreferences()
  const attemptedImports = new Set<string>()
  const [busy, setBusy] = createSignal<ReadonlySet<string>>(new Set())
  const [failures, setFailures] = createSignal<Record<string, SidebarUpdateError>>({})
  const preferences = createMemo(() => serverSectionPreferences(projects(), legacy))

  const update = async (projectId: string, transform: SectionUpdate): Promise<boolean> => {
    if (sidebarWriteInFlight(projectId)) return false
    setBusy((previous) => new Set(previous).add(projectId))
    setFailures((previous) => {
      const next = { ...previous }
      delete next[projectId]
      return next
    })
    const failure = await applySidebarUpdate(getProjectState, projectId, legacy, transform)
    setBusy((previous) => {
      const next = new Set(previous)
      next.delete(projectId)
      return next
    })
    if (failure) setFailures((previous) => ({ ...previous, [projectId]: failure }))
    return failure === null
  }

  createEffect(projects, (current) => {
    for (const project of Object.values(current)) {
      if (project.sidebar !== null || !Object.hasOwn(legacy.projects, project.id) || attemptedImports.has(project.id)) continue
      attemptedImports.add(project.id)
      void update(project.id, (previous) => previous)
    }
  })

  return { preferences, busy, failures, update }
}
