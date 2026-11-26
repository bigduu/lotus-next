import { createRoot, createSignal, flush } from "solid-js"
import { afterEach, expect, it } from "vitest"
import { appStore } from "@shared/store/appStore/state"
import { discardComposerDrafts, readComposerDraft, saveComposerDraft } from "@/lib/composer/recoverableDrafts"
import { createComposerDraftRecovery, type ComposerDraftMode } from "./createComposerDraftRecovery"

const a = { origin: "http://127.0.0.1:9562", sessionId: "root-a", birthToken: "a".repeat(64) }
const b = { ...a, sessionId: "root-b", birthToken: "b".repeat(64) }
let unmount: (() => void) | undefined

afterEach(() => {
  unmount?.()
  unmount = undefined
  discardComposerDrafts()
  appStore.setState(appStore.getInitialState(), true)
})

function mount(initialMode: ComposerDraftMode = "ordinary") {
  const draft = createRoot((dispose) => {
    unmount = dispose
    const [scope, select] = createSignal(a)
    const [mode, setMode] = createSignal(initialMode)
    const recovery = createComposerDraftRecovery(() => scope().origin, () => scope().sessionId, () => scope().birthToken, mode)
    return {
      move(next: typeof a, nextMode: ComposerDraftMode = "ordinary") {
        select(next)
        setMode(nextMode)
        flush()
      },
      type(content: string) {
        const id = scope().sessionId
        recovery.noteEditorInput(id, content)
        appStore.getState().setInputContent(id, content)
      },
      submit() {
        return recovery.captureSubmission()(appStore.getState().getInputState(scope().sessionId).contentRevision)
      },
    }
  })
  flush()
  return draft
}

const hidePage = () => window.dispatchEvent(new Event("pagehide"))

it("waits for ordinary admission and discards a receipt when the composer starts a Work reply", () => {
  saveComposerDraft(a, "ordinary draft")
  saveComposerDraft(b, "other session")
  const draft = mount("unresolved")
  expect(appStore.getState().getInputState(a.sessionId).content).toBe("")
  expect(readComposerDraft(a)).toBe("ordinary draft")

  draft.move(a)
  expect(appStore.getState().getInputState(a.sessionId).content).toBe("ordinary draft")
  draft.move(a, "work")
  expect(readComposerDraft(a)).toBeUndefined()
  expect(readComposerDraft(b)).toBe("other session")
  draft.type("answer to a Work question")
  hidePage()
  expect(readComposerDraft(a)).toBeUndefined()

  draft.move(a)
  hidePage()
  expect(appStore.getState().getInputState(a.sessionId).content).toBe("answer to a Work question")
  expect(readComposerDraft(a)).toBeUndefined()
  draft.type("new ordinary edit")
  hidePage()
  expect(readComposerDraft(a)).toBe("new ordinary edit")
})

it("restores a definitively rejected unchanged revision after navigation", () => {
  const draft = mount()
  draft.type("ordinary draft")
  hidePage()
  expect(readComposerDraft(a)).toBe("ordinary draft")
  const finish = draft.submit()
  expect(readComposerDraft(a)).toBeUndefined()
  draft.move(b)
  finish(true)
  expect(readComposerDraft(a)).toBe("ordinary draft")
})

it("does not re-save a rejected revision after its composer became semantically referenced", () => {
  const draft = mount()
  draft.type("ordinary draft")
  const finish = draft.submit()
  draft.move(a, "work")
  draft.move(b)
  finish(true)
  expect(readComposerDraft(a)).toBeUndefined()
})
