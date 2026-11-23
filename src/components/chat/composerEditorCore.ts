import { isAndroid, type Editor, type EditorOptions } from "@tiptap/core"
import Document from "@tiptap/extension-document"
import Paragraph from "@tiptap/extension-paragraph"
import Text from "@tiptap/extension-text"
import HardBreak from "@tiptap/extension-hard-break"
import Mention from "@tiptap/extension-mention"
import Link from "@tiptap/extension-link"
import { Placeholder } from "@tiptap/extensions/placeholder"
import { UndoRedo } from "@tiptap/extensions/undo-redo"
import { exitSuggestion, type SuggestionProps } from "@tiptap/suggestion"
import { PluginKey, TextSelection } from "@tiptap/pm/state"
import type { RequestDraftCompletion } from "@services/chat/draftCompletion"
import { ComposerDraftCompletion, refreshDraftCompletion } from "./composerDraftCompletion"
import { composerDocument, composerSlice, composerText, isComposerLink } from "./composerDocument"

export type ComposerFocusSnapshot = { text: string; from: number; to: number } | null
export type ComposerInputHandle = { focus: () => void }
export type FileSuggestion = { query: string; pick: (path: string) => void; dismiss: () => void }

const fileSuggestionKey = new PluginKey("composer-files")

function referenceSignature(editor: Editor): string {
  const references: [number, string][] = []
  editor.state.doc.descendants((node, position) => {
    if (node.type.name === "mention") references.push([position, node.attrs.id])
  })
  return JSON.stringify(references)
}

export type ComposerEditorProps = {
  id: string
  value: string
  label: string
  title: string
  placeholder: string
  busy: boolean
  mentionsEnabled: boolean
  mentionScope?: string | null
  onChange: (text: string) => void
  onSubmit: () => void
  onAddFiles: (files: File[]) => void
  onSuggestionChange: (suggestion: FileSuggestion | null) => void
  requestDraftCompletion?: RequestDraftCompletion
}

export function normalizeDraft(value: string): string {
  return value.replace(/\r\n?/g, "\n")
}

/** Keep the document, editing rules and plaintext contract independent of the renderer. */
export function createComposerEditorState(
  getProps: () => ComposerEditorProps,
  getEditor: () => Editor | null,
  announce: (suffix: string) => void,
) {
  const initial = getProps()
  let publishedDraft = { text: normalizeDraft(initial.value), references: "[]" }
  const options: Partial<EditorOptions> = {
    extensions: [
      Document, Paragraph, Text, HardBreak, UndoRedo,
      ComposerDraftCompletion.configure({
        getRequest: () => getProps().requestDraftCompletion,
        announce,
      }),
      Placeholder.configure({ placeholder: () => getProps().placeholder }),
      Link.configure({
        autolink: true,
        openOnClick: false,
        // Pasting a URL replaces selection as text; never hides a URL behind a label.
        linkOnPaste: false,
        isAllowedUri: (url, context) => context.defaultValidate(url) && isComposerLink(url),
        shouldAutoLink: isComposerLink,
        HTMLAttributes: { class: "text-primary underline decoration-primary/60 underline-offset-2", tabindex: "-1" },
      }),
      Mention.configure({
        deleteTriggerWithBackspace: true,
        renderText: ({ node }) => `@${node.attrs.id}`,
        HTMLAttributes: { class: "rounded bg-primary/15 px-1 text-primary [overflow-wrap:anywhere]" },
        suggestion: {
          pluginKey: fileSuggestionKey,
          char: "@",
          allowedPrefixes: [" ", "\n", "("],
          allow: ({ state, range }) => getProps().mentionsEnabled
            && !!state.doc.resolve(range.from).parent.type.contentMatch.matchType(state.schema.nodes.mention),
          items: () => [], // Existing workspace FileMenu owns asynchronous results.
          shouldResetDismissed: ({ transaction }) => transaction.docChanged,
          render: () => {
            const update = (suggestion: SuggestionProps) => {
              getProps().onSuggestionChange({
                query: suggestion.query,
                pick: (path) => suggestion.command({ id: path, label: path }),
                dismiss: () => {
                  if (!suggestion.editor.isDestroyed) exitSuggestion(suggestion.editor.view, fileSuggestionKey)
                },
              })
            }
            return { onStart: update, onUpdate: update, onExit: () => getProps().onSuggestionChange(null) }
          },
        },
      }),
    ],
    content: composerDocument(initial.value),
    editorProps: {
      attributes: {
        id: initial.id,
        role: "textbox",
        "aria-multiline": "true",
        "data-composer-editor": "",
        class: "composer-editor min-h-11 max-h-40 w-full min-w-0 overflow-y-auto overflow-x-hidden rounded-md bg-transparent px-2 py-2 text-base outline-none whitespace-pre-wrap [overflow-wrap:anywhere] [&_p]:m-0",
      },
      clipboardTextSerializer: (slice) => composerText(slice.content),
      handleKeyDown: (view, event) => {
        if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || view.composing) return false
        if (event.key === "Enter") {
          if (event.shiftKey) getEditor()?.commands.setHardBreak()
          else getProps().onSubmit()
          return true
        }
        return false
      },
      handlePaste: (view, event) => {
        const data = event.clipboardData
        if (!data) return false
        const files = Array.from(data.files)
        if (files.length) getProps().onAddFiles(files)
        else {
          // Drop foreign HTML/marks and untrusted mention metadata. Literal text
          // (including <tags>, Markdown and @paths) is never parsed as HTML.
          const text = data.getData("text/plain")
          if (text) view.dispatch(view.state.tr.replaceSelection(composerSlice(text, view.state.schema)).scrollIntoView())
        }
        event.preventDefault()
        return true
      },
      handleDrop: (view, event) => {
        if (view.dragging || event.dataTransfer?.files.length) return false
        const text = event.dataTransfer?.getData("text/plain")
        if (text) {
          const position = view.posAtCoords({ left: event.clientX, top: event.clientY })?.pos ?? view.state.selection.from
          const transaction = view.state.tr.replaceRange(position, position, composerSlice(text, view.state.schema))
          transaction.setSelection(TextSelection.near(transaction.doc.resolve(transaction.mapping.map(position))))
          view.dispatch(transaction.scrollIntoView())
          view.focus()
        }
        event.preventDefault()
        return true
      },
      handleDOMEvents: {
        keydown: (view, event) => {
          if (event.isComposing || event.keyCode === 229 || view.composing || view.dom.dataset.composing === "true") return true
          // Android Chrome bypasses ProseMirror handleKeyDown for physical
          // Enter. Handle its explicit Shift variant once, before native DOM
          // insertion can leave an extra BR. Plain Enter still uses the
          // library's IME/Safari/virtual-keyboard safeguards below.
          if (event.key === "Enter" && event.shiftKey && isAndroid() && /Chrome\//.test(navigator.userAgent)) {
            event.preventDefault()
            getEditor()?.commands.setHardBreak()
            return true
          }
          return false
        },
        compositionstart: (view) => { view.dom.dataset.composing = "true"; return false },
        compositionend: (view) => {
          requestAnimationFrame(() => { delete view.dom.dataset.composing })
          return false
        },
        // Preserve the outer ChatPane attachment drop handler; do not insert a
        // browser file URL/HTML payload into this editor as well.
        drop: (_view, event) => {
          if (!event.dataTransfer?.files.length) return false
          event.preventDefault()
          return true
        },
        click: (_view, event) => {
          if (event.target instanceof Element && event.target.closest("a")) event.preventDefault()
          return false
        },
        auxclick: (_view, event) => {
          if (event.target instanceof Element && event.target.closest("a")) event.preventDefault()
          return false
        },
      },
    },
    onUpdate: ({ editor }) => {
      const text = composerText(editor.state.doc)
      const references = referenceSignature(editor)
      // Link/format transactions are document updates, but not new plaintext
      // drafts. Explicit atom selection still counts as an edit when its text
      // is unchanged, so an in-flight send cannot clear that newer selection.
      if (text === publishedDraft.text && references === publishedDraft.references) return
      publishedDraft = { text, references }
      getProps().onChange(text)
    },
  }

  return {
    options,
    syncDraft(editor: Editor, value: string) {
      if (composerText(editor.state.doc) !== value) {
        editor.commands.setContent(composerDocument(value), { emitUpdate: false })
      }
      publishedDraft = { text: value, references: referenceSignature(editor) }
    },
  }
}

