import type { ComponentType, HTMLAttributes, ReactNode } from "react"
import type { ProjectManifest } from "@services/project"
import type { ChatItem } from "@shared/types/chatMessages"
import { confirmedProjectRevision } from "@shared/store/appStore/slices/projectSlice"
import { getProjectSections, LEGACY_PROJECT_SECTION_ID, type ProjectSectionPreferences } from "@/lib/projectSidebarPreferences"

export type SidebarDragSource = { kind: "session" | "section"; projectId: string; id: string }
export type SidebarDropTarget = { projectId: string; sectionId: string | null }
export type SidebarDragPickup = SidebarDragSource & { revision: number }
export type SidebarDragState = {
  projects: Record<string, ProjectManifest>
  chats: readonly ChatItem[]
  preferences: ProjectSectionPreferences
  busy: ReadonlySet<string>
}

export function sidebarDragSource(value: unknown): SidebarDragSource | null {
  if (!value || typeof value !== "object") return null
  const source = value as Record<string, unknown>
  return (source.kind === "session" || source.kind === "section") && typeof source.projectId === "string" && typeof source.id === "string"
    ? { kind: source.kind, projectId: source.projectId, id: source.id } : null
}

export function sidebarDropTarget(value: unknown): SidebarDropTarget | null {
  if (!value || typeof value !== "object") return null
  const target = value as Record<string, unknown>
  return typeof target.projectId === "string" && (target.sectionId === null || typeof target.sectionId === "string")
    ? { projectId: target.projectId, sectionId: target.sectionId } : null
}

/** Re-read canonical membership and the confirmed server revision at pickup and drop. */
export function validSidebarSource(source: SidebarDragSource, state: SidebarDragState, revision?: number): boolean {
  const project = state.projects[source.projectId]
  if (!project || project.status !== "active" || project.sidebar === undefined || state.busy.has(project.id)) return false
  if (confirmedProjectRevision(project) !== project.revision || (revision !== undefined && project.revision !== revision)) return false
  if (source.kind === "session") {
    return state.chats.some((chat) => chat.id === source.id && !chat.parentSessionId && chat.config?.projectId?.trim() === project.id)
  }
  return source.id !== LEGACY_PROJECT_SECTION_ID && getProjectSections(state.preferences, project.id, project.section).some((section) => section.id === source.id)
}

export function validSidebarDrop(pickup: SidebarDragPickup, target: SidebarDropTarget, state: SidebarDragState): boolean {
  if (pickup.projectId !== target.projectId || !validSidebarSource(pickup, state, pickup.revision)) return false
  const project = state.projects[pickup.projectId]!
  return target.sectionId === null || getProjectSections(state.preferences, project.id, project.section).some((section) => section.id === target.sectionId)
}

export type SidebarDragParts = {
  Handle: ComponentType<{ source: SidebarDragSource; label: string; disabled?: boolean }>
  Target: ComponentType<HTMLAttributes<HTMLDivElement> & { target: SidebarDropTarget; disabled?: boolean; children: ReactNode }>
}

export type SidebarProjectDragProps = SidebarDragState & {
  scopeKey: string
  onMoveSession: (pickup: SidebarDragPickup, target: SidebarDropTarget) => Promise<boolean>
  onMoveSection: (pickup: SidebarDragPickup, target: SidebarDropTarget, after: boolean) => void
  children: (parts?: SidebarDragParts) => ReactNode
}
