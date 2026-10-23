import type { Message } from "@shared/types/chatMessages"
import type { ChildProgress } from "@shared/store/appStore/slices/executionStateSlice/types"

const subAgentTool = (name: unknown) => typeof name === "string" && name.toLowerCase().replace(/[_-]/g, "") === "subagent"

type CreationField = "child_session_id" | "actor_id"
const compactFields = new Set(["intent", "target", "role", "message", "reply_to"])
const omitted = (value: unknown) => value === undefined || value === null || value === ""

// Existing SubAgent contracts: legacy create, or compact chat without a target
// or parent reply. A matching successful result and canonical Child are required.
function creationField(value: unknown): CreationField | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null
  const args = value as Record<string, unknown>
  if (args.action === "create") return "child_session_id"
  if (Object.keys(args).some((key) => !compactFields.has(key))
    || args.intent !== undefined && args.intent !== "chat"
    || !omitted(args.target) || !omitted(args.reply_to)
    || !omitted(args.role) && typeof args.role !== "string"
    || typeof args.message !== "string" || !args.message.trim()) return null
  return "actor_id"
}

/** Placement evidence only: a matched create call/result, never arbitrary message text. */
export function groupSubAgents(groups: { key: string; messages: Message[] }[], agents: Record<string, ChildProgress>) {
  const creates = new Map<string, { key: string; field: CreationField }>()
  const origins = new Map<string, string>()
  for (const group of groups) for (const message of group.messages) {
    if (!("type" in message)) continue
    if (message.role === "assistant" && message.type === "tool_call") for (const call of message.toolCalls) {
      const field = subAgentTool(call.toolName) ? creationField(call.parameters) : null
      if (field && !creates.has(call.toolCallId)) creates.set(call.toolCallId, { key: group.key, field })
    }
    if (message.type !== "tool_result" || message.isError) continue
    const origin = creates.get(message.toolCallId)
    if (!origin || typeof message.result?.result !== "string" || message.result.result.length > 65_536) continue
    try {
      const value: unknown = JSON.parse(message.result.result)
      if (!value || typeof value !== "object" || Array.isArray(value)) continue
      const row = value as Record<string, unknown>
      const id = row[origin.field]
      if (typeof id === "string" && row.reused !== true &&
        Object.hasOwn(agents, id) && !origins.has(id)) origins.set(id, origin.key)
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
