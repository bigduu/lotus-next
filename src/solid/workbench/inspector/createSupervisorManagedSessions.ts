import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import { ApiError, isApiError } from "@services/api"
import { sameProjects, sameSupervisor } from "@services/supervisorScope/client"
import { canWriteManagedSessions, decodeManagedSessionReceipt, managedSessionsClient, managedSessionsProblem,
  type ManagedSessionIntent, type ManagedSessionLink, type ManagedSessionReceipt, type ManagedSessionsQuery, type ManagedSessionsResponse, type SessionCandidate, type SessionCandidatesPage } from "@services/supervisorScope/managedSessions"
import type { ScopeProblem } from "@services/supervisorScope/types"

export interface ManagedSessionsDependencies {
  read(signal?: AbortSignal, page?: ManagedSessionsQuery): Promise<ManagedSessionsResponse>
  candidates(offset?: number): Promise<SessionCandidatesPage>
  describe?(links: readonly ManagedSessionLink[], signal?: AbortSignal): Promise<readonly SessionCandidate[]>
  update(intent: ManagedSessionIntent): Promise<ManagedSessionReceipt>
}
type Notice = "saved" | "conflict" | "rejected" | "unknown"
interface View {
  observation: ManagedSessionsResponse | null; candidates: readonly SessionCandidate[]; nextOffset: number | null; nextAfter: string | null
  loading: boolean; catalogError: boolean; loadingMore: boolean; problem: ScopeProblem | null
  review: ManagedSessionIntent | null; notice: Notice | null; submitting: boolean; writeBlocked: boolean
}
const initial = (): View => ({ observation: null, candidates: [], nextOffset: null, nextAfter: null, loading: false, catalogError: false,
  loadingMore: false, problem: null, review: null, notice: null, submitting: false, writeBlocked: true })
