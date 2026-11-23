import { useEffect, useLayoutEffect, useImperativeHandle, useRef, useState, type Ref, type RefObject } from "react"
import type { Editor } from "@tiptap/core"
import { EditorContent, useEditor } from "@tiptap/react"
import { uiText } from "@shared/i18n/ui"
import {
  applyComposerPresentation,
  captureComposerFocus,
  createComposerEditorState,
  dismissComposerSuggestion,
  normalizeDraft,
  refreshComposerDraftCompletion,
  restoreComposerFocus,
  type ComposerEditorProps,
  type ComposerFocusSnapshot,
  type ComposerInputHandle,
} from "./composerEditorCore"
import "./ComposerEditor.css"

export type { ComposerFocusSnapshot, ComposerInputHandle, FileSuggestion } from "./composerEditorCore"

type Props = ComposerEditorProps & {
  inputRef: Ref<ComposerInputHandle>
  focusSnapshot?: RefObject<ComposerFocusSnapshot>
}

/** Tiptap owns document/selection/IME; the rest of the app only receives text. */
export function ComposerEditor(props: Props) {
  const latest = useRef(props)
  latest.current = props
  const normalizedValue = normalizeDraft(props.value)
  const editorRef = useRef<Editor | null>(null)
  const announcementRef = useRef<HTMLSpanElement>(null)
  // This component is keyed by draft identity. Configure the editor once;
  // controlled text acknowledgements must not reconfigure its DOM view.
  const [composer] = useState(() => createComposerEditorState(
    () => latest.current,
    () => editorRef.current,
    (suffix) => {
      const status = announcementRef.current
      if (!status) return
      const message = suffix ? uiText("chat_draft_completion_announcement", { suffix }) : ""
      if (status.textContent !== message) status.textContent = message
    },
  ))
  const editor = useEditor(composer.options)
  editorRef.current = editor

  useEffect(() => {
    if (editor && !editor.isDestroyed) dismissComposerSuggestion(editor)
  }, [editor, props.mentionScope])

  useLayoutEffect(() => {
    if (editor && !editor.isDestroyed) refreshComposerDraftCompletion(editor)
  }, [editor, props.requestDraftCompletion])

  useLayoutEffect(() => {
    const snapshotRef = props.focusSnapshot
    if (!editor || editor.isDestroyed || !snapshotRef) return
    const snapshot = snapshotRef.current
    if (snapshot) {
      restoreComposerFocus(editor, snapshot)
      snapshotRef.current = null
    }
    return () => {
      if (!editor.isDestroyed) snapshotRef.current = captureComposerFocus(editor)
    }
  }, [editor, props.focusSnapshot])

  useImperativeHandle(props.inputRef, () => ({ focus: () => {
    if (editor && !editor.isDestroyed) editor.view.focus()
  } }), [editor])

  useEffect(() => {
    if (editor && !editor.isDestroyed) composer.syncDraft(editor, normalizedValue)
  }, [composer, editor, normalizedValue])

  useEffect(() => {
    if (editor && !editor.isDestroyed) applyComposerPresentation(editor, latest.current)
  }, [editor, props.label, props.busy, props.title, props.placeholder, props.mentionsEnabled])

  return <>
    <EditorContent editor={editor} className="contents" />
    <span ref={announcementRef} aria-live="polite" aria-atomic="true" className="sr-only" />
  </>
}
