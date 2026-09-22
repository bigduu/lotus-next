import type { Message } from "@shared/types/chatMessages"
import {
  parseFileChangeResultPayload,
  type FileChangeResultPayload,
} from "@shared/utils/resultFormatters"

export type SessionFileChange = {
  id: string
  toolCallId?: string
  payload: FileChangeResultPayload
}

export type LiveFileChangeSegment = {
  kind: string
  calls?: readonly {
    toolCallId: string
    output: string
  }[]
}

/** Collect durable file-edit results from a loaded session transcript. */
export function collectSessionFileChanges(messages: Message[]): SessionFileChange[] {
  const changes: SessionFileChange[] = []

  for (const message of messages) {
    if ((message as { type?: string }).type !== "tool_result") continue
    const toolResult = message as {
      toolCallId?: string
      result?: { result?: unknown }
    }
    const content = toolResult.result?.result
    if (typeof content !== "string") continue
    const payload = parseFileChangeResultPayload(content)
    if (payload) changes.push({ id: message.id, toolCallId: toolResult.toolCallId, payload })
  }

  return changes
}

/** Collect structured file edits before the current tool round is persisted. */
export function collectLiveSessionFileChanges(
  segments: readonly LiveFileChangeSegment[],
): SessionFileChange[] {
  const changes: SessionFileChange[] = []

  for (const segment of segments) {
    if (segment.kind !== "tools") continue
    for (const call of segment.calls ?? []) {
      const payload = parseFileChangeResultPayload(call.output)
      if (payload) {
        changes.push({
          id: `live:${call.toolCallId}`,
          toolCallId: call.toolCallId,
          payload,
        })
      }
    }
  }

  return changes
}

/** Keep one copy while persistence and streaming briefly overlap. */
export function mergeSessionFileChanges(
  persisted: readonly SessionFileChange[],
  live: readonly SessionFileChange[],
): SessionFileChange[] {
  const persistedToolCallIds = new Set(
    persisted.flatMap((change) => (change.toolCallId ? [change.toolCallId] : [])),
  )

  return [
    ...persisted,
    ...live.filter(
      (change) => !change.toolCallId || !persistedToolCallIds.has(change.toolCallId),
    ),
  ]
}
