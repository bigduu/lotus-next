import { ApiError } from "@services/api/errors"
import type { AgentClient, HistoryResponse, SessionSummary } from "./AgentService"

export type ConversationClearFailure = "active_run" | "pending_approval" | "state_unavailable"
  | "authority_conflict" | "incompatible" | "unsupported" | "unknown" | "readback_failed"

export class ConversationClearError extends Error {
  constructor(readonly reason: ConversationClearFailure, options?: ErrorOptions) {
    super(reason, options)
    this.name = "ConversationClearError"
  }
}

type ClearClient = Pick<AgentClient, "getSession" | "getPendingQuestion" | "clearSession" | "getHistory">

const errorCode = (error: ApiError): string | undefined => {
  try { const body = JSON.parse(error.body ?? "{}"); return body.error?.code ?? body.code } catch { return undefined }
}

/** C1 clears stored conversation data, not an atomic native/provider reset. */
export async function requestConversationClear(sessionId: string, client: ClearClient): Promise<void> {
  try {
    const { session } = await client.getSession(sessionId)
    const pending = await client.getPendingQuestion(sessionId)
    if (session.id !== sessionId || typeof session.is_running !== "boolean"
        || typeof pending.has_pending_question !== "boolean") throw new ConversationClearError("state_unavailable")
    if (pending.has_pending_question || session.plan_mode?.status === "awaiting_approval") {
      throw new ConversationClearError("pending_approval")
    }
    if (session.is_running) throw new ConversationClearError("active_run")
  } catch (cause) {
    if (cause instanceof ConversationClearError) throw cause
    throw new ConversationClearError("state_unavailable", { cause })
  }

  try {
    await client.clearSession(sessionId)
  } catch (cause) {
    if (cause instanceof ApiError) {
      const code = errorCode(cause)
      if (cause.status === 409 && code === "session_clear_authority_conflict") {
        throw new ConversationClearError("authority_conflict", { cause })
      }
      if (cause.status === 409 && code === "session_execution_incompatible") {
        throw new ConversationClearError("incompatible", { cause })
      }
      if ([404, 405, 501].includes(cause.status)) throw new ConversationClearError("unsupported", { cause })
    }
    // A transport failure, malformed receipt or storage error may follow a write.
    // No automatic retry and no optimistic local clearing.
    throw new ConversationClearError("unknown", { cause })
  }
}

export interface ClearedConversationSnapshot { history: HistoryResponse; session: SessionSummary }

/** Read-only confirmation. C1 retains zero or one initial System message. */
export async function readClearedConversation(sessionId: string, client: ClearClient): Promise<ClearedConversationSnapshot> {
  try {
    const { session } = await client.getSession(sessionId)
    const history = await client.getHistory(sessionId)
    if (session.id !== sessionId || history.session_id !== sessionId || session.is_running !== false
        || session.has_pending_question === true
        || session.token_usage !== null || !Array.isArray(history.messages)
        || history.messages.length > 1 || history.messages.some((message) => message.role !== "system")
        || session.message_count !== history.messages.length) {
      throw new Error("Unconfirmed clear readback")
    }
    return { session, history }
  } catch (cause) {
    throw new ConversationClearError("readback_failed", { cause })
  }
}
