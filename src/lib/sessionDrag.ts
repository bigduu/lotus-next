import { SIDEBAR_SESSION_DRAG_TYPE } from "./projectSidebarPreferences"

export type SessionDragPayload = { sessionId: string; projectId: string | null }

export function readSessionDrag(data: Pick<DataTransfer, "getData">): SessionDragPayload | null {
  try {
    const value: unknown = JSON.parse(data.getData(SIDEBAR_SESSION_DRAG_TYPE))
    if (!value || typeof value !== "object" || !("sessionId" in value) || !("projectId" in value)) return null
    if (typeof value.sessionId !== "string" || !value.sessionId.trim()) return null
    if (value.projectId !== null && (typeof value.projectId !== "string" || !value.projectId.trim())) return null
    return { sessionId: value.sessionId, projectId: value.projectId }
  } catch { return null }
}
