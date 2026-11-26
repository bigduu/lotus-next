import { ArrowUp, ChevronDown, Ellipsis, FolderGit2, LoaderCircle, Paperclip, Square, X } from "@lucide/solid"
import { createEffect, createMemo, createSignal, createUniqueId, For, lazy, Loading, onSettled, Show, untrack } from "solid-js"
import { appStore } from "@shared/store/appStore/state"
import { newSessionPermissionStore } from "@shared/store/newSessionPermissionState"
import { createDraftCompletionRequest } from "@services/chat/draftCompletion"
import { isSessionLoopCommand } from "@services/chat/sessionLoop"
import { getDraftCompletionEnabled, subscribeDraftCompletionEnabled } from "@shared/store/draftCompletionPreferenceState"
import type { SideChatIntent } from "@/lib/sideChatIntent"
import { fileToAttachment, type ChatImageAttachment } from "@/lib/chatImageAttachments"
import { peekPendingTemplatePrompt } from "@/lib/taskTemplates"
import { getRootModeFenceState } from "@/lib/rootModeTransitionState"
import { Button } from "../ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover"
import { DialogLayerMount } from "../ui/layer-scope"
import { composerControlClassName, composerIconButtonClassName } from "@/lib/composer/composerStyles"
import { createStoreSelector } from "../state/createStoreSelector"
import type { ComposerFocusSnapshot } from "../composer/ComposerEditor"
import { isSessionExecutionBlocked } from "@services/chat/sessionExecutionCompatibility"
import { createGuidanceQueue } from "./guidance/createGuidanceQueue"
import { GuidanceQueueControls, GuidanceTimingControl } from "./guidance/GuidanceQueueControls"
import type { createRootModeAuthority } from "./model/createRootModeAuthority"
import type { createTicketIngress } from "./createTicketIngress"
import { createComposerModelControls } from "./model/createComposerModelControls"
import { ComposerModelControls } from "./model/ComposerModelControls"
import { createUiLocale, createUiText } from "../shell/uiText"
import type { createChat } from "./createChat"
import { createComposerCommands } from "./commands/createComposerCommands"
import { ComposerCommandMenus } from "./commands/ComposerCommandMenus"
import { NewChatProjectControl, NewChatPromptControl } from "./ComposerDraftControls"
import { NewSessionPermissionControl, PermissionModeControl } from "./permissions/PermissionModeControl"
import { createNewChatWorktree } from "../workspace/createNewChatWorktree"
import { NewChatWorktreeControl } from "../workspace/NewChatWorktreeControl"
import { WorktreePreparationNotice } from "../workspace/WorktreePreparationNotice"
import { ContextCompressionNotice } from "./compact/ContextCompressionNotice"
import { ContextUsageRing } from "./compact/ContextUsageRing"
import { ChatRunStatus } from "./status/ChatRunStatus"
import { transcriptWorkWait } from "./status/transcriptWorkWait"
import { createLiveBootstrapRetry } from "./status/live-retry/createLiveBootstrapRetry"
import { useComposerDraftOrigin } from "../bootstrap/composerDraftOrigin"
import { createComposerDraftRecovery, type ComposerDraftMode } from "./createComposerDraftRecovery"
import { LiveBootstrapRetryNotice } from "./status/live-retry/LiveBootstrapRetryNotice"

type Chat = ReturnType<typeof createChat>
const ComposerEditor = lazy(() => import("../composer/ComposerEditor"), { export: "ComposerEditor" })

