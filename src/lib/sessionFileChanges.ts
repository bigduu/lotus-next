import type { Message } from "@shared/types/chatMessages"
import {
  getFileChangePayloadDiffStats,
  parseFileChangeResultPayload,
  type FileChangeResultPayload,
} from "@shared/utils/resultFormatters"

export type SessionFileChange = {
  id: string
  toolCallId?: string
  payload: FileChangeResultPayload
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
    const filePath = normalizeFileChangePath(
      change.payload.file_path,
      change.payload.workspace,
      sessionWorkspace,
    )
    const stats = getFileChangePayloadDiffStats(change.payload)
    const existing = groups.get(filePath)

    if (existing) {
      existing.changes.push(change)
      existing.addedLines += stats.added
      existing.removedLines += stats.removed
      existing.truncated ||= change.payload.diff.truncated === true
      existing.lastChangeIndex = index
      return
    }

    groups.set(filePath, {
      id: `file:${filePath}`,
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
