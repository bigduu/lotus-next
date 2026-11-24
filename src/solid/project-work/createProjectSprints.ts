import { createEffect, createMemo, createSignal, onCleanup, onSettled, type Accessor } from "solid-js"
import { getErrorMessage, isApiError } from "@services/api"
import { sprintClient, type SprintAction, type SprintCommand, type SprintCommandResult, type SprintInspection, type SprintPage } from "@services/tickets/sprints"
import type { SnapshotRef, TicketScope } from "@services/tickets/types"

type Load = {
  query: object
  list: SprintPage | null
  inspection: SprintInspection | null
  scope: TicketScope | null
  status: "loading" | "available" | "unsupported" | "error"
  error: string | null
}
type CommandJournal = Map<string, { command: SprintCommand; result: SprintCommandResult | null }>
// The tab-local journal keeps the exact request through disposal and reconnect.
const commandJournal: CommandJournal = new Map()
const commandChanged = "lotus-sprint-command-changed"

export function createProjectSprints(
  projectId: Accessor<string>, snapshot: Accessor<SnapshotRef | null>, selectedId: Accessor<string | null>,
  owner: Accessor<boolean>, onCommitted: () => void, journal = commandJournal,
) {
  const [load, setLoad] = createSignal<Load | null>(null)
  const [outcomeVersion, updateOutcome] = createSignal(0)
  const [sending, setSending] = createSignal(false)
  const [moreBusy, setMoreBusy] = createSignal(false)
  const [revision, setRevision] = createSignal(0)
  const [online, setOnline] = createSignal(navigator.onLine)
  const fixed = createMemo(() => snapshot(), { equals: (a, b) =>
    a?.commit === b?.commit && a?.seq === b?.seq && a?.authority_epoch === b?.authority_epoch })
  const query = createMemo(() => ({
    projectId: projectId(), selectedId: selectedId(), snapshot: fixed(), owner: owner(), revision: revision(),
  }))
  let active: { query: ReturnType<typeof query>; controller: AbortController; paging: boolean } | undefined
  let locked = false
  let alive = true
  onCleanup(() => { alive = false })

  onSettled(() => {
    const outcomeChanged = () => updateOutcome((value) => value + 1)
    const connectionChanged = () => setOnline(navigator.onLine)
    window.addEventListener(commandChanged, outcomeChanged)
    window.addEventListener("online", connectionChanged)
    window.addEventListener("offline", connectionChanged)
    return () => {
      window.removeEventListener(commandChanged, outcomeChanged)
      window.removeEventListener("online", connectionChanged)
      window.removeEventListener("offline", connectionChanged)
    }
  })

  const refresh = () => { active?.controller.abort(); setRevision((value) => value + 1) }
  const valid = (read: NonNullable<typeof active>) =>
    read === active && !read.controller.signal.aborted && query() === read.query
  createEffect(query, (requested) => {
    const read = { query: requested, controller: new AbortController(), paging: false }
    active = read
    setMoreBusy(false)
    const { projectId, snapshot, selectedId } = requested
    if (!requested.owner || !snapshot) return () => read.controller.abort()
    const base: Load = { query: requested, list: null, inspection: null, scope: null, status: "loading", error: null }
    setLoad(base)
    const signal = read.controller.signal
    void Promise.all([
      sprintClient.list(projectId, undefined, snapshot, signal),
      sprintClient.scope(signal),
      selectedId ? sprintClient.inspect(projectId, selectedId, snapshot, signal) : Promise.resolve(null),
    ]).then(([list, scope, inspection]) => {
      if (valid(read)) setLoad({ ...base, list, scope, inspection, status: "available" })
    }).catch((failure) => {
      if (valid(read)) setLoad({ ...base,
        status: isApiError(failure) && [404, 405, 501].includes(failure.status) ? "unsupported" : "error",
        error: getErrorMessage(failure),
      })
    })
    return () => read.controller.abort()
  })

  const current = createMemo(() => {
    const data = load()
    const scope = query()
    return scope.owner && scope.snapshot && data?.query === scope ? data : null
  })
  const operation = createMemo(() => { outcomeVersion(); return journal.get(projectId()) })
  const request = () => operation()?.result ?? null
  const canWrite = createMemo(() => {
    const entry = current()
    const scope = entry?.scope
    const snapshot = fixed()
    const committed = request()
    const overview = scope?.overview
    return Boolean(entry?.status === "available" && scope?.available && scope.health === "writable"
      && scope.capabilities?.ticket_scope_v1 && scope.mutation_enabled && scope.binding
      && overview && ["complete", "authoritative_scope"].includes(overview.coverage)
      && !overview.truncated && overview.omitted_count === 0 && overview.index_seq >= overview.snapshot.seq
      && snapshot && overview.snapshot.commit === snapshot.commit
      && overview.snapshot.seq === snapshot.seq && overview.snapshot.authority_epoch === snapshot.authority_epoch
      && online() && !sending() && (!operation() || (committed?.status === "committed" && snapshot.seq >= committed.committedSeq)))
  })

  const loadMore = async () => {
    const initial = current()?.list
    const read = active
    if (!initial?.next_cursor || !read || !valid(read) || read.paging || !read.query.snapshot) return
    read.paging = true
    setMoreBusy(true)
    try {
      const list = await sprintClient.list(read.query.projectId, initial, read.query.snapshot, read.controller.signal)
      if (valid(read)) setLoad((previous) => previous && { ...previous, list })
    } catch (failure) {
      // An expired cursor cannot mix two immutable membership snapshots.
      if (valid(read)) setLoad((previous) => previous && { ...previous, error: getErrorMessage(failure), status: "error" })
    } finally {
      read.paging = false
      if (valid(read)) setMoreBusy(false)
    }
  }

  const record = (command: SprintCommand, result: SprintCommandResult) => {
    journal.set(command.project_id, { command, result })
    window.dispatchEvent(new Event(commandChanged))
  }
  const execute = async (command: SprintCommand, checkingUnknown = false) => {
    if (locked) return
    locked = true
    setSending(true)
    try {
      const receipt = await sprintClient.command(command)
      record(command, { status: "committed", operationId: receipt.operation.operation_id, committedSeq: receipt.operation.committed_seq })
      if (alive && projectId() === command.project_id) { onCommitted(); refresh() }
    } catch (failure) {
      // A rejection while checking an unknown command cannot prove its first attempt failed.
      const status = !checkingUnknown && isApiError(failure) && failure.status < 500
        ? failure.status === 409 ? "conflict" : "rejected" : "unknown"
      record(command, { status, message: getErrorMessage(failure) })
    } finally {
      locked = false
      if (alive) setSending(false)
    }
  }
  const command = async (id: string, action: SprintAction) => {
    const project = projectId()
    const previous = journal.get(project)?.result
    const activeSnapshot = fixed()
    const binding = current()?.scope?.binding
    if (!canWrite() || !navigator.onLine || locked || !activeSnapshot || !binding
      || (journal.has(project) && (previous?.status !== "committed" || activeSnapshot.seq < previous.committedSeq))) return
    const frozen = structuredClone<SprintCommand>({
      operation_id: crypto.randomUUID(), binding: { ...binding }, expected_seq: activeSnapshot.seq,
      expected_epoch: activeSnapshot.authority_epoch, project_id: project, sprint_id: id,
      source: "Explicit owner Sprint planning", action,
    })
    journal.set(project, { command: frozen, result: null })
    updateOutcome((value) => value + 1)
    await execute(frozen)
  }
  const reconcile = async () => {
    const project = projectId()
    const pending = journal.get(project)
    const scope = current()?.scope
    const original = pending?.command
    if (!owner() || !navigator.onLine || !scope?.available || !scope.mutation_enabled || !original
      || original.project_id !== project || scope.binding?.scope_id !== original.binding.scope_id
      || pending?.result?.status !== "unknown" || locked) return
    await execute(original, true)
  }
  const reviewLatest = () => {
    const project = projectId()
    const pending = journal.get(project)
    if (locked || pending?.result?.status === "unknown" || (pending && !pending.result)) return
    journal.delete(project)
    updateOutcome((value) => value + 1)
    onCommitted()
    refresh()
  }
  return {
    list: () => current()?.list ?? null,
    inspection: () => current()?.inspection ?? null,
    status: () => current()?.status ?? (owner() ? "loading" : "unsupported"),
    error: () => current()?.error ?? null,
    request, sending, canWrite, moreBusy, loadMore, command, reconcile, reviewLatest,
  }
}