export function ComposerPanel(props: {
  chat: Chat
  workspacePath: string | null
  setupNeedsModel?: boolean
  inputId?: string
  projectId: string | null
  onSelectProject: (id: string | null) => void
  selectedWorktreePath: string | null
  draftEpoch: number
  navigationVersion: () => number
  onOpenWorkspacePicker: () => void
  onOpenGoal: (sessionId: string) => void
  onOpenWorkflowRuns: (sessionId: string) => void
  onOpenSideChat?: (intent?: SideChatIntent) => void
  rootAuthority: ReturnType<typeof createRootModeAuthority>
  ingress: ReturnType<typeof createTicketIngress>
  semantic: boolean
  draftRecoveryMode: ComposerDraftMode
  reference: { work_id: string; id: string; title: string } | null
  onClearReference: () => void
  canSendIngress: boolean
  captureSessionCreated: () => (sessionId: string) => void
  onPreviewImage: (url: string) => void
  onAttachmentsChange?: (attachments: readonly ChatImageAttachment[]) => void
  registerImageDrop?: (handler: ((files: FileList) => void) | null) => void
  onSubmitMessage?: () => void
  onModelFailureChange?: (active: boolean) => void
  pageVisible?: boolean
}) {
  const text = createUiText()
  const locale = createUiLocale()
  let column!: HTMLDivElement
  let surface!: HTMLDivElement
  const [compactToolbar, setCompactToolbar] = createSignal(false)
  const [moreOpen, setMoreOpen] = createSignal(false)
  const [moreLayer, setMoreLayer] = createSignal<HTMLDivElement | undefined>(undefined, { ownedWrite: true })
  const draftKey = () => props.chat.currentSessionId ?? ""
  const draftRecovery = createComposerDraftRecovery(
    useComposerDraftOrigin(),
    () => props.chat.currentSessionId,
    () => props.rootAuthority.isRoot && !props.rootAuthority.unsafe ? props.rootAuthority.authority?.birthToken : undefined,
    () => props.reference ? "work" : props.draftRecoveryMode,
  )
  const focusEditor = () => {
    if (props.pageVisible !== false) surface.querySelector<HTMLElement>('[data-composer-editor][contenteditable="true"]')?.focus()
  }
  createEffect(draftKey, () => { setMoreOpen(false) })
  onSettled(() => {
    let focusFrame: number | undefined
    const measure = () => {
      const width = column.clientWidth
      if (!width) return
      const compact = width < 600
      if (!compact && moreOpen()) {
        const key = draftKey()
        setMoreOpen(false)
        if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
        focusFrame = requestAnimationFrame(() => {
          if (draftKey() === key && !compactToolbar()) focusEditor()
        })
      }
      setCompactToolbar(compact)
    }
    const observer = new ResizeObserver(measure)
    observer.observe(column)
    measure()
    return () => {
      observer.disconnect()
      if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    }
  })
  const inputs = createStoreSelector(appStore, (state) => state.inputStates)
  const usage = createStoreSelector(appStore, (state) => {
    const id = props.chat.currentSessionId
    return id ? state.tokenUsages[id] ?? props.chat.currentChat?.config?.tokenUsage : undefined
  })
  const value = () => inputs()[draftKey()]?.content ?? ""
  const monitoredCommand = () => transcriptWorkWait(props.chat).monitoredCommand
  const running = () => props.chat.currentChat?.isRunning === true
    || (props.chat.sending && props.chat.streaming !== null) || monitoredCommand()
  const liveRetry = createLiveBootstrapRetry({
    sessionId: () => props.chat.currentSessionId,
    running,
    root: () => props.rootAuthority.isRoot,
  })
  const rootControlsBlocked = () => {
    const id = props.chat.currentSessionId
    return props.rootAuthority.unsafe || Boolean(id && getRootModeFenceState(id) !== "clear")
  }
  const worktree = createNewChatWorktree({
    sessionId: () => props.chat.currentSessionId,
    projectId: () => props.projectId,
    workspacePath: () => props.workspacePath,
    existingPath: () => props.selectedWorktreePath,
    draftEpoch: () => props.draftEpoch,
    navigationVersion: props.navigationVersion,
  })
  const [worktreeNotice, setWorktreeNotice] = createSignal<{ message: string; isCurrent: () => boolean } | null>(null)
  const queue = createGuidanceQueue(() => props.chat.currentSessionId, running)
  const queuedSend = () => !props.semantic && Boolean(props.chat.currentSessionId && (running() || queue.hasUnconfirmed))
  const interactionBlocked = () => Boolean(props.chat.pendingQuestion || props.chat.pendingApproval ||
    props.chat.executionCompatibility.blocked || isSessionExecutionBlocked(props.chat.currentSessionId))
  const [predict, setPredict] = createSignal(getDraftCompletionEnabled())
  const [submitting, setSubmitting] = createSignal(false)
  let active = false
  const [attachments, setAttachments] = createSignal<ChatImageAttachment[]>([])
  createEffect(attachments, (current) => { props.onAttachmentsChange?.(current) })
  const [commandNotice, setCommandNotice] = createSignal<{ key: string; message: string } | null>(null)
  let attachmentRevision = 0
  const models = createComposerModelControls({
    chat: props.chat,
    draftKey,
    root: props.rootAuthority,
    disabled: () => interactionBlocked() || running() || submitting() || props.chat.submissionPending ||
      queue.busy || queue.hasUnconfirmed || props.ingress.busy || props.ingress.pending || commands.busy,
  })
  createEffect(() => [draftKey(), props.pageVisible !== false && models.modelError !== null] as const,
    ([, active]) => { props.onModelFailureChange?.(active) })
  const submissionUnavailable = () => props.setupNeedsModel || interactionBlocked() || models.busy ||
    (props.semantic && (!props.canSendIngress || props.ingress.busy || props.ingress.activationPending))
  const blocked = () => submissionUnavailable() || models.rootAdmissionBlocked
  const inputId = untrack(() => props.inputId) ?? createUniqueId()
  const mentionWorkspace = () => worktree.preparedPath ?? props.workspacePath
  const workspaceLabel = () => {
    const path = mentionWorkspace()
    return path ? path.split(/[\\/]/).filter(Boolean).at(-1) || path : text("select_working_directory_18240aa3")
  }
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
    compactionWait: () => active || submitting() || models.busy || props.ingress.busy || props.ingress.pending,
    thinkingMode: () => models.thinkingMode,
    extraSessionRestricted: () => models.root.child || props.semantic,
    openGoal: props.onOpenGoal,
    openWorkflowRuns: props.onOpenWorkflowRuns,
    openSideChat: () => props.onOpenSideChat,
  })
  const sideChatCommand = () => commands.isSideChatCommand(value())
  const loopDraft = () => isSessionLoopCommand(value())
  const submissionPending = () => submitting() || props.chat.submissionPending || queue.busy || commands.busy
    || models.busy || (props.semantic && props.ingress.busy)
  let filePicker!: HTMLInputElement
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
  onSettled(() => {
    const register = props.registerImageDrop
    if (!register) return
    register((files) => { void addFiles(files) })
    return () => register(null)
  })

  const send = async () => {
    const key = draftKey()
    const draft = appStore.getState().getInputState(key)
    const suppressDraftSubmission = draftRecovery.captureSubmission()
    if (commands.handleSideChat(draft) || commands.handleCompact(draft)) return
    const images = attachments()
    const submittedAttachmentRevision = attachmentRevision
    const useQueue = queuedSend()
    const semantic = props.semantic
    const payload = images.length ? images.map(({ base64, name, size, type }) => ({ base64, name, size, type })) : undefined
    if ((!draft.content.trim() && !images.length) || (!semantic && !useQueue && props.chat.sending) ||
      props.chat.submissionPending || active || submissionUnavailable() || queue.busy || commands.busy) return
    if (models.rootAdmissionBlocked) {
      setCommandNotice({ key, message: text("the_root_permission_change_is_unconfirmed_sending_and_e_a75a6b4f") })
      return
    }
    active = true
    setSubmitting(true)
    setCommandNotice(null)
    const reference = props.reference
    const sessionCreated = props.captureSessionCreated()
    const origin = worktree.capture()
    const submission = {
      projectId: props.projectId,
      workspacePath: props.workspacePath,
      images: payload,
      templatePrompt: key === "" ? peekPendingTemplatePrompt() : null,
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
          semantic !== props.semantic || useQueue !== queuedSend() || draft.contentRevision !== appStore.getState().getInputState(key).contentRevision ||
          attachmentRevision !== submittedAttachmentRevision) return
      }
      const selectedSkill = commands.selectedSkill
      if (semantic && selectedSkill) {
        setCommandNotice({ key, message: text("ticket_enter_ticket_instructions_directly_in_the_mes_2bddd839") })
        return
      }
      if (origin.prepare) {
        try { submission.workspacePath = await origin.prepare() }
        catch {
          if (origin.isCurrent()) setWorktreeNotice({
            message: worktree.error ?? text("chat_worktree_prepare_failed"),
            isCurrent: origin.isCurrent,
          })
          return
        }
        if (!origin.isCurrent()) return
      }
      let liveBootstrapResume = false
      if (!(semantic && key) && !useQueue) {
        const negotiated = liveRetry.prepareInitial()
        if (typeof negotiated === "boolean") liveBootstrapResume = negotiated
        else {
          liveBootstrapResume = await negotiated
          const draftChanged = draft.contentRevision !== appStore.getState().getInputState(key).contentRevision ||
            attachmentRevision !== submittedAttachmentRevision
          // Worktree preparation already committed to a frozen request. New
          // edits stay in the composer while that request proceeds.
          if (!origin.isCurrent() || blocked() || semantic !== props.semantic || useQueue !== queuedSend() ||
            (!origin.prepare && draftChanged)) return
        }
      }
      if (origin.isCurrent()) props.onSubmitMessage?.()
      const finishDraftSubmission = suppressDraftSubmission(draft.contentRevision)
      const result = semantic && key
        ? await props.ingress.send({
            session_id: key,
            message: draft.content.trim(),
            model: props.chat.currentChat?.config?.model ?? "",
            model_ref: props.chat.currentChat?.config?.model_ref ?? undefined,
            images: payload,
            ...(reference ? { thread_id: reference.work_id, in_reply_to: reference.id } : {}),
          }, () => origin.isCurrent() && props.semantic && props.canSendIngress)
        : useQueue ? await queue.send(draft.content, payload) : await props.chat.send(draft.content, {
        ...submission,
        skillIds: selectedSkill ? [selectedSkill.id] : undefined,
        isOriginCurrent: origin.prepare ? origin.isCurrent : undefined,
        ...(liveBootstrapResume ? { liveBootstrapResume: true } : {}),
      })
      finishDraftSubmission(result.kind !== "accepted" && result.kind !== "unconfirmed")
      if (result.kind === "unconfirmed" && origin.isCurrent()) focusEditor()
      if (result.kind !== "accepted") return
      if (!key && submission.projectId) sessionCreated(result.sessionId)
      if (origin.prepare && (!origin.viewerIsCurrent() || (!result.navigated && !origin.isCurrent()))) return
      if (reference && origin.isCurrent() && props.reference?.id === reference.id) props.onClearReference()
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
      if (origin.isCurrent()) focusEditor()
    } finally {
      active = false
      setSubmitting(false)
    }
  }

  const secondaryControls = () => (
    <div class="flex min-w-0 max-w-full flex-wrap items-center gap-1" data-composer-secondary-controls="">
      <Button type="button" variant="ghost" size="icon" class={composerIconButtonClassName}
        aria-label={text("add_images_9f0d4e46")} onClick={() => filePicker.click()}>
        <Paperclip class="size-4" />
      </Button>
      <Show when={draftKey() === ""}>
        <NewChatProjectControl projectId={props.projectId} onSelect={props.onSelectProject} />
        <NewChatWorktreeControl projectId={props.projectId} workspacePath={props.workspacePath}
          showWorkspaceName={Boolean(props.projectId && !props.selectedWorktreePath)}
          value={worktree.selection} onChange={worktree.select} automatic={worktree.automatic}
          disabled={worktree.locked || submitting() || props.chat.submissionPending}
          preparedPath={worktree.preparedPath} error={worktree.error} />
        <Show when={!props.projectId || props.selectedWorktreePath || worktree.preparedPath}>
          <button type="button" class={composerControlClassName}
            title={mentionWorkspace() || text("default_working_directory_3d80c40d")}
            onClick={() => { setMoreOpen(false); props.onOpenWorkspacePicker() }}>
            <FolderGit2 class="size-4 shrink-0" />
            <span class="truncate">{workspaceLabel()}</span>
            <ChevronDown class="size-3 shrink-0 opacity-60" />
          </button>
        </Show>
        <Show when={worktree.busy}><span role="status" class="px-2 text-xs text-muted-foreground">
          {text("chat_worktree_preparing")}
        </span></Show>
        <NewChatPromptControl />
      </Show>
    </div>
  )

  return (
    <div ref={(element) => { column = element }} data-composer-region="" data-composer-column=""
      data-composer-compact={String(compactToolbar())}
      class="relative mx-auto w-[calc(100%-1.5rem)] min-w-0 max-w-6xl shrink-0 pb-3 pt-1">
      <ContextCompressionNotice feedback={props.pageVisible === false ? null : props.chat.contextCompression}
        sessionId={props.pageVisible !== false && props.chat.currentChat?.kind === "root" ? props.chat.currentSessionId : null}
        manualPending={commands.compactPending} runActive={running()} />
      <Show when={props.pageVisible !== false}>
        <Show when={worktreeNotice()?.isCurrent() && worktreeNotice()} keyed>
          {(notice) => <WorktreePreparationNotice message={notice.message}
            onDismiss={() => setWorktreeNotice(null)} onRestoreFocus={focusEditor} />}
        </Show>
        <Show when={commands.selectedSkill && models.thinkingMode === "ultra" && !models.root.child}>
          <p role="alert" class="mx-2 mb-2 text-xs text-destructive">
            {text("the_selected_skill_is_incompatible_with_ultra_orchestra_fd2e7fa6")}
          </p>
        </Show>
        <ChatRunStatus chat={props.chat} rootUnsafe={props.rootAuthority.unsafe}
          retryDisabled={models.busy || submitting() || queue.busy || commands.busy || props.ingress.busy}
          onContinueEditing={() => document.getElementById(inputId)?.focus()} />
        <LiveBootstrapRetryNotice offer={liveRetry.offer}
          disabled={props.chat.executionCompatibility.blocked || props.rootAuthority.unsafe || models.busy}
          onConfirm={() => {
            if (!rootControlsBlocked() && !models.busy && !isSessionExecutionBlocked(props.chat.currentSessionId)) void liveRetry.confirm()
          }}
          onStop={() => { void liveRetry.stop() }}
          onRefresh={() => { if (!rootControlsBlocked()) void liveRetry.refresh() }} />
      </Show>
      <Show when={!props.semantic}>
        <GuidanceQueueControls sessionId={props.chat.currentSessionId} queue={queue} onPreview={props.onPreviewImage} />
      </Show>
      <Show when={props.semantic && props.reference}>
        {(reference) => <div class="mx-2 mb-2 flex items-center gap-2 text-xs" data-testid="ticket-reference">
          <span>{text("ticket_reference", { title: reference().title })}</span>
          <button type="button" class="underline" disabled={props.ingress.pending} onClick={props.onClearReference}>
            {text("ticket_clear_reference_b2e538a2")}
          </button>
        </div>}
      </Show>
      <Show when={props.semantic && props.ingress.starting}>
        <p role="status" class="mx-2 mb-2 text-xs text-muted-foreground">{text("ticket_starting")}</p>
      </Show>
      <Show when={props.semantic && !props.ingress.starting && (props.ingress.error || props.ingress.pending && !props.ingress.busy)}>
        <div role="alert" class="mx-2 mb-2 text-xs text-destructive">
          {props.ingress.error ?? text("ticket_the_previous_message_is_not_confirmed_retry_w_7369504e")}
          <Show when={props.ingress.canRetryStart}>
            <button type="button" class="ml-2 underline" onClick={() => void props.ingress.retryExecute()}>
              {text("ticket_retry_start_47d5cd3e")}
            </button>
          </Show>
        </div>
      </Show>
      <Show when={commandNotice()?.key === draftKey()}><p role="alert" class="mx-2 mb-2 text-xs text-destructive">
        {commandNotice()?.message}
      </p></Show>
      <div ref={(element) => { surface = element }} data-composer-surface=""
        class="min-w-0 rounded-3xl border border-transparent bg-card p-1.5">
        <Show when={attachments().length}>
          <div data-composer-attachments=""
            class="flex max-h-[clamp(5.25rem,calc(35dvh-2rem),16rem)] flex-wrap content-start gap-2 overflow-y-auto overscroll-contain scroll-py-1 px-2 py-1.5">
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
        <Loading fallback={<div data-composer-editor="" aria-hidden="true" class="min-h-11 w-full px-2 py-2 text-base" />}>
        <Show when={draftIdentity()} keyed>
          {(entry) => {
            const previous = focusSnapshots.get(entry.key) ?? { current: null }
            focusSnapshots.set(entry.key, previous)
            return <ComposerEditor
              id={inputId}
              value={value()}
              busy={submissionPending()}
              label={text("messages_4da199fa")}
              title={text("enter_to_send_shift_enter_for_a_new_line_b6153e81")}
              placeholder={text(queuedSend() ? "type_a_message_to_add_to_the_queue_38c6f67b" : "send_a_message_ae2f86f0")}
              inputRef={commands.setInputRef}
              mentionsEnabled={Boolean(mentionWorkspace())}
              mentionScope={mentionWorkspace()}
              onChange={(content) => {
                draftRecovery.noteEditorInput(entry.key, content)
                appStore.getState().setInputContent(entry.key, content)
              }}
              onSubmit={() => { void send() }}
              onAddFiles={(files) => { void addFiles(files) }}
              onSuggestionChange={commands.setFileSuggestion}
              focusSnapshot={previous}
              requestDraftCompletion={completion()}
            />
          }}
        </Show>
        </Loading>
        <div data-composer-toolbar="" class="flex flex-wrap items-center gap-1">
          <input ref={(element) => { filePicker = element }} type="file" multiple accept="image/*" hidden onChange={(event) => {
            if (event.currentTarget.files) void addFiles(event.currentTarget.files)
            event.currentTarget.value = ""
          }} />
          <div class="flex min-w-0 flex-wrap items-center gap-1"
            style={{ flex: compactToolbar() ? "1 0 100%" : "1 1 auto" }}>
            <Show when={props.chat.currentSessionId} keyed fallback={<NewSessionPermissionControl />}>
              {(id) => <PermissionModeControl sessionId={id} title={props.chat.currentChat?.title || id} />}
            </Show>
            <Show when={compactToolbar()} fallback={secondaryControls()}>
              <Popover placement="top-start" open={moreOpen()} onOpenChange={setMoreOpen}>
                <PopoverTrigger as={Button} type="button" variant="ghost" size="icon" class={composerIconButtonClassName}
                  aria-label={text("more_38844b13")} title={text("more_38844b13")}>
                  <Ellipsis class="size-4" />
                </PopoverTrigger>
                <PopoverContent ref={setMoreLayer} aria-label={text("more_38844b13")} class="max-w-[calc(100vw-24px)]">
                  <DialogLayerMount value={moreLayer}>{secondaryControls()}</DialogLayerMount>
                </PopoverContent>
              </Popover>
            </Show>
            <Show when={typeof props.chat.outputRate === "number"}>
              <span data-output-rate="" class="ml-auto max-w-28 min-w-0 truncate text-xs tabular-nums text-muted-foreground"
                title={text("estimated_from_streamed_text_not_used_for_billing_1de5fc8d")}>
                {text("output_rate", { rate: props.chat.outputRate?.toLocaleString(locale(), { minimumFractionDigits: 1, maximumFractionDigits: 1 }) })}
              </span>
            </Show>
          </div>
          <div class="ml-auto flex max-w-full flex-wrap items-center justify-end gap-1">
            <ContextUsageRing usage={usage()} onClick={() => {
              const id = props.chat.currentSessionId
              if (id) props.onOpenGoal(id)
            }} />
            <ComposerModelControls controls={models} onRestoreFocus={focusEditor} />
            <Show when={queuedSend() && !loopDraft()}><GuidanceTimingControl queue={queue} compact={compactToolbar()} disabled={blocked() || submitting()} /></Show>
            <Show when={running() || (props.chat.sending && !props.chat.submissionPending)}>
              <Button size="icon" class="size-8 rounded-full" type="button"
                aria-label={text(monitoredCommand() ? "stop_background_command" : "stop_generation_9ad0aac3")}
                disabled={props.chat.backgroundCommandStopStatus === "stopping"} onClick={() => {
                  if (!monitoredCommand()) liveRetry.cancelForStop()
                  void props.chat.stop()
                }}>
                <Square class="size-4" fill="currentColor" />
              </Button>
            </Show>
            <Show when={!submissionPending()} fallback={
              <Button size="icon" class="size-8 rounded-full" type="button" disabled
                aria-label={text("sending_2d88d503")}>
                <LoaderCircle class="size-4 motion-safe:animate-spin" aria-hidden="true" />
              </Button>
            }>
              <Show when={!props.chat.sending || queuedSend() || props.semantic || sideChatCommand() || loopDraft()}>
                <Button size="icon" class="size-8 rounded-full" type="button"
                  aria-label={text(queuedSend() && !sideChatCommand() && !loopDraft() ? "add_to_queue_bc3b684c" : "send_message_00881483")}
                  disabled={!props.chat.booted || (!value().trim() && !attachments().length) ||
                    (!sideChatCommand() && submissionUnavailable())}
                  onClick={() => { void send() }}>
                  <ArrowUp />
                </Button>
              </Show>
            </Show>
          </div>
        </div>
      </div>
    </div>
  )
}
