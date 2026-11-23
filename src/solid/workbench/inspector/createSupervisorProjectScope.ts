import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import { isApiError } from "@services/api"
import { canWriteProjectScope, decodeProjectScopeReceipt, sameProjects, sameSupervisor, scopeProblem, supervisorScopeClient } from "@services/supervisorScope/client"
import type { ProjectOption, ProjectScopeIntent, ProjectScopeReceipt, ProjectScopeResponse, ScopeErrorCode, ScopeProblem } from "@services/supervisorScope/types"

export interface ProjectScopeDependencies {
  read(signal?: AbortSignal): Promise<ProjectScopeResponse>
  projects(): Promise<readonly ProjectOption[]>
  update(intent: ProjectScopeIntent): Promise<ProjectScopeReceipt>
}
export const defaultProjectScopeDependencies: ProjectScopeDependencies = supervisorScopeClient
type Notice = { kind: "saved" | "authentication" | "conflict" | "rejected" | "unavailable" | "unknown"; code?: ScopeErrorCode }
function refused(error: unknown): Notice {
  if (!isApiError(error)) return { kind: "unknown" }
  const { status } = error, { code } = scopeProblem(error)
  if (status === 401) return { kind: "authentication", code }
  if (status === 403) return { kind: "rejected", code }
  if (status === 409 && (code === "scope_revision_conflict" || code === "project_archived")) return { kind: "conflict", code }
  if (status === 503 && code && ["host_owner_authorization_unavailable", "scope_authority_invalid", "scope_unavailable", "project_store_unavailable"].includes(code)) return { kind: "unavailable", code }
  if (status === 404 && (code === "supervisor_missing" || code === "project_unavailable") || status === 400 && code === "project_scope_invalid") return { kind: "rejected", code }
  return { kind: "unknown" }
}
interface View {
  observation: ProjectScopeResponse | null; projects: readonly ProjectOption[]; draft: readonly string[] | null
  reading: boolean; catalogError: boolean; writeBlocked: boolean; problem: ScopeProblem | null
  review: ProjectScopeIntent | null; notice: Notice | null; submitting: boolean
}
const initial = (): View => ({ observation: null, projects: [], draft: null, reading: true, catalogError: false,
  writeBlocked: false, problem: null, review: null, notice: null, submitting: false })

export function createSupervisorProjectScope(open: Accessor<boolean>, dependencies = defaultProjectScopeDependencies) {
  const [readView, setView] = createSignal<View>(initial())
  let lifecycle = 0
  let readVersion = 0
  let controller: AbortController | null = null
  let flight: object | null = null

  const load = async (preserveDraft: boolean) => {
    const version = ++readVersion, generation = lifecycle
    controller?.abort(); const request = new AbortController(); controller = request
    setView((s) => ({ ...s, reading: true, writeBlocked: true, review: null, problem: null }))
    const current = () => open() && lifecycle === generation && readVersion === version
    const [scope, catalog] = await Promise.allSettled([dependencies.read(request.signal), dependencies.projects()])
    if (!current()) return null
    if (scope.status === "rejected") {
      setView((s) => ({ ...s, observation: null, reading: false, writeBlocked: true, review: null, problem: scopeProblem(scope.reason) }))
      return null
    }
    setView((s) => ({ ...s, observation: scope.value, projects: catalog.status === "fulfilled" ? catalog.value : [],
      draft: preserveDraft && s.draft !== null ? s.draft : [...scope.value.scope.allowed_projects],
      reading: false, catalogError: catalog.status === "rejected", writeBlocked: false, problem: null, review: null,
      notice: s.notice?.kind === "unknown" ? s.notice : null }))
    return scope.value
  }

  createEffect(open, (visible) => {
    lifecycle += 1
    flight = null
    if (visible) { setView(initial()); void load(false) }
    return () => { lifecycle += 1; readVersion += 1; controller?.abort() }
  })

  const edit = (id: string, checked: boolean) => {
    setView((s) => {
      if (!s.observation || s.observation.management_access || s.reading || s.submitting || s.catalogError || !s.draft) return s
      const option = s.projects.find((p) => p.id === id)
      if (checked && (option?.status !== "active" || !s.draft.includes(id) && s.draft.length >= 64)) return s
      if (!checked && !s.draft.includes(id)) return s
      const draft = checked ? [...new Set([...s.draft, id])].sort() : s.draft.filter((p) => p !== id)
      return { ...s, draft, review: null, notice: null }
    })
  }
  const review = () => {
    setView((s) => {
      if (!s.observation || s.observation.management_access || s.reading || s.submitting || s.catalogError || s.draft === null) return s
      const intent: ProjectScopeIntent = Object.freeze({ supervisor: Object.freeze({ ...s.observation.scope.supervisor }),
        expected_state_revision: s.observation.scope.state_revision,
        mutation: Object.freeze({ kind: "configure_project_scope", allowed_projects: Object.freeze([...s.draft]) }) })
      return { ...s, review: intent, notice: null }
    })
  }
  const refresh = () => open() && !flight ? load(true) : Promise.resolve(null)

  const confirm = async () => {
    const s = readView(), intent = s.review
    if (!open() || flight || !intent || !s.observation || s.reading || s.catalogError
      || s.writeBlocked || !canWriteProjectScope(s.observation)
      || s.draft?.some((id) => s.projects.find((p) => p.id === id)?.status !== "active")
      || !sameSupervisor(intent.supervisor, s.observation.scope.supervisor) || intent.expected_state_revision !== s.observation.scope.state_revision
      || !sameProjects(intent.mutation.allowed_projects, s.draft ?? [])) return
    const token = {}; flight = token
    const generation = lifecycle
    const current = () => open() && generation === lifecycle && flight === token
    setView((v) => ({ ...v, submitting: true, notice: null }))
    try {
      let notice: Notice = { kind: "unknown" }
      let receipt: ReturnType<typeof decodeProjectScopeReceipt> | null = null
      try { receipt = decodeProjectScopeReceipt(await dependencies.update(intent), intent) } catch (error) { notice = refused(error) }
      if (!current()) return
      const fresh = await load(true)
      if (!current()) return
      if (receipt && fresh && !fresh.management_access && sameSupervisor(receipt.supervisor, fresh.scope.supervisor)
        && receipt.state_revision === fresh.scope.state_revision && sameProjects(intent.mutation.allowed_projects, fresh.scope.allowed_projects)) notice = { kind: "saved" }
      setView((v) => ({ ...v, review: null, notice,
        writeBlocked: ["authentication", "rejected", "unavailable"].includes(notice.kind) }))
    } finally {
      if (current()) { flight = null; setView((v) => ({ ...v, submitting: false })) }
    }
  }
  const invalidSelection = createMemo(() => {
    const view = readView()
    return Boolean(view.draft?.some((id) => view.projects.find((project) => project.id === id)?.status !== "active"))
  })
  const writeAvailable = () => !readView().writeBlocked && canWriteProjectScope(readView().observation)
  const canEdit = createMemo(() => {
    const view = readView()
    return !!view.observation && !view.observation.management_access && !view.reading && !view.submitting && !view.catalogError
  })
  const canConfirm = createMemo(() => {
    const view = readView()
    return !invalidSelection() && !!view.review && !view.reading && !view.submitting && !view.catalogError && writeAvailable()
  })
  return { view: readView, writeAvailable, invalidSelection, canEdit, canConfirm, edit, reviewDraft: review, confirm, refresh,
    backToEdit: () => setView((view) => ({ ...view, review: null, notice: null })),
  }
}