export function dismissComposerSuggestion(editor: Editor) {
  exitSuggestion(editor.view, fileSuggestionKey)
}

export function refreshComposerDraftCompletion(editor: Editor) {
  refreshDraftCompletion(editor.view)
}

export function applyComposerPresentation(
  editor: Editor,
  { label, busy, title, placeholder, mentionsEnabled }: Pick<ComposerEditorProps, "label" | "busy" | "title" | "placeholder" | "mentionsEnabled">,
) {
  const element = editor.view.dom
  element.setAttribute("aria-label", label)
  element.setAttribute("aria-busy", String(busy))
  element.setAttribute("title", title)
  element.setAttribute("data-placeholder", placeholder)
  // Refresh placeholder decorations without touching text or selection.
  editor.view.dispatch(editor.state.tr)
  if (!mentionsEnabled) dismissComposerSuggestion(editor)
}

export function restoreComposerFocus(editor: Editor, snapshot: NonNullable<ComposerFocusSnapshot>) {
  if (snapshot.text === composerText(editor.state.doc)) {
    // Restored drafts are plain text: map character offsets, not the old
    // document positions where a whole @path occupied one atom.
    const position = (offset: number) => {
      let result = editor.state.doc.content.size - 1
      let remaining = offset
      editor.state.doc.forEach((paragraph, start) => {
        if (remaining < 0) return
        const length = composerText(paragraph).length
        if (remaining <= length) { result = start + 1 + remaining; remaining = -1 }
        else remaining -= length + 1
      })
      return result
    }
    editor.commands.setTextSelection({ from: position(snapshot.from), to: position(snapshot.to) })
  } else editor.commands.setTextSelection(editor.state.doc.content.size - 1)
  editor.view.focus()
}

export function captureComposerFocus(editor: Editor): ComposerFocusSnapshot {
  const { doc, selection } = editor.state
  return editor.view.hasFocus() ? {
    text: composerText(doc),
    from: composerText(doc.cut(0, selection.from)).length,
    to: composerText(doc.cut(0, selection.to)).length,
  } : null
}
