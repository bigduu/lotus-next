import { apiClient, isApiError } from "@services/api"
import type { GetSessionResponse } from "@services/chat/AgentService"

// A client access observation attached to a canonical receipt, not an owner or
// runtime-health DTO. Opening a Session never starts or creates one here.
export interface AssignmentSessionTarget { assignment_id: string; session_id: string; run_id: string }
export interface AssignmentSessionAccess extends AssignmentSessionTarget { access: "accessible" | "denied" | "missing" | "unknown" }
export const assignmentSessionKey = (value: AssignmentSessionTarget) => JSON.stringify([value.assignment_id, value.session_id, value.run_id])
export async function readAssignmentSessionAccess(target: AssignmentSessionTarget, projectId: string, signal: AbortSignal): Promise<AssignmentSessionAccess> {
  let access: AssignmentSessionAccess["access"] = "unknown"
  try {
    const { session } = await apiClient.get<GetSessionResponse>(`sessions/${encodeURIComponent(target.session_id)}`, { signal })
    if (session?.id === target.session_id && ["root", "child"].includes(session.kind)
      && (session.project_id == null || session.project_id === projectId)) access = "accessible"
  } catch (failure) {
    if (signal.aborted) throw failure
    if (isApiError(failure)) access = failure.status === 403 ? "denied" : failure.status === 404 ? "missing" : "unknown"
  }
  return { ...target, access }
}
