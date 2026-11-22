import { useCallback, useEffect, useRef, useState, type SetStateAction } from "react"
import type { RightWorkbenchTab, WorkbenchToolTab } from "@/components/app/RightWorkbench"
import { getBackendStorageScope } from "@services/api"

export type WorkbenchSubagents = {
  childId: string | null
  view: "tree" | "messages"
}

export interface WorkbenchState {
  open: boolean
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
  open: false, tab: null, tools: [], order: [], subagents: { childId: null, view: "tree" },
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
      },
      reviewTarget: identifier(item.reviewTarget) ? item.reviewTarget : null,
      browserActiveId: identifier(item.browserActiveId) ? item.browserActiveId : null,
      browserPresent: item.browserPresent === true,
    }
  } catch { return fallback }
}

/** Persist descriptors only. Browser pages, drafts, credentials and executable actions never enter this state. */
export function useWorkbenchState(sessionId: string | null) {
  const key = workbenchStorageKey(getBackendStorageScope(), sessionId)
  const navigationState = useRef(new Map<string | null, WorkbenchState>())
  const [stored, setStored] = useState(() => ({ key, state: readWorkbenchState(key) }))
  let current = stored
  if (stored.key !== key) {
    current = { key, state: navigationState.current.get(key) ?? readWorkbenchState(key) }
    // Reset before children/effects commit, so session A cannot leak into or overwrite B.
    setStored(current)
  }
  useEffect(() => {
    navigationState.current.delete(key)
    if (!stored.key || stored.key !== key) return
    try { localStorage.setItem(stored.key, JSON.stringify({ version: 2, state: stored.state })) } catch {
      // Storage may be disabled or full. The current workbench remains usable.
    }
  }, [key, stored])
  const setField = useCallback(<K extends keyof WorkbenchState>(field: K, value: SetStateAction<WorkbenchState[K]>) => {
    setStored((previous) => {
      if (previous.key !== key) return previous
      const next = typeof value === "function"
        ? (value as (old: WorkbenchState[K]) => WorkbenchState[K])(previous.state[field]) : value
      return Object.is(next, previous.state[field]) ? previous : { key, state: { ...previous.state, [field]: next } }
    })
  }, [key])
  const openToolForSession = (targetSessionId: string, tool: WorkbenchToolTab) => {
    const targetKey = workbenchStorageKey(getBackendStorageScope(), targetSessionId)
    const previous = targetKey === key ? current.state : navigationState.current.get(targetKey) ?? readWorkbenchState(targetKey)
    const state: WorkbenchState = { ...previous, open: true, tab: tool,
      tools: previous.tools.includes(tool) ? previous.tools : [...previous.tools, tool] }
    if (targetKey === key) setStored((previous) => previous.key !== key ? previous : {
      key, state: { ...previous.state, open: true, tab: tool,
        tools: previous.state.tools.includes(tool) ? previous.state.tools : [...previous.state.tools, tool] },
    })
    else {
      // Apply the navigation intent to its destination, never the outgoing chat.
      // Retain it in memory too, so disabled storage does not lose the intent.
      navigationState.current.set(targetKey, state)
      if (targetKey) {
        try { localStorage.setItem(targetKey, JSON.stringify({ version: 2, state })) } catch { /* optional persistence */ }
      }
    }
  }
  return { state: current.state, setField, scope: key, openToolForSession }
}
