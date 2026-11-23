import { createEffect, createMemo, createSignal, onCleanup, type Accessor } from "solid-js"
import { getBackendStorageScope } from "@services/api"
import { activateWorkbenchTab, readWorkbenchState, workbenchStorageKey, writeWorkbenchState, type WorkbenchState } from "@/lib/workbenchState"
import type { WorkbenchToolTab } from "@/lib/workbenchTabTypes"

type Update = (current: WorkbenchState) => WorkbenchState

export function createWorkbenchState(sessionId: Accessor<string | null>, backend: Accessor<string> = getBackendStorageScope) {
  const key = createMemo(() => workbenchStorageKey(backend(), sessionId()))
  const visit = createMemo(() => ({ key: key() }))
  const [sessions, setSessions] = createSignal(new Map<string | null, WorkbenchState>())
  const initial = createMemo(() => readWorkbenchState(key()))
  const state = createMemo(() => sessions().get(key()) ?? initial())
  const saved = new Map<string, WorkbenchState>()
  let active = true

  createEffect(
    () => ({ key: key(), state: state(), sessions: sessions() }),
    ({ key, state, sessions }) => {
      const persist = (scope: string | null, descriptor: WorkbenchState) => {
        if (!scope || saved.get(scope) === descriptor) return
        writeWorkbenchState(scope, descriptor)
        saved.set(scope, descriptor)
      }
      for (const [scope, descriptor] of sessions) persist(scope, descriptor)
      persist(key, state)
    },
  )
  onCleanup(() => { active = false })

  const capture = () => {
    const currentVisit = visit()
    const currentInitial = initial()
    const isCurrent = () => active && currentVisit === visit()
    const update = (change: Update) => {
      if (!isCurrent()) return
      setSessions((current) => {
        const descriptor = current.get(currentVisit.key) ?? currentInitial
        const next = change(descriptor)
        return descriptor === next ? current : new Map(current).set(currentVisit.key, next)
      })
    }
    const setField = <K extends keyof WorkbenchState>(field: K, value: WorkbenchState[K] | ((before: WorkbenchState[K]) => WorkbenchState[K])) => {
      update((before) => {
        const next = typeof value === "function" ? value(before[field]) : value
        return Object.is(before[field], next) ? before : { ...before, [field]: next }
      })
    }
    const openToolForSession = (sessionId: string, tool: WorkbenchToolTab) => {
      if (!isCurrent()) return
      const destination = workbenchStorageKey(backend(), sessionId)
      if (!destination) return
      if (destination === currentVisit.key) {
        update((before) => activateWorkbenchTab(before, tool))
      } else {
        const initialDestination = readWorkbenchState(destination)
        setSessions((current) => new Map(current).set(destination,
          activateWorkbenchTab(current.get(destination) ?? initialDestination, tool)))
      }
    }
    return { update, setField, openToolForSession, isCurrent }
  }

  return { state, key, capture }
}
