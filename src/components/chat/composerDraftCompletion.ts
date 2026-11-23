import { Extension } from "@tiptap/core"
import { closeHistory } from "@tiptap/pm/history"
import type { Node as ProseMirrorNode } from "@tiptap/pm/model"
import { Plugin, PluginKey, type EditorState } from "@tiptap/pm/state"
import { Decoration, DecorationSet, type EditorView } from "@tiptap/pm/view"
import type { RequestDraftCompletion } from "@services/chat/draftCompletion"
import { composerSlice, composerText } from "./composerDocument"

const debounceMs = 700
type Suggestion = { request: RequestDraftCompletion; suffix: string }
type Attempt = { request: RequestDraftCompletion; doc: ProseMirrorNode; controller: AbortController; timer: number }
const key = new PluginKey<Suggestion | null>("composer-draft-completion")

export function refreshDraftCompletion(view: EditorView) {
  view.dispatch(view.state.tr.setMeta(key, null))
}

function atDraftEnd({ doc, selection }: EditorState): boolean {
  return selection.empty && selection.to === doc.content.size - 1
}

function canSuggest(view: EditorView): boolean {
  return !view.isDestroyed && !view.composing && view.dom.dataset.composing !== "true"
    && view.hasFocus() && atDraftEnd(view.state)
}

export const ComposerDraftCompletion = Extension.create<{
  getRequest: () => RequestDraftCompletion | undefined
  announce: (suffix: string) => void
}>({
  name: "composerDraftCompletion",
  addOptions: () => ({ getRequest: () => undefined, announce: () => {} }),
  addProseMirrorPlugins() {
    const { getRequest, announce } = this.options
    let attempt: Attempt | undefined

    function cancel(keepDraft = false) {
      if (!attempt) return
      window.clearTimeout(attempt.timer)
      attempt.controller.abort()
      if (!keepDraft) attempt = undefined
    }

    function schedule(view: EditorView) {
      const request = getRequest()
      if (!request || !canSuggest(view)) { cancel(); return }
      const { doc } = view.state
      if (attempt?.doc === doc && attempt.request === request) return
      cancel()

      const controller = new AbortController()
      const { signal } = controller
      const timer = window.setTimeout(async () => {
        if (signal.aborted || getRequest() !== request || !canSuggest(view) || view.state.doc !== doc) return
        const suffix = await request(composerText(doc), signal).catch(() => null)
        if (suffix?.trim() && !signal.aborted && getRequest() === request && canSuggest(view) && view.state.doc === doc) {
          view.dispatch(view.state.tr.setMeta(key, { request, suffix } satisfies Suggestion))
        }
      }, debounceMs)
      attempt = { doc, request, controller, timer }
    }

    function dismiss(view: EditorView) {
      if (key.getState(view.state)) refreshDraftCompletion(view)
    }

    return [new Plugin<Suggestion | null>({
      key,
      state: {
        init: () => null,
        apply: (transaction, suggestion, _previous, state) => {
          if (transaction.docChanged || !atDraftEnd(state)) return null
          const next = transaction.getMeta(key) as Suggestion | null | undefined
          return next === undefined ? suggestion : next
        },
      },
      props: {
        decorations(state) {
          const suggestion = key.getState(state)
          if (!suggestion || suggestion.request !== getRequest()) return null
          const widget = Decoration.widget(state.selection.to, (view) => {
            const element = view.dom.ownerDocument.createElement("span")
            element.setAttribute("data-draft-completion", "")
            element.setAttribute("aria-hidden", "true")
            element.textContent = suggestion.suffix
            return element
          }, { side: 1, ignoreSelection: true, key: suggestion.suffix })
          return DecorationSet.create(state.doc, [widget])
        },
        handleKeyDown(view, event) {
          if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || !canSuggest(view)) return false
          const suggestion = key.getState(view.state)
          if (event.key === "Escape") {
            cancel(true)
            dismiss(view)
            return !!suggestion
          }
          if (!suggestion || suggestion.request !== getRequest() || event.repeat
            || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey
            || (event.key !== "Tab" && event.key !== "ArrowRight")) return false

          const transaction = closeHistory(view.state.tr)
            .replaceSelection(composerSlice(suggestion.suffix, view.state.schema))
          view.dispatch(transaction.scrollIntoView())
          cancel(true)
          return true
        },
        handleDOMEvents: {
          focus(view) { schedule(view); return false },
          blur(view) { cancel(); dismiss(view); return false },
          compositionstart(view) { cancel(); dismiss(view); return false },
          compositionend(view) {
            // The editor clears its composition guard on the next frame.
            window.requestAnimationFrame(() => schedule(view))
            return false
          },
        },
      },
      view: () => ({
        update(view) {
          const suggestion = key.getState(view.state)
          announce(suggestion && suggestion.request === getRequest() ? suggestion.suffix : "")
          schedule(view)
        },
        destroy() { cancel(); announce("") },
      }),
    })]
  },
})
