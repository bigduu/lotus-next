import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { collectSubagentFileChanges, type SessionFileChange } from "@/lib/sessionFileChanges"
import { agentClient } from "@services/chat/AgentService"
import { useAppStore } from "@shared/store/appStore"
import type { ChatItem } from "@shared/types/chatMessages"

type HistoryRead = {
  birth: string | number
  revision: string
  attempt: number
  changes: readonly SessionFileChange[]
  truncated: boolean
  failed: boolean
}

type ReadSnapshot = {
  scope: string | null
  entries: Map<string, HistoryRead>
}

const MAX_CONCURRENT_HISTORY_READS = 4
const emptySnapshot: ReadSnapshot = { scope: null, entries: new Map() }
const birth = (chat: ChatItem) => chat.createdAtExact ?? chat.createdAt

function childHistoryRevision(child: ChatItem) {
  return JSON.stringify([
    birth(child), child.updatedAt, child.lastActivityAt, child.messageCount,
    child.isRunning, child.lastRunStatus, child.title, child.config?.workspacePath,
    child.placement?.kind, child.placement?.host,
  ])
}

export function useSubagentFileChanges(root: ChatItem | null | undefined, connectionScope: string | null, active: boolean) {
  const rootId = root?.kind === "root" ? root.id : null
  const scope = rootId && root ? JSON.stringify([connectionScope, rootId, birth(root)]) : null
  // useChat keeps this flattened index current through the account feed.
  // A managed session, sibling Root or unconfirmed live card cannot join it.
  const children = useAppStore(useShallow((state) => rootId
    ? state.chats.filter((chat) => chat.kind === "child" && chat.rootSessionId === rootId && chat.id !== rootId)
    : []))
  const sources = useMemo(() => children.filter((child) => child.messageCount !== 0)
    .map((child) => ({ child, revision: childHistoryRevision(child) })), [children])
  const [attempt, setAttempt] = useState(0)
  const [snapshot, setSnapshot] = useState(emptySnapshot)
  const latest = useRef(emptySnapshot)

  useEffect(() => {
    if (latest.current.scope !== scope) {
      latest.current = { scope, entries: new Map() }
      setSnapshot(latest.current)
    }
    if (!active || !scope) return

    const entries = new Map<string, HistoryRead>()
    const queue = sources.filter(({ child, revision }) => {
      const previous = latest.current.entries.get(child.id)
      if (previous?.birth === birth(child)) entries.set(child.id, previous)
      return previous?.revision !== revision || (previous.failed && previous.attempt !== attempt)
    })
    const controller = new AbortController()
    const { signal } = controller
    const publish = () => {
      const next = { scope, entries: new Map(entries) }
      latest.current = next
      setSnapshot(next)
    }
    if (entries.size !== latest.current.entries.size) publish()

    // Idle child histories are read once per indexed revision. Opening Review
    // on a large tree must also leave room for the user's other API reads.
    const readNext = async () => {
      while (!signal.aborted) {
        const next = queue.shift()
        if (!next) return
        const { child, revision } = next
        let changes: SessionFileChange[] = []
        let truncated = false
        let failed = false
        try {
          const history = await agentClient.getHistory(child.id, undefined, signal)
          if (signal.aborted) return
          if (history.session_id !== child.id) throw new Error("Child history session mismatch")
          changes = collectSubagentFileChanges(history.messages, {
            sessionId: child.id,
            title: child.title,
            workspace: child.config?.workspacePath,
            separateFileLocation: !!child.placement && child.placement.kind !== "local",
          })
          truncated = history.truncated === true
        } catch {
          if (signal.aborted) return
          failed = true
        }
        entries.set(child.id, { birth: birth(child), revision, attempt, changes, truncated, failed })
        publish()
      }
    }
    const workerCount = Math.min(MAX_CONCURRENT_HISTORY_READS, queue.length)
    for (let index = 0; index < workerCount; index++) {
      void readNext()
    }
    return () => controller.abort()
  }, [scope, active, sources, attempt])

  const retry = useCallback(() => {
    if (rootId) void useAppStore.getState().loadSubagentSessions(rootId, { force: true }).catch(() => {})
    setAttempt((value) => value + 1)
  }, [rootId])

  return useMemo(() => {
    const changes: SessionFileChange[] = []
    let loading = false
    let unavailable = children.length < (root?.subagentCount ?? 0)
    let truncated = false
    const entries = snapshot.scope === scope ? snapshot.entries : emptySnapshot.entries
    for (const { child, revision } of sources) {
      const entry = entries.get(child.id)
      if (!entry || entry.birth !== birth(child)) {
        loading ||= active
        continue
      }
      loading ||= active && (entry.revision !== revision || (entry.failed && entry.attempt !== attempt))
      unavailable ||= entry.failed
      truncated ||= entry.truncated
      for (const change of entry.changes) changes.push(change)
    }
    return { changes, loading, unavailable, truncated, retry }
  }, [active, attempt, children.length, retry, root?.subagentCount, scope, snapshot, sources])
}
