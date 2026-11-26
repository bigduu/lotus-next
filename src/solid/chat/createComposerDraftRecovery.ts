import { createEffect, createMemo, type Accessor } from "solid-js"
import { appStore } from "@shared/store/appStore/state"
import { readComposerDraft, saveComposerDraft } from "@/lib/composer/recoverableDrafts"

const writeDelayMs = 300

export function createComposerDraftRecovery(
  origin: Accessor<string | null | undefined>,
  session: Accessor<string | null>,
  birthToken: Accessor<string | undefined>,
) {
  const scope = createMemo(() => {
    const local = origin()
    const id = session()
    const birth = birthToken()
    return local && id && birth ? { origin: local, sessionId: id, birthToken: birth } : null
  })
  let record: { suppress: (revision: number) => void; retrySave: (revision: number) => void } | undefined
  const lastInput = new Map<string, { birthToken: string; revision: number }>()
  const submitted = new Map<string, number>()

  createEffect(scope, (current) => {
    if (!current) return
    const id = current.sessionId
    const input = appStore.getState().getInputState(id)
    const last = lastInput.get(id)
    const recycled = last?.birthToken !== current.birthToken && last?.revision === input.contentRevision
    if (recycled) appStore.getState().setInputContentIfRevision(id, input.contentRevision, "")
    const prior = !recycled && input.contentRevision === 0 ? readComposerDraft(current) : undefined
    if (prior !== undefined) appStore.getState().setInputContentIfRevision(id, 0, prior)
    lastInput.set(id, { birthToken: current.birthToken, revision: appStore.getState().getInputState(id).contentRevision })

    let timer: ReturnType<typeof setTimeout> | undefined
    let pending = !recycled && input.contentRevision !== 0
    const cancel = () => {
      clearTimeout(timer)
      timer = undefined
    }
    const flush = () => {
      cancel()
      if (!pending || origin() !== current.origin) return
      pending = false
      const state = appStore.getState().inputStates[id]
      saveComposerDraft(current, state && state.contentRevision !== submitted.get(id) ? state.content : "")
    }
    const schedule = () => {
      pending = true
      if (timer === undefined) timer = setTimeout(flush, writeDelayMs)
    }
    const unsubscribe = appStore.subscribe((state) => state.inputStates[id]?.contentRevision, (revision) => {
      lastInput.set(id, { birthToken: current.birthToken, revision: revision ?? 0 })
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
        if (appStore.getState().inputStates[id]?.contentRevision !== revision) return
        submitted.set(id, revision)
        pending = true
        flush()
      },
      retrySave(revision: number) {
        if (revision !== submitted.get(id)) return
        submitted.delete(id)
        if (active === record) schedule()
      },
    }
    record = active
    return () => {
      unsubscribe()
      window.removeEventListener("pagehide", flush)
      // A known authorization change wins over old pending writes.
      if (origin() === current.origin) flush()
      else {
        cancel()
        const latest = appStore.getState().inputStates[id]
        if (latest?.content) appStore.getState().setInputContentIfRevision(id, latest.contentRevision, "")
      }
      if (record === active) record = undefined
    }
  })

  return {
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
