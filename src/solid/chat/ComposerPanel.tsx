import { ArrowUp, ImagePlus, Square, X } from "@lucide/solid"
import { createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { appStore } from "@shared/store/appStore/state"
import { newSessionPermissionStore } from "@shared/store/newSessionPermissionState"
import { createDraftCompletionRequest } from "@services/chat/draftCompletion"
import { getDraftCompletionEnabled, subscribeDraftCompletionEnabled } from "@shared/store/draftCompletionPreferenceState"
import { fileToAttachment, type ChatImageAttachment } from "@/lib/chatImageAttachments"
import { Button } from "../ui/button"
import { createStoreSelector } from "../state/createStoreSelector"
import { ComposerEditor, type ComposerFocusSnapshot } from "../composer/ComposerEditor"
import { isSessionExecutionBlocked } from "@services/chat/sessionExecutionCompatibility"
import { createGuidanceQueue } from "./guidance/createGuidanceQueue"
import { GuidanceQueueControls, GuidanceTimingControl } from "./guidance/GuidanceQueueControls"
import { createComposerModelControls } from "./model/createComposerModelControls"
import { ComposerModelControls } from "./model/ComposerModelControls"
import { createUiText } from "../shell/uiText"
import type { createChat } from "./createChat"
import { createComposerCommands } from "./commands/createComposerCommands"
import { ComposerCommandMenus } from "./commands/ComposerCommandMenus"
import { NewSessionPermissionControl, PermissionModeControl } from "./permissions/PermissionModeControl"
import { createNewChatWorktree } from "../workspace/createNewChatWorktree"
import { NewChatWorktreeControl } from "../workspace/NewChatWorktreeControl"

type Chat = ReturnType<typeof createChat>

export function ComposerPanel(props: {
  chat: Chat
  workspacePath: string | null
  projectId: string | null
  selectedWorktreePath: string | null
  draftEpoch: number
  navigationVersion: () => number
  onOpenGoal: (sessionId: string) => void
  captureSessionCreated: () => (sessionId: string) => void
  onPreviewImage: (url: string) => void
}) {
  const text = createUiText()
  const draftKey = () => props.chat.currentSessionId ?? ""
  const inputs = createStoreSelector(appStore, (state) => state.inputStates)
  const value = () => inputs()[draftKey()]?.content ?? ""
  const running = () => props.chat.currentChat?.isRunning === true ||
    (props.chat.sending && props.chat.streaming !== null)
  const worktree = createNewChatWorktree({
    sessionId: () => props.chat.currentSessionId,
    projectId: () => props.projectId,
    workspacePath: () => props.workspacePath,
    existingPath: () => props.selectedWorktreePath,
    draftEpoch: () => props.draftEpoch,
    navigationVersion: props.navigationVersion,
  })
  const queue = createGuidanceQueue(() => props.chat.currentSessionId, running)
  const queuedSend = () => Boolean(props.chat.currentSessionId && (running() || queue.hasUnconfirmed))
  const interactionBlocked = () => Boolean(props.chat.pendingQuestion || props.chat.pendingApproval ||
    isSessionExecutionBlocked(props.chat.currentSessionId))
  const [predict, setPredict] = createSignal(getDraftCompletionEnabled())
  const [submitting, setSubmitting] = createSignal(false)
  const [attachments, setAttachments] = createSignal<ChatImageAttachment[]>([])
  let attachmentRevision = 0
  const models = createComposerModelControls({
    chat: props.chat,
    draftKey,
    disabled: () => interactionBlocked() || running() || submitting() || props.chat.submissionPending || queue.busy || queue.hasUnconfirmed,
  })
  const blocked = () => interactionBlocked() || models.sendBlocked
  const inputId = "lotus-message-input"
  const mentionWorkspace = () => worktree.preparedPath ?? props.workspacePath
  const commands = createComposerCommands({
    chat: props.chat,
    draftKey,
    workspacePath: mentionWorkspace,
    inputId,
    running,
    blocked,
    hasAttachments: () => attachments().length > 0,
    queueBusy: () => queue.busy || queue.hasUnconfirmed,
    queuePending: () => queue.pending.length > 0,
    thinkingMode: () => models.thinkingMode,
    extraSessionRestricted: () => models.root.child,
    openGoal: props.onOpenGoal,
  })
  let filePicker!: HTMLInputElement
  let active = false
  const changeAttachments = (change: (current: ChatImageAttachment[]) => ChatImageAttachment[]) => {
    attachmentRevision += 1
    setAttachments(change)
  }
  const focusSnapshots = new Map<string, { current: ComposerFocusSnapshot }>()
  const draftIdentity = createMemo(() => ({ key: draftKey() }), {
    equals: (previous, next) => previous?.key === next.key,
  })

  onSettled(() => subscribeDraftCompletionEnabled(() => setPredict(getDraftCompletionEnabled())))
  const completion = createMemo(() => predict()
    ? createDraftCompletionRequest(props.chat.currentSessionId, props.chat.messages)
    : undefined)

  const addFiles = async (files: FileList | File[]) => {
    const identity = draftIdentity()
    const images = Array.from(files).filter((file) => file.type.startsWith("image/"))
    if (!images.length) return
    try {
      const converted = await Promise.all(images.map(fileToAttachment))
      if (draftIdentity() === identity) changeAttachments((current) => [...current, ...converted])
    } catch (error) {
      console.error("[solid-composer] Could not attach image:", error)
    }
  }

  const send = async () => {
    const key = draftKey()
    const draft = appStore.getState().getInputState(key)
    const images = attachments()
    const submittedAttachmentRevision = attachmentRevision
    const useQueue = queuedSend()
    const payload = images.length ? images.map(({ base64, name, size, type }) => ({ base64, name, size, type })) : undefined
    if ((!draft.content.trim() && !images.length) || (!useQueue && props.chat.sending) ||
      props.chat.submissionPending || active || blocked() || queue.busy || commands.busy) return
    active = true
    setSubmitting(true)
    const sessionCreated = props.captureSessionCreated()
    const origin = worktree.capture()
    const submission = {
      projectId: props.projectId,
      workspacePath: props.workspacePath,
      images: payload,
      permissionMode: key === "" ? newSessionPermissionStore.getState().mode : undefined,
      rootOrchestrationOnly: key === ""
        ? (draft.thinkingMode !== undefined ? draft.thinkingMode === "ultra" : models.requestValue)
        : undefined,
      thinkingMode: key === "" ? draft.thinkingMode : undefined,
      reasoningSelection: key === "" ? draft.reasoningEffort : undefined,
    }
    try {
      const verdict = commands.handleSubmit(draft)
      if (verdict !== "pass") {
        if (await verdict !== "pass" || !origin.isCurrent() || blocked() ||
          draft.contentRevision !== appStore.getState().getInputState(key).contentRevision ||
          attachmentRevision !== submittedAttachmentRevision) return
      }
      const selectedSkill = commands.selectedSkill
      if (origin.prepare) {
        try { submission.workspacePath = await origin.prepare() }
        catch { return }
        if (!origin.isCurrent()) return
      }
      const result = useQueue ? await queue.send(draft.content, payload) : await props.chat.send(draft.content, {
        ...submission,
        skillIds: selectedSkill ? [selectedSkill.id] : undefined,
        isOriginCurrent: origin.prepare ? origin.isCurrent : undefined,
      })
      if (result.kind !== "accepted") return
      if (!key && submission.projectId) sessionCreated(result.sessionId)
      if (origin.prepare && (!origin.viewerIsCurrent() || (!result.navigated && !origin.isCurrent()))) return
      if (selectedSkill) commands.clearSkill(selectedSkill)
      if (attachmentRevision === submittedAttachmentRevision) changeAttachments(() => [])
      const latest = appStore.getState()
      const cleared = latest.setInputContentIfRevision(key, draft.contentRevision, "")
      if (!cleared && result.navigated && key !== result.sessionId) {
        latest.moveInputContentIfRevision(key, latest.inputStates[key]?.contentRevision ?? 0, result.sessionId)
      }
      if (result.navigated && key !== result.sessionId) {
        if (draft.thinkingModeRevision !== undefined) latest.clearInputThinkingModeIfRevision(key, draft.thinkingModeRevision)
        if (latest.inputStates[key]?.reasoningEffort === draft.reasoningEffort) latest.clearInputReasoningEffort(key)
      }
    } catch (error) {
      console.error("[solid-composer] Submission failed:", error)
    } finally {
      active = false
      setSubmitting(false)
    }
  }

  return (
    <div data-composer-column="" class="mx-auto w-full max-w-4xl px-3 pb-3 sm:px-6">
      <Show when={props.chat.sendFailure}>
        {(failure) => <div role="alert" class="mb-2 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {failure().message || text("submission_is_unconfirmed_refresh_or_retry_the_last_sub_f3127c94")}
        </div>}
      </Show>
      <GuidanceQueueControls sessionId={props.chat.currentSessionId} queue={queue} onPreview={props.onPreviewImage} />
      <div class="min-w-0 rounded-3xl border bg-background p-2"
        onDragOver={(event) => {
          if (event.dataTransfer?.types.includes("Files")) event.preventDefault()
        }}
        onDrop={(event) => {
          if (!event.dataTransfer?.files.length) return
          event.preventDefault()
          void addFiles(event.dataTransfer.files)
        }}>
        <Show when={attachments().length}>
          <div class="flex flex-wrap gap-2 px-2 py-1.5">
            <For each={attachments()}>{(attachment) => (
              <div class="relative">
                <button type="button" onClick={() => props.onPreviewImage(attachment.url)}
                  class="overflow-hidden rounded-lg border">
                  <img class="size-16 object-cover" src={attachment.url} alt={attachment.name} />
                </button>
                <button type="button" aria-label={text("remove_image_86d72aab")}
                  class="absolute right-0 top-0 rounded-full bg-background p-1"
                  onClick={() => changeAttachments((current) => current.filter((item) => item !== attachment))}>
                  <X class="size-3.5" />
                </button>
              </div>
            )}</For>
          </div>
        </Show>
        <ComposerCommandMenus commands={commands} />
        <Show when={draftIdentity()} keyed>
          {(entry) => {
            const previous = focusSnapshots.get(entry.key) ?? { current: null }
            focusSnapshots.set(entry.key, previous)
            return <ComposerEditor
              id={inputId}
              value={value()}
              busy={submitting() || props.chat.submissionPending || queue.busy || commands.busy}
              label={text("messages_4da199fa")}
              title={text("enter_to_send_shift_enter_for_a_new_line_b6153e81")}
              placeholder={text(queuedSend() ? "type_a_message_to_add_to_the_queue_38c6f67b" : "send_a_message_ae2f86f0")}
              inputRef={commands.setInputRef}
              mentionsEnabled={Boolean(mentionWorkspace())}
              mentionScope={mentionWorkspace()}
              onChange={(content) => appStore.getState().setInputContent(entry.key, content)}
              onSubmit={() => { void send() }}
              onAddFiles={(files) => { void addFiles(files) }}
              onSuggestionChange={commands.setFileSuggestion}
              focusSnapshot={previous}
              requestDraftCompletion={completion()}
            />
          }}
        </Show>
        <div data-composer-toolbar="" class="flex flex-wrap items-center gap-1">
          <input ref={(element) => { filePicker = element }} type="file" multiple accept="image/*" hidden onChange={(event) => {
            if (event.currentTarget.files) void addFiles(event.currentTarget.files)
            event.currentTarget.value = ""
          }} />
          <Button type="button" variant="ghost" size="icon" aria-label={text("add_images_9f0d4e46")}
            onClick={() => filePicker.click()}>
            <ImagePlus class="size-4" />
          </Button>
          <Show when={draftKey() === ""}>
            <NewChatWorktreeControl projectId={props.projectId} workspacePath={props.workspacePath}
              value={worktree.selection} onChange={worktree.select} automatic={worktree.automatic}
              disabled={worktree.locked || submitting() || props.chat.submissionPending}
              preparedPath={worktree.preparedPath} error={worktree.error} />
            <Show when={worktree.busy}><span role="status" class="px-2 text-xs text-muted-foreground">
              {text("chat_worktree_preparing")}
            </span></Show>
          </Show>
          <Show when={props.chat.currentSessionId} keyed fallback={<NewSessionPermissionControl />}>
            {(id) => <PermissionModeControl sessionId={id} title={props.chat.currentChat?.title || id} />}
          </Show>
          <ComposerModelControls controls={models} />
          <div class="flex-1" />
          <Show when={queuedSend()}><GuidanceTimingControl queue={queue} disabled={blocked() || submitting()} /></Show>
          <Show when={running() || props.chat.sending}>
            <Button size="icon" class="rounded-full" type="button"
              aria-label={text("stop_ca4d973c")} onClick={() => { void props.chat.stop() }}>
              <Square class="size-3.5" />
            </Button>
          </Show>
          <Show when={!props.chat.sending || queuedSend()}>
            <Button size="icon" class="rounded-full" type="button"
              aria-label={text(queuedSend() ? "add_to_queue_bc3b684c" : "send_message_00881483")}
              disabled={!props.chat.booted || (!value().trim() && !attachments().length) ||
                blocked() || submitting() || props.chat.submissionPending || queue.busy || commands.busy}
              onClick={() => { void send() }}>
              <ArrowUp />
            </Button>
          </Show>
        </div>
      </div>
    </div>
  )
}
