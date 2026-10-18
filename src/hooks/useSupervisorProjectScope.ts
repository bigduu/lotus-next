import { useCallback, useEffect, useRef, useState } from "react"
import { decodeProjectScopeReceipt, sameProjects, sameSupervisor, scopeProblem, supervisorScopeClient } from "@services/supervisorScope/client"
import { decodeProjectScopeOwnerAvailability, isNativeConfirmationUnavailableCode, isNativeScopeCancellation, nativeConfirmationReady, unavailableProjectScopeOwnerBridge, type NativeConfirmationUnavailableCode, type ProjectScopeOwnerBridge, type ProjectScopeOwnerNoticeCode, type ProjectScopeOwnerOutcome } from "@services/supervisorScope/ownerBridge"
import type { ProjectOption, ProjectScopeIntent, ProjectScopeResponse, ScopeProblem } from "@services/supervisorScope/types"

export interface ProjectScopeDependencies {
  read(signal?: AbortSignal): Promise<ProjectScopeResponse>
  projects(): Promise<readonly ProjectOption[]>
  bridge: ProjectScopeOwnerBridge
}
export const defaultProjectScopeDependencies: ProjectScopeDependencies = { ...supervisorScopeClient, bridge: unavailableProjectScopeOwnerBridge }
type Notice = { kind: "cancelled" | "saved" | "conflict" | "rejected" | "unavailable" | "unknown"; code?: ProjectScopeOwnerNoticeCode }
function refused(outcome: Extract<ProjectScopeOwnerOutcome, { kind: "rejected" }>): Notice {
  const { status, code } = outcome
  if (status === 503 && isNativeConfirmationUnavailableCode(code)) return { kind: "unavailable", code }
  if ((status === 401 || status === 403) && (!code || ["host_owner_authorization_required", "supervisor_identity_mismatch"].includes(code))) return { kind: "rejected", code }
  if (status === 409 && (code === "scope_revision_conflict" || code === "project_archived")) return { kind: "conflict", code }
  if (status === 503 && code && ["host_owner_authorization_unavailable", "scope_authority_invalid", "scope_unavailable", "project_store_unavailable"].includes(code)) return { kind: "unavailable", code }
  if (status === 404 && (code === "supervisor_missing" || code === "project_unavailable") || status === 400 && code === "project_scope_invalid") return { kind: "rejected", code }
  return { kind: "unknown" }
}
interface View {
  observation: ProjectScopeResponse | null; projects: readonly ProjectOption[]; draft: readonly string[] | null
  reading: boolean; catalogError: boolean; nativeAvailable: boolean; nativeUnavailableCode: NativeConfirmationUnavailableCode | null; problem: ScopeProblem | null
  review: ProjectScopeIntent | null; notice: Notice | null; submitting: boolean
}
const initial = (): View => ({ observation: null, projects: [], draft: null, reading: true, catalogError: false,
  nativeAvailable: false, nativeUnavailableCode: null, problem: null, review: null, notice: null, submitting: false })