export function createSupervisorManagedSessions(active: Accessor<boolean>, dependencies: ManagedSessionsDependencies = managedSessionsClient) {
  const [readView, setView] = createSignal<View>(initial())
  let generation = 0
  let readVersion = 0
  let controller: AbortController | null = null
  let mutation: object | null = null
  let pageFlight: object | null = null
  const hydrate = (links: readonly ManagedSessionLink[], request: AbortController, current: () => boolean) => {
    if (!dependencies.describe || !links.length) return
    void dependencies.describe(links, request.signal).then((summaries) => {
      if (!current() || request.signal.aborted) return
      setView((previous) => previous.observation?.management_access && previous.observation.owner_authorization.available ? { ...previous,
        candidates: [...new Map([...previous.candidates, ...summaries].map((summary) => [summary.session_id, summary])).values()] } : previous)
    }).catch(() => { /* A missing label must not hide canonical sessions. */ })
  }
  const load = async () => {
    const scope = generation, version = ++readVersion
    controller?.abort(); pageFlight = null; const request = new AbortController(); controller = request
    setView((previous) => ({ ...previous, loading: true, loadingMore: false, review: null, problem: null, writeBlocked: true }))
    const current = () => active() && generation === scope && readVersion === version
    let canonical: ManagedSessionsResponse
    try { canonical = await dependencies.read(request.signal) }
    catch (error) {
      if (!current()) return null
      // Invalidate pending navigations immediately, before displaying the refusal.
      readVersion += 1
      setView((previous) => ({ ...previous, loading: false, observation: null, nextAfter: null, problem: managedSessionsProblem(error), writeBlocked: true }))
      return null
    }
    if (!current()) return null
    let candidates: SessionCandidatesPage = { sessions: [], nextOffset: null }, catalogError = false
    if (!canonical.management_access) {
      try { candidates = await dependencies.candidates() } catch { catalogError = true }
    }
    if (!current()) return null
    setView((previous) => ({ ...previous, loading: false, observation: canonical,
      candidates: candidates.sessions, nextOffset: candidates.nextOffset, nextAfter: canonical.next_after ?? null,
      catalogError, problem: null, review: null, writeBlocked: false }))
    if (canonical.management_access && canonical.owner_authorization.available) hydrate(canonical.sessions, request, current)
    return canonical
  }
  createEffect(active, (visible) => {
    generation += 1
    mutation = null
    pageFlight = null
    setView(initial())
    if (visible) void load()
    return () => { generation += 1; readVersion += 1; controller?.abort() }
  })
  const refresh = () => active() && !mutation ? load() : Promise.resolve(null)
  const navigationGuard = (requireObservation = true) => {
    const scope = generation, version = readVersion, observed = readView().observation
    const problem = readView().problem, flight = pageFlight
    return () => active() && generation === scope && readVersion === version
      && (requireObservation ? observed !== null && pageFlight === null && readView().observation === observed
        && !readView().loading && !readView().problem && observed.owner_authorization.available
        : readView().problem === problem && pageFlight === flight)
  }
  const loadMore = async () => {
    const current = readView()
    if (!active() || pageFlight || mutation || current.loading || current.nextOffset === null && current.nextAfter === null) return
    const token = {}, scope = generation, version = readVersion, offset = current.nextOffset
    pageFlight = token; setView((previous) => ({ ...previous, loadingMore: true }))
    const stillCurrent = () => active() && generation === scope && readVersion === version && pageFlight === token
    try {
      if (current.observation?.management_access) {
        if (current.nextAfter === null) return
        const page = await dependencies.read(controller?.signal, { after: current.nextAfter, limit: 20 })
        if (!stillCurrent()) return
        if (!page.management_access || !sameSupervisor(page.scope.supervisor, current.observation.scope.supervisor)
          || page.scope.state_revision !== current.observation.scope.state_revision || !sameProjects(page.scope.allowed_projects, current.observation.scope.allowed_projects)) {
          throw new ApiError("directory_scope_changed", 409, "", JSON.stringify({ code: "scope_revision_conflict" }))
        }
        setView((previous) => ({ ...previous, observation: { ...page,
          sessions: [...new Map([...(previous.observation?.sessions ?? []), ...page.sessions].map((session) => [session.session_id, session])).values()] },
          nextAfter: page.next_after ?? null, problem: null }))
        const request = controller
        if (request && page.owner_authorization.available) hydrate(page.sessions, request,
          () => active() && generation === scope && readVersion === version && controller === request)
        return
      }
      const page = await dependencies.candidates(offset ?? undefined)
      if (!stillCurrent()) return
      setView((previous) => ({ ...previous, candidates: [...new Map([...previous.candidates, ...page.sessions].map((session) => [session.session_id, session])).values()], nextOffset: page.nextOffset, catalogError: false }))
    } catch (error) {
      if (stillCurrent()) setView((previous) => {
        if (!current.observation?.management_access) return { ...previous, catalogError: true }
        const problem = managedSessionsProblem(error)
        return { ...previous, problem, ...(["authentication", "forbidden", "conflict"].includes(problem.kind)
          ? { observation: null, candidates: [], nextAfter: null, nextOffset: null, writeBlocked: true } : {}) }
      })
    }
    finally { if (pageFlight === token) { const notify = stillCurrent(); pageFlight = null; if (notify) setView((previous) => ({ ...previous, loadingMore: false })) } }
  }
  const rows = createMemo(() => {
    const view = readView()
    if (view.observation?.management_access) {
      // A label is reusable only for the exact decoded target observation.
      const summaries = new Map(view.candidates.map((candidate) => [JSON.stringify(candidate.observedTarget), candidate]))
      const ownerAvailable = view.observation.owner_authorization.available
      return view.observation.sessions.map((link) => ({
        session_id: link.session_id, link, summary: ownerAvailable && link.current_user_target ? summaries.get(JSON.stringify(link.current_user_target)) : undefined,
        status: "current_user" as const, canEnable: false,
      }))
    }
    const allowed = new Set(view.observation?.scope.allowed_projects)
    const candidates = new Map(view.candidates.map((session) => [session.session_id, session]))
    const links = new Map(view.observation?.sessions.map((link) => [link.session_id, link]))
    const ids = new Set([...links.keys(), ...view.candidates.filter((session) => session.project_id !== null && allowed.has(session.project_id)).map((session) => session.session_id)])
    return [...ids].sort().map((session_id) => {
      const link = links.get(session_id), summary = candidates.get(session_id)
      return { session_id, link, summary, status: link?.authorization_error ? "unavailable" as const : link?.authorized ? "authorized" as const : link?.enabled ? "reconfirm" as const : link ? "detached" as const : "available" as const,
        canEnable: !link?.authorization_error && !!summary?.project_id && allowed.has(summary.project_id) }
    })
  })
  const reviewTarget = (target: string, enabled: boolean) => {
    const current = readView(), row = rows().find((session) => session.session_id === target)
    if (!active() || !current.observation || current.loading || current.submitting || current.writeBlocked || !canWriteManagedSessions(current.observation)
      || !row || enabled && (!row.canEnable || current.catalogError || row.link?.authorized) || !enabled && !row.link?.enabled) return
    const intent: ManagedSessionIntent = Object.freeze({ supervisor: Object.freeze({ ...current.observation.scope.supervisor }),
      expected_state_revision: current.observation.scope.state_revision, target_session_id: target, enabled })
    setView((previous) => ({ ...previous, review: intent, notice: null }))
  }
  const confirm = async () => {
    const current = readView(), intent = current.review
    if (!active() || mutation || !intent || !current.observation || current.loading || current.writeBlocked || !canWriteManagedSessions(current.observation)
      || !sameSupervisor(intent.supervisor, current.observation.scope.supervisor) || intent.expected_state_revision !== current.observation.scope.state_revision) return
    const token = {}, scope = generation; mutation = token
    const stillCurrent = () => active() && generation === scope && mutation === token
    setView((previous) => ({ ...previous, submitting: true, notice: null }))
    try {
      let receipt: ManagedSessionReceipt | null = null, notice: Notice = "unknown"
      try { receipt = decodeManagedSessionReceipt(await dependencies.update(intent), intent) }
      catch (error) { if (isApiError(error)) notice = error.status === 409 ? "conflict" : [400, 401, 403, 404].includes(error.status) ? "rejected" : "unknown" }
      if (!stillCurrent()) return
      const canonical = await load()
      if (!stillCurrent()) return
      const link = canonical?.sessions.find((session) => session.session_id === intent.target_session_id)
      if (receipt && canonical && !canonical.management_access && sameSupervisor(receipt.supervisor, canonical.scope.supervisor) && receipt.state_revision === canonical.scope.state_revision
        && receipt.link_revision === (link?.link_revision ?? null) && (intent.enabled ? link?.enabled && link.authorized : !link?.enabled)) notice = "saved"
      setView((previous) => ({ ...previous, review: null, notice, writeBlocked: canonical === null }))
    } finally { if (stillCurrent()) { mutation = null; setView((previous) => ({ ...previous, submitting: false })) } }
  }
  const canManage = createMemo(() => {
    const view = readView()
    return !view.loading && !view.submitting && !view.writeBlocked && canWriteManagedSessions(view.observation)
  })
  return {
    view: readView, rows, refresh, loadMore, navigationGuard, reviewTarget, confirm, canManage,
    currentUser: () => readView().observation?.management_access?.kind === "current_user",
    cancelReview: () => setView((previous) => ({ ...previous, review: null })),
  }
}
