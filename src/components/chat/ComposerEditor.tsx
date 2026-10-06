import { useEffect, useLayoutEffect, useImperativeHandle, useRef, type Ref, type RefObject } from "react"
import { EditorContent, useEditor } from "@tiptap/react"
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
import { composerDocument, composerSlice, composerText, isComposerLink } from "./composerDocument"

export type ComposerFocusSnapshot = { text: string; from: number; to: number } | null
export type ComposerInputHandle = { focus: () => void }
export type FileSuggestion = { query: string; pick: (path: string) => void; dismiss: () => void }
const fileSuggestionKey = new PluginKey("composer-files")

type Props = {
  id: string
  value: string
  inputRef: Ref<ComposerInputHandle>
  focusSnapshot?: RefObject<ComposerFocusSnapshot>
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
}

/** Tiptap owns document/selection/IME; the rest of the app only receives text. */
export function ComposerEditor(props: Props) {
  const latest = useRef(props)
  latest.current = props
  const editor = useEditor({
    extensions: [
      Document, Paragraph, Text, HardBreak, UndoRedo,
      Placeholder.configure({ placeholder: () => latest.current.placeholder }),
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
          allow: ({ state, range }) => latest.current.mentionsEnabled
            && !!state.doc.resolve(range.from).parent.type.contentMatch.matchType(state.schema.nodes.mention),
          items: () => [], // Existing workspace FileMenu owns asynchronous results.
          render: () => {
            const update = (suggestion: SuggestionProps) => {
              latest.current.onSuggestionChange({
                query: suggestion.query,
                pick: (path) => suggestion.command({ id: path, label: path }),
                dismiss: () => exitSuggestion(suggestion.editor.view, fileSuggestionKey),
              })
            }
            return { onStart: update, onUpdate: update, onExit: () => latest.current.onSuggestionChange(null) }
          },
        },
      }),
    ],
    content: composerDocument(props.value),
    editorProps: {
      attributes: {
        id: props.id,
        role: "textbox",
        "aria-multiline": "true",
        "data-composer-editor": "",
        class: "composer-editor min-h-11 max-h-40 w-full min-w-0 overflow-y-auto overflow-x-hidden rounded-md bg-transparent px-2 py-2 pr-32 text-base outline-none whitespace-pre-wrap [overflow-wrap:anywhere] [&_p]:m-0",
        style: "padding-right: 128px",
      },
      clipboardTextSerializer: (slice) => composerText(slice.content),
      handleKeyDown: (view, event) => {
        if (event.defaultPrevented || event.isComposing || event.keyCode === 229 || view.composing) return false
        if (event.key === "Enter") {
          if (event.shiftKey) editor?.commands.setHardBreak()
          else latest.current.onSubmit()
          return true
        }
        return false
      },
      handlePaste: (view, event) => {
        const data = event.clipboardData
        if (!data) return false
        const files = Array.from(data.files)
        if (files.length) latest.current.onAddFiles(files)
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
        keydown: (view, event) => event.isComposing || event.keyCode === 229 || view.composing,
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
    onUpdate: ({ editor }) => latest.current.onChange(composerText(editor.state.doc)),
  })

  useEffect(() => {
    if (editor) exitSuggestion(editor.view, fileSuggestionKey)
  }, [editor, props.mentionScope])

  useLayoutEffect(() => {
    const snapshotRef = props.focusSnapshot
    if (!editor || !snapshotRef) return
    const snapshot = snapshotRef.current
    if (snapshot) {
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
      snapshotRef.current = null
    }
    return () => {
      const { doc, selection } = editor.state
      snapshotRef.current = editor.view.hasFocus() ? {
        text: composerText(doc),
        from: composerText(doc.cut(0, selection.from)).length,
        to: composerText(doc.cut(0, selection.to)).length,
      } : null
    }
  }, [editor, props.focusSnapshot])

  useImperativeHandle(props.inputRef, () => ({ focus: () => editor?.commands.focus() }), [editor])

  useEffect(() => {
    if (!editor || composerText(editor.state.doc) === props.value) return
    editor.commands.setContent(composerDocument(props.value), { emitUpdate: false })
  }, [editor, props.value])

  useEffect(() => {
    if (!editor) return
    const element = editor.view.dom
    element.setAttribute("aria-label", props.label)
    element.setAttribute("aria-busy", String(props.busy))
    element.setAttribute("title", props.title)
    element.setAttribute("data-placeholder", props.placeholder)
    // Refresh placeholder decorations without touching text or selection.
    editor.view.dispatch(editor.state.tr)
    if (!props.mentionsEnabled) exitSuggestion(editor.view, fileSuggestionKey)
  }, [editor, props.label, props.busy, props.title, props.placeholder, props.mentionsEnabled])

  return <EditorContent editor={editor} className="contents" />
}
