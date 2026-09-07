import { apiClient } from "../api"

export type GuidanceMode = "after_round" | "after_run"
export interface GuidanceImage { base64: string; name?: string; size?: number; type?: string }
export interface PendingGuidance { id: string; text: string; created_at: string; mode?: GuidanceMode; images?: string[] }
const route = (sessionId: string) => `sessions/${encodeURIComponent(sessionId)}/guidance`
export const guidanceService = {
  imageUrl: (sessionId: string, imageId: string) => apiClient.resolveUrl(`sessions/${encodeURIComponent(sessionId)}/attachments/${encodeURIComponent(imageId)}`),
  list: (sessionId: string) => apiClient.get<{ messages: PendingGuidance[] }>(route(sessionId)),
  send: (sessionId: string, id: string, text: string, mode: GuidanceMode = "after_round", images: GuidanceImage[] = []) =>
    apiClient.post<{ id: string; activation_pending: boolean }>(route(sessionId), { id, text, mode, images }),
  cancel: (sessionId: string, id: string) =>
    apiClient.delete(`${route(sessionId)}/${encodeURIComponent(id)}`),
}
