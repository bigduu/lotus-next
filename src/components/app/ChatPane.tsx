import { LiveBootstrapRetryNotice } from "@/components/chat/LiveBootstrapRetryNotice"
import { backgroundExecWaitActive } from "@/components/chat/runtimeNotices"
import { useLiveBootstrapRetry } from "@/hooks/useLiveBootstrapRetry"
import { useSessionDrop } from "@/hooks/useSessionDrop"
import type { ComposerInputHandle } from "@/components/chat/ComposerEditor"
import { uiLanguage, uiText, useUiLocale } from "@shared/i18n/ui"
import { useMarkSessionRead } from "@/lib/sessionReadState"
import { useRenderProbe } from "@/lib/renderProbe"
import { recordSessionUserInput } from "@/lib/sidebarSessionOrder"
import { isTerminalRunStatus } from "@shared/store/appStore/slices/executionStateSlice"
import { lazy, Suspense, useCallback, useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  ChevronDown,
  ChevronLeft,
  RotateCcw,
  Download,
  FileDown,
  BookText,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import { workspaceService } from "@services/workspace"
import type { WorkspaceFileEntry } from "@services/workspace/types"
import { QuestionDialog, ChildApprovalCard } from "@/components/chat/Dialogs"
import { downloadMarkdown } from "@/lib/exportMarkdown"
import { downloadPdf } from "@/lib/exportPdf"
import type { useChat } from "@/hooks/useChat"
import { useContainerWidth } from "@/hooks/useContainerWidth"
import { useStickyScroll } from "@/hooks/useStickyScroll"
import { useRootOrchestrationMode } from "@/hooks/useRootOrchestrationMode"
import { useRootThinkingMode } from "@/hooks/useRootThinkingMode"
import { getRootModeFenceState } from "@/lib/rootModeTransitionFence"
import { useAppStore, selectChildren } from "@shared/store/appStore"
import { agentClient } from "@services/chat/AgentService"
import { isGoalResumeCommand } from "@services/chat/goalCommand"
import { isSessionLoopCommand, parseSessionLoopCommand, type SessionLoopCommand, type SessionLoopMode, type SessionLoopState, type SessionLoopStatus } from "@services/chat/sessionLoop"
import { getApiErrorCode, getErrorMessage, isApiError } from "@services/api/errors"
import { tokenBudgetRevision } from "@shared/store/appStore/slices/tokenBudgetSlice"
import { mapTokenBudgetUsage } from "@shared/types/tokenBudget"
import { useSubAgentView } from "@/hooks/useSubAgentView"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import { getRuntimeModelIds, resolveNewChatModelRef } from "@shared/types/providerConfig"
import type { ProviderModelRef } from "@shared/types/providerModelRef"
import type { ReasoningEffortSelection } from "@shared/utils/reasoningEffort"
import type { SkillDefinition } from "@shared/types/skill"
import { ChatHeader } from "@/components/app/ChatHeader"
import {
  EnvironmentCard,
  EnvironmentLauncher,
  type EnvironmentSource,
} from "@/components/app/RightPanelLauncher"
import { HomeDashboard } from "@/components/app/HomeDashboard"
import { MessageList } from "@/components/app/MessageList"
import { useGuidanceQueue } from "@/hooks/useGuidanceQueue"
import { useTicketWork } from "@/hooks/useTicketWork"
import { useTicketIngress } from "@/hooks/useTicketIngress"
import { TicketWorkAvailability } from "@/components/chat/TicketWorkAvailability"
import { LazyTicketWorkPanel } from "@/components/chat/LazyTicketWorkPanel"
import { SupervisorOverview } from "@/components/chat/SupervisorOverview"
import type { OpenRecordedSession } from "@/components/chat/SupervisorApprovalCards"
import { usePermissionTimeline, useSupervisorApprovalTimeline } from "@/hooks/useApprovalTimeline"
import { isDefaultSupervisor } from "@/lib/supervisor"
import type { PendingRequest as TicketRequest } from "@services/tickets/types"
import { SessionGuidance } from "@/components/app/SessionGuidance"
import { Composer } from "@/components/app/Composer"
import { Toasts, type ToastNotice } from "@/components/app/Toasts"
import { ImageLightbox } from "@/components/app/ImageLightbox"
import { peekPendingTemplatePrompt } from "@/lib/taskTemplates"
import { ContextUsageRing } from "@/components/app/ContextUsageRing"
import { ContextCompressionNotice } from "@/components/app/ContextCompressionNotice"
import { ModelEffortPicker } from "@/components/chat/ModelEffortPicker"
import { NewSessionPermissionControl, PermissionModeControl } from "@/components/chat/PermissionModeControl"
import { RootOrchestrationControl } from "@/components/chat/RootOrchestrationControl"
import { WorkflowRunsDialog } from "@/components/chat/WorkflowRunsDialog"
import { SessionTaskDag } from "@/components/chat/SessionTaskDag"
import { ConversationClearDialog } from "@/components/chat/ConversationClearDialog"
import type { SessionPermissionMode } from "@services/chat/AgentService"
import { useNewSessionPermission } from "@shared/store/newSessionPermission"
import {
  collectLiveSessionFileChanges,
  collectSessionFileChanges,
  groupSessionFileChanges,
  mergeSessionFileChanges,
  summarizeSessionFileChangeGroups,
  type SessionFileChangeSummary,
} from "@/lib/sessionFileChanges"
import { describeRunFailure } from "@/lib/runFailureGuidance"
import { extractDiagnosticId, type RunDiagnosticsSubject } from "@/lib/runDiagnosticId"
import { RunDiagnosticsEntry } from "@/components/chat/RunDiagnosticsEntry"
import { SessionCompatibilityNotice } from "./SessionCompatibilityNotice"
import { isSessionExecutionBlocked, observeSessionExecutionConflict } from "@services/chat/sessionExecutionCompatibility"
import { NewChatWorktreePreparation, NewChatWorktreePreparationError } from "@services/workspace/newChatWorktreePreparation"

const NewChatWorktreeControl = lazy(() => import("@/components/app/NewChatWorktreeControl").then((module) => ({ default: module.NewChatWorktreeControl })))

function worktreeErrorMessage(error: NewChatWorktreePreparationError | null) {
  if (!error) return null
  switch (error.kind) {
    case "invalid": return uiText("chat_worktree_invalid_config")
    case "missing-root": return uiText("chat_worktree_missing_root")
    case "no-source": return uiText("chat_worktree_no_git")
    case "source-unavailable": return uiText("chat_worktree_source_unavailable")
    case "ambiguous-source": return uiText("chat_worktree_ambiguous_source")
    case "uncertain": return uiText("chat_worktree_uncertain")
    case "context-changed": return uiText("chat_worktree_context_changed")
    default: return uiText("chat_worktree_prepare_failed")
  }
}

type Attachment = { id: string; base64: string; name: string; type: string; size: number; url: string }
type EnvironmentPreference = "auto" | "open" | "closed"

const MESSAGE_WORKSPACE_WIDTH = 1152
const ENVIRONMENT_OCCUPIED_WIDTH = 332
const COMPACT_COMMAND = "/compact"

type LoopCapabilityConfirmation = { sessionId: string; revision: number }

function sessionLoopStatusText(state?: SessionLoopState, mode?: SessionLoopMode): string {
  switch (state) {
    case "scheduled": return uiText(mode === "adaptive" ? "session_loop_adaptive_scheduled" : "session_loop_scheduled")
    case "paused": return uiText("session_loop_paused")
    case "stopped": return uiText("session_loop_stopped")
    case "expired": return uiText("session_loop_expired")
    default: return uiText("session_loop_absent")
  }
}

function sessionLoopOutcomeText(status: string): string {
  switch (status) {
    case "completed": return uiText("session_loop_run_completed")
    case "failed": return uiText("session_loop_run_failed")
    case "cancelled": return uiText("session_loop_run_cancelled")
    case "suspended": return uiText("session_loop_run_suspended")
    case "dispatch_failed": return uiText("session_loop_run_dispatch_failed")
    case "running": return uiText("session_loop_run_running")
    default: return uiText("session_loop_run_unconfirmed")
  }
}

// Only auto-open Environment when a 72rem chat pane still fits beside it.
// Reserve its space in the layout so the chat can expand without being shifted
// outside its pane or underneath the floating card.
const ENVIRONMENT_AUTO_SHOW_MIN_WIDTH =
  MESSAGE_WORKSPACE_WIDTH + ENVIRONMENT_OCCUPIED_WIDTH

type ComposerSubmissionSnapshot = Readonly<{
  draftKey: string
  draftRevision: number
  attachmentRevision: number
  skillRevision: number
  text: string
  attachments: readonly Readonly<Attachment>[]
  selectedSkill: Readonly<SkillDefinition> | null
  workspacePath: string | null
  projectId: string | null
  templatePrompt: ReturnType<typeof peekPendingTemplatePrompt>
  /** Permission mode to stamp when this submission creates a NEW session. */
  permissionMode: SessionPermissionMode | null
  /** Explicit only for new chats or a changed Root choice. */
  rootOrchestrationOnly: boolean | undefined
  thinkingMode: import("@services/chat/AgentService").ThinkingMode | undefined
  thinkingModeRevision: number | undefined
  /** One-shot new-session picker override captured with the submission. */
  reasoningSelection: ReasoningEffortSelection | undefined
}>

function fileToAttachment(file: File): Promise<Attachment> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const url = String(reader.result)
      // data URL → strip the "data:...;base64," prefix for the API payload.
      const base64 = url.includes(",") ? url.slice(url.indexOf(",") + 1) : url
      resolve({
        id: `${file.name}-${file.size}-${url.length}`,
        base64,
        name: file.name,
        type: file.type,
        size: file.size,
        url,
      })
    }
    reader.onerror = () => reject(reader.error)
    reader.readAsDataURL(file)
  })
}

type ChatState = ReturnType<typeof useChat>
const EMPTY_PENDING_USER_IMAGES = [] as const

