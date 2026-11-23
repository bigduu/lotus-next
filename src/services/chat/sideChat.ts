import { apiClient } from "@services/api"
import { subscribeAgent } from "./v2Stream"

export const SIDE_CHAT_FEATURE = "session_side_chat"
export const SIDE_CHAT_MAX_QUESTION_BYTES = 4096

export type SideChatQuote = { message_id: string; text: string }
export type SideChatTurn = {
  id: string
  message: string
  quote: SideChatQuote | null
  status: "running" | "completed" | "stopped" | "failed" | "interrupted"
  answer: string
}
export type SideChatSnapshot = {
  id: string
  model: { provider: string; model: string }
  turns: SideChatTurn[]
  preview: string
}

type SideChatUpdate = {
  type: "side_chat_changed" | "side_chat_progress"
  chat_id?: unknown
  run_id?: unknown
  text?: unknown
}
export type SideChatTurnRequest = {
  id: string
  expected_chat_id: string | null
  previous_turn_id: string | null
  message?: string
  quote?: SideChatQuote
}

const sessionPath = (sourceId: string) => "sessions/" + encodeURIComponent(sourceId) + "/side-chat"
const encoder = new TextEncoder()

export const sideChatQuestionFits = (text: string): boolean => encoder.encode(text).length <= SIDE_CHAT_MAX_QUESTION_BYTES
export function sideChatQuote(messageId: string, text: string): SideChatQuote {
  const selected = text.trim()
  if (encoder.encode(selected).length <= 4096) return { message_id: messageId, text: selected }
  let bytes = 0
  let length = 0
  for (const character of selected) {
    bytes += encoder.encode(character).length
    if (bytes > 4096) break
    length += character.length
  }
  return { message_id: messageId, text: selected.slice(0, length) }
}

export const sideChatClient = {
  async read(sourceId: string, signal?: AbortSignal) {
    const result = await apiClient.get<{ side_chat: SideChatSnapshot | null }>(sessionPath(sourceId), { cache: "no-store", signal })
    return result.side_chat
  },
  async start(sourceId: string, request: SideChatTurnRequest) {
    const result = await apiClient.post<{ side_chat: SideChatSnapshot }>(sessionPath(sourceId) + "/turns", request)
    return result.side_chat
  },
  stop(sourceId: string, chatId: string, runId: string) {
    return apiClient.post<void>(sessionPath(sourceId) + "/runs/" + encodeURIComponent(runId) + "/stop", { chat_id: chatId })
  },
  subscribe(sourceId: string, changed: () => void, progress: (chatId: string, runId: string, text: string) => void) {
    return subscribeAgent("side-chat/" + sourceId, {}, (raw) => {
      const event = raw as unknown as SideChatUpdate
      if (event.type === "side_chat_changed") changed()
      if (event.type === "side_chat_progress" && typeof event.chat_id === "string"
        && typeof event.run_id === "string" && typeof event.text === "string") {
        progress(event.chat_id, event.run_id, event.text)
      }
    }).close
  },
}
