import type { Message } from "@shared/types/chatMessages"
import type { HistoryResponse } from "@services/chat/AgentService"
import { compareRfc3339Instants } from "@shared/utils/compareRfc3339Instants"
import {
  getFileChangePayloadDiffStats,
  parseFileChangeResultPayload,
  type FileChangeResultPayload,
} from "@shared/utils/resultFormatters"

export type SessionFileChange = {
  id: string
  toolCallId?: string
  createdAt?: string
  payload: FileChangeResultPayload
  source?: SubagentFileChangeSource
}

export type SubagentFileChangeSource = {
  sessionId: string
  title: string
  workspace?: string
  separateFileLocation: boolean
}

export type SessionFileChangeGroup = {
  id: string
  filePath: string
  changes: SessionFileChange[]
  addedLines: number
  removedLines: number
  truncated: boolean
}

export type SessionFileChangeSummary = {
  fileCount: number
  editCount: number
  addedLines: number
  removedLines: number
}

export type LiveFileChangeSegment = {
  kind: string
  calls?: readonly {
    toolCallId: string
    output: string
  }[]
}

/** Collect durable file-edit results from a loaded session transcript. */
export function collectSessionFileChanges(messages: readonly Message[]): SessionFileChange[] {
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
    if (payload) changes.push({
      id: message.id,
      toolCallId: toolResult.toolCallId,
      createdAt: message.createdAt,
      payload,
    })
  }

  return changes
}

/** Project durable tool results without retaining the child's conversation. */
export function collectSubagentFileChanges(
  messages: HistoryResponse["messages"],
  source: SubagentFileChangeSource,
): SessionFileChange[] {
  const changes: SessionFileChange[] = []
  for (const message of messages) {
    if (message.role !== "tool" || message.tool_success === false) continue
    const payload = parseFileChangeResultPayload(message.content)
    if (payload) changes.push({
      id: JSON.stringify([source.sessionId, message.id]),
      createdAt: message.created_at,
      payload,
      source,
    })
  }
  return changes
}

export function orderPersistedFileChanges(changes: SessionFileChange[]): SessionFileChange[] {
  return changes.sort((left, right) =>
    left.createdAt && right.createdAt
      ? compareRfc3339Instants(left.createdAt, right.createdAt) || 0
      : 0,
  )
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

export const canonicalizeFileChangePath = (filePath: string): string =>
  filePath
    .replace(/\\/g, "/")
    .replace(/^\/private\/tmp(?=\/|$)/, "/tmp")
    .replace(/^\/private\/var(?=\/|$)/, "/var")

const isAbsoluteFileChangePath = (filePath: string): boolean =>
  filePath.startsWith("/") || /^[a-zA-Z]:\//.test(filePath)

function normalizeFileChangePath(
  filePath: string,
  payloadWorkspace?: string,
  sessionWorkspace?: string,
): string {
  const normalizedPath = canonicalizeFileChangePath(filePath)
  if (isAbsoluteFileChangePath(normalizedPath)) return normalizedPath

  const workspace = canonicalizeFileChangePath(payloadWorkspace || sessionWorkspace || "").replace(
    /\/$/,
    "",
  )
  return workspace ? `${workspace}/${normalizedPath.replace(/^\.\//, "")}` : normalizedPath
}

/**
 * Present a session as files rather than tool invocations while preserving the
 * chronological patches for every file. Groups are ordered by their latest
 * edit, so the final group is always the most recently changed file.
 */
export function groupSessionFileChanges(
  changes: readonly SessionFileChange[],
  sessionWorkspace?: string,
): SessionFileChangeGroup[] {
  const groups = new Map<
    string,
    SessionFileChangeGroup & { lastChangeIndex: number }
  >()

  changes.forEach((change, index) => {
    const source = change.source
    const filePath = normalizeFileChangePath(
      change.payload.file_path,
      change.payload.workspace,
      source ? source.workspace : sessionWorkspace,
    )
    // A remote environment or an unresolved relative path has its own file
    // identity even if the displayed path appears elsewhere in this tree.
    const id = source && (source.separateFileLocation || !isAbsoluteFileChangePath(filePath))
      ? `subagent-file:${JSON.stringify([source.sessionId, filePath])}`
      : `file:${filePath}`
    const stats = getFileChangePayloadDiffStats(change.payload)
    const existing = groups.get(id)

    if (existing) {
      existing.changes.push(change)
      existing.addedLines += stats.added
      existing.removedLines += stats.removed
      existing.truncated ||= change.payload.diff.truncated === true
      existing.lastChangeIndex = index
      return
    }

    groups.set(id, {
      id,
      filePath,
      changes: [change],
      addedLines: stats.added,
      removedLines: stats.removed,
      truncated: change.payload.diff.truncated === true,
      lastChangeIndex: index,
    })
  })

  return Array.from(groups.values())
    .sort((left, right) => left.lastChangeIndex - right.lastChangeIndex)
    .map(({ lastChangeIndex: _lastChangeIndex, ...group }) => group)
}

export function summarizeSessionFileChangeGroups(
  groups: readonly SessionFileChangeGroup[],
): SessionFileChangeSummary {
  return groups.reduce<SessionFileChangeSummary>(
    (summary, group) => ({
      fileCount: summary.fileCount + 1,
      editCount: summary.editCount + group.changes.length,
      addedLines: summary.addedLines + group.addedLines,
      removedLines: summary.removedLines + group.removedLines,
    }),
    { fileCount: 0, editCount: 0, addedLines: 0, removedLines: 0 },
  )
}
