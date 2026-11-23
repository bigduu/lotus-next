import { createEffect, createMemo, createSignal, onSettled } from "solid-js"
import { getBackendStorageScope } from "@services/api"
import { readWorkbenchState, workbenchStorageKey, writeWorkbenchState, type WorkbenchState } from "@/lib/workbenchState"

type Update = (current: WorkbenchState) => WorkbenchState

export function createWorkbenchState(sessionId: () => string | null) {
  const key = createMemo(() => workbenchStorageKey(getBackendStorageScope(), sessionId()))
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
  onSettled(() => () => { active = false })

  const capture = () => {
    const currentVisit = visit()
    const update = (change: Update) => {
      if (!active || visit() !== currentVisit) return
      setSessions((current) => {
        const descriptor = current.get(currentVisit.key) ?? initial()
        const next = change(descriptor)
        return descriptor === next ? current : new Map(current).set(currentVisit.key, next)
      })
    }
    const setField = <K extends keyof WorkbenchState>(field: K, value: WorkbenchState[K]) =>
      update((before) => Object.is(before[field], value) ? before : { ...before, [field]: value })
    return { update, setField, isCurrent: () => active && currentVisit === visit() }
  }

  return { state, key, capture }
}
