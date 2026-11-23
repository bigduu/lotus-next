import type { Message } from "@shared/types/chat"
import { apiClient } from "@services/api"

const MAX_DRAFT_CHARS = 1600

export type RequestDraftCompletion = (draft: string, signal: AbortSignal) => Promise<string | null>

export function createDraftCompletionRequest(sessionId: string | null, messages: readonly Message[]): RequestDraftCompletion {
  const lastTurn = sessionId ? messages.findLast((message) =>
    !message.isError && !message.isAuthError && (message.role === "user"
      || (message.role === "assistant" && message.type === "text"
        && message.phase !== "commentary" && message.content.trim() !== "")),
  ) : undefined
  const assistantId = lastTurn?.role === "assistant" ? lastTurn.id : undefined

  return async (draft, signal) => {
    const trimmed = draft.trim()
    if (draft === "" ? !assistantId
      : trimmed.startsWith("/") || Array.from(trimmed).length < 2 || Array.from(draft).length > MAX_DRAFT_CHARS) return null

    const response = await apiClient.postOnce<{ suffix?: unknown }>("chat/draft-completion", {
      draft,
      session_id: sessionId ?? undefined,
      expected_assistant_message_id: draft === "" ? assistantId : undefined,
    }, { signal, logicalTimeoutMs: 7500 })
    return typeof response?.suffix === "string" ? response.suffix : null
  }
}
