import { createEffect, createSignal, untrack, type Accessor } from "solid-js"
import { apiClient, getErrorMessage, isApiError } from "@services/api"
import type { TokenUsage } from "@services/metrics/types"

export const projectScanModeText = {
  off: "project_scan_off",
  enabled: "project_scan_enabled",
  paused: "project_scan_paused",
} as const

export const projectScanResultText = {
  waiting: "project_scan_waiting",
  capacity: "project_scan_capacity",
  model_unavailable: "project_scan_model_unavailable",
  input_too_large: "project_scan_input_too_large",
  scanning: "project_scan_scanning",
  declined: "project_scan_declined",
  unconfirmed: "project_scan_unconfirmed",
  pending: "project_scan_pending",
  notified: "project_scan_notified",
} as const

export const projectScanBlockerText = {
  open_questions: "project_scan_open_questions",
  dependencies: "project_scan_dependencies",
  tool_contract: "project_scan_tool_contract",
  workspace_unavailable: "project_scan_workspace_unavailable",
  required_file_unavailable: "project_scan_required_file_unavailable",
} as const

type ScanBlocker =
  | { kind: Exclude<keyof typeof projectScanBlockerText, "required_file_unavailable"> }
  | { kind: "required_file_unavailable"; path: string }

export type ScanAction = "enable" | "pause" | "resume" | "disable"

interface ScanStatus {
  project_id: string
  mode: keyof typeof projectScanModeText
  last_result: "idle" | keyof typeof projectScanResultText
  model: string | null
  available: boolean
  in_flight: boolean
  last_check?: { work_id: string; title: string; blocker: ScanBlocker | null; summary: string | null } | null
  usage: { model_requests: number; unknown_requests: number; tokens: TokenUsage }
}

const path = (id: string) => `/projects/${encodeURIComponent(id)}/scan`

export function createProjectScan(projectId: Accessor<string>, options: { pollWhileOff?: boolean } = {}) {
  const [status, setStatus] = createSignal<ScanStatus | null>(null)
  const [error, setError] = createSignal<string | null>(null)
  const [unsupported, setUnsupported] = createSignal(false)
  const [sending, setSending] = createSignal(false)
  let scope: { id: string; signal: AbortSignal; read?: AbortController } | undefined
  const current = (target: NonNullable<typeof scope>) =>
    scope === target && !target.signal.aborted && projectId() === target.id
  const scopedStatus = () => {
    const value = status()
    return value?.project_id === projectId() ? value : null
  }

  const refresh = async (target: NonNullable<typeof scope>) => {
    if (!current(target) || target.read || sending()) return
    const read = new AbortController()
    target.read = read
    try {
      const result = await apiClient.getOnce<ScanStatus>(path(target.id), { signal: read.signal })
      if (current(target) && !read.signal.aborted && result.project_id === target.id) {
        setStatus(result)
        setUnsupported(false)
        setError(null)
      }
    } catch (failure) {
      if (!current(target) || read.signal.aborted) return
      if (isApiError(failure) && [404, 405].includes(failure.status)) {
        setStatus(null)
        setUnsupported(true)
        setError(null)
      } else {
        setError(getErrorMessage(failure))
      }
    } finally {
      if (target.read === read) target.read = undefined
    }
  }

  createEffect(projectId, (id) => {
    setStatus(null)
    setError(null)
    setUnsupported(false)
    setSending(false)
    if (!id) return
    const lifetime = new AbortController()
    const target: NonNullable<typeof scope> = { id, signal: lifetime.signal }
    scope = target
    void untrack(() => refresh(target))
    const timer = window.setInterval(() => {
      if (document.visibilityState !== "visible" || unsupported()) return
      const value = scopedStatus()
      if (options.pollWhileOff || value?.in_flight || (value && value.mode !== "off") || error()) void refresh(target)
    }, 8_000)
    return () => {
      window.clearInterval(timer)
      lifetime.abort()
      target.read?.abort()
    }
  })

  const command = async (action: ScanAction) => {
    const target = scope
    if (!target || !current(target) || !scopedStatus() || sending()) return
    target.read?.abort()
    setSending(true)
    setError(null)
    try {
      const result = await apiClient.postOnce<ScanStatus>(path(target.id), { action }, { signal: target.signal })
      if (current(target) && result.project_id === target.id) setStatus(result)
    } catch (failure) {
      if (current(target)) setError(getErrorMessage(failure))
    } finally {
      if (current(target)) setSending(false)
    }
  }

  return {
    status: scopedStatus,
    error,
    unsupported,
    sending,
    command,
    refresh() {
      if (scope) void refresh(scope)
    },
  }
}
