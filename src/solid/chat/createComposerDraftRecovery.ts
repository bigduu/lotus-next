import { createEffect, createMemo, onSettled, untrack, type Accessor } from "solid-js"
import { appStore } from "@shared/store/appStore/state"
import { discardComposerDraftForSession, readComposerDraft, saveComposerDraft } from "@/lib/composer/recoverableDrafts"

const writeDelayMs = 300

export type ComposerDraftMode = "ordinary" | "unresolved" | "work"

export function createComposerDraftRecovery(
  origin: Accessor<string | null | undefined>,
  session: Accessor<string | null>,
  birthToken: Accessor<string | undefined>,
  mode: Accessor<ComposerDraftMode>,
) {
  const admittedOrigin = createMemo(origin)
  const context = createMemo(() => {
    const local = admittedOrigin()
    const id = session()
    const birth = birthToken()
    return local && id ? { origin: local, sessionId: id, birthToken: birth, mode: mode() } : null
  }, { equals: (a, b) => a?.origin === b?.origin && a?.sessionId === b?.sessionId
    && a?.birthToken === b?.birthToken && a?.mode === b?.mode })
  let record: { suppress: (revision: number) => void; retrySave: (revision: number) => void } | undefined
  const lastInput = new Map<string, { birthToken: string; revision: number }>()
  const submitted = new Map<string, number>()
  // Clearing a Work reference can leave its text in the editor.
  const workDrafts = new Set<string>()
  let mounted = true
  onSettled(() => () => { mounted = false })
  createEffect(admittedOrigin, () => { submitted.clear() })

  createEffect(context, (current) => {
    if (!current) return
    const id = current.sessionId
    if (current.mode === "work") {
      workDrafts.add(id)
      submitted.delete(id)
      discardComposerDraftForSession(current.origin, id)
      return
    }
    if (current.mode !== "ordinary" || !current.birthToken) return
    const scope = { origin: current.origin, sessionId: id, birthToken: current.birthToken }
    const canSave = () => untrack(() => admittedOrigin() === scope.origin && !workDrafts.has(id)
      && (session() !== id || (mode() === "ordinary" && birthToken() === scope.birthToken)))
    const input = appStore.getState().getInputState(id)
    const last = lastInput.get(id)
    const recycled = last?.birthToken !== scope.birthToken && last?.revision === input.contentRevision
    if (recycled) appStore.getState().setInputContentIfRevision(id, input.contentRevision, "")
    const prior = !recycled && !workDrafts.has(id) && input.contentRevision === 0 ? readComposerDraft(scope) : undefined
    if (prior !== undefined) appStore.getState().setInputContentIfRevision(id, 0, prior)
    lastInput.set(id, { birthToken: scope.birthToken, revision: appStore.getState().getInputState(id).contentRevision })

    let timer: ReturnType<typeof setTimeout> | undefined
    let pending = !recycled && !workDrafts.has(id) && input.contentRevision !== 0
    const cancel = () => {
      clearTimeout(timer)
      timer = undefined
    }
    const flush = () => {
      cancel()
      if (!pending || !canSave()) return
      pending = false
      const state = appStore.getState().inputStates[id]
      saveComposerDraft(scope, state && state.contentRevision !== submitted.get(id) ? state.content : "")
    }
    const schedule = () => {
      pending = true
      if (timer === undefined) timer = setTimeout(flush, writeDelayMs)
    }
    const unsubscribe = appStore.subscribe((state) => state.inputStates[id]?.contentRevision, (revision) => {
      lastInput.set(id, { birthToken: scope.birthToken, revision: revision ?? 0 })
      if (revision !== submitted.get(id)) submitted.delete(id)
      if (!revision || !appStore.getState().inputStates[id]?.content) {
        pending = true
        flush()
      } else schedule()
    })
    if (pending) schedule()
    window.addEventListener("pagehide", flush)
    const active = {
      suppress(revision: number) {
        if (!canSave() || appStore.getState().inputStates[id]?.contentRevision !== revision) return
        submitted.set(id, revision)
        pending = true
        flush()
      },
      retrySave(revision: number) {
        if (revision !== submitted.get(id)) return
        submitted.delete(id)
        if (!mounted || !canSave()) return
        if (active === record) schedule()
        else {
          const state = appStore.getState().inputStates[id]
          const last = lastInput.get(id)
          if (state?.contentRevision === revision && last?.revision === revision && last.birthToken === scope.birthToken) {
            saveComposerDraft(scope, state.content)
          }
        }
      },
    }
    record = active
    return () => {
      unsubscribe()
      window.removeEventListener("pagehide", flush)
      // A known authorization change wins over old pending writes.
      if (untrack(admittedOrigin) === current.origin) flush()
      else {
        cancel()
        const latest = appStore.getState().inputStates[id]
        if (latest?.content) appStore.getState().setInputContentIfRevision(id, latest.contentRevision, "")
      }
      if (record === active) record = undefined
    }
  })

  return {
    noteEditorInput(id: string, content: string) {
      if (workDrafts.has(id) && session() === id && mode() === "ordinary" && birthToken()
        && content !== appStore.getState().inputStates[id]?.content) workDrafts.delete(id)
    },
    captureSubmission() {
      const source = record
      return (revision: number) => {
        source?.suppress(revision)
        return (rejected: boolean) => {
          if (rejected) source?.retrySave(revision)
        }
      }
    },
  }
}
