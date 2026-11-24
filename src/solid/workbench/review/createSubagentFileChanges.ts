import { createEffect, createMemo, createSignal, onSettled, type Accessor } from "solid-js"
import { collectSubagentFileChanges, type SessionFileChange } from "@/lib/sessionFileChanges"
import { agentClient } from "@services/chat/AgentService"
import { appStore } from "@shared/store/appStore/state"
import type { ChatItem } from "@shared/types/chatMessages"
import { createStoreSelector } from "../../state/createStoreSelector"

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

type Source = { child: ChatItem; revision: string }

const MAX_CONCURRENT_HISTORY_READS = 4
const EMPTY_SNAPSHOT: ReadSnapshot = { scope: null, entries: new Map() }
const EMPTY_CHILDREN: ChatItem[] = []
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

export function createSubagentFileChanges(
  root: Accessor<ChatItem | null | undefined>,
  connectionScope: Accessor<string | null>,
  active: Accessor<boolean>,
) {
  const rootId = createMemo(() => {
    const current = root()
    return current?.kind === "root" ? current.id : null
  })
  const scope = createMemo(() => {
    const current = root()
    const id = rootId()
    return id && current ? JSON.stringify([connectionScope(), id, birth(current)]) : null
  })

  // The account feed keeps the flattened persisted child index current. Only
  // confirmed descendants of this Root can supply edits for its review.
  const children = createStoreSelector(appStore, (state) => {
    const id = rootId()
    return id ? state.chats.filter((chat) => chat.kind === "child" && chat.rootSessionId === id && chat.id !== id)
      : EMPTY_CHILDREN
  }, (previous, next) => previous.length === next.length && previous.every((child, index) => child === next[index]))

  const sources = createMemo<Source[]>(() => children().filter((child) => child.messageCount !== 0)
    .map((child) => ({ child, revision: childHistoryRevision(child) })))
  const births = createMemo(() => new Map(sources().map(({ child }) => [child.id, birth(child)])))
  const [attempt, setAttempt] = createSignal(0)
  const [snapshot, setSnapshot] = createSignal(EMPTY_SNAPSHOT)
  const reads = new Map<string, ActiveHistoryRead>()
  let latest = EMPTY_SNAPSHOT

  const abortReads = () => {
    for (const read of reads.values()) read.controller.abort()
    reads.clear()
  }
  onSettled(() => abortReads)

  const publish = (scope: ReadSnapshot["scope"], entries: ReadSnapshot["entries"]) => {
    latest = { scope, entries }
    setSnapshot(latest)
  }

  async function readHistory({ child, revision }: Source, capturedScope: string, readAttempt: number) {
    const controller = new AbortController()
    const childBirth = birth(child)
    const { signal } = controller
    const read = { birth: childBirth, controller }
    reads.set(child.id, read)

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
    if (reads.get(child.id) !== read) return
    reads.delete(child.id)
    if (!active() || scope() !== capturedScope || latest.scope !== capturedScope || births().get(child.id) !== childBirth) return

    // Move the completed read to the end so an actively changing child cannot
    // take every free slot while other children wait for their first read.
    const entries = new Map(latest.entries)
    entries.delete(child.id)
    entries.set(child.id, { birth: childBirth, revision, attempt: readAttempt, changes, truncated, failed })
    publish(capturedScope, entries)
  }

  createEffect(
    () => {
      snapshot() // A completed read frees a slot for the next source.
      return { scope: scope(), active: active(), sources: sources(), births: births(), attempt: attempt() }
    },
    ({ scope, active, sources, births, attempt }) => {
      if (latest.scope !== scope) {
        abortReads()
        publish(scope, new Map())
      }
      if (!active || !scope) {
        abortReads()
        return
      }

      for (const [id, read] of reads) {
        if (births.get(id) !== read.birth) {
          read.controller.abort()
          reads.delete(id)
        }
      }
      const previous = latest.entries
      const entries = new Map([...previous].filter(([id, entry]) => births.get(id) === entry.birth))
      if (entries.size !== previous.size) publish(scope, entries)

      const readOrder = new Map(Array.from(entries.keys(), (id, index) => [id, index]))
      const pending = sources.filter(({ child, revision }) =>
        !reads.has(child.id) && needsRead(entries.get(child.id), revision, attempt),
      ).sort((a, b) => (readOrder.get(a.child.id) ?? -1) - (readOrder.get(b.child.id) ?? -1))

      for (const source of pending.slice(0, MAX_CONCURRENT_HISTORY_READS - reads.size)) {
        void readHistory(source, scope, attempt)
      }
    },
  )

  const retry = () => {
    const id = rootId()
    if (id) void appStore.getState().loadSubagentSessions(id, { force: true }).catch(() => {})
    setAttempt((value) => value + 1)
  }

  return createMemo(() => {
    const current = snapshot()
    const entries = current.scope === scope() ? current.entries : EMPTY_SNAPSHOT.entries
    const activeView = active()
    const readAttempt = attempt()
    const changes: SessionFileChange[] = []
    let loading = false
    let unavailable = children().length < (root()?.subagentCount ?? 0)
    let truncated = false
    for (const { child, revision } of sources()) {
      const entry = entries.get(child.id)
      if (!entry || entry.birth !== birth(child)) {
        loading ||= activeView
        continue
      }
      loading ||= activeView && needsRead(entry, revision, readAttempt)
      unavailable ||= entry.failed
      truncated ||= entry.truncated
      for (const change of entry.changes) changes.push(change)
    }
    return { changes, loading, unavailable, truncated, retry }
  })
}
