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

export type SideChatSource = { source_generation: string; side_chat: SideChatSnapshot | null }

type SideChatUpdate = {
  type: "side_chat_changed" | "side_chat_progress"
  chat_id?: unknown
  run_id?: unknown
  text?: unknown
}
export type SideChatTurnRequest = {
  id: string
  source_generation: string
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

export function newSideChatRequestId(): string {
  if (typeof crypto.randomUUID === "function") return crypto.randomUUID()
  const bytes = crypto.getRandomValues(new Uint8Array(16))
  bytes[6] = (bytes[6] & 0x0f) | 0x40
  bytes[8] = (bytes[8] & 0x3f) | 0x80
  const text = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("")
  return [text.slice(0, 8), text.slice(8, 12), text.slice(12, 16), text.slice(16, 20), text.slice(20)].join("-")
}

export const sideChatClient = {
  async read(sourceId: string, signal?: AbortSignal) {
    const source = await apiClient.get<SideChatSource>(sessionPath(sourceId), { cache: "no-store", signal })
    if (typeof source.source_generation !== "string") throw new Error("Unknown Side Chat source")
    return source
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
