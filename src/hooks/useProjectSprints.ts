import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { getErrorMessage, isApiError } from "@services/api"
import { sprintClient, type SprintAction, type SprintCommand, type SprintCommandResult, type SprintInspection, type SprintPage } from "@services/tickets/sprints"
import type { SnapshotRef, TicketScope } from "@services/tickets/types"

type Load = { projectId: string; selectedId: string | null; commit: string; list: SprintPage | null; inspection: SprintInspection | null; scope: TicketScope | null; status: "loading" | "available" | "unsupported" | "error"; error: string | null }
type CommandJournal = Map<string, { command: SprintCommand; result: SprintCommandResult | null }>
// A tab-local request journal survives closing/reopening the dialog. It stores
// request/receipt identity only; Sprint and Work facts still come from reads.
const sprintCommandJournal: CommandJournal = new Map()
const commandChanged = "lotus-sprint-command-changed"
export function useProjectSprints(projectId: string, snapshot: SnapshotRef | null, selectedId: string | null, owner: boolean, onCommitted: () => void, journal: CommandJournal = sprintCommandJournal) {
  const [load, setLoad] = useState<Load | null>(null)
  const [, updateOutcome] = useState(0)
  const [sending, setSending] = useState(false)
  const [moreBusy, setMoreBusy] = useState(false)
  const [revision, setRevision] = useState(0)
  const active = useRef<AbortController | null>(null)
  const outcomes = useRef(journal)
  const lock = useRef(false)
  const moreLock = useRef(false)
  const alive = useRef(true)
  const project = useRef(projectId)
  const [online, setOnline] = useState(() => navigator.onLine)
  project.current = projectId
  const commit = snapshot?.commit
  const seq = snapshot?.seq
  const epoch = snapshot?.authority_epoch
  const fixed = useMemo(() => commit !== undefined && seq !== undefined && epoch !== undefined ? { commit, seq, authority_epoch: epoch } : null, [commit, seq, epoch])
  useEffect(() => { alive.current = true; return () => { alive.current = false } }, [])
  useEffect(() => {
    const changed = () => updateOutcome((value) => value + 1)
    window.addEventListener(commandChanged, changed)
    return () => window.removeEventListener(commandChanged, changed)
  }, [])
  useEffect(() => {
    const changed = () => setOnline(navigator.onLine)
    window.addEventListener("online", changed); window.addEventListener("offline", changed)
    return () => { window.removeEventListener("online", changed); window.removeEventListener("offline", changed) }
  }, [])
  const refresh = useCallback(() => { active.current?.abort(); setRevision((value) => value + 1) }, [])
  useEffect(() => {
    const controller = new AbortController()
    active.current = controller; moreLock.current = false; setMoreBusy(false)
    if (!owner || !fixed) return () => controller.abort()
    const base: Load = { projectId, selectedId, commit: fixed.commit, list: null, inspection: null, scope: null, status: "loading", error: null }
    setLoad(base)
    void Promise.all([
      sprintClient.list(projectId, undefined, fixed, controller.signal),
      sprintClient.scope(controller.signal),
      selectedId ? sprintClient.inspect(projectId, selectedId, fixed, controller.signal) : Promise.resolve(null),
    ]).then(([list, scope, inspection]) => {
      if (!controller.signal.aborted) setLoad({ ...base, list, scope, inspection, status: "available" })
    }).catch((failure) => {
      if (!controller.signal.aborted) setLoad({ ...base, status: isApiError(failure) && [404, 405, 501].includes(failure.status) ? "unsupported" : "error", error: getErrorMessage(failure) })
    })
    return () => controller.abort()
  }, [projectId, fixed, selectedId, owner, revision])
  const current = owner && snapshot && load?.projectId === projectId && load.selectedId === selectedId && load.commit === snapshot.commit ? load : null
  const operation = outcomes.current.get(projectId)
  const request = operation?.result ?? null
  const scopeSnapshot = current?.scope?.overview?.snapshot
  const canWrite = !!(current?.status === "available" && current.scope?.available && current.scope.health === "writable" && current.scope.capabilities?.ticket_scope_v1 && current.scope.mutation_enabled && current.scope.binding
    && current.scope.overview && ["complete", "authoritative_scope"].includes(current.scope.overview.coverage)
    && !current.scope.overview.truncated && current.scope.overview.omitted_count === 0 && current.scope.overview.index_seq >= current.scope.overview.snapshot.seq
    && scopeSnapshot && scopeSnapshot.commit === snapshot?.commit && scopeSnapshot.seq === snapshot.seq && scopeSnapshot.authority_epoch === snapshot.authority_epoch
    && online && !sending && (!operation || (request?.status === "committed" && snapshot.seq >= request.committedSeq)))
  const loadMore = async () => {
    const controller = active.current
    if (!current?.list?.next_cursor || !controller || controller.signal.aborted || moreLock.current) return
    moreLock.current = true; setMoreBusy(true)
    try {
      const list = await sprintClient.list(projectId, current.list, snapshot!, controller.signal)
      if (!controller.signal.aborted) setLoad((previous) => previous && { ...previous, list })
    } catch (failure) {
      // Keep the old complete pages visible; expired cursor requires an explicit
      // new board snapshot, never a merge of two membership histories.
      if (!controller.signal.aborted) setLoad((previous) => previous && { ...previous, error: getErrorMessage(failure), status: "error" })
    } finally { if (!controller.signal.aborted) { moreLock.current = false; setMoreBusy(false) } }
  }
  const execute = async (command: SprintCommand, checkingUnknown = false) => {
    if (lock.current) return
    lock.current = true; setSending(true)
    try {
      const receipt = await sprintClient.command(command)
      outcomes.current.set(command.project_id, { command, result: { status: "committed", operationId: receipt.operation.operation_id, committedSeq: receipt.operation.committed_seq } })
      window.dispatchEvent(new Event(commandChanged))
      if (alive.current && project.current === command.project_id) { onCommitted(); refresh() }
    } catch (failure) {
      // Losing permission (or a new scope/CAS) while checking an uncertain
      // command says nothing about its first attempt. Keep its exact identity.
      const status = !checkingUnknown && isApiError(failure) && failure.status < 500 ? failure.status === 409 ? "conflict" : "rejected" : "unknown"
      outcomes.current.set(command.project_id, { command, result: { status, message: getErrorMessage(failure) } })
      window.dispatchEvent(new Event(commandChanged))
    } finally { lock.current = false; if (alive.current) setSending(false) }
  }
  const command = async (sprintId: string, action: SprintAction) => {
    const previous = outcomes.current.get(projectId)
    if (!canWrite || !navigator.onLine || lock.current || (previous && (previous.result?.status !== "committed" || snapshot!.seq < previous.result.committedSeq)) || !current?.scope?.binding || !snapshot) return
    const body: SprintCommand = {
      operation_id: crypto.randomUUID(), binding: { ...current.scope.binding }, expected_seq: snapshot.seq, expected_epoch: snapshot.authority_epoch,
      project_id: projectId, sprint_id: sprintId, source: "Explicit owner Sprint planning", action,
    }
    // Freeze the full payload before the first network attempt. UI edits and
    // later query refreshes cannot rewrite an uncertain command's identity/CAS.
    const frozen = structuredClone(body)
    outcomes.current.set(projectId, { command: frozen, result: null }); updateOutcome((value) => value + 1)
    await execute(frozen)
  }
  const reconcile = async () => {
    const pending = outcomes.current.get(projectId)
    const original = pending?.command
    if (!owner || !navigator.onLine || !current?.scope?.available || !current.scope.mutation_enabled
      || !original || original.project_id !== projectId || current.scope.binding?.scope_id !== original.binding.scope_id
      || pending?.result?.status !== "unknown" || lock.current) return
    await execute(original, true)
  }
  const reviewLatest = () => {
    const pending = outcomes.current.get(projectId)
    if (lock.current || pending?.result?.status === "unknown" || (pending && !pending.result)) return
    outcomes.current.delete(projectId); updateOutcome((value) => value + 1); onCommitted(); refresh()
  }
  return { list: current?.list ?? null, inspection: current?.inspection ?? null, status: current?.status ?? (owner ? "loading" : "unsupported"), error: current?.error ?? null,
    request, sending, canWrite, moreBusy, loadMore, command, reconcile, reviewLatest, refresh }
}