/** The primary chat controls the transcript, composer and its transient dialogs. */
export function ChatPane({
  chat,
  fileChangeSummary,
  onEnvironmentVisible,
  pickedWorkspace,
  worktreePath,
  pendingProjectId,
  onNewSessionInProjectSection,
  newChatEpoch = 0,
  getNavigationVersion,
  onSelectProject,
  onOpenWorkspacePicker,
  onOpenInspector,
  onOpenReview,
  onOpenRecordedSession,
  workPanelTarget,
  onOpenWork,
  onWorkReference,
  sidePaneOpen,
  onToggleSidePane,
  onOpenSubagents,
  onSelectSubAgent,
  onOpenSidebar,
  sidebarCollapsed,
  pageVisible = true,
}: {
  chat: ChatState
  fileChangeSummary?: SessionFileChangeSummary
  onEnvironmentVisible?: (sessionId: string | null) => void
  pickedWorkspace: string | null
  /** Explicit checkout selected in the worktree manager for this Project. */
  worktreePath?: string | null
  /** Project preselected for the next NEW session (project-grouped sidebar). */
  pendingProjectId?: string | null
  /** Notified once when a NEW session lands after a section-scoped 新建 intent. */
  onNewSessionInProjectSection?: (sessionId: string) => void
  /** Explicit New chat intent, including new → new with a null session ID. */
  newChatEpoch?: number
  /** Synchronous navigation-intent fence owned by the main App. */
  getNavigationVersion?: () => number
  /** Chip-driven project selection for the next NEW session. */
  onSelectProject?: (projectId: string | null) => void
  onOpenWorkspacePicker: () => void
  onOpenInspector: () => void
  onOpenReview?: () => void
  onOpenRecordedSession?: OpenRecordedSession
  workPanelTarget?: HTMLElement | null
  onOpenWork?: () => void
  onWorkReference?: () => void
  sidePaneOpen?: boolean
  onToggleSidePane?: () => void
  onOpenSubagents?: () => void
  /** Opens a child without replacing this pane's current session. */
  onSelectSubAgent?: (childId: string) => void
  onOpenSidebar: () => void
  sidebarCollapsed: boolean
  /** Retain the mounted conversation while another app page is visible. */
  pageVisible?: boolean
}) {
  useUiLocale()
  useRenderProbe("app.ChatPane")
  const {
    chats,
    currentSessionId,
    currentChat,
    messages,
    streaming,
    streamPhase,
    streamingReasoning,
    liveSegments,
    streamStatus,
    contextCompression,
    outputRate,
    pendingUserText,
    pendingUserImages = EMPTY_PENDING_USER_IMAGES,
    pendingUserMessages,
    sending,
    submissionPending,
    select,
    send,
    stop,
    deleteMessage,
    fork,
    regenerate,
    editMessage,
    retry,
    sendFailure,
    pendingQuestion,
    questionLoading,
    questionSubmitting,
    questionUnavailable,
    questionError,
    questionCanRetry,
    refreshQuestion,
    retryQuestion,
    pendingApproval,
    answerQuestion,
    respondApproval,
  } = chat
  // `sending` belongs to this hook instance, while `streaming` is already
  // scoped to the session rendered by this pane.  Do not let a run from the
  // session we just left turn a blank/new conversation into a Stop button.
  const executionBlocked = chat.executionCompatibility?.blocked === true
  const questionControls = useMemo(() => ({
    onAnswer: answerQuestion,
    onRefresh: refreshQuestion,
    onRetry: retryQuestion,
    loading: questionLoading,
    submitting: questionSubmitting,
    unavailable: questionUnavailable,
    error: questionError,
    canRetry: questionCanRetry,
  }), [answerQuestion, refreshQuestion, retryQuestion, questionLoading, questionSubmitting,
    questionUnavailable, questionError, questionCanRetry])
  const permissionTimeline = usePermissionTimeline(messages,
    !executionBlocked && pendingQuestion?.interaction_kind === "permission" ? pendingQuestion : null,
    chat.recordedPermission, currentChat?.config?.workspacePath, questionControls)
  const supervisorApprovalTimeline = useSupervisorApprovalTimeline(
    pageVisible !== false && !!currentChat && isDefaultSupervisor(currentChat),
    messages.at(-1)?.id ?? null, onOpenRecordedSession)
  const actionableApproval = chat.approvalCompatibility?.blocked ? null : pendingApproval
  const { approvalSubmitting, approvalError } = chat
  const timelineAttachments = useMemo(() => {
    const entries = [...permissionTimeline, ...supervisorApprovalTimeline]
    if (actionableApproval) entries.push({
      key: JSON.stringify(["child-approval", actionableApproval.childSessionId, actionableApproval.requestId]),
      node: <ChildApprovalCard a={actionableApproval} onRespond={respondApproval}
        submitting={approvalSubmitting} error={approvalError} />,
    })
    return entries
  }, [permissionTimeline, supervisorApprovalTimeline, actionableApproval, respondApproval, approvalSubmitting, approvalError])
  const activity = currentChat?.activity
  const suspended = currentChat?.lastRunStatus === "suspended"
  const canPresentWait = currentChat?.isRunning !== true
    && !isTerminalRunStatus(currentChat?.lastRunStatus)
    && !pendingQuestion && !pendingApproval
  const monitoredCommandWaiting = canPresentWait && suspended
    && (activity === undefined || activity === "waiting_bash")
    && backgroundExecWaitActive((currentChat?.messages ?? []).slice(-1).map((message) => ({
      metadata: (message as { metadata?: { runtime_kind?: unknown } }).metadata,
      content: "content" in message ? message.content : undefined,
    })))
  const backgroundExecWaiting = monitoredCommandWaiting || (canPresentWait && activity === "waiting_bash")
  const delegationWaiting = canPresentWait && (activity === "waiting_children"
    || (activity === undefined && (currentChat?.runningChildCount ?? 0) > 0))
  const yieldedWaiting = delegationWaiting || backgroundExecWaiting
  // A projected wait keeps the transcript live, but does not itself supply a
  // runner that Stop can cancel. Retain the existing monitored command path.
  const currentlyRunning = currentChat?.isRunning === true || (sending && streaming !== null) || monitoredCommandWaiting
  const managedHistoryStatus = useAppStore((state) => currentSessionId
    ? state.managedHistoryBindings?.[currentSessionId]?.status : undefined)
  const managedHistoryStale = managedHistoryStatus === "stale"
  // A newer Human interaction may arrive while this pane retains an earlier
  // generation failure. Keep its recovery state until the interaction clears.
  const waitingForHuman = Boolean(pendingQuestion || pendingApproval)
    || activity === "waiting_user" || currentChat?.planMode?.status === "awaiting_approval"
  const visibleSendFailure = sendFailure?.sessionId === currentSessionId
    && (sendFailure.kind === "submission-unconfirmed" || !waitingForHuman)
    ? sendFailure : null
  const persistedRunError = !visibleSendFailure
    && !waitingForHuman
    && !currentlyRunning
    && currentChat?.lastRunStatus === "error"
    ? currentChat.lastRunError?.trim() || uiText("generation_failed_the_server_provided_no_error_details_d70c7744")
    : null
  const generationFailed = visibleSendFailure?.kind === "generation-failed"
    || persistedRunError !== null
  const runErrorDetail = visibleSendFailure?.message?.trim()
    || (generationFailed && currentChat?.lastRunStatus === "error"
      ? currentChat.lastRunError?.trim() || persistedRunError
      : null)
  const runFailureGuidance = generationFailed ? describeRunFailure(runErrorDetail) : null
  const runDiagnosticsSubject = useMemo<RunDiagnosticsSubject>(() => ({
    sessionId: currentSessionId,
    localOperationId: visibleSendFailure?.operationId ?? null,
    failureKind: visibleSendFailure?.kind ?? "generation-failed",
    diagnosticId: extractDiagnosticId(runErrorDetail),
    errorBinding: runErrorDetail,
    liveDiagnostic: visibleSendFailure?.kind === "generation-failed" ? visibleSendFailure.diagnostic : null,
  }), [currentSessionId, visibleSendFailure, runErrorDetail])

  const queue = useGuidanceQueue(currentSessionId, currentlyRunning)
  const rootAuthority = useRootOrchestrationMode(currentSessionId, currentChat?.kind)
  const liveRetry = useLiveBootstrapRetry(currentSessionId, currentlyRunning, rootAuthority.isRoot)
  const stopWithLiveFence = () => { liveRetry.cancelForStop(); stop() }
  // Invalidate cached Work eligibility on mode/lifecycle changes. This key is
  // only a local read fence; initialization revision still comes from scope GET.
  const workAuthorityKey = `${rootAuthority.authority?.birthToken ?? ""}:${rootAuthority.authority?.epoch ?? ""}:${rootAuthority.authority?.enabled ?? ""}`
  // Settle the first identity read before starting a scoped read. Later
  // unchanged metadata refreshes must not withdraw Work or cancel its reads.
  const deferWorkRead = rootAuthority.loading && !rootAuthority.authority && !rootAuthority.unsafe
  const tickets = useTicketWork(currentSessionId, workAuthorityKey, rootAuthority.unsafe, deferWorkRead)
  const ticketIngress = useTicketIngress(currentSessionId)
  const ticketScope = tickets.state?.current.scope
  const pendingTicketMessage = ticketIngress.hasPending(currentSessionId)
  const semanticComposer = tickets.negotiated === false || pendingTicketMessage || ticketScope?.capabilities?.semantic_messages_v1 === true
    && ticketScope.mutation_enabled === true
    && ticketScope.binding.supervisor_session_id === currentSessionId
  const [ticketReference, setTicketReference] = useState<TicketRequest | null>(null)
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null)
  const workFocusScope = useMemo(() => ({ currentSessionId }), [currentSessionId])
  const [workFocusRequest, setWorkFocusRequest] = useState<{ scope: object } | null>(null)
  const focusWorkPanel = useCallback(() => {
    if (!workFocusRequest || workFocusRequest.scope !== workFocusScope || pageVisible === false) return
    const overview = workPanelTarget?.querySelector<HTMLElement>('[data-testid="ticket-work-overview"]')
    if (!overview) return
    const active = document.activeElement
    // Preserve a newer composer focus even when it was set programmatically.
    if (!active?.matches('input, textarea, [contenteditable="true"]') || workPanelTarget?.contains(active)) overview.focus()
    setWorkFocusRequest(null)
  }, [workFocusRequest, workFocusScope, workPanelTarget, pageVisible])
  const openTicketWork = (workId: string | null) => {
    setSelectedWorkId(workId)
    onOpenWork?.()
    setWorkFocusRequest({ scope: workFocusScope })
  }
  useEffect(() => {
    if (!workFocusRequest) return
    if (workFocusRequest.scope !== workFocusScope || pageVisible === false) {
      setWorkFocusRequest(null)
      return
    }
    // Retain main's late portal/cancellation behavior; lazy details also call
    // this same focus handler once their canonical overview is mounted.
    const cancel = () => setWorkFocusRequest(null)
    document.addEventListener("pointerdown", cancel, true)
    document.addEventListener("keydown", cancel, true)
    const frame = requestAnimationFrame(focusWorkPanel)
    return () => {
      cancelAnimationFrame(frame)
      document.removeEventListener("pointerdown", cancel, true)
      document.removeEventListener("keydown", cancel, true)
    }
  }, [workFocusRequest, workFocusScope, workPanelTarget, pageVisible, ticketScope?.binding.supervisor_session_id, focusWorkPanel])
  const replayReferences = ticketIngress.references(currentSessionId)
  const visibleTicketReference = pendingTicketMessage && replayReferences?.in_reply_to
    ? { work_id: replayReferences.thread_id ?? replayReferences.in_reply_to, id: replayReferences.in_reply_to }
    : ticketReference
  useEffect(() => { setWorkFocusRequest(null); setTicketReference(null); setSelectedWorkId(null) }, [currentSessionId])
  const [chatLayoutRef, chatLayoutWidth] = useContainerWidth<HTMLDivElement>()
  const environmentHasRoom = chatLayoutWidth >= ENVIRONMENT_AUTO_SHOW_MIN_WIDTH
  useMarkSessionRead(pageVisible ? currentChat : null)
  const [environmentPreference, setEnvironmentPreference] =
    useState<EnvironmentPreference>("auto")
  const environmentId = useId()

  useEffect(() => {
    setEnvironmentPreference("auto")
  }, [currentSessionId])

  const environmentOpen = environmentPreference === "open"
    || (environmentPreference === "auto" && environmentHasRoom)
  const environmentVisible = environmentOpen && !(sidePaneOpen ?? false)
  useEffect(() => {
    onEnvironmentVisible?.(pageVisible && environmentVisible ? currentSessionId : null)
  }, [currentSessionId, environmentVisible, onEnvironmentVisible, pageVisible])
  const environmentReservedWidth = environmentVisible && environmentHasRoom
    ? ENVIRONMENT_OCCUPIED_WIDTH
    : 0

  // Live in-run token budget (pushed over the agent channel) — beats the
  // persisted config snapshot, which only refreshes on history reload.
  const liveTokenUsage = useAppStore((s) =>
    currentSessionId ? s.tokenUsages[currentSessionId] : undefined,
  )
  const tokenUsage = liveTokenUsage ?? currentChat?.config?.tokenUsage

  // Drafts remain available when switching sessions or returning to a new chat.
  const draftKey = currentSessionId ?? ""
  const draft = useAppStore((s) => s.inputStates[draftKey]?.content ?? "")
  const loopDraft = isSessionLoopCommand(draft)
  const loopRequests = useRef(new Set<string>())
  const latestSubmit = useRef<(confirmation?: LoopCapabilityConfirmation) => void>(() => {})
  const composerInputRef = useRef<ComposerInputHandle>(null)
  const submissionActiveRef = useRef(false)
  const [preparationPending, setPreparationPending] = useState(false)
  const mountedRef = useRef(true)
  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false } }, [])
  const currentDraftKeyRef = useRef(draftKey)
  currentDraftKeyRef.current = draftKey
  const setDraft = (value: string | ((prev: string) => string)) => {
    const store = useAppStore.getState()
    const prev = store.inputStates[draftKey]?.content ?? ""
    store.setInputContent(draftKey, typeof value === "function" ? value(prev) : value)
  }
  const sessionDrop = useSessionDrop(chats, select)
  const [dragOver, setDragOver] = useState(false)
  const [goalSaving, setGoalSaving] = useState(false)
  const goalRequestActive = useRef(false)
  const [compactingSessions, setCompactingSessions] = useState<ReadonlySet<string>>(() => new Set())
  // The ref claims immediately. Render state follows the selected session.
  const compactionRequests = useRef(compactingSessions)
  const compacting = Boolean(currentSessionId && compactingSessions.has(currentSessionId))
  const setCompactionPending = (id: string, pending: boolean) => {
    const sessions = new Set(compactionRequests.current)
    if (pending) sessions.add(id)
    else sessions.delete(id)
    compactionRequests.current = sessions
    if (mountedRef.current) setCompactingSessions(sessions)
  }
  const [selectedSkill, setSelectedSkill] = useState<SkillDefinition | null>(null)
  const [rootModeConflict, setRootModeConflict] = useState<string | null>(null)
  useEffect(() => { setRootModeConflict(null) }, [currentSessionId])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const attachmentRevisionRef = useRef(0)
  const skillRevisionRef = useRef(0)
  const changeAttachments = (value: Attachment[] | ((prev: Attachment[]) => Attachment[])) => {
    attachmentRevisionRef.current += 1
    setAttachments(value)
  }
  const changeSelectedSkill = (value: SkillDefinition | null) => {
    skillRevisionRef.current += 1
    setSelectedSkill(value)
  }
  const [preview, setPreview] = useState<string | null>(null)
  const [toast, setToast] = useState<ToastNotice | null>(null)
  const [forking, setForking] = useState(false)
  // Identity changes even for A → B → A, so old async failures stay in their scope.
  const toastScope = useMemo(() => ({ sessionId: currentSessionId }), [currentSessionId])
  const toastScopeRef = useRef(toastScope)
  toastScopeRef.current = toastScope
  useEffect(() => { setToast(null); setForking(false) }, [currentSessionId])
  const toastId = useRef(0)
  const showToast = useCallback((message: string, kind: ToastNotice["kind"] = "info", details?: string) => {
    if (toastScopeRef.current === toastScope) setToast({ id: ++toastId.current, message, kind, details })
  }, [toastScope])

  // NOTE: the background-shell completion NOTIFICATION is no longer fired here.
  // It arrives as a backend `notification` event (deduped + preference-gated,
  // never replayed on resubscribe) and is surfaced via `onNotification` in
  // useChat. The tool card still flips reactively from the store.

  // Sticky-scroll machinery (refs + ResizeObserver + open-session re-pin).
  const { scrollRef, contentRef, atBottom, handleScroll, scrollToBottom, pinToBottom } =
    useStickyScroll(currentSessionId)

  const addFiles = async (files: FileList | File[]) => {
    const imgs = Array.from(files).filter((f) => f.type.startsWith("image/"))
    if (imgs.length === 0) return
    const next = await Promise.all(imgs.map(fileToAttachment))
    changeAttachments((prev) => [...prev, ...next])
  }

  const skills = useAppStore(useShallow((s) => s.skills))
  const subAgents = useAppStore(useShallow((s) => selectChildren(currentSessionId)(s)))
  const subAgentView = useSubAgentView(currentChat, chats, subAgents, pageVisible)
  const mergedSubAgents = subAgentView.agents
  const providerSnapshot = useProviderStore((s) => s.providerSnapshot)
  const providerStatus = useProviderStore((s) => s.providerStatus)
  const modelGroups = useMemo(() => {
    if (providerStatus !== "ready" || !providerSnapshot) return []
    const groups = providerSnapshot.instances.filter((instance) => instance.enabled)
      .map((instance) => ({
        provider: instance.id,
        label: instance.label || instance.id,
        models: getRuntimeModelIds(instance, providerSnapshot.defaults),
      }))
      .filter((group) => group.models.length > 0)
    return groups.map((group) =>
      groups.some((other) => other.provider !== group.provider && other.label === group.label)
        ? { ...group, label: `${group.label} (${group.provider})` }
        : group,
    )
  }, [providerSnapshot, providerStatus])
  const selectedModel = useAppStore((s) => s.selectedModel)
  const setSelectedModel = useAppStore((s) => s.setSelectedModel)
  const changeSessionModel = useAppStore((s) => s.changeSessionModel)
  const defaultChatRef = providerSnapshot?.defaults?.chat
  const chatReasoningEffort = useProviderStore(
    (s) => s.providerSnapshot?.defaults?.chat?.reasoning_effort,
  )
  const inputReasoningSelection = useAppStore(
    (s) => s.inputStates[draftKey]?.reasoningEffort,
  )
  const workReasoning = chat.executionCompatibility?.workReasoning
  const cachedEffort = currentChat?.config?.reasoningEffort ?? currentChat?.config?.model_ref?.reasoning_effort
  // The detail also has the saved effort when a cached list row omits it.
  const savedEffort = workReasoning && workReasoning.createdAt === currentChat?.createdAtExact
    ? workReasoning.effort : cachedEffort
  // A new composer mirrors the Chat-role setting exactly. Provider-instance
  // defaults are intentionally not resolved into the selection: that is what
  // Auto delegates to Bamboo. Existing sessions show their durable override.
  const reasoningSelection: ReasoningEffortSelection = currentSessionId
    ? savedEffort ?? "auto"
    : inputReasoningSelection ?? chatReasoningEffort ?? "auto"
  const clearInputReasoningEffort = useAppStore((s) => s.clearInputReasoningEffort)
  const rootMode = useRootThinkingMode({
    sessionId: currentSessionId, draftKey, ordinarySelection: reasoningSelection, root: rootAuthority,
    defaultChatUltra: providerSnapshot?.features?.chat_ultra_by_default,
    disabled: submissionPending || compacting || currentlyRunning || queue.busy || queue.hasUnconfirmed,
  })
  const rootSessionUnsafe = useCallback(() => rootMode.busy || rootMode.blocked
    || Boolean(currentSessionId && getRootModeFenceState(currentSessionId) !== "clear"),
  [currentSessionId, rootMode.busy, rootMode.blocked])
  const skillModeConflict = selectedSkill && rootMode.selected === true && !rootMode.child
    ? uiText("the_selected_skill_is_incompatible_with_ultra_orchestra_fd2e7fa6")
    : null
  // Existing sessions display their durable model. The global selection is
  // only a draft for a new session and cannot relabel a running session.
  const legacyModel = currentSessionId ? currentChat?.config?.model : undefined
  const activeModelRef = currentSessionId
    ? currentChat?.config?.model_ref ?? (legacyModel ? undefined : defaultChatRef)
    : resolveNewChatModelRef(providerSnapshot, selectedModel)
  const activeModel = activeModelRef?.model || legacyModel || ""
  const [modelSaving, setModelSaving] = useState(false)
  const modelControlDisabled = modelSaving || compacting || currentlyRunning || submissionPending
    || queue.busy || queue.hasUnconfirmed
  const handleModelChange = async (model: ProviderModelRef) => {
    if (modelControlDisabled || (model.provider === activeModelRef?.provider && model.model === activeModel)) return
    if (!currentSessionId) {
      setSelectedModel(model)
      return
    }

    setModelSaving(true)
    try {
      await changeSessionModel(currentSessionId, model)
    } catch (error) {
      if (currentDraftKeyRef.current === currentSessionId) {
        showToast(uiText("could_not_save_the_model_please_try_again_631991a6"), "error", getErrorMessage(error))
      }
    } finally {
      setModelSaving(false)
    }
  }

  // Escape hides the pickers until the draft changes again (typing re-opens).
  const [menusDismissed, setMenusDismissed] = useState(false)
  const menuDraftRef = useRef({ key: draftKey, text: draft })
  useEffect(() => {
    const changed = menuDraftRef.current.key !== draftKey || menuDraftRef.current.text !== draft
    menuDraftRef.current = { key: draftKey, text: draft }
    // Even an equal-state dispatch can leave a React lane pending during
    // rapid external-editor updates. Open menus need no reset dispatch.
    if (changed && menusDismissed) setMenusDismissed(false)
  }, [draft, draftKey, menusDismissed])

  const slashQuery = !menusDismissed && draft.startsWith("/") ? draft.slice(1) : null
  const [workflowRunsOpen, setWorkflowRunsOpen] = useState(false)
  const openWorkflowRuns = () => {
    setMenusDismissed(true)
    setWorkflowRunsOpen(true)
  }
  const [clearTarget, setClearTarget] = useState<{ id: string; title: string } | null>(null)
  // Tiptap reports the active @query at the caret, including mid-message edits.
  const [atQuery, setAtQuery] = useState<string | null>(null)
  const workspacePath = currentChat?.config?.workspacePath
  // A new session uses its explicitly selected worktree, then the Project
  // primary path. Existing sessions retain their stored workspace.
  const selectedProjectPath = useAppStore((state) =>
    pendingProjectId ? state.projects[pendingProjectId]?.project_path : undefined,
  )
  const projectWorktreeDefault = useAppStore((state) =>
    !!pendingProjectId && state.projects[pendingProjectId]?.new_chat_worktree === true,
  )
  const [, refreshPreparation] = useState(0)
  const preparationDrafts = useRef({ epoch: newChatEpoch, entries: new Map<string, NewChatWorktreePreparation>() })
  if (preparationDrafts.current.epoch !== newChatEpoch) {
    preparationDrafts.current = { epoch: newChatEpoch, entries: new Map() }
  }
  const preparationKey = JSON.stringify([pendingProjectId ?? null, pickedWorkspace, worktreePath ?? null])
  let preparation = preparationDrafts.current.entries.get(preparationKey)
  if (!preparation) {
    preparation = new NewChatWorktreePreparation(pendingProjectId ?? null,
      () => { if (mountedRef.current) refreshPreparation((revision) => revision + 1) })
    preparationDrafts.current.entries.set(preparationKey, preparation)
  }
  const automaticWorktree = !currentSessionId && !worktreePath
    && projectWorktreeDefault && preparation.useProjectDefault
  const submissionScope = useMemo(() => ({ currentSessionId, pendingProjectId, pickedWorkspace, worktreePath, selectedProjectPath, newChatEpoch }), [currentSessionId, pendingProjectId, pickedWorkspace, worktreePath, selectedProjectPath, newChatEpoch])
  const submissionScopeRef = useRef(submissionScope)
  submissionScopeRef.current = submissionScope
  const liveSendRef = useRef(send)
  liveSendRef.current = send
  const selectedWorktreePath = !currentSessionId ? preparation.path ?? worktreePath : null
  const displayWorkspace = workspacePath ?? selectedWorktreePath ?? selectedProjectPath ?? pickedWorkspace
  const environmentChanges = useMemo(() => fileChangeSummary ?? summarizeSessionFileChangeGroups(
    groupSessionFileChanges(mergeSessionFileChanges(
      collectSessionFileChanges(messages), collectLiveSessionFileChanges(liveSegments),
    ), displayWorkspace ?? undefined),
  ), [fileChangeSummary, messages, liveSegments, displayWorkspace])
  const currentProjectName = useAppStore((state) => {
    const projectId = currentChat?.config?.projectId
    return projectId ? state.projects[projectId]?.name : undefined
  })
  const environmentSources = useMemo<EnvironmentSource[]>(() => {
    const sources = new Map<string, EnvironmentSource>()
    const addPath = (path: string) => {
      const name = path.split(/[\\/]/).filter(Boolean).at(-1) ?? path
      sources.set(`file:${path}`, { id: `file:${path}`, name, kind: "file" })
    }

    for (const message of messages) {
      if ("images" in message) {
        for (const image of message.images ?? []) {
          const previewUrl = image.url
            ?? (image.base64
              ? image.base64.startsWith("data:")
                ? image.base64
                : `data:${image.type || "image/png"};base64,${image.base64}`
              : undefined)
          sources.set(`image:${image.id}`, {
            id: `image:${image.id}`,
            name: image.name,
            kind: "image",
            previewUrl,
          })
        }
      }
      if ("type" in message && message.type === "file_reference") {
        for (const path of message.paths) addPath(path)
      }
    }
    for (const attachment of attachments) {
      sources.set(`draft:${attachment.id}`, {
        id: `draft:${attachment.id}`,
        name: attachment.name,
        kind: "image",
        previewUrl: attachment.url,
      })
    }

    return [...sources.values()]
  }, [attachments, messages])
  const [workspaceFiles, setWorkspaceFiles] = useState<WorkspaceFileEntry[]>([])
  const filesLoadedForRef = useRef<string | null>(null)
  useEffect(() => {
    filesLoadedForRef.current = null
    setWorkspaceFiles([])
  }, [displayWorkspace])
  const filePickerOpen = atQuery !== null
  useEffect(() => {
    if (!filePickerOpen || !displayWorkspace || filesLoadedForRef.current === displayWorkspace) return
    let cancelled = false
    const target = displayWorkspace
    workspaceService.listWorkspaceFiles(target).then((files) => {
      if (cancelled) return
      filesLoadedForRef.current = target
      setWorkspaceFiles(files)
    }).catch(() => {
      if (!cancelled) setWorkspaceFiles([])
    })
    // Closing the menu or changing workspace must not publish stale results.
    return () => { cancelled = true }
  }, [filePickerOpen, displayWorkspace])

  const compactionUnavailableReason = () => {
    if (!currentSessionId) return uiText("compact_open_session")
    if (rootMode.child || managedHistoryStatus || (currentChat && isDefaultSupervisor(currentChat))
      || ticketScope?.binding.supervisor_session_id === currentSessionId) return uiText("compact_root_only")
    if (executionBlocked || isSessionExecutionBlocked(currentSessionId)
      || rootSessionUnsafe()) return uiText("compact_session_unavailable")
    if (currentlyRunning || yieldedWaiting || currentChat?.lastRunStatus === "suspended"
      || pendingApproval || pendingQuestion || questionLoading || questionSubmitting
      || submissionActiveRef.current || goalRequestActive.current || compactionRequests.current.has(currentSessionId)
      || submissionPending
      || modelSaving || queue.busy || queue.hasUnconfirmed || queue.pending.length
      || ticketIngress.busy || pendingTicketMessage) return uiText("compact_wait_for_session")
    if (attachments.length || selectedSkill) {
      return uiText("compact_send_alone")
    }
    return null
  }

  const compactDraft = (revision: number, fromMenu = false) => {
    const unavailable = compactionUnavailableReason()
    if (!currentSessionId || unavailable) {
      if (unavailable) showToast(unavailable)
      return
    }
    const sessionId = currentSessionId
    let commandRevision = revision
    if (fromMenu) {
      if (!useAppStore.getState().setInputContentIfRevision(draftKey, revision, COMPACT_COMMAND)) return
      const normalized = useAppStore.getState().inputStates[draftKey]
      if (normalized?.content !== COMPACT_COMMAND) return
      commandRevision = normalized.contentRevision
      menuDraftRef.current = { key: draftKey, text: COMPACT_COMMAND }
    }
    const tokenRevision = tokenBudgetRevision(useAppStore.getState, sessionId)
    setCompactionPending(sessionId, true)
    setMenusDismissed(true)
    composerInputRef.current?.focus()
    void agentClient.compactSessionContext(sessionId).then((receipt) => {
      const store = useAppStore.getState()
      store.setInputContentIfRevision(draftKey, commandRevision, "")
      if (receipt.status === "unchanged") {
        if (mountedRef.current) showToast(uiText("compact_context_unchanged"))
        return
      }
      const currentTokenRevision = tokenBudgetRevision(useAppStore.getState, sessionId)
      const usage = mapTokenBudgetUsage(receipt.token_usage)
      if (usage && tokenRevision.usage === currentTokenRevision.usage) {
        store.updateTokenUsage(sessionId, usage, { fromSnapshot: true })
      }
      if (tokenRevision.truncation === currentTokenRevision.truncation) {
        store.setTruncationInfo(sessionId, receipt.token_usage.truncation_occurred,
          receipt.token_usage.segments_removed, { fromSnapshot: true })
      }
      if (mountedRef.current) {
        const percent = new Intl.NumberFormat(uiLanguage(), { maximumFractionDigits: 1 })
        showToast(uiText("compact_context_applied", {
          before: percent.format(receipt.usage_before_percent),
          after: percent.format(receipt.usage_after_percent),
        }))
      }
      // A slow history refresh must not keep the finished operation pending.
      void store.loadChatHistory(sessionId, { mode: "monotonic" }).catch(() => {})
    }, (error) => {
      observeSessionExecutionConflict(sessionId, error)
      if (!mountedRef.current) return
      if (isApiError(error) && error.status === 422 && getApiErrorCode(error) === "context_summary_empty") {
        showToast(uiText("context_compression_notice_empty_summary"), "error")
        return
      }
      showToast(uiText(isApiError(error) && error.status === 404
        ? "compact_context_not_found" : "compact_context_unconfirmed"), "error", getErrorMessage(error))
    }).finally(() => setCompactionPending(sessionId, false))
  }

  const requestSessionLoop = (
    sessionId: string,
    command: SessionLoopCommand,
    onConfirmed: (status: SessionLoopStatus) => void,
  ) => {
    if (loopRequests.current.has(sessionId)) return
    loopRequests.current.add(sessionId)
    setMenusDismissed(true)
    void agentClient.applySessionLoop(sessionId, command).then(onConfirmed, (error) => {
      observeSessionExecutionConflict(sessionId, error)
      if (!mountedRef.current) return
      const unavailable = isApiError(error) && (error.status === 404 || error.status === 405)
      showToast(uiText(unavailable ? "session_loop_backend_unavailable" : "session_loop_unconfirmed"),
        "error", unavailable ? undefined : getErrorMessage(error))
    }).finally(() => { loopRequests.current.delete(sessionId) })
  }

  const submitLoopCommand = (sessionId: string, command: SessionLoopCommand, revision: number) => {
    requestSessionLoop(sessionId, command, ({ loop }) => {
      useAppStore.getState().setInputContentIfRevision(draftKey, revision, "")
      if (!mountedRef.current) return
      const details = []
      if (loop?.next_fire_at) {
        const time = new Intl.DateTimeFormat(uiLanguage(), { dateStyle: "medium", timeStyle: "short" })
          .format(new Date(loop.next_fire_at))
        details.push(uiText("session_loop_next_run", { time }))
      }
      if (loop?.last_run_status) {
        details.push(uiText("session_loop_last_result", { result: sessionLoopOutcomeText(loop.last_run_status) }))
      }
      const summary = sessionLoopStatusText(loop?.state, loop?.mode)
      showToast(details.length ? `${summary} ${details.join(" · ")}` : summary)
    })
  }

  const loopSubmissionAllowed = (sessionId: string, startsLoop: boolean): boolean => {
    if (rootMode.child || managedHistoryStatus
      || (currentChat && isDefaultSupervisor(currentChat))
      || ticketScope?.binding.supervisor_session_id === sessionId) {
      showToast(uiText("session_loop_ordinary_only"))
      return false
    }
    if (rootMode.selected === true && startsLoop) {
      showToast(uiText("session_loop_standard_only"))
      return false
    }
    if (executionBlocked || isSessionExecutionBlocked(sessionId)
      || rootSessionUnsafe() || semanticComposer || ticketIngress.busy) {
      showToast(uiText("session_loop_session_unavailable"))
      return false
    }
    if (attachments.length || selectedSkill) {
      showToast(uiText("session_loop_send_alone"))
      return false
    }
    return true
  }

  const submit = (loopConfirmation?: LoopCapabilityConfirmation) => {
    const storeAtSubmit = useAppStore.getState()
    const draftAtSubmit = storeAtSubmit.inputStates[draftKey]
    const text = draftAtSubmit?.content ?? ""
    if (currentSessionId && text.trim().toLowerCase() === "/workflow") {
      openWorkflowRuns()
      return
    }
    const loopCommand = parseSessionLoopCommand(text)
    if (loopCommand !== null) {
      if (loopCommand === "invalid") { showToast(uiText("session_loop_usage")); return }
      if (!currentSessionId) { showToast(uiText("session_loop_open_session")); return }
      const startsLoop = loopCommand === "natural" || (loopCommand.action !== "status" && loopCommand.action !== "stop")
      if (!loopSubmissionAllowed(currentSessionId, startsLoop)) return
      if (loopCommand !== "natural") {
        submitLoopCommand(currentSessionId, loopCommand, draftAtSubmit?.contentRevision ?? 0)
        return
      }
      if (currentlyRunning || yieldedWaiting || currentChat?.lastRunStatus === "suspended"
        || pendingApproval || pendingQuestion || queue.busy || queue.hasUnconfirmed) {
        showToast(uiText("session_loop_wait_for_session"))
        return
      }
    }
    if (text.trim().toLowerCase() === COMPACT_COMMAND) {
      compactDraft(draftAtSubmit?.contentRevision ?? 0)
      return
    }
    // Keep an in-flight admission from capturing or clearing a second draft.
    if (submissionActiveRef.current || executionBlocked || isSessionExecutionBlocked(currentSessionId) || submissionPending || modelSaving || queue.busy || ticketIngress.busy || rootMode.busy || goalRequestActive.current
      || (currentSessionId && compactionRequests.current.has(currentSessionId))) return
    if (semanticComposer && !tickets.canSendIngress) { showToast(uiText("ticket_the_ticket_connection_or_write_permission_is__c3da124f"), "error"); return }
    if (rootSessionUnsafe()) {
      setRootModeConflict(uiText("the_root_permission_change_is_unconfirmed_sending_and_e_a75a6b4f"))
      return
    }
    if (loopCommand === "natural" && currentSessionId) {
      const sessionId = currentSessionId
      const revision = draftAtSubmit?.contentRevision ?? 0
      if (loopConfirmation?.sessionId !== sessionId || loopConfirmation.revision !== revision) {
        const navigationVersion = getNavigationVersion?.()
        requestSessionLoop(sessionId, { action: "status" }, () => {
          if (!mountedRef.current || toastScopeRef.current !== toastScope
            || getNavigationVersion?.() !== navigationVersion
            || useAppStore.getState().inputStates[draftKey]?.contentRevision !== revision) return
          // Recheck live composer and run eligibility after probing an older
          // backend. The current draft is still the original slash request.
          latestSubmit.current({ sessionId, revision })
        })
        return
      }
    }
    const resumeGoal = isGoalResumeCommand(text)
    if (resumeGoal && (!currentSessionId || selectedSkill || attachments.length > 0 || pendingTicketMessage || semanticComposer)) {
      showToast(uiText("goal_resume_chat_only"), "error")
      return
    }
    const goalCommand = !selectedSkill && attachments.length === 0
      ? /^\/goal(?:\s+([\s\S]*))?$/i.exec(text.trim()) : null
    if ((goalCommand || resumeGoal) && !pendingTicketMessage && (currentSessionId || !goalCommand?.[1]?.trim())) {
      if (!currentSessionId) { showToast(uiText("open_a_session_before_setting_a_goal_83867da8")); return }
      const revision = draftAtSubmit?.contentRevision ?? 0
      if (!resumeGoal && !goalCommand?.[1]?.trim()) {
        onOpenInspector()
        storeAtSubmit.setInputContentIfRevision(draftKey, revision, "")
        return
      }
      const sessionId = currentSessionId
      if (getRootModeFenceState(sessionId) !== "clear") {
        setRootModeConflict(uiText("the_root_permission_change_is_unconfirmed_sending_and_e_a75a6b4f"))
        return
      }
      goalRequestActive.current = true; setGoalSaving(true)
      const command = resumeGoal ? agentClient.resumeGoal(sessionId)
        : agentClient.sendMessage({ message: text.trim(), session_id: sessionId, model: currentChat?.config?.model ?? "" })
      void command.then(async (response) => {
        if (response.session_id !== sessionId || !response.goal_command) throw new Error("Goal command was not acknowledged")
        recordSessionUserInput(sessionId)
        useAppStore.getState().setInputContentIfRevision(draftKey, revision, "")
        if (currentDraftKeyRef.current === draftKey) {
          const action = response.goal_command.action
          const goalMessages: Partial<Record<string, string>> = {
            off: uiText("goal_paused_c6289896"),
            clear: uiText("goal_cleared_0cfc707e"),
            on_no_prompt: uiText("set_a_goal_first_cc87f18f"),
            status: uiText("goal_settings_opened_63de7dc7"),
            resume: uiText("goal_resume_queued"),
          }
          showToast(goalMessages[action] ?? uiText("goal_set_724a547c"))
          if (action === "status" || action === "on_no_prompt") onOpenInspector()
        }
        try { await useAppStore.getState().loadChatHistory(sessionId) }
        catch { /* The command acknowledgement already confirms the saved configuration. */ }
        // Execution admission handles an already-running session atomically.
        // The run may finish while the Goal command is being acknowledged.
        if (response.goal_command.should_execute) {
          if (getRootModeFenceState(sessionId) !== "clear") {
            if (currentDraftKeyRef.current === draftKey) showToast(uiText("root_permissions_are_unconfirmed_the_goal_was_saved_but_bd40481a"), "error")
            return
          }
          if (isSessionExecutionBlocked(sessionId)) return
          try { await agentClient.execute(sessionId, currentChat?.config?.model) }
          catch (error) { observeSessionExecutionConflict(sessionId, error); if (currentDraftKeyRef.current === draftKey) showToast(uiText("goal_saved_send_a_message_to_continue_ba844fbc"), "error", getErrorMessage(error)) }
        }
      }).catch((error) => {
        observeSessionExecutionConflict(sessionId, error)
        if (currentDraftKeyRef.current === draftKey) {
          const unavailable = resumeGoal && isApiError(error) && (error.status === 404 || error.status === 405)
          showToast(uiText(unavailable ? "goal_resume_unavailable" : "could_not_save_the_goal_your_command_is_preserved_pleas_ac375306"), "error", getErrorMessage(error))
        }
      }).finally(() => { goalRequestActive.current = false; setGoalSaving(false) })
      return
    }
    if (!text.trim() && attachments.length === 0) return
    setRootModeConflict(null)
    if ((currentlyRunning || queue.hasUnconfirmed) && selectedSkill) {
      showToast(uiText("remove_the_selected_skill_before_queueing_the_message_e38f6811"))
      return
    }
    const snapshot: ComposerSubmissionSnapshot = Object.freeze({
      draftKey,
      draftRevision: draftAtSubmit?.contentRevision ?? 0,
      attachmentRevision: attachmentRevisionRef.current,
      skillRevision: skillRevisionRef.current,
      text,
      attachments: Object.freeze(attachments.map((attachment) => Object.freeze({ ...attachment }))),
      selectedSkill: selectedSkill
        ? Object.freeze({ ...selectedSkill, tool_refs: [...selectedSkill.tool_refs] })
        : null,
      workspacePath: selectedWorktreePath ?? selectedProjectPath ?? pickedWorkspace,
      projectId: pendingProjectId ?? null,
      templatePrompt: !currentSessionId ? peekPendingTemplatePrompt() : null,
      // The home picker's selection only applies when this send creates a new
      // session; an existing session keeps its stored permission mode.
      permissionMode: !currentSessionId ? useNewSessionPermission.getState().mode : null,
      rootOrchestrationOnly: !currentSessionId && draftAtSubmit?.thinkingMode !== undefined
        ? draftAtSubmit.thinkingMode === "ultra" : rootMode.requestValue,
      thinkingMode: !currentSessionId ? draftAtSubmit?.thinkingMode : undefined,
      thinkingModeRevision: !currentSessionId ? draftAtSubmit?.thinkingModeRevision : undefined,
      reasoningSelection: !currentSessionId ? inputReasoningSelection : undefined,
    })
    const images = snapshot.attachments.map((a) => ({ base64: a.base64, name: a.name, size: a.size, type: a.type }))
    if (semanticComposer && snapshot.selectedSkill) {
      showToast(uiText("ticket_enter_ticket_instructions_directly_in_the_mes_2bddd839"))
      return
    }
    const frozenReference = ticketReference
    const prepareWorktree = !currentSessionId && (preparation.selection !== null || automaticWorktree)
    const originNavigationVersion = getNavigationVersion?.()
    const isOriginCurrent = () => mountedRef.current
      && submissionScopeRef.current === submissionScope
      && liveSendRef.current === send
      && useAppStore.getState().currentSessionId === currentSessionId
      && getNavigationVersion?.() === originNavigationVersion
    const sendSnapshot = (path: string | null) => {
      const submitSnapshot = (liveBootstrapResume: boolean) => send(snapshot.text, {
        skillIds: snapshot.selectedSkill ? [snapshot.selectedSkill.id] : undefined,
        images: images.length ? images : undefined,
        workspacePath: path,
        projectId: snapshot.projectId,
        templatePrompt: snapshot.templatePrompt,
        permissionMode: snapshot.permissionMode ?? undefined,
        rootOrchestrationOnly: snapshot.rootOrchestrationOnly,
        thinkingMode: snapshot.thinkingMode,
        reasoningSelection: snapshot.reasoningSelection,
        ...(prepareWorktree ? { isOriginCurrent } : {}),
        ...(liveBootstrapResume ? { liveBootstrapResume: true } : {}),
      })
      const negotiated = liveRetry.prepareInitial()
      return typeof negotiated === "boolean" ? submitSnapshot(negotiated)
        : negotiated.then((ready) => isOriginCurrent() ? submitSnapshot(ready) : { kind: "blocked" as const })
    }
    // React pending state cannot guard two submit callbacks in the same event.
    submissionActiveRef.current = true
    const submission = semanticComposer && currentSessionId
      ? ticketIngress.send({ session_id: currentSessionId, message: snapshot.text,
          model: activeModel, model_ref: currentChat?.config.model_ref ?? undefined,
          images: images.length ? images : undefined,
          ...(frozenReference ? { thread_id: frozenReference.work_id, in_reply_to: frozenReference.id } : {}),
        })
      : currentSessionId && (currentlyRunning || queue.hasUnconfirmed)
      ? queue.send(snapshot.text, images)
      : prepareWorktree
      ? (async () => {
          setPreparationPending(true)
          try {
            const path = await preparation.prepare(isOriginCurrent, automaticWorktree)
            if (!isOriginCurrent()) throw new NewChatWorktreePreparationError("context-changed")
            return await sendSnapshot(path)
          } catch (error) {
            if (isOriginCurrent()) showToast(worktreeErrorMessage(error instanceof NewChatWorktreePreparationError ? error : null)
              ?? uiText("chat_worktree_prepare_failed"), "error")
            return { kind: "blocked" as const }
          } finally {
            if (mountedRef.current) setPreparationPending(false)
          }
        })()
      : sendSnapshot(snapshot.workspacePath)
    void submission
      .then((result) => {
        if (prepareWorktree && result.kind !== "accepted" && !isOriginCurrent()) return
        if (currentSessionId && !rootMode.child && !currentlyRunning && !queue.hasUnconfirmed
          && result.kind !== "busy" && result.kind !== "ignored" && result.kind !== "blocked") {
          void rootMode.refresh(currentSessionId)
        }
        if (result.kind === "unconfirmed") {
          if (currentDraftKeyRef.current === snapshot.draftKey) composerInputRef.current?.focus()
          return
        }
        if (result.kind !== "accepted") return
        // A section-scoped creation intent applies to exactly this new session;
        // the callback owns clearing it, so later sends never re-apply it. An
        // accepted result already proves the session exists, so this durable
        // metadata outlives navigation: the guard below abandons this composer's
        // UI updates, not the session the acknowledgement already created.
        if (!currentSessionId && snapshot.projectId && onNewSessionInProjectSection) {
          onNewSessionInProjectSection(result.sessionId)
        }
        if (prepareWorktree && (!mountedRef.current
          || getNavigationVersion?.() !== originNavigationVersion
          || (!result.navigated && !isOriginCurrent()))) return
        if (frozenReference) setTicketReference((current) => current?.id === frozenReference.id ? null : current)
        // Commit only fields that still have the exact mutation revision captured
        // by this submission. A late acknowledgement must never erase edits or a
        // same-value re-selection made while the request was in flight.
        const store = useAppStore.getState()
        const cleared = store.setInputContentIfRevision(
          snapshot.draftKey,
          snapshot.draftRevision,
          "",
        )
        if (!cleared && result.navigated && snapshot.draftKey !== result.sessionId) {
          // A new-session acknowledgement re-keys the composer. Carry newer text
          // into that fresh session instead of leaving it hidden under the old
          // new-chat sentinel. Never overwrite an independently populated target.
          const latest = useAppStore.getState()
          const latestRevision = latest.inputStates[snapshot.draftKey]?.contentRevision ?? 0
          latest.moveInputContentIfRevision(
            snapshot.draftKey,
            latestRevision,
            result.sessionId,
          )
        }
        if (result.navigated && snapshot.draftKey !== result.sessionId) {
          if (snapshot.thinkingModeRevision !== undefined) {
            store.clearInputThinkingModeIfRevision(snapshot.draftKey, snapshot.thinkingModeRevision)
          }
          const latestSelection = useAppStore.getState().inputStates[
            snapshot.draftKey
          ]?.reasoningEffort
          if (latestSelection === snapshot.reasoningSelection) {
            clearInputReasoningEffort(snapshot.draftKey)
          }
        }
        if (attachmentRevisionRef.current === snapshot.attachmentRevision) setAttachments([])
        if (skillRevisionRef.current === snapshot.skillRevision) setSelectedSkill(null)
      })
      .catch((err) => {
        // send() normally resolves a typed outcome. Preserve every composer
        // field if an unexpected client exception escapes that boundary.
        console.error("[ChatPane] submission coordinator failed", err)
        if (currentDraftKeyRef.current === snapshot.draftKey) composerInputRef.current?.focus()
      })
      .finally(() => { submissionActiveRef.current = false })
    // Re-pin to bottom on send — the ResizeObserver keeps it there as the reply
    // grows and as the streaming→markdown swap relayouts.
    pinToBottom()
  }
  latestSubmit.current = submit

  const pickSkill = (skill: SkillDefinition) => {
    changeSelectedSkill(skill)
    setDraft("")
  }

  const handleFork = useCallback((id: string) => {
    if (rootSessionUnsafe()) { setRootModeConflict(uiText("the_root_permission_change_is_unconfirmed_forking_is_un_ca51f044")); return }
    const draftKey = currentDraftKeyRef.current
    setForking(true)
    void fork(id).then((nid) => {
      if (toastScopeRef.current === toastScope) setForking(false)
      if (nid) {
        if (toastScopeRef.current === toastScope) showToast(uiText("forked_into_a_new_session_from_here_b0abc6b8"))
        else if (currentDraftKeyRef.current === nid) {
          // Fork intentionally navigates to its new session. Do not replace a
          // notification already raised there, or notify an unrelated session.
          setToast((current) => current ?? { id: ++toastId.current, kind: "info", message: uiText("forked_into_a_new_session_from_here_b0abc6b8") })
        }
      }
      else if (currentDraftKeyRef.current === draftKey) showToast(uiText("could_not_fork_this_backend_does_not_support_session_fo_006caf5c"), "error")
    }).catch((error) => {
      if (toastScopeRef.current === toastScope) setForking(false)
      showToast(uiText("operation_failed_0c3b4cf7"), "error", getErrorMessage(error))
    })
  }, [fork, rootSessionUnsafe, showToast, toastScope])
  const handleRegenerate = useCallback(() => {
    if (executionBlocked) return
    if (rootSessionUnsafe()) { setRootModeConflict(uiText("the_root_permission_change_is_unconfirmed_regeneration__134c0a98")); return }
    if (modelSaving) { showToast(uiText("saving_model_please_wait_04e35c5e")); return }
    void regenerate()
  }, [executionBlocked, modelSaving, regenerate, rootSessionUnsafe, showToast])
  const handleEditMessage = useCallback((id: string, text: string) => {
    if (executionBlocked) return
    if (rootSessionUnsafe()) { setRootModeConflict(uiText("the_root_permission_change_is_unconfirmed_editing_and_r_45b99ff9")); return }
    if (modelSaving) { showToast(uiText("saving_model_please_wait_04e35c5e")); return }
    void editMessage(id, text)
  }, [editMessage, executionBlocked, modelSaving, rootSessionUnsafe, showToast])

  const launchWorkbench = (action: () => void) => {
    action()
  }
  const selectSubAgentInPane = onSelectSubAgent ?? select
  const overflowItems = [
    ...(currentSessionId ? [{ label: uiText("conversation_clear_action"), icon: <RotateCcw className="size-4" />,
      onClick: () => setClearTarget({ id: currentSessionId, title: currentChat?.title || currentSessionId }) }] : []),
    ...(currentSessionId ? [{ label: uiText("workflow_run_title"), icon: <BookText className="size-4" />,
      onClick: openWorkflowRuns }] : []),
    ...(currentSessionId && messages.length > 0
      ? [
          {
            label: uiText("export_as_markdown_ac8b027c"),
            icon: <Download className="size-4" />,
            onClick: () => downloadMarkdown(messages, currentChat?.title || "chat"),
          },
          {
            label: uiText("export_as_pdf_e42c8735"),
            icon: <FileDown className="size-4" />,
            onClick: () => void downloadPdf(messages, currentChat?.title || "chat"),
          },
        ]
      : []),
  ]
  const environmentCard = currentSessionId ? (
    <EnvironmentCard
      id={environmentId}
      workspace={displayWorkspace}
      projectName={currentProjectName}
      placement={currentChat?.placement}
      changedFiles={environmentChanges.fileCount}
      addedLines={environmentChanges.addedLines}
      removedLines={environmentChanges.removedLines}
      sources={environmentSources}
      onOpenReview={() => launchWorkbench(onOpenReview ?? onOpenInspector)}
      onPreviewImage={setPreview}
    />
  ) : null

  return (
    <>
      <div
        className="relative flex min-w-0 flex-1 flex-col"
        data-session-drop-target="main"
        {...sessionDrop.handlers}
        onDragOver={(e) => {
          if (e.dataTransfer.types.includes("Files")) {
            e.preventDefault()
            setDragOver(true)
          }
        }}
        onDragLeave={(e) => {
          if (e.currentTarget === e.target) setDragOver(false)
        }}
        onDrop={(e) => {
          e.preventDefault()
          setDragOver(false)
          if (e.dataTransfer.files.length) void addFiles(e.dataTransfer.files)
        }}
      >
        {dragOver || sessionDrop.active ? (
          <div className="pointer-events-none absolute inset-0 z-[60] m-3 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/10 text-sm font-medium text-primary">
            {uiText(sessionDrop.active ? "drop_to_open_session" : "drop_to_add_images_6ccb05f2")}</div>
        ) : null}

        <ChatHeader
          title={currentChat?.title || "Bodhi"}
          hasSession={!!currentSessionId}
          overflowItems={overflowItems}
          onOpenSidebar={onOpenSidebar}
          environment={
            <EnvironmentLauncher
              open={environmentVisible}
              controlsId={environmentId}
              onToggle={() => setEnvironmentPreference(environmentOpen ? "closed" : "open")}
            />
          }
          onOpenSubagents={onOpenSubagents}
          sidePaneOpen={sidePaneOpen ?? false}
          onToggleSidePane={() => launchWorkbench(onToggleSidePane ?? onOpenInspector)}
          sidebarCollapsed={sidebarCollapsed}
          supervisorControl={currentChat && isDefaultSupervisor(currentChat) && ticketScope?.binding.supervisor_session_id === currentSessionId ? (
            <SupervisorOverview controller={tickets} running={currentlyRunning} onSelectWork={onOpenWork ? openTicketWork : undefined} />
          ) : null}
        />

        <div ref={chatLayoutRef} data-chat-layout className="relative flex min-h-0 min-w-0 flex-1">
          <div
            data-chat-body
            className="relative flex min-w-0 flex-1 flex-col"
            style={{ paddingInlineEnd: environmentReservedWidth, transition: "padding-inline-end 200ms ease-out" }}
        data-session-drop-target="main"
        {...sessionDrop.handlers}
          >
        <SessionCompatibilityNotice state={chat.executionCompatibility} sessionId={currentSessionId} />
        {currentSessionId && currentChat?.id === currentSessionId && currentChat.kind !== "child"
          && !currentChat.parentSessionId && pageVisible !== false ? (
          <SessionTaskDag key={`task-dag:${currentSessionId}`} sessionId={currentSessionId} running={currentlyRunning} />
        ) : null}
        {pendingApproval && chat.approvalCompatibility?.blocked ? (
          <section aria-label={uiText("subagent_approval_request_4321e83b")}>
            <p className="px-3 pt-2 text-sm font-medium">{uiText("subagent_approval_request_4321e83b")}</p>
            <SessionCompatibilityNotice state={chat.approvalCompatibility} />
          </section>
        ) : null}
        {currentChat?.planMode ? (
          <div className="border-b bg-primary/10 px-3 py-1.5 text-center text-xs font-medium text-primary">
            {uiText("plan_mode_7cbb85b7")} {(currentChat.planMode as { status?: string }).status
              ? ` · ${(currentChat.planMode as { status?: string }).status}`
              : ""}
          </div>
        ) : null}

        {currentChat?.parentSessionId ? (
          <button
            onClick={() => select(currentChat.parentSessionId as string)}
            className="flex w-full items-center gap-1.5 border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />{uiText("subagent_back_to_parent_session_5f5fc758")}</button>
        ) : null}

        {!currentSessionId && !sending && !pendingUserText && pendingUserImages.length === 0 && !pendingUserMessages?.length ? (
          // Main-pane home view: session shortcuts + quick-start templates.
          // The composer below stays live — a template only prefills it.
          <HomeDashboard
            chats={chats}
            onOpenSession={select}
            onPickTemplate={(prefill) => setDraft(prefill)}
            onDescribeTask={() => composerInputRef.current?.focus()}
          />
        ) : (
        <MessageList
          key={currentSessionId ?? "new-session"}
          scrollRef={scrollRef}
          contentRef={contentRef}
          onScroll={handleScroll}
          messages={messages}
          timelineAttachments={timelineAttachments}
          mergedSubAgents={mergedSubAgents}
          subAgentError={subAgentView.error}
          onRefreshSubAgents={subAgentView.refresh}
          sending={currentlyRunning || yieldedWaiting}
          latestRunFinished={
            !currentlyRunning &&
            !yieldedWaiting &&
            streamPhase === null &&
            currentChat?.lastRunStatus === "completed"
          }
          streaming={streaming}
          streamingActive={streamPhase === "streaming"}
          streamingReasoning={streamingReasoning}
          liveSegments={liveSegments}
          streamStatus={streamStatus}
          backgroundExecWaiting={backgroundExecWaiting}
          delegationWaiting={delegationWaiting && (suspended || activity === "waiting_children") && !backgroundExecWaiting}
          pendingUserText={pendingUserText}
          pendingUserImages={pendingUserImages}
          pendingUserMessages={pendingUserMessages}
          forking={forking}
          executionBlocked={executionBlocked}
          onSelectSubAgent={selectSubAgentInPane}
          onPreviewImage={setPreview}
          onRegenerate={handleRegenerate}
          onFork={handleFork}
          onDelete={deleteMessage}
          onEditMessage={handleEditMessage}
        />
        )}

        {managedHistoryStale && <div role="alert" className="mx-4 mb-2 text-xs text-destructive">{uiText("supervisor_managed_history_stale")}</div>}
        {visibleSendFailure || persistedRunError ? (
          <div
            role="alert"
            aria-live="assertive"
            className="mx-auto mb-1 flex w-[calc(100%-1.5rem)] max-w-full flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
          >
            <div className="min-w-0 flex-1 text-destructive">
              <p className="font-medium">
                {visibleSendFailure?.kind === "submission-unconfirmed"
                  ? visibleSendFailure.rejectionCode
                    ? visibleSendFailure.rootModeSelectionSubmitted
                      ? uiText("bamboo_rejected_the_mode_change_your_content_is_preserv_3445f2fc")
                      : uiText("bamboo_rejected_the_request_your_content_is_preserved_74a6cc8c")
                    : uiText("sending_is_unconfirmed_your_content_is_preserved_4f66238c")
                  : rootMode.unsafe && generationFailed
                    ? uiText("message_saved_but_execution_is_stopped_for_this_session_bacf408a")
                    : runFailureGuidance?.title ?? uiText("message_sent_but_generation_was_interrupted_62a4d83d")}
              </p>
              {rootMode.unsafe && generationFailed ? (
                <p className="mt-1 text-xs">{uiText("the_root_permission_change_is_unconfirmed_your_message__fd9a5b04")}</p>
              ) : visibleSendFailure?.kind === "submission-unconfirmed" && visibleSendFailure.rejectionCode === "session_project_running_conflict" ? (
                <p className="mt-1 text-xs">{uiText("session_source_conflict_action")}</p>
              ) : runFailureGuidance ? (
                <p className="mt-1 text-xs">{runFailureGuidance.action}</p>
              ) : null}
              {runErrorDetail && visibleSendFailure?.kind === "submission-unconfirmed" ? (
                <p className="mt-1 break-words text-xs">{runErrorDetail}</p>
              ) : runErrorDetail ? (
                <details className="mt-1 text-xs">
                  <summary>{uiText("technical_details_c26fb419")}</summary>
                  <p className="mt-1 break-words">{runErrorDetail}</p>
                </details>
              ) : null}
            </div>
            {!currentlyRunning ? <RunDiagnosticsEntry key={currentChat?.updatedAt} subject={runDiagnosticsSubject} /> : null}
            {rootMode.unsafe ? null : generationFailed ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={sending || modelSaving || executionBlocked}
                onClick={() => {
                  if (rootSessionUnsafe()) { setRootModeConflict(uiText("the_root_permission_change_is_unconfirmed_generation_re_bdcf3a6c")); return }
                  if (visibleSendFailure?.kind === "generation-failed") {
                    void retry(visibleSendFailure)
                  } else {
                    void retry()
                  }
                }}
              >
                <RotateCcw className="size-3.5" />{uiText("retry_generation_37960b38")}</Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => composerInputRef.current?.focus()}>
                {uiText("continue_editing_fd4b9e3b")}</Button>
            )}
          </div>
        ) : null}

        <LiveBootstrapRetryNotice offer={liveRetry.offer} disabled={executionBlocked || rootMode.unsafe || modelSaving}
          onConfirm={() => { if (!rootSessionUnsafe()) void liveRetry.confirm() }} onStop={() => void liveRetry.stop()}
          onRefresh={() => { if (!rootSessionUnsafe()) void liveRetry.refresh() }} />

        {chat.upstreamRetryStatus ? <p role="status" className="mx-4 mb-2 text-xs text-muted-foreground">
          {uiText(chat.upstreamRetryStatus === "requesting" ? "upstream_retry_requesting"
            : chat.upstreamRetryStatus === "already_running" ? "upstream_retry_already_running"
            : chat.upstreamRetryStatus === "enabled" ? "upstream_retry_enabled"
            : chat.upstreamRetryStatus === "stopping" ? "upstream_retry_stopping"
              : chat.upstreamRetryStatus === "stop_requested" ? "upstream_retry_stop_requested"
                : chat.upstreamRetryStatus === "not_started" ? "upstream_retry_not_started"
                : chat.upstreamRetryStatus === "unavailable" ? "upstream_retry_unavailable"
                  : chat.upstreamRetryStatus === "identity_unsaved" ? "upstream_retry_identity_unsaved"
                    : chat.upstreamRetryStatus === "identity_unavailable" ? "upstream_retry_identity_unavailable" : "upstream_retry_stop_unconfirmed")}
        </p> : null}

        {queue.error && <div role="alert" className="mx-auto mb-1 w-[calc(100%-1.5rem)] max-w-full rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive">{queue.error}</div>}
        {workPanelTarget ? createPortal(ticketScope?.binding.supervisor_session_id === currentSessionId ? (
          <LazyTicketWorkPanel key={currentSessionId} onReady={focusWorkPanel} controller={tickets} selectedWorkId={selectedWorkId} onShowAll={() => openTicketWork(null)} onReference={tickets.canSendIngress && ticketScope.capabilities?.message_references_v1 === true && !pendingTicketMessage ? (request) => {
            setTicketReference(request)
            onWorkReference?.()
            requestAnimationFrame(() => composerInputRef.current?.focus())
          } : undefined} />
        ) : <TicketWorkAvailability availability={tickets.availability} refreshing={tickets.refreshing} canRefresh={tickets.canRefresh} onRefresh={() => void tickets.refresh()} canInitialize={tickets.canInitialize} initializing={tickets.initializing} initializationError={tickets.initializationError} onInitialize={() => void tickets.initialize()} />, workPanelTarget) : null}
        {semanticComposer && visibleTicketReference ? <div className="mx-4 mb-2 flex items-center gap-2 text-xs" data-testid="ticket-reference">
          <span>{uiText("ticket_reference", { title: tickets.state?.works[visibleTicketReference.work_id]?.ticket.contract.title ?? uiText("supervisor_work_tab") })}</span>
          <button type="button" className="underline" disabled={pendingTicketMessage} onClick={() => setTicketReference(null)}>{uiText("ticket_clear_reference_b2e538a2")}</button>
        </div> : null}
        {semanticComposer && ticketIngress.starting ? <p role="status" className="mx-4 mb-2 text-xs text-muted-foreground">
          {uiText("ticket_starting")}
        </p> : null}
        {semanticComposer && !ticketIngress.starting && (ticketIngress.error || pendingTicketMessage && !ticketIngress.busy) ? <div role="alert" className="mx-4 mb-2 text-xs text-destructive">{ticketIngress.error ?? uiText("ticket_the_previous_message_is_not_confirmed_retry_w_7369504e")}
          {ticketIngress.canRetryStart ? <button type="button" className="ml-2 underline" onClick={() => void ticketIngress.retryExecute()}>{uiText("ticket_retry_start_47d5cd3e")}</button> : null}
        </div> : null}
        <div data-composer-region className="relative shrink-0">
          {/* Keep the jump control centered on the available chat column. */}
          {!atBottom && (
            <div
              data-scroll-to-bottom-anchor
              className="pointer-events-none absolute inset-x-0 top-0 z-20 mx-auto flex max-w-full -translate-y-1/2 justify-center px-3"
            >
              <button
                onClick={scrollToBottom}
                aria-label={uiText("scroll_to_bottom_2b05ff67")}
                className="pointer-events-auto rounded-full border bg-card p-2 text-muted-foreground shadow-lg transition-colors hover:bg-accent hover:text-foreground"
              >
                <ChevronDown className="size-5" />
              </button>
            </div>
          )}
          <div className="shrink-0">
          <ContextCompressionNotice
            feedback={contextCompression}
            sessionId={pageVisible && currentChat?.kind === "root" ? currentSessionId : null}
            manualPending={compacting}
            runActive={currentlyRunning}
          />
          <Composer
          draft={draft}
          draftKey={draftKey}
          outputRate={outputRate}
          onDraftChange={setDraft}
          executionBlocked={executionBlocked}
          onSubmit={() => submit()}
          onStop={stopWithLiveFence}
          sending={currentlyRunning}
          queueMode={queue.mode}
          onQueueModeChange={currentSessionId && !submissionPending && !semanticComposer && !loopDraft ? queue.setMode : undefined}
          sendWhileRunning={semanticComposer || loopDraft}
          queueControls={currentSessionId && !semanticComposer ? <SessionGuidance key={currentSessionId} sessionId={currentSessionId} messages={queue.pending} busy={queue.busy} onCancel={(id) => void queue.cancel(id)} onPreview={setPreview} /> : null}
          workspaceControl={!currentSessionId ? <Suspense fallback={null}>
            <NewChatWorktreeControl projectId={pendingProjectId ?? null}
              workspacePath={worktreePath ?? selectedProjectPath ?? pickedWorkspace}
              value={preparation.selection} onChange={(value) => preparation.select(value)}
              automatic={automaticWorktree}
              disabled={preparation.locked || submissionPending || preparationPending}
              preparedPath={preparation.path} error={worktreeErrorMessage(preparation.error)} />
            {preparationPending ? <span role="status" className="px-2 text-xs text-muted-foreground">{uiText("chat_worktree_preparing")}</span> : null}
          </Suspense> : null}
          permissionControl={(
            <>
              {currentSessionId ? (
                <PermissionModeControl
                  sessionId={currentSessionId}
                  title={currentChat?.title || currentSessionId}
                  compact
                />
              ) : <NewSessionPermissionControl />}
              <RootOrchestrationControl
                sessionId={currentSessionId}
                child={rootMode.child}
                unsafe={rootMode.unsafe}
                selected={rootMode.selected}
                confirmed={rootMode.confirmed}
                loading={rootMode.loading}
                pending={submissionPending || rootMode.busy}
                recovering={rootMode.recovering}
                recoverable={rootMode.recoverable}
                error={rootMode.error}
                conflict={rootModeConflict ?? skillModeConflict}
                onRetry={() => { void rootMode.retry() }}
              />
              {rootMode.child && rootMode.error ? (
                <span role="alert" className="basis-full text-destructive">{rootMode.error}</span>
              ) : null}
            </>
          )}
          runtimeControls={(
            <>
              {tokenUsage ? (
                <ContextUsageRing
                  totalTokens={tokenUsage.totalTokens}
                  maxContextTokens={tokenUsage.maxContextTokens}
                  cacheReadInputTokens={tokenUsage.cacheReadInputTokens}
                  cacheReadInputTokensRetained={tokenUsage.cacheReadInputTokensRetained}
                  prefixCache={tokenUsage.prefixCache}
                  onClick={() => launchWorkbench(onOpenInspector)}
                />
              ) : null}
              <ModelEffortPicker
                modelGroups={modelGroups}
                model={activeModel}
                modelProvider={activeModelRef?.provider}
                onModelChange={(model) => void handleModelChange(model)}
                modelDisabled={modelControlDisabled}
                value={rootMode.ordinaryValue}
                allowUltra={rootMode.isRoot}
                thinkingMode={rootMode.thinkingMode}
                onChange={(selection) => { setRootModeConflict(null); void rootMode.choose(selection) }}
                disabled={rootMode.controlDisabled || ticketIngress.busy}
                menuPlacement="up"
                menuAlign="right"
              />
            </>
          )}
          submissionPending={submissionPending || preparationPending || goalSaving || compacting || queue.busy || ticketIngress.busy || modelSaving || rootMode.busy}
          inputRef={composerInputRef}
          attachments={attachments}
          onAddFiles={(files) => void addFiles(files)}
          onRemoveAttachment={(id) =>
            changeAttachments((prev) => prev.filter((x) => x.id !== id))
          }
          onPreviewImage={setPreview}
          selectedSkill={selectedSkill}
          onClearSkill={() => changeSelectedSkill(null)}
          onPickSkill={pickSkill}
          skills={skills}
          onOpenWorkflowRuns={currentSessionId ? openWorkflowRuns : undefined}
          onPickGoal={currentSessionId ? () => { launchWorkbench(onOpenInspector); setDraft(""); setMenusDismissed(true) } : undefined}
          onPickCompact={() => {
            const latest = useAppStore.getState().inputStates[draftKey]
            if (currentDraftKeyRef.current === draftKey && latest?.content === draft) {
              compactDraft(latest.contentRevision ?? 0, true)
            }
          }}
          compactUnavailable={compactionUnavailableReason()}
          slashQuery={slashQuery}
          onMentionQueryChange={setAtQuery}
          displayWorkspace={displayWorkspace}
          showProjectWorkspace={!!selectedWorktreePath}
          workspaceFiles={workspaceFiles}
          hasSession={!!currentSessionId}
          onOpenWorkspacePicker={onOpenWorkspacePicker}
          selectedProjectId={pendingProjectId ?? null}
          onSelectProject={(projectId) => onSelectProject?.(projectId)}
          onDismissMenus={() => setMenusDismissed(true)}
        />
          </div>
        </div>
          </div>

          {environmentCard ? (
            <div
              data-environment-floating
              data-state={environmentVisible ? "open" : "closed"}
              aria-hidden={!environmentVisible}
              className="absolute right-3 top-3 z-30 max-h-[calc(100%-1.5rem)] max-w-[calc(100%-1.5rem)] overflow-y-auto rounded-2xl"
              style={{
                opacity: environmentVisible ? 1 : 0,
                transform: environmentVisible
                  ? "translateX(0) scale(1)"
                  : "translateX(0.75rem) scale(0.98)",
                transformOrigin: "top right",
                visibility: environmentVisible ? "visible" : "hidden",
                pointerEvents: environmentVisible ? "auto" : "none",
                transition: "opacity 200ms ease-out, transform 200ms ease-out, visibility 200ms ease-out",
              }}
            >
              {environmentCard}
            </div>
          ) : null}
        </div>
      </div>

      <Toasts forking={forking} toast={toast} onDismiss={() => setToast(null)} onRestoreFocus={() => { if (pageVisible !== false) composerInputRef.current?.focus() }} />
      {clearTarget ? <ConversationClearDialog key={clearTarget.id} sessionId={clearTarget.id} title={clearTarget.title}
        onClose={() => setClearTarget(null)} /> : null}
      {workflowRunsOpen && currentSessionId && pageVisible !== false ? <WorkflowRunsDialog key={currentSessionId}
        sessionId={currentSessionId} sessionTitle={currentChat?.title || currentSessionId}
        projectId={currentChat?.config?.projectId} projectName={currentProjectName}
        onClose={() => setWorkflowRunsOpen(false)} /> : null}

      <ImageLightbox src={preview} onClose={() => setPreview(null)} />

      {!pendingQuestion && questionError ? (
        <div role="alert" className="mx-4 mb-3 flex items-center gap-3 rounded-lg border p-3 text-sm">
          <span>{questionError}</span>
          <button type="button" className="shrink-0 underline" disabled={questionLoading || questionSubmitting} onClick={() => void refreshQuestion()}>
            {questionLoading ? uiText("refreshing_71659de8") : uiText("refresh_request_0ab317cc")}
          </button>
        </div>
      ) : null}

      {!executionBlocked && pendingQuestion?.interaction_kind === "clarification"
          && (!pendingApproval || chat.approvalCompatibility?.blocked) ? (
        <QuestionDialog q={pendingQuestion} onAnswer={(t) => void answerQuestion(t)}
          loading={questionLoading} submitting={questionSubmitting} unavailable={questionUnavailable}
          error={questionError} canRetry={questionCanRetry}
          onRefresh={() => void refreshQuestion()} onRetry={() => void retryQuestion()} />
      ) : null}
    </>
  )
}
