import { createEffect, createSignal, onSettled, untrack } from "solid-js"
import { Editor } from "@tiptap/core"
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
} from "@/lib/composer/composerEditorCore"
import "@/shared/theme/composer-editor.css"

export type { ComposerFocusSnapshot, ComposerInputHandle, FileSuggestion } from "@/lib/composer/composerEditorCore"

type Props = ComposerEditorProps & {
  inputRef?: (handle: ComposerInputHandle | null) => void
  focusSnapshot?: { current: ComposerFocusSnapshot }
  formatDraftCompletionAnnouncement?: (suffix: string) => string
}

type MountedComposer = {
  editor: Editor
  syncDraft: (editor: Editor, value: string) => void
}

/** Keep one editor per draft identity so prop updates preserve its DOM and selection. */
export function ComposerEditor(props: Props) {
  let host!: HTMLDivElement
  let announcement!: HTMLSpanElement
  let currentEditor: Editor | null = null
  let inputRef: Props["inputRef"]
  let focusSnapshot: Props["focusSnapshot"]
  const [composer, setComposer] = createSignal<MountedComposer | null>(null)
  const inputHandle: ComposerInputHandle = {
    focus: () => {
      if (currentEditor && !currentEditor.isDestroyed) currentEditor.view.focus()
    },
  }

  const mountComposer = (): MountedComposer => {
    const { options, syncDraft } = createComposerEditorState(
      () => props,
      () => currentEditor,
      (suffix) => {
        const message = suffix ? props.formatDraftCompletionAnnouncement?.(suffix) ?? suffix : ""
        if (announcement.textContent !== message) announcement.textContent = message
      },
    )
    const editor = new Editor({ ...options, element: host })
    currentEditor = editor
    return { editor, syncDraft }
  }

  onSettled(() => {
    const mounted = mountComposer()
    setComposer(mounted)

    return () => {
      const { editor } = mounted
      currentEditor = null
      if (!editor.isDestroyed) {
        if (focusSnapshot) focusSnapshot.current = captureComposerFocus(editor)
        editor.destroy()
      }
      inputRef?.(null)
    }
  })

  const onEditorChange = <T,>(read: () => T, apply: (mounted: MountedComposer, value: T) => void) => {
    createEffect(
      () => [composer(), read()] as const,
      ([mounted, value]) => {
        if (!mounted) return
        untrack(() => {
          if (mounted.editor.isDestroyed) {
            // Recover the controlled draft if a pane update outlives its view.
            const replacement = mountComposer()
            mounted.editor = replacement.editor
            mounted.syncDraft = replacement.syncDraft
            applyComposerPresentation(mounted.editor, props)
          }
          apply(mounted, value)
        })
      },
    )
  }

  onEditorChange(
    () => props.mentionScope,
    ({ editor }) => dismissComposerSuggestion(editor),
  )
  onEditorChange(
    () => props.requestDraftCompletion,
    ({ editor }) => refreshComposerDraftCompletion(editor),
  )
  onEditorChange(
    () => normalizeDraft(props.value),
    ({ editor, syncDraft }, value) => syncDraft(editor, value),
  )
  onEditorChange(
    () => ({
      label: props.label,
      busy: props.busy,
      title: props.title,
      placeholder: props.placeholder,
      mentionsEnabled: props.mentionsEnabled,
    }),
    ({ editor }, presentation) => applyComposerPresentation(editor, presentation),
  )
  onEditorChange(
    () => props.focusSnapshot,
    ({ editor }, snapshotRef) => {
      if (focusSnapshot) focusSnapshot.current = captureComposerFocus(editor)
      focusSnapshot = snapshotRef
      if (focusSnapshot?.current) {
        restoreComposerFocus(editor, focusSnapshot.current)
        focusSnapshot.current = null
      }
    },
  )
  onEditorChange(
    () => props.inputRef,
    (_mounted, nextRef) => {
      inputRef?.(null)
      inputRef = nextRef
      inputRef?.(inputHandle)
    },
  )

  return <>
    <div ref={(element) => { host = element }} class="contents" />
    <span ref={(element) => { announcement = element }} aria-live="polite" aria-atomic="true" class="sr-only" />
  </>
}
