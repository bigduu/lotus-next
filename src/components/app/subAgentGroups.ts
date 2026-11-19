import type { Message } from "@shared/types/chatMessages"
import type { SubAgentCard } from "@/hooks/useSubAgentView"
import { renderProbe } from "@/lib/renderProbe"

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

/**
 * Parsing a create result is the expensive half of provenance: results can be
 * tens of kilobytes and the scan runs on every transcript change. The cached
 * row is validated against the exact source text, so a streamed result that
 * grew in place is re-parsed instead of read back stale.
 */
const parsedResults = new WeakMap<Message, { text: string; row: Record<string, unknown> | null }>()

type ToolResultMessage = Extract<Message, { type: "tool_result" }>

function parseResultRow(message: ToolResultMessage): Record<string, unknown> | null {
  const text = message.result?.result
  if (typeof text !== "string" || text.length > 65_536) return null
  const cached = parsedResults.get(message)
  if (cached && cached.text === text) {
    renderProbe.count("subagent.origins.cache-hit")
    return cached.row
  }
  let row: Record<string, unknown> | null = null
  renderProbe.count("subagent.origins.parse")
  try {
    const value: unknown = JSON.parse(text)
    if (value && typeof value === "object" && !Array.isArray(value)) row = value as Record<string, unknown>
  } catch { /* A streamed/incomplete result is not provenance. */ }
  parsedResults.set(message, { text, row })
  return row
}

/** One matched create result: the Child it names and the group that created it. */
export interface SubAgentOrigin {
  /** Transcript group (activity row key) that owns the creating call. */
  key: string
  /** Canonical Child Session/Actor id named by the result. */
  id: string
}

type ToolGroup = { key: string; messages: readonly Message[] }
type Creation = { key: string; field: CreationField }

interface SubAgentOriginIndex {
  creates: ReadonlyMap<string, Creation>
  candidates: SubAgentOrigin[]
}

/** Index matched create calls and results. A result in the live tail may
 * complete an earlier call even before the canonical history catches up. */
function scanSubAgentOrigins(groups: readonly ToolGroup[], earlier?: ReadonlyMap<string, Creation>): SubAgentOriginIndex {
  const creates = new Map<string, Creation>()
  const candidates: SubAgentOrigin[] = []
  for (const group of groups) for (const message of group.messages) {
    if (!("type" in message)) continue
    if (message.role === "assistant" && message.type === "tool_call") for (const call of message.toolCalls) {
      const field = subAgentTool(call.toolName) ? creationField(call.parameters) : null
      if (field && !earlier?.has(call.toolCallId) && !creates.has(call.toolCallId)) {
        creates.set(call.toolCallId, { key: group.key, field })
      }
    }
    if (message.type !== "tool_result" || message.isError) continue
    const origin = earlier?.get(message.toolCallId) ?? creates.get(message.toolCallId)
    if (!origin) continue
    const row = parseResultRow(message)
    if (!row || row.reused === true) continue
    const id = row[origin.field]
    if (typeof id === "string") candidates.push({ key: origin.key, id })
  }
  return { creates, candidates }
}

export function indexSubAgentOrigins(groups: readonly ToolGroup[]): SubAgentOriginIndex {
  renderProbe.count("subagent.origins.history")
  return scanSubAgentOrigins(groups)
}

export function collectSubAgentOrigins(groups: readonly ToolGroup[], history?: SubAgentOriginIndex): SubAgentOrigin[] {
  renderProbe.count("subagent.origins.collect")
  if (history && groups.length === 0) return history.candidates
  const { candidates } = scanSubAgentOrigins(groups, history?.creates)
  if (!history) return candidates
  return candidates.length ? [...history.candidates, ...candidates] : history.candidates
}

/**
 * Attach known children to their creating group. Cheap and order-stable: the
 * first verified create wins, and create-result order never sorts by recency.
 */
export function placeSubAgents(
  candidates: readonly SubAgentOrigin[],
  agents: Record<string, SubAgentCard>,
  firstMessageAt?: number | null,
) {
  const origins = new Map<string, string>()
  for (const candidate of candidates) {
    if (Object.hasOwn(agents, candidate.id) && !origins.has(candidate.id)) {
      origins.set(candidate.id, candidate.key)
    }
  }
  const byOrigin = new Map<string, Record<string, SubAgentCard>>()
  for (const [id, key] of origins) {
    const group = byOrigin.get(key) ?? {}
    group[id] = agents[id]; byOrigin.set(key, group)
  }
  const folded: Record<string, SubAgentCard> = Object.create(null)
  const unplaced: Record<string, SubAgentCard> = Object.create(null)
  let hasUnconfirmedAge = false
  for (const [id, agent] of Object.entries(agents)) {
    if (origins.has(id)) continue
    // Actor snapshots and Child summaries arrive independently. Until there is
    // a birth time to compare, keep unanchored cards behind the fold.
    const ageUnconfirmed = firstMessageAt != null &&
      (!Number.isFinite(firstMessageAt) || agent.createdAt === undefined)
    const predatesHistory = firstMessageAt === null ||
      (firstMessageAt !== undefined && agent.createdAt !== undefined && agent.createdAt < firstMessageAt)
    hasUnconfirmedAge ||= ageUnconfirmed
    const group = predatesHistory || ageUnconfirmed ? folded : unplaced
    group[id] = agent
  }
  return { byOrigin, folded, unplaced, hasUnconfirmedAge }
}

/** Convenience composition used by tests and one-shot callers. */
export function groupSubAgents(
  groups: { key: string; messages: Message[] }[],
  agents: Record<string, SubAgentCard>,
) {
  return placeSubAgents(collectSubAgentOrigins(groups), agents)
}
