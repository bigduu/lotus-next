import type { ChatItem } from "@shared/types/chatMessages"

// Bamboo's built-in assistant identity. User-created titles carry no role.
export const DEFAULT_SUPERVISOR_SESSION_ID = "bamboo-default-supervisor"

export function isDefaultSupervisor(chat: ChatItem): boolean {
  return chat.id === DEFAULT_SUPERVISOR_SESSION_ID
    && !chat.parentSessionId && chat.kind !== "child"
}