export function useSupervisorProjectScope(open: boolean, dependencies = defaultProjectScopeDependencies) {
  const [view, setView] = useState<View>(initial)
  const latest = useRef(view); latest.current = view
  const visible = useRef(open); visible.current = open
  const lifecycle = useRef(0), readVersion = useRef(0), controller = useRef<AbortController | null>(null)
  const flight = useRef<object | null>(null)

  const load = useCallback(async (preserveDraft: boolean) => {
    const version = ++readVersion.current, generation = lifecycle.current
    controller.current?.abort(); const request = new AbortController(); controller.current = request
    setView((s) => ({ ...s, reading: true, nativeAvailable: false, nativeUnavailableCode: null, review: null, problem: null }))
    const current = () => visible.current && lifecycle.current === generation && readVersion.current === version
    const [scope, catalog] = await Promise.allSettled([dependencies.read(request.signal), dependencies.projects()])
    if (!current()) return null
    if (scope.status === "rejected") {
      setView((s) => ({ ...s, observation: null, reading: false, nativeAvailable: false, nativeUnavailableCode: null, review: null, problem: scopeProblem(scope.reason) }))
      return null
    }
    let availability = null
    try { availability = decodeProjectScopeOwnerAvailability(await dependencies.bridge.inspectAvailability(scope.value)) } catch { /* Remain blocked. */ }
    const nativeAvailable = nativeConfirmationReady(availability)
    const nativeUnavailableCode = availability?.authority_profile?.unavailable_code ?? null
    if (!current()) return null
    setView((s) => ({ ...s, observation: scope.value, projects: catalog.status === "fulfilled" ? catalog.value : [],
      draft: preserveDraft && s.draft !== null ? s.draft : [...scope.value.scope.allowed_projects],
      reading: false, catalogError: catalog.status === "rejected", nativeAvailable, nativeUnavailableCode, problem: null, review: null }))
    return scope.value
  }, [dependencies])

  useEffect(() => {
    lifecycle.current += 1; flight.current = null
    if (open) { setView(initial()); void load(false) }
    return () => { lifecycle.current += 1; readVersion.current += 1; controller.current?.abort() }
  }, [open, load])

  const edit = useCallback((id: string, checked: boolean) => {
    setView((s) => {
      if (!s.observation || s.reading || s.submitting || s.catalogError || !s.draft) return s
      const option = s.projects.find((p) => p.id === id)
      if (checked && (option?.status !== "active" || !s.draft.includes(id) && s.draft.length >= 64)) return s
      if (!checked && !s.draft.includes(id)) return s
      const draft = checked ? [...new Set([...s.draft, id])].sort() : s.draft.filter((p) => p !== id)
      return { ...s, draft, review: null, notice: null }
    })
  }, [])
  const review = useCallback(() => {
    setView((s) => {
      if (!s.observation || s.reading || s.submitting || s.catalogError || s.draft === null) return s
      const intent: ProjectScopeIntent = Object.freeze({ supervisor: Object.freeze({ ...s.observation.scope.supervisor }),
        expected_state_revision: s.observation.scope.state_revision,
        mutation: Object.freeze({ kind: "configure_project_scope", allowed_projects: Object.freeze([...s.draft]) }) })
      return { ...s, review: intent, notice: null }
    })
  }, [])
  const refresh = useCallback(() => { if (visible.current && !flight.current) return load(true); return Promise.resolve(null) }, [load])

  const confirm = useCallback(async () => {
    const s = latest.current, intent = s.review
    if (!visible.current || flight.current || !intent || !s.observation || s.reading || s.catalogError
      || !s.nativeAvailable
      || s.draft?.some((id) => s.projects.find((p) => p.id === id)?.status !== "active")
      || !sameSupervisor(intent.supervisor, s.observation.scope.supervisor) || intent.expected_state_revision !== s.observation.scope.state_revision
      || !sameProjects(intent.mutation.allowed_projects, s.draft ?? [])) return
    const token = {}; flight.current = token
    const generation = lifecycle.current
    const current = () => visible.current && generation === lifecycle.current && flight.current === token
    setView((v) => ({ ...v, submitting: true, notice: null }))
    try {
      let outcome: ProjectScopeOwnerOutcome
      try { outcome = await dependencies.bridge.confirmAndApply(intent) } catch { outcome = { kind: "unknown" } }
      if (!current()) return
      if (isNativeScopeCancellation(outcome)) {
        setView((v) => ({ ...v, review: null, notice: { kind: "cancelled", code: outcome.code } })); return
      }
      let notice: Notice = { kind: "unknown" }
      let receipt: ReturnType<typeof decodeProjectScopeReceipt> | null = null
      if (outcome?.kind === "applied") {
        try { receipt = decodeProjectScopeReceipt(outcome.receipt, intent) } catch { /* Do not claim success. */ }
      } else if (outcome?.kind === "unavailable") notice = { kind: "unavailable" }
      else if (outcome?.kind === "rejected") notice = refused(outcome)
      const fresh = await load(true)
      if (!current()) return
      if (receipt && fresh && sameSupervisor(receipt.supervisor, fresh.scope.supervisor)
        && receipt.state_revision === fresh.scope.state_revision && sameProjects(intent.mutation.allowed_projects, fresh.scope.allowed_projects)) notice = { kind: "saved" }
      setView((v) => ({ ...v, review: null, notice, nativeAvailable: notice.kind === "unavailable" ? false : v.nativeAvailable,
        nativeUnavailableCode: notice.kind === "unavailable" && isNativeConfirmationUnavailableCode(notice.code) ? notice.code : v.nativeUnavailableCode }))
    } finally {
      if (current()) { flight.current = null; setView((v) => ({ ...v, submitting: false })) }
    }
  }, [dependencies, load])

  const invalidSelection = !!view.draft?.some((id) => view.projects.find((p) => p.id === id)?.status !== "active")
  return { ...view, invalidSelection, edit, reviewDraft: review, confirm, refresh,
    backToEdit: () => setView((s) => ({ ...s, review: null, notice: null })),
    canEdit: !!view.observation && !view.reading && !view.submitting && !view.catalogError,
    canConfirm: !invalidSelection && !!view.review && !view.reading && !view.submitting && !view.catalogError && view.nativeAvailable && !!view.observation }
}
