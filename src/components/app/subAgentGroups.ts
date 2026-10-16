import type { Message } from "@shared/types/chatMessages"
import type { ChildProgress } from "@shared/store/appStore/slices/executionStateSlice/types"

const subAgentTool = (name: unknown) => typeof name === "string" && name.toLowerCase().replace(/[_-]/g, "") === "subagent"

/** Placement evidence only: a matched create call/result, never arbitrary message text. */
export function groupSubAgents(groups: { key: string; messages: Message[] }[], agents: Record<string, ChildProgress>) {
  const creates = new Map<string, string>()
  const origins = new Map<string, string>()
  for (const group of groups) for (const message of group.messages) {
    if (!("type" in message)) continue
    if (message.role === "assistant" && message.type === "tool_call") for (const call of message.toolCalls) {
      if (subAgentTool(call.toolName) && call.parameters.action === "create" && !creates.has(call.toolCallId)) creates.set(call.toolCallId, group.key)
    }
    if (message.type !== "tool_result" || message.isError) continue
    const origin = creates.get(message.toolCallId)
    if (!origin || typeof message.result?.result !== "string" || message.result.result.length > 65_536) continue
    try {
      const value: unknown = JSON.parse(message.result.result)
      if (!value || typeof value !== "object" || Array.isArray(value)) continue
      const row = value as Record<string, unknown>
      if (typeof row.child_session_id === "string" && row.reused !== true &&
        Object.hasOwn(agents, row.child_session_id) && !origins.has(row.child_session_id)) origins.set(row.child_session_id, origin)
    } catch { /* A streamed/incomplete result is not provenance. */ }
  }
  const byOrigin = new Map<string, Record<string, ChildProgress>>()
  // Create-result order is immutable; mutable session recency never sorts cards.
  for (const [id, key] of origins) {
    const group = byOrigin.get(key) ?? {}
    group[id] = agents[id]; byOrigin.set(key, group)
  }
  const unplaced = Object.fromEntries(Object.entries(agents).filter(([id]) => !origins.has(id)))
  return { byOrigin, unplaced }
}
