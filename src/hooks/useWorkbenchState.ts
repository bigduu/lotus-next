import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type SetStateAction } from "react"
import type { WorkbenchToolTab } from "@/lib/workbenchTabTypes"
import { getBackendStorageScope } from "@services/api"

import { activateWorkbenchTab, readWorkbenchState, workbenchStorageKey, writeWorkbenchState, type WorkbenchState } from "@/lib/workbenchState"

export * from "@/lib/workbenchState"

type Visit = { key: string | null }
type WorkbenchUpdate = (current: WorkbenchState) => WorkbenchState

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
