import type { Message } from "@shared/types/chatMessages"
import {
  parseFileChangeResultPayload,
  type FileChangeResultPayload,
} from "@shared/utils/resultFormatters"

export type SessionFileChange = {
  id: string
  payload: FileChangeResultPayload
}

/** Collect durable file-edit results from a loaded session transcript. */
export function collectSessionFileChanges(messages: Message[]): SessionFileChange[] {
  const changes: SessionFileChange[] = []

  for (const message of messages) {
    if ((message as { type?: string }).type !== "tool_result") continue
    const content = (message as { result?: { result?: unknown } }).result?.result
    if (typeof content !== "string") continue
    const payload = parseFileChangeResultPayload(content)
    if (payload) changes.push({ id: message.id, payload })
  }

  return changes
}
