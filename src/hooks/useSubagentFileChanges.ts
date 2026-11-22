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

type ActiveHistoryRead = {
  birth: string | number
  controller: AbortController
}

const MAX_CONCURRENT_HISTORY_READS = 4
const emptySnapshot: ReadSnapshot = { scope: null, entries: new Map() }
const birth = (chat: ChatItem) => chat.createdAtExact ?? chat.createdAt
const needsRead = (entry: HistoryRead | undefined, revision: string, attempt: number) =>
  entry?.revision !== revision || (entry.failed && entry.attempt !== attempt)

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
  const activeReads = useRef(new Map<string, ActiveHistoryRead>())

  useEffect(() => {
    const reads = activeReads.current
    return () => {
      for (const read of reads.values()) read.controller.abort()
      reads.clear()
    }
  }, [scope, active])

  useEffect(() => {
    if (latest.current.scope !== scope) {
      latest.current = { scope, entries: new Map() }
      setSnapshot(latest.current)
    }
    if (!active || !scope) return

    const reads = activeReads.current
    const births = new Map(sources.map(({ child }) => [child.id, birth(child)]))
    for (const [id, read] of reads) {
      if (births.get(id) === read.birth) continue
      read.controller.abort()
      reads.delete(id)
    }
    const previousEntries = latest.current.entries
    const entries = new Map([...previousEntries].filter(([id, entry]) => births.get(id) === entry.birth))
    const publish = (entries: ReadSnapshot["entries"]) => {
      const next = { scope, entries }
      latest.current = next
      setSnapshot(next)
    }
    if (entries.size !== previousEntries.size) publish(entries)

    // An index change can arrive while another child's history is loading.
    // Finish each read independently and give unread or older entries a turn
    // before rereading a child whose revision kept advancing.
    const readOrder = new Map(Array.from(entries.keys(), (id, index) => [id, index]))
    const pending = sources.filter(({ child, revision }) =>
      !reads.has(child.id) && needsRead(entries.get(child.id), revision, attempt),
    ).sort((a, b) => (readOrder.get(a.child.id) ?? -1) - (readOrder.get(b.child.id) ?? -1))

    const load = async ({ child, revision }: typeof sources[number]) => {
      const controller = new AbortController()
      reads.set(child.id, { birth: birth(child), controller })
      const { signal } = controller
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
      reads.delete(child.id)
      const updated = new Map(latest.current.entries)
      updated.delete(child.id)
      updated.set(child.id, { birth: birth(child), revision, attempt, changes, truncated, failed })
      publish(updated)
    }
    for (const source of pending.slice(0, MAX_CONCURRENT_HISTORY_READS - reads.size)) void load(source)
  }, [scope, active, sources, attempt, snapshot])

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
      loading ||= active && needsRead(entry, revision, attempt)
      unavailable ||= entry.failed
      truncated ||= entry.truncated
      for (const change of entry.changes) changes.push(change)
    }
    return { changes, loading, unavailable, truncated, retry }
  }, [active, attempt, children.length, retry, root?.subagentCount, scope, snapshot, sources])
}
