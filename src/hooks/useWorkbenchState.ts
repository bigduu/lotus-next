import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from "react"
import type { RightWorkbenchTab, WorkbenchToolTab } from "@/components/app/RightWorkbench"
import { getBackendStorageScope } from "@services/api"

export type WorkbenchSubagents = {
  childId: string | null
  view: "tree" | "messages"
  expandedActorIds?: string[]
}

export interface WorkbenchState {
  open: boolean
  dockWidth: number | null
  tab: RightWorkbenchTab | null
  tools: WorkbenchToolTab[]
  order: string[]
  subagents: WorkbenchSubagents
  reviewTarget: string | null
  browserActiveId: string | null
  browserPresent: boolean
}
const tools: WorkbenchToolTab[] = ["work", "inspector", "review", "subagents"]
export const emptyWorkbenchState = (): WorkbenchState => ({
  open: false, dockWidth: null, tab: null, tools: [], order: [], subagents: { childId: null, view: "tree" },
  reviewTarget: null, browserActiveId: null, browserPresent: false,
})
const identifier = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 4096

export function workbenchStorageKey(backend: string, sessionId: string | null): string | null {
  if (!sessionId) return null
  // Endpoint identity only: never put credentials, query parameters or fragments in storage.
  const url = new URL(backend)
  return `lotus-next.workbench.v1:${encodeURIComponent(url.origin + url.pathname)}:${encodeURIComponent(sessionId)}`
}

export function readWorkbenchState(key: string | null): WorkbenchState {
  const fallback = emptyWorkbenchState()
  if (!key) return fallback
  try {
    const value = JSON.parse(localStorage.getItem(key) ?? "null")
    if (!value || (value.version !== 1 && value.version !== 2) || !value.state || typeof value.state !== "object") return fallback
    const item = value.state
    const migrateTab = (tab: unknown): unknown => value.version === 1 && tab === "session" ? "subagents" : tab
    const savedTools = Array.isArray(item.tools) ? [...new Set<WorkbenchToolTab>(
      item.tools.map(migrateTab).filter((tool: unknown): tool is WorkbenchToolTab => tools.includes(tool as WorkbenchToolTab)),
    )] : []
    const tab = migrateTab(item.tab)
    // Both old and new stored IDs are only candidates until the current actor
    // snapshot proves the child belongs to this session's root.
    const childId = value.version === 1 ? item.secondSid : item.subagents?.childId
    return {
      open: item.open === true,
      dockWidth: typeof item.dockWidth === "number" && Number.isFinite(item.dockWidth) && item.dockWidth > 0
        ? item.dockWidth : null,
      tab: tab === "browser" || savedTools.includes(tab as WorkbenchToolTab) ? tab as RightWorkbenchTab : null,
      tools: savedTools,
      order: Array.isArray(item.order) ? [...new Set<string>(item.order
        .map((id: unknown) => value.version === 1 && id === "tool:session" ? "tool:subagents" : id)
        .filter((id: unknown): id is string =>
          identifier(id) && (id.startsWith("browser:") || tools.some((tool) => id === "tool:" + tool)),
        ))].slice(0, 200) : [],
      subagents: {
        childId: identifier(childId) ? childId : null,
        view: identifier(childId) && (value.version === 1 || item.subagents?.view === "messages") ? "messages" : "tree",
        ...(Array.isArray(item.subagents?.expandedActorIds)
          ? { expandedActorIds: [...new Set<string>(item.subagents.expandedActorIds.filter(identifier))].slice(0, 256) }
          : {}),
      },
      reviewTarget: identifier(item.reviewTarget) ? item.reviewTarget : null,
      browserActiveId: identifier(item.browserActiveId) ? item.browserActiveId : null,
      browserPresent: item.browserPresent === true,
    }
  } catch { return fallback }
}

export function activateWorkbenchTab(state: WorkbenchState, tab: RightWorkbenchTab): WorkbenchState {
  return {
    ...state,
    open: true,
    tab,
    tools: tab === "browser" || state.tools.includes(tab) ? state.tools : [...state.tools, tab],
  }
}

type Visit = { key: string | null }
type WorkbenchUpdate = (current: WorkbenchState) => WorkbenchState

function writeWorkbenchState(key: string, state: WorkbenchState) {
  try { localStorage.setItem(key, JSON.stringify({ version: 2, state })) } catch {
    // Keep the in-memory view usable when storage is disabled or full.
  }
}

/** Persist view descriptors only. Drafts, message content and actions are not persisted. */
export function useWorkbenchState(sessionId: string | null) {
  const key = workbenchStorageKey(getBackendStorageScope(), sessionId)
  const [visit, setVisit] = useState<Visit>(() => ({ key }))
  if (visit.key !== key) setVisit({ key })
  const committedVisit = useRef<Visit | null>(null)
  useLayoutEffect(() => {
    committedVisit.current = visit
    return () => { committedVisit.current = null }
  }, [visit])

  const [sessions, setSessions] = useState(() => new Map<string | null, WorkbenchState>())
  const initial = useMemo(() => readWorkbenchState(key), [key])
  const state = sessions.get(key) ?? initial

  const persisted = useRef(new Map<string, WorkbenchState>())
  useEffect(() => {
    // A navigation can batch changes for the departing and destination sessions.
    // Save both using their own key after the resulting state commits.
    for (const [scope, descriptor] of sessions) {
      if (!scope || persisted.current.get(scope) === descriptor) continue
      writeWorkbenchState(scope, descriptor)
      persisted.current.set(scope, descriptor)
    }
    if (key && persisted.current.get(key) !== state) {
      writeWorkbenchState(key, state)
      persisted.current.set(key, state)
    }
  }, [key, sessions, state])

  const isCurrent = useCallback(() => committedVisit.current === visit, [visit])
  const update = useCallback((change: WorkbenchUpdate) => {
    if (!isCurrent()) return
    setSessions((current) => {
      const before = current.get(key) ?? initial
      const after = change(before)
      return before === after ? current : new Map(current).set(key, after)
    })
  }, [initial, isCurrent, key])
  const setField = useCallback(<K extends keyof WorkbenchState>(field: K, value: SetStateAction<WorkbenchState[K]>) => {
    update((previous) => {
      const next = typeof value === "function"
        ? (value as (old: WorkbenchState[K]) => WorkbenchState[K])(previous[field]) : value
      return Object.is(next, previous[field]) ? previous : { ...previous, [field]: next }
    })
  }, [update])
  const openToolForSession = (targetSessionId: string, tool: WorkbenchToolTab) => {
    if (!isCurrent()) return
    const targetKey = workbenchStorageKey(getBackendStorageScope(), targetSessionId)
    if (targetKey === key) {
      update((previous) => activateWorkbenchTab(previous, tool))
      return
    }
    const targetInitial = readWorkbenchState(targetKey)
    setSessions((current) => new Map(current).set(
      targetKey, activateWorkbenchTab(current.get(targetKey) ?? targetInitial, tool),
    ))
  }
  return { state, update, setField, scope: key, isCurrent, openToolForSession }
}
