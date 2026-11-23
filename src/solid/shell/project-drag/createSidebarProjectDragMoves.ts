import { appStore } from "@shared/store/appStore/state"
import { getSessionSection, reorderProjectSection, setSessionSection } from "@/lib/projectSidebarPreferences"
import type { SectionUpdate } from "@/lib/projectSidebarWrites"
import { commitSessionOrder, rankSessionAt, sessionOrderSnapshot, sortSessionIds } from "@/lib/sidebarSessionOrderState"
import {
  validSidebarDrop, type SidebarDragPickup, type SidebarDragState, type SidebarDropTarget,
} from "@/components/app/sidebarDrag"

interface Options {
  state: () => SidebarDragState
  bucketSessionIds: (projectId: string, sectionId: string | null) => string[]
  update: (projectId: string, transform: SectionUpdate) => Promise<boolean>
  onMovedSection?: (projectId: string, sectionId: string | null) => void
}

const NO_BUSY: ReadonlySet<string> = new Set()

export function createSidebarProjectDragMoves(options: Options) {
  const current = (): SidebarDragState => ({ ...options.state(), projects: appStore.getState().projects })

  async function moveSession(source: SidebarDragPickup, target: SidebarDropTarget, after = false): Promise<boolean> {
    const state = current()
    if (source.kind !== "session" || !validSidebarDrop(source, target, state)) return false
    const { projectId, sectionId, sessionId: targetId } = target
    const project = state.projects[projectId]!
    if (targetId && (targetId === source.id || !options.bucketSessionIds(projectId, sectionId).includes(targetId))) return false

    const differentSection = getSessionSection(state.preferences, projectId, source.id, project.section) !== sectionId
    if (!differentSection && !targetId) return false
    if (differentSection) {
      let applied = false
      const saved = await options.update(projectId, (previous) => {
        // The writer is allowed to hold its own busy flag. Check the fresh
        // server revision, membership, and destination again inside it.
        const fresh = { ...current(), preferences: previous, busy: NO_BUSY }
        if (!validSidebarDrop(source, target, fresh)) return previous
        const latestProject = fresh.projects[projectId]!
        const next = setSessionSection(previous, projectId, source.id, sectionId, latestProject.section)
        applied = next !== previous
        return next
      })
      if (!saved || !applied) return false
      options.onMovedSection?.(projectId, sectionId)
    }

    if (targetId) {
      const latest = sessionOrderSnapshot()
      const sorted = sortSessionIds(latest, options.bucketSessionIds(projectId, sectionId))
      commitSessionOrder(rankSessionAt(latest, sorted, source.id, targetId, after))
    }
    return true
  }

  function moveSection(source: SidebarDragPickup, target: SidebarDropTarget, after: boolean) {
    if (source.kind !== "section" || !validSidebarDrop(source, target, current())) return
    void options.update(source.projectId, (previous) => {
      const fresh = { ...current(), preferences: previous, busy: NO_BUSY }
      return validSidebarDrop(source, target, fresh)
        ? reorderProjectSection(previous, source.projectId, source.id, target.sectionId, after)
        : previous
    })
  }

  return { moveSession, moveSection }
}
