import { apiClient } from "../api"

export interface PendingGuidance { id: string; text: string; created_at: string }
const route = (sessionId: string) => `sessions/${encodeURIComponent(sessionId)}/guidance`
export const guidanceService = {
  list: (sessionId: string) => apiClient.get<{ messages: PendingGuidance[] }>(route(sessionId)),
  send: (sessionId: string, id: string, text: string) =>
    apiClient.post<{ id: string; activation_pending: boolean }>(route(sessionId), { id, text }),
  cancel: (sessionId: string, id: string) =>
    apiClient.delete(`${route(sessionId)}/${encodeURIComponent(id)}`),
}
