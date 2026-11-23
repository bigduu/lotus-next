import { supportsContinuousUpstreamRetry, readUpstreamRetryCapability, isRetryRunId, type UpstreamRetrySelection, type UpstreamRetryFeedback } from "@services/chat/upstreamRetry"
import type { PublicRunDiagnostic } from "@services/chat/runDiagnostic"
import { uiText } from "@shared/i18n/text"
import { createOutputRate, createSessionExecutionCompatibility } from "./observation"
import { isSessionExecutionBlocked, observeSessionExecutionConflict } from "@services/chat/sessionExecutionCompatibility"
import { createEffect, createMemo, createSignal, onSettled, untrack } from "solid-js"
import { shallow } from "zustand/vanilla/shallow"
import { createStoreSelector } from "@/solid/state/createStoreSelector"
import { cell, createExternalSnapshot, createObservableCell } from "./snapshots"
import {
  appStore,
  initializeStore,
  selectSessionById,
  selectShouldObserve,
} from "@shared/store/appStore/state"
import { providerStore } from "@shared/store/appStore/slices/providerState"
import { recordUsedModel } from "@shared/utils/usedModels"
import {
  agentClient,
  type PendingQuestionResponse,
  type PermissionDecisionChoice,
  type PermissionDecisionRequest,
  type ReasoningEffort,
  type SessionPermissionMode,
  type ExecuteResponse,
} from "@services/chat/AgentService"
import { permissionDecisionFor } from "@services/chat/permissionDecision"
import {
  deliverSessionNotification, observeBackgroundShells, recordBackgroundShellOutcome,
} from "@services/chat/backgroundShellObservation"
import { apiClient, getBackendStorageScope } from "@services/api"
import { getErrorMessage, isApiError } from "@services/api/errors"
import { backgroundBashIds, hasSessionWorkWait, parseBackgroundBashLaunch } from "@/lib/sessionBackgroundTasks"
import { beginOrdinaryRetryFence, beginContinuousRetryFence, confirmContinuousRetryFence, confirmOrdinaryStartedWithoutRunId, discardUnsentContinuousRetryFence, restoreConfirmedUnstartedRetryFence, readContinuousRetryFence, readOrdinaryRetryFence } from "@/lib/continuousRetryFence"
import { mapTokenBudgetUsage } from "@shared/types/tokenBudget"
import {
  compressionBudgetReceived, compressionFeedbackFromStatus, compressionRunEnded,
  summaryFeedback, type ContextCompressionFeedback,
} from "@/lib/contextCompression"
import { getSystemPromptEnhancementText } from "@shared/utils/systemPromptEnhancement"
import { recordSessionUserInput } from "@/lib/sidebarSessionOrderState"
import {
  acknowledgePendingTemplatePrompt,
  type PendingTemplatePromptSnapshot,
} from "@/lib/taskTemplates"
import {
  getRootModeFenceState,
} from "@/lib/rootModeTransitionState"
import type { Message, MessageImage } from "@shared/types/chat"
import { projectCompletedAnswers, type CompletedAnswerHandoff } from "@/lib/completedAnswerHandoff"
import {
  acquireCompletedAnswerLease, getCompletedAnswerHandoffs, invalidateCompletedAnswerForDeletedMessage, invalidateCompletedAnswers,
  newCompletedAnswerHandoffId, reconcileCompletedAnswers, releaseCompletedAnswerLease,
  retainCompletedAnswer, subscribeCompletedAnswerHandoffs,
} from "@/lib/completedAnswerHandoffRegistry"
import { resolveNewChatModelRef } from "@shared/types/providerConfig"
import type { ProviderModelRef } from "@shared/types/providerModelRef"
import {
  getReasoningEffortForProvider,
  type ReasoningEffortSelection,
} from "@shared/utils/reasoningEffort"

export type PendingQuestion = Extract<PendingQuestionResponse, { has_pending_question: true }>
export type RecordedPermission = {
  question: Extract<PendingQuestion, { interaction_kind: "permission" }>
  decision: PermissionDecisionChoice
  continued: boolean
}
type QuestionScope = { sessionId: string | null | undefined; epoch: number }
type QuestionState = {
  scope: QuestionScope
  question: PendingQuestion | null
  loading: boolean
  submitting: boolean
  unavailable: boolean
  error: string | null
  retry: PermissionDecisionRequest | null
  recordedKey: string | null
  recordedPermission?: RecordedPermission
}
const questionKey = (q: PendingQuestion) => JSON.stringify([
  q.interaction_kind, q.tool_call_id,
  q.interaction_kind === "permission" ? q.permission_request.request_generation : null,
  q.interaction_kind === "permission" ? q.permission_request.policy_revision : null,
])
const sameQuestionScope = (a: QuestionScope, b: QuestionScope) =>
  a.sessionId === b.sessionId && a.epoch === b.epoch
export type PendingApproval = {
  childSessionId: string
  requestId: string
  toolName?: string
  permission?: string
  resource?: string
}

export type SubmissionUnconfirmedFailure = {
  kind: "submission-unconfirmed"
  operationId: number
  sessionId: string | null
  message?: string
  rejectionCode?: SubmissionRejectionCode
  rootModeSelectionSubmitted?: boolean
}

type SubmissionRejectionCode = "root_orchestration_incompatible_mode" | "root_orchestration_requires_root" | "session_project_running_conflict"

const submissionRejectionCode = (error: unknown): SubmissionRejectionCode | null => {
  if (!isApiError(error) || (error.status !== 400 && error.status !== 409) || !error.body) return null
  try {
    const parsed = JSON.parse(error.body) as { error?: { code?: unknown } }
    const code = parsed.error?.code
    if (code === "session_project_running_conflict") return error.status === 409 ? code : null
    return code === "root_orchestration_incompatible_mode" || code === "root_orchestration_requires_root"
      ? code : null
  } catch {
    return null
  }
}

// This provisional producer response explicitly refuses this request before it
// starts. A generic conflict, missing session binding, or lost response is not
// proof of non-start and must keep the pending identity fence.
const isUnpreparedContinuousRetryRefusal = (error: unknown, sessionId: string): boolean => {
  if (!isApiError(error) || error.status !== 409 || !error.body) return false
  try {
    const body: unknown = JSON.parse(error.body)
    if (!body || typeof body !== "object" || Array.isArray(body) || Object.hasOwn(body, "run_id")) return false
    const value = body as { session_id?: unknown; error?: unknown }
    if (value.session_id !== sessionId || !value.error || typeof value.error !== "object" || Array.isArray(value.error)) return false
    return (value.error as { code?: unknown }).code === "retry_resume_not_prepared"
  } catch { return false }
}

export type GenerationFailure = {
  diagnostic?: Readonly<PublicRunDiagnostic>
  kind: "generation-failed"
  operationId: number
  sessionId: string
  pendingOperationId?: number
  message?: string
}

export type SendFailure = SubmissionUnconfirmedFailure | GenerationFailure

const toFailureMessage = (error: unknown): string | undefined => {
  if (error == null) return undefined
  if (typeof error === "string") return error.trim() || undefined
  return getErrorMessage(error).trim() || undefined
}

export type SendSubmissionResult =
  | { kind: "accepted"; operationId: number; sessionId: string; navigated: boolean }
  | { kind: "unconfirmed"; operationId: number; rejectionCode?: SubmissionRejectionCode }
  | { kind: "blocked" }
  | { kind: "busy" }
  | { kind: "ignored" }

type ActiveSendOperation = {
  id: number
  phase: "submitting" | "preparing" | "generating"
  originSessionId: string | null
  originNavigationEpoch: number
  acknowledgedSessionId?: string
  pendingOperationId?: number
}

/** A single live (in-run) tool invocation, streamed over the agent channel. */
export type LiveToolCall = {
  toolCallId: string
  toolName: string
  args?: Record<string, unknown>
  /** Streamed output while running; replaced by the final result on complete. */
  output: string
  status: "running" | "completed" | "error"
  error?: string
  images?: Array<{ mime_type: string; data: string }>
}

/**
 * One frozen segment of the CURRENT run's live timeline. Text the model
 * finished streaming before a tool round freezes into a `text` segment; the
 * round's tool calls accumulate in a `tools` segment. The still-streaming tail
 * stays in `streaming`/`streamingReasoning`. On terminal, persisted segments
 * replace the timeline while an uncommitted final text tail remains visible.
 */
export type LiveSegment =
  | { kind: "text"; text: string; reasoning: string | null }
  | { kind: "tools"; calls: LiveToolCall[] }

type BufferedLiveSegment = LiveSegment | { kind: "interjection"; messageId: string }

export type StreamPhase = "streaming" | "finalizing" | null

type ScopedCompressionFeedback = {
  sessionId: string
  operationId: number
  phase: string
  value: ContextCompressionFeedback
}

type RetainedTerminal = CompletedAnswerHandoff & { lease: ReturnType<typeof acquireCompletedAnswerLease> }

type StopDispatchKind = "legacy" | "exact"
type ContinuousStopFence = {
  sessionId: string
  operationId: number
  observation?: true
  stop: (onDispatched?: () => void) => Promise<StopDispatchKind>
}

// All panes share one immutable API client. Keep the exact Execute receipt
// across navigation and pane remounts; a stale run identity fails closed.
const continuousStopFences = new Map<string, ContinuousStopFence>()

const requestLegacyStop = async (sessionId: string, onDispatched?: () => void) => {
  const store = appStore.getState()
  store.markCancel(sessionId)
  store.updateSession(sessionId, { isRunning: false }, { skipBackendPatch: true })
  const request = agentClient.stopGeneration(sessionId)
  onDispatched?.()
  await request
  return "legacy" as const
}

const stopExactContinuousRun = async (
  sessionId: string, runId: string, onDispatched?: () => void, isCurrent?: () => boolean,
) => {
  // An older producer may ignore an unfamiliar Stop header. Re-negotiate
  // support rather than treating a persisted identity as proof of capability.
  if (!await supportsContinuousUpstreamRetry()) throw new Error("Exact Stop capability unavailable")
  if (isCurrent && !isCurrent()) throw new Error("Execution identity unavailable")
  const request = agentClient.stopGeneration(sessionId, runId)
  onDispatched?.()
  await request
  return "exact" as const
}

const coalesceExactStop = (dispatch: (onDispatched?: () => void) => Promise<StopDispatchKind>) => {
  let pending: Promise<StopDispatchKind> | null = null
  return (onDispatched?: () => void) => {
    if (pending) return pending
    const request = dispatch(onDispatched)
    pending = request
    // A failed request may be retried only by another explicit user action.
    void request.catch(() => { if (pending === request) pending = null })
    return request
  }
}

const EMPTY_PENDING_IMAGES: readonly MessageImage[] = []

type PendingUserMessage = {
  operationId: number
  sid: string
  text: string
  images: readonly MessageImage[]
  acknowledgedMessageId: string | null
  baselineMessageIds: ReadonlySet<string>
}

export type PendingUserMessageView = Pick<PendingUserMessage, "operationId" | "text" | "images">

type PendingUserState = {
  entries: ReadonlyMap<number, PendingUserMessage>
  claimed: ReadonlyMap<string, ReadonlySet<string>>
}

const matchPendingUserMessages = (
  messages: Message[], pending: readonly PendingUserMessage[], claimed: ReadonlySet<string> = new Set(),
): ReadonlyMap<number, string> => {
  const matches = new Map<number, string>(), used = new Set(claimed)
  // Explicit ACK IDs take precedence over the legacy text/baseline fallback.
  for (const entry of pending) {
    if (entry.acknowledgedMessageId !== null
      && messages.some((message) => message.role === "user" && message.id === entry.acknowledgedMessageId)) {
      matches.set(entry.operationId, entry.acknowledgedMessageId)
      used.add(entry.acknowledgedMessageId)
    }
  }
  // Legacy ACKs omit message IDs: consume new canonical IDs in history order
  // at most once, including after an earlier operation has retired.
  for (const entry of pending) {
    if (entry.acknowledgedMessageId !== null) continue
    const message = messages.find((message) => message.role === "user" && !used.has(message.id)
      && !entry.baselineMessageIds.has(message.id) && "content" in message && message.content.trim() === entry.text)
    if (message) { matches.set(entry.operationId, message.id); used.add(message.id) }
  }
  return matches
}

type PromptPresetForComposition = {
  id: string
  content?: string
  isDefault?: boolean
}

/**
 * Compose a new session's durable base prompt.
 *
 * A task template narrows the selected/default assistant prompt; it must not
 * replace that prompt and silently discard its identity or operating policy.
 */
const composeNewSessionSystemPrompt = (
  prompts: PromptPresetForComposition[],
  selectedPromptId: string | null,
  taskPrompt?: string,
): string | undefined => {
  const selectedPrompt = selectedPromptId
    ? prompts.find((prompt) => prompt.id === selectedPromptId)
    : undefined
  const selectedContent = selectedPrompt?.content?.trim()
  const taskContent = taskPrompt?.trim()

  if (!taskContent) return selectedContent || undefined

  const defaultContent = (
    prompts.find((prompt) => prompt.isDefault)?.content
    ?? prompts[0]?.content
  )?.trim()
  const baseContent = selectedContent || defaultContent

  return baseContent
    ? `${baseContent}\n\n## Task Mode\n${taskContent}`
    : taskContent
}

const STREAM_TEXT_PUBLISH_INTERVAL_MS = 100

// Stable empty array so instances not owning the live stream don't re-render.
const EMPTY_SEGMENTS: LiveSegment[] = []

/**
 * Minimal P0 chat orchestration on top of the ported store + AgentService.
 *
 * Session list, history and persisted messages come from the store; live token
 * streaming is held locally here (the full jotai streaming machine is a later
 * port). On terminal the live tail enters `finalizing` and remains visible
 * until a history reconciliation proves that the persisted assistant message
 * is readable.
 *
 * `boundSessionId` makes the hook drive a SPECIFIC session instead of the global
 * "current" one — this is what lets multiple panes each run an independent live
 * chat. Called with no argument (the main pane), the hook follows the global
 * `currentSessionId` and behaves exactly as before. A bound instance skips the
 * one-time app bootstrap (the main instance owns it) and never persists the
 * "last session" pointer.
 */
export function createChat(
  boundSessionId?: () => string | null,
  // For bound instances: when a send/fork creates a NEW session, the bound
  // instance must NOT mutate the global current (that would hijack the main
  // pane). Instead it reports the new id here so the caller can re-bind its own
  // pane to it (e.g. App's setSecondSid).
  onSessionCreated?: (sessionId: string) => void,
  options: { pageVisible?: () => boolean } = {},
) {
  const pageVisible = options.pageVisible ?? (() => true)
  const isBound = boundSessionId !== undefined

  const chats = createStoreSelector(appStore, (s) => s.chats, shallow)
  const globalCurrentSessionId = createStoreSelector(appStore, (s) => s.currentSessionId)
  const sessionIndexRevision = createStoreSelector(appStore, (s) => s.sessionIndexRevision)
  // The session this hook instance drives: a bound pane uses its own id; the
  // main pane follows the global current. Everything below keys off `sid`.
  const sid = createMemo(() => boundSessionId ? boundSessionId() : globalCurrentSessionId())
  const readSessionId = () => boundSessionId ? boundSessionId() : appStore.getState().currentSessionId
  const executionCompatibility = createSessionExecutionCompatibility(() => sid())
  const currentChat = createStoreSelector(appStore, (state) => selectSessionById(sid())(state))
  const canonicalMessages = createStoreSelector(appStore, (s) => selectSessionById(sid())(s)?.messages ?? [], shallow)
  const observedShellIds = createStoreSelector(appStore, (s) => backgroundBashIds(selectSessionById(sid())(s)?.messages), shallow)
  createEffect(
    () => [sid(), observedShellIds()] as const,
    ([sessionId, shellIds]) => {
      if (sessionId) observeBackgroundShells(sessionId, shellIds)
    },
  )
  const completedHandoffs = createExternalSnapshot(subscribeCompletedAnswerHandoffs, getCompletedAnswerHandoffs)
  createEffect(
    () => [chats(), completedHandoffs(), canonicalMessages()] as const,
    () => untrack(() => {
      for (const sessionId of new Set(completedHandoffs().map((entry) => entry.sessionId))) {
        const chat = chats().find((item) => item.id === sessionId)
        // A paged or bootstrapping index can omit a still-existing session.
        // Only explicit clear/delete signals and the cache limits retire it.
        if (chat) reconcileCompletedAnswers(sessionId, chat.messages)
      }
    }),
  )
  // Resolve a profile from the exact session at action admission. Async restore
  // and retry preparation must not switch to the current pane's model.
  const readExecutionProfile = (sessionId: string | null) => {
    const state = appStore.getState()
    const providerSnapshot = providerStore.getState().providerSnapshot
    const chatDefault = providerSnapshot?.defaults?.chat
    if (!sessionId) {
      const modelRef = resolveNewChatModelRef(providerSnapshot, state.selectedModel)
      const selection = state.inputStates[""]?.reasoningEffort
      return {
        model: modelRef?.model || "",
        modelRef,
        reasoningEffort: selection === "auto" ? undefined : selection ?? chatDefault?.reasoning_effort,
      }
    }
    const session = selectSessionById(sessionId)(state)
    const sessionRef = session?.config?.model_ref
    const sessionModel = sessionRef?.model || session?.config?.model || ""
    let modelRef: ProviderModelRef | undefined
    if (sessionRef?.provider?.trim() && sessionRef.model?.trim()) {
      modelRef = { provider: sessionRef.provider, model: sessionRef.model }
    } else if (!sessionModel && chatDefault?.provider?.trim() && chatDefault.model) {
      modelRef = { provider: chatDefault.provider, model: chatDefault.model }
    }
    return {
      model: sessionModel || chatDefault?.model || "",
      modelRef,
      reasoningEffort: session?.config?.reasoningEffort ?? sessionRef?.reasoning_effort
        ?? getReasoningEffortForProvider(providerSnapshot, sessionRef?.provider || modelRef?.provider),
    }
  }

  const [booted, setBooted] = createSignal(false)
  const [streamingText, setStreamingText] = createSignal<string | null>(null)
  const [streamPhaseState, setStreamPhaseState] = createSignal<StreamPhase>(null)
  // The session the live stream belongs to — so streaming only renders in ITS
  // conversation, never leaking into another session the user switched to.
  const [streamSid, setStreamSid] = createSignal<string | null>(null)
  // Retain every acknowledged send until its own canonical user message arrives.
  const [pendingState, setPendingState] = createSignal<PendingUserState>(({ entries: new Map(), claimed: new Map() }))
  const [sending, setSending] = createSignal(false)
  const { rate: outputRate, record: recordOutput, reset: resetOutputRate } = createOutputRate(sid, () => (sending() || currentChat()?.isRunning === true) && streamSid() === sid())
  const [submissionPending, setSubmissionPending] = createSignal(false)
  const [sendFailures, setSendFailures] = createSignal<ReadonlyMap<string | null, SendFailure>>(new Map())
  const [pendingApproval, setPendingApproval] = createSignal<PendingApproval | null>(null)
  const [approvalSubmission, setApprovalSubmission] = createSignal<{
    request: PendingApproval; submitting: boolean; error: string | null
  } | null>(null)
  const approvalSubmitRef = cell<PendingApproval | null>(null)
  const approvalCompatibility = createSessionExecutionCompatibility(() => pendingApproval()?.childSessionId ?? null)
  const abortRef = cell<AbortController | null>(null)
  const mountedRef = cell(false)
  const [owned, setOwned] = createSignal(false)
  const operationSequenceRef = cell(0)
  const activeSendRef = cell<ActiveSendOperation | null>(null)
  // A pane that started a run retains that identity even if another pane
  // later starts a successor in the same session.
  const paneStopFencesRef = cell<Map<string, ContinuousStopFence>>(new Map())
  const stoppingFencesRef = cell(new Set<ContinuousStopFence>())
  const [upstreamRetryFeedback, setUpstreamRetryFeedback] = createSignal<{
    sessionId: string; operationId: number; status: UpstreamRetryFeedback
  } | null>(null)
  const sendFailuresRef = cell<ReadonlyMap<string | null, SendFailure>>(new Map())
  const latestOperationBySessionRef = cell<Map<string | null, number>>(new Map())
  const streamOperationRef = cell<number | null>(null)
  const streamBaselineMessageIdRef = cell<string | null>(null)
  const streamBaselineToolResultIdsRef = createObservableCell<ReadonlySet<string>>(new Set())
  const streamUserMessageIdRef = createObservableCell<string | null>(null)
  const subscriptionRef = cell<{ operationId: number; sessionId: string } | null>(null)
  let navigation = { sessionId: untrack(readSessionId), epoch: 0 }
  const navigationRef = {
    get current() {
      sid()
      const sessionId = readSessionId()
      if (navigation.sessionId !== sessionId) navigation = { sessionId, epoch: navigation.epoch + 1 }
      return navigation
    },
  }

  const [questionState, setQuestionState] = createSignal<QuestionState>(({
    scope: navigationRef.current, question: null, loading: false, submitting: false,
    unavailable: false, error: null, retry: null, recordedKey: null,
  }))
  const questionStateRef = cell(untrack(() => questionState()))
  const questionReadSequenceRef = cell(0)
  const questionSubmitRef = cell<{ scope: QuestionScope; key: string; awaitingResponse: boolean } | null>(null)
  const visibleQuestionState = createMemo(() => sameQuestionScope(questionState().scope, navigationRef.current) ? questionState() : null)
  const pendingQuestion = createMemo(() => visibleQuestionState()?.question ?? null)
  const updateQuestionState = (update: (current: QuestionState) => QuestionState) => {
    const next = update(questionStateRef.current)
    questionStateRef.current = next
    setQuestionState(next)
  }
  const ownsQuestionScope = (scope: QuestionScope) =>
    mountedRef.current && sameQuestionScope(scope, navigationRef.current)

  // Event payloads are notifications only. Opening and explicit refresh use
  // this same canonical reader, with ownership independent of stream completion.
  const reconcileQuestion = async (
    scope: QuestionScope = navigationRef.current,
    preserveError = false,
  ): Promise<"pending" | "absent" | "unavailable" | "stale"> => {
    if (!scope.sessionId || !ownsQuestionScope(scope)) return "stale"
    const sequence = ++questionReadSequenceRef.current
    updateQuestionState((current) => ({ ...current, loading: true }))
    try {
      const result = await agentClient.getPendingQuestion(scope.sessionId)
      if (!ownsQuestionScope(scope) || questionReadSequenceRef.current !== sequence) return "stale"
      const question = result.has_pending_question ? result : null
      updateQuestionState((current) => {
        const previousKey = current.question ? questionKey(current.question) : current.recordedKey
        const changed = !!question && (questionKey(question) !== previousKey
          || (current.retry && question.interaction_kind === "permission"
            && !permissionDecisionFor(question.permission_request, current.retry.decision)))
        if (changed) questionSubmitRef.current = null
        const retry = changed ? null : current.retry
        const recordedKey = changed ? null : current.recordedKey
        const submission = questionSubmitRef.current
        const awaitingResponse = submission?.awaitingResponse && sameQuestionScope(submission.scope, scope)
          && current.question && questionKey(current.question) === submission.key
        // Absence cannot settle a POST whose response is still pending, or an
        // ambiguous permission POST awaiting an explicit exact retry.
        return { scope, question: question ?? (retry || awaitingResponse ? current.question : null),
          loading: false, submitting: changed ? false : current.submitting, unavailable: false,
          retry, recordedKey, recordedPermission: current.recordedPermission,
          error: preserveError || retry || recordedKey ? current.error : null }
      })
      return question ? "pending" : "absent"
    } catch {
      if (!ownsQuestionScope(scope) || questionReadSequenceRef.current !== sequence) return "stale"
      updateQuestionState((current) => ({ ...current, loading: false, unavailable: true,
        error: current.recordedKey ? uiText("your_decision_was_recorded_but_subsequent_state_cannot__624ad0a2")
          : current.retry ? uiText("the_previous_submission_is_unconfirmed_and_the_current__c5a7efbd")
            : uiText("the_confirmation_request_cannot_be_read_right_now_refre_05a4bdbe") }))
      return "unavailable"
    }
  }
  // The session whose agent channel this instance is CURRENTLY subscribed to
  // (null once the subscription settles). Guards the passive-observe engine
  // against double-subscribing a run we already drive/watch.
  const subscribedSidRef = cell<string | null>(null)
  // Keep the full answer for tool boundaries and settlement while publishing
  // less often to the Markdown renderer.
  const streamBufRef = cell("")
  const cancelTextPublishRef = cell<(() => void) | null>(null)
  const lastTextPublishAtRef = cell<number | null>(null)
  const livePreviewVisibleRef = cell(untrack(() => pageVisible() && !document.hidden))
  const resumePreviewRafRef = cell<number | null>(null)
  // Coalesce live reasoning ("思考过程") updates once per animation frame.
  const [streamingReasoningText, setStreamingReasoningText] = createSignal<string | null>(null)
  const reasonBufRef = cell("")
  const reasonRafRef = cell<number | null>(null)
  // Per-child rolling output buffer for live sub-agent previews.
  const childBufRef = cell<Record<string, string>>({})
  // The current run's frozen live timeline (finished text rounds + tool groups).
  // Mutations happen on the ref; a RAF flush clones into state ≤1×/frame.
  const [liveSegmentsState, setLiveSegmentsState] = createSignal<BufferedLiveSegment[]>([])
  const liveSegRef = cell<BufferedLiveSegment[]>([])
  const segRafRef = cell<number | null>(null)
  const toolCallsByIdRef = cell<Map<string, LiveToolCall>>(new Map())
  // One-line "what is the agent doing" status (tool running / compacting…),
  // shown while no text is streaming.
  const [streamStatusState, setStreamStatusState] = createSignal<string | null>(null)
  const streamStatusRef = cell<string | null>(null)
  const [compressionState, setCompressionState] = createSignal<ScopedCompressionFeedback | null>(null)
  const compressionRef = cell<ScopedCompressionFeedback | null>(null)
  // A completed live tail remains renderable until the WebSocket/SSE-triggered
  // history reconciliation contains that exact terminal assistant message.
  const retainedTerminalRef = createObservableCell<RetainedTerminal | null>(null)
  const answerLeaseRef = createObservableCell<ReturnType<typeof acquireCompletedAnswerLease> | null>(null)
  const retainTerminalAcrossUnmount = () => {
    const retained = retainedTerminalRef.current
    if (!retained) return
    const { lease, ...handoff } = retained
    const chat = appStore.getState().chats.find((item) => item.id === handoff.sessionId)
    if (chat) reconcileCompletedAnswers(handoff.sessionId, chat.messages)
    releaseCompletedAnswerLease(lease)
    retainedTerminalRef.current = null
    if (answerLeaseRef.current === lease) answerLeaseRef.current = null
  }

  // Streaming / optimistic message are scoped to this instance's session.
  const retainedTerminal = createMemo(() => retainedTerminalRef.current)
  // Project all pending turns together before hiding this pane's own live tail:
  // a single canonical message can settle only one pending run.
  const sessionHandoffs = createMemo(() => completedHandoffs().filter((entry) => entry.sessionId === sid()))
  const projection = createMemo(() => projectCompletedAnswers(canonicalMessages(), sessionHandoffs()))
  const ownHandoffId = createMemo(() => {
    const retained = retainedTerminal()
    return streamSid() === sid() && retained?.lease.valid ? retained.handoffId : undefined
  })
  const ownPresent = createMemo(() => !!ownHandoffId() && sessionHandoffs().some((entry) => entry.handoffId === ownHandoffId()))
  const ownUnconfirmed = createMemo(() => !!ownHandoffId() && projection().remaining.some((entry) => entry.handoffId === ownHandoffId()))
  const messages = createMemo(() => ownHandoffId() && ownUnconfirmed()
    ? projection().messages.filter((message) => message.id !== `completed-answer-handoff-${ownHandoffId()}`)
    : projection().messages)
  const retainedTerminalIsHydrated = createMemo(() => {
    const retained = retainedTerminal()
    completedHandoffs()
    return retained?.sessionId === sid() && (retained.lease.confirmed || ownPresent() && !ownUnconfirmed())
  })
  const knownRun = createMemo(() => (completedHandoffs(), answerLeaseRef.current?.runId))
  const cachedSameRun = createMemo(() => !retainedTerminal() && streamSid() === sid() && knownRun() && completedHandoffs().some((entry) =>
    entry.sessionId === sid() && entry.runId === knownRun() && entry.text.startsWith(streamingText() ?? "")))
  const answerLeaseValid = createMemo(() => (completedHandoffs(), answerLeaseRef.current?.valid !== false))
  const streaming = createMemo(() => streamSid() === sid() && !retainedTerminalIsHydrated() && !cachedSameRun() && answerLeaseValid() ? streamingText() : null)
  const streamingReasoning = createMemo(() => streamSid() === sid() && answerLeaseValid() ? streamingReasoningText() : null)
  const canonicalUserIds = createMemo(() => new Set(
    canonicalMessages().flatMap((message) => message.role === "user" ? [message.id] : []),
  ))
  const uncommittedSegments = createMemo(() => {
    if (streamSid() !== sid() || !answerLeaseValid()) return EMPTY_SEGMENTS
    // The admitted user message confirms the transcript prefix through the
    // interjection. The next round can already be streaming when history lands.
    const checkpoint = liveSegmentsState().findLastIndex((segment) => segment.kind === "interjection"
      && canonicalUserIds().has(segment.messageId))
    const segments = checkpoint < 0 ? liveSegmentsState() : liveSegmentsState().slice(checkpoint + 1)
    if (streamPhaseState() !== null) return segments
    // Failed history reads retain terminal tool evidence without keeping a run
    // active. Only results after this stream's latest acknowledged user can confirm
    // it. Earlier results may hydrate late or reuse the same tool invocation id.
    // Legacy ACKs without a message id cannot prove that boundary.
    const acknowledgedMessageId = streamUserMessageIdRef.current
    const userIndex = acknowledgedMessageId === null ? -1
      : messages().findIndex((message) => message.role === "user" && message.id === acknowledgedMessageId)
    // A later user may belong to another turn.
    const nextUserIndex = userIndex < 0 ? -1
      : messages().findIndex((message, index) => index > userIndex && message.role === "user")
    const candidates = userIndex < 0 ? [] : messages().slice(userIndex + 1, nextUserIndex < 0 ? undefined : nextUserIndex)
    const persistedToolIds = new Set(candidates.flatMap((message) =>
      "type" in message && message.type === "tool_result" && !streamBaselineToolResultIdsRef.current.has(message.id)
        ? [message.toolCallId] : []))
    let hydrated = false
    const remaining = segments.flatMap<BufferedLiveSegment>((segment) => {
      if (segment.kind !== "tools") return [segment]
      const calls = segment.calls.filter((call) => !persistedToolIds.has(call.toolCallId))
      hydrated ||= calls.length !== segment.calls.length
      return calls.length ? [{ ...segment, calls }] : []
    })
    return hydrated ? remaining : segments
  })
  const liveSegments = createMemo(() => uncommittedSegments().length
    ? uncommittedSegments().filter((segment) => segment.kind !== "interjection") : EMPTY_SEGMENTS)
  const streamStatus = createMemo(() => streamSid() === sid() && answerLeaseValid() ? streamStatusState() : null)
  const contextCompression = createMemo(() => {
    const current = compressionState()
    return current?.sessionId === sid() ? current.value : null
  })
  const streamPhase = createMemo(() => streamSid() === sid() && answerLeaseValid() ? streamPhaseState() : null)
  const sessionPending = createMemo(() => [...pendingState().entries.values()].filter((entry) => entry.sid === sid()))
  const hydratedPending = createMemo(() => matchPendingUserMessages(messages(), sessionPending(), pendingState().claimed.get(sid() ?? "")))
  // Swap each exact ACK to history in this render, before cleanup, without
  // hiding another send that is still absent from the canonical snapshot.
  const pendingUserMessages = createMemo<readonly PendingUserMessageView[]>(() => sessionPending()
    .filter((entry) => !hydratedPending().has(entry.operationId))
    .map(({ operationId, text, images }) => ({ operationId, text, images })))
  const visiblePending = createMemo(() => pendingUserMessages().at(-1) ?? null)
  const pendingUserText = createMemo(() => visiblePending()?.text ?? null)
  const pendingUserImages = createMemo(() => visiblePending()?.images ?? EMPTY_PENDING_IMAGES)
  const sendFailure = createMemo(() => sendFailures().get(sid() ?? null) ?? null)

  const noteSessionOperation = (sessionId: string | null, operationId: number) => {
    const current = latestOperationBySessionRef.current.get(sessionId)
    if (current === undefined || operationId > current) {
      latestOperationBySessionRef.current.set(sessionId, operationId)
    }
  }

  const publishSendFailure = (failure: SendFailure) => {
    const latestOperation = latestOperationBySessionRef.current.get(failure.sessionId)
    if (latestOperation !== undefined && latestOperation > failure.operationId) return false
    const current = sendFailuresRef.current.get(failure.sessionId)
    if (current && current.operationId > failure.operationId) return false
    const next = new Map(sendFailuresRef.current)
    next.set(failure.sessionId, failure)
    sendFailuresRef.current = next
    if (mountedRef.current) setSendFailures(next)
    return true
  }

  const clearSendFailure = (sessionId: string | null, expectedOperationId?: number) => {
      const current = sendFailuresRef.current.get(sessionId)
      if (!current || (expectedOperationId !== undefined && current.operationId !== expectedOperationId)) {
        return false
      }
      const next = new Map(sendFailuresRef.current)
      next.delete(sessionId)
      sendFailuresRef.current = next
      if (mountedRef.current) setSendFailures(next)
      return true
    }

  const getSendFailure = (sessionId: string | null) => {
    return sendFailuresRef.current.get(sessionId) ?? null
  }

  const clearPendingOperation = (operationId: number) => {
    if (!mountedRef.current) return
    const submitting = activeSendRef.current?.phase === "submitting" ? activeSendRef.current.originSessionId : null
    setPendingState((current) => {
      const target = current.entries.get(operationId)
      if (!target) return current
      const persisted = selectSessionById(target.sid)(appStore.getState())?.messages ?? []
      const pending = [...current.entries.values()].filter((entry) => entry.sid === target.sid)
      const matched = matchPendingUserMessages(persisted, pending, current.claimed.get(target.sid)).get(operationId)
      if (!matched) return current
      const entries = new Map(current.entries), claimed = new Map(current.claimed)
      entries.delete(operationId)
      // A later POST can still be awaiting its ACK when this history arrives.
      if (pending.length > 1 || submitting === target.sid) claimed.set(target.sid, new Set([...(claimed.get(target.sid) ?? []), matched]))
      else claimed.delete(target.sid)
      return { entries, claimed }
    })
  }

  createEffect(
    () => [hydratedPending()] as const,
    () => untrack(() => {
      for (const operationId of hydratedPending().keys()) clearPendingOperation(operationId)
    }),
  )

  const setStreamStatus = (status: string | null) => {
    if (streamStatusRef.current === status) return
    streamStatusRef.current = status
    setStreamStatusState(status)
  }

  const publishCompression = (value: ScopedCompressionFeedback | null) => {
    compressionRef.current = value
    setCompressionState(value)
  }

  const canPublishPreview = () =>
    livePreviewVisibleRef.current && resumePreviewRafRef.current === null

  const publishSegments = () => {
    segRafRef.current = null
    // Clone tools and their calls so React sees new references for mutated rows.
    setLiveSegmentsState(liveSegRef.current.map((segment) =>
      segment.kind === "tools" ? { ...segment, calls: segment.calls.map((call) => ({ ...call })) } : segment,
    ))
  }

  const flushSegments = (immediate = false) => {
    if (!canPublishPreview()) return
    if (segRafRef.current != null) {
      if (!immediate) return
      cancelAnimationFrame(segRafRef.current)
    }
    if (immediate) publishSegments()
    else segRafRef.current = requestAnimationFrame(publishSegments)
  }

  const resetTextPublish = () => {
    cancelTextPublishRef.current?.()
    cancelTextPublishRef.current = null
    lastTextPublishAtRef.current = null
  }

  const cancelReasoningPublish = () => {
    if (reasonRafRef.current === null) return
    cancelAnimationFrame(reasonRafRef.current)
    reasonRafRef.current = null
  }

  const resetLivePublish = () => {
    resetTextPublish()
    cancelReasoningPublish()
    if (segRafRef.current !== null) cancelAnimationFrame(segRafRef.current)
    segRafRef.current = null
    if (resumePreviewRafRef.current !== null) cancelAnimationFrame(resumePreviewRafRef.current)
    resumePreviewRafRef.current = null
  }

  const publishTextPreview = () => {
    cancelTextPublishRef.current = null
    const text = streamBufRef.current
    // Leading whitespace should leave the first visible text on the frame path.
    if (lastTextPublishAtRef.current !== null || text.trim()) lastTextPublishAtRef.current = performance.now()
    setStreamingText(text)
  }

  const publishReasoningPreview = () => {
    reasonRafRef.current = null
    setStreamingReasoningText(reasonBufRef.current || null)
  }

  createEffect(
    () => [pageVisible()] as const,
    () => untrack(() => {
      const updateVisibility = () => {
        const visible = pageVisible() && !document.hidden
        if (visible === livePreviewVisibleRef.current) return
        livePreviewVisibleRef.current = visible
        if (!visible) {
          resetLivePublish()
        } else if (streamOperationRef.current !== null) {
          // Publish the whole current timeline in one frame. Events between
          // showing the page and this frame still accumulate in the same buffers.
          resumePreviewRafRef.current = requestAnimationFrame(() => {
            resumePreviewRafRef.current = null
            publishTextPreview()
            publishReasoningPreview()
            publishSegments()
          })
        }
      }
      document.addEventListener("visibilitychange", updateVisibility)
      updateVisibility()
      return () => document.removeEventListener("visibilitychange", updateVisibility)
    }),
  )

  const flushBufferedText = () => {
    resetTextPublish()
    const text = streamBufRef.current
    if (text) setStreamingText(text)
    return text
  }

  // Freeze the currently-buffered assistant text/reasoning into a `text`
  // segment (natural "text → tool call" reading order) and restart the buffers
  // for whatever streams after the tool round. Also fixes the multi-round
  // duplication where every round's text piled up in ONE bubble.
  const freezeTextSegment = () => {
    const text = streamBufRef.current
    const reasoning = reasonBufRef.current
    if (!text.trim() && !reasoning.trim()) return
    liveSegRef.current.push({ kind: "text", text, reasoning: reasoning.trim() ? reasoning : null })
    streamBufRef.current = ""
    reasonBufRef.current = ""
    resetTextPublish()
    cancelReasoningPublish()
    if (canPublishPreview()) {
      setStreamingText("")
      setStreamingReasoningText(null)
    }
  }

  const pushToken = (c: string) => {
      // Text is flowing again — the "running tool…" status line is stale.
      setStreamStatus(null)
      recordOutput(c)
      streamBufRef.current += c
      if (!canPublishPreview() || cancelTextPublishRef.current) return

      const lastPublishAt = lastTextPublishAtRef.current
      const delay = lastPublishAt === null
        ? 0 : STREAM_TEXT_PUBLISH_INTERVAL_MS - (performance.now() - lastPublishAt)
      if (delay > 0) {
        const timer = setTimeout(publishTextPreview, Math.ceil(delay))
        cancelTextPublishRef.current = () => clearTimeout(timer)
      } else {
        const frame = requestAnimationFrame(publishTextPreview)
        cancelTextPublishRef.current = () => cancelAnimationFrame(frame)
      }
    }

  const pushReasoning = (c: string) => {
    recordOutput(c)
    reasonBufRef.current += c
    if (canPublishPreview() && reasonRafRef.current === null) {
      reasonRafRef.current = requestAnimationFrame(publishReasoningPreview)
    }
  }

  const stopStream = (final: string | null, operationId?: number, retain?: "tool-results" | "partial-answer") => {
      if (operationId !== undefined && streamOperationRef.current !== operationId) return
      const partialAnswer = retain === "partial-answer"
      const visibleText = partialAnswer ? streamBufRef.current : final
      const retainedSegments = retain ? liveSegRef.current.flatMap<BufferedLiveSegment>((segment) => {
        if (segment.kind === "interjection") return [segment]
        if (segment.kind === "text") return partialAnswer ? [segment] : []
        const calls = segment.calls.filter((call) => call.status !== "running").map((call) => ({ ...call }))
        return calls.length ? [{ ...segment, calls }] : []
      }) : EMPTY_SEGMENTS
      const compression = compressionRef.current
      if (compression && compression.operationId === streamOperationRef.current) {
        const value = compressionRunEnded(compression.value)
        if (value !== compression.value) publishCompression({ ...compression, value: value! })
      }
      resetLivePublish()
      streamBufRef.current = ""
      reasonBufRef.current = ""
      liveSegRef.current = retainedSegments
      toolCallsByIdRef.current.clear()
      setUpstreamRetryFeedback((current) => current?.status === "enabled" || current?.status === "requesting" || current?.status === "already_running" ? null : current)
      streamOperationRef.current = null
      setLiveSegmentsState(retainedSegments)
      setStreamStatus(null)
      setStreamingText(visibleText)
      setStreamingReasoningText(null)
      // Release the run even when a failed history read keeps static tool
      // evidence. A retained result never owns streaming or Stop controls.
      if (final === null && !partialAnswer) {
        if (answerLeaseRef.current) releaseCompletedAnswerLease(answerLeaseRef.current)
        answerLeaseRef.current = null
        retainedTerminalRef.current = null
        setStreamPhaseState(null)
        if (!retainedSegments.some((segment) => segment.kind === "tools")) setStreamSid(null)
      } else {
        setStreamPhaseState("finalizing")
      }
    }

  // Account-feed WebSocket reconciliation updates `messages`. Retire a locally
  // retained terminal tail only after the matching durable assistant message is
  // present, avoiding both disappearance and a one-frame duplicate.
  createEffect(
    () => [canonicalMessages(), completedHandoffs(), sid()] as const,
    () => untrack(() => {
      const activeLease = answerLeaseRef.current
      if (activeLease && !activeLease.valid && activeLease.sessionId === sid()) {
        abortRef.current?.abort()
        stopStream(null)
        return
      }
      const retained = retainedTerminalRef.current
      if (!retained || retained.sessionId !== sid()) return
      if (streamOperationRef.current !== null) return
      if (retained.lease.valid && !retained.lease.confirmed) return
      stopStream(null)
    }),
  )

  createEffect(
    () => [liveSegments().length, liveSegmentsState(), sid(), streamPhaseState(), streamSid(), uncommittedSegments()] as const,
    () => untrack(() => {
      if (streamSid() !== sid() || streamPhaseState() !== null || streamOperationRef.current !== null
          || uncommittedSegments() === liveSegmentsState()) return
      // Retire hydrated tool snapshots permanently, including after history edits.
      liveSegRef.current = uncommittedSegments()
      setLiveSegmentsState(uncommittedSegments())
      if (!liveSegments().length) setStreamSid(null)
    }),
  )

  const LAST_SESSION_KEY = "lotus_next_last_session"

  onSettled(() => {
    // Only the main (unbound) instance bootstraps the app; bound panes mount
    // after boot and reuse the already-initialized store.
    if (isBound) {
      setBooted(true)
      return
    }
    let savedSessionId: string | null = null
    try {
      // Capture this before bootstrap selects its default root. The persistence
      // effect is gated on `booted`, so it cannot overwrite a saved child id.
      savedSessionId = localStorage.getItem(LAST_SESSION_KEY)
    } catch {
      /* ignore */
    }
    void (async () => {
      try {
        await initializeStore()
      } catch {
        // The store exposes backend availability separately; still let the shell boot.
      }

      // Restore the last session the user was on (not whatever loadChats defaulted to).
      try {
        if (savedSessionId) {
          const store = appStore.getState()
          const restored = store.chats.some((c) => c.id === savedSessionId)
            || await store.restoreSession(savedSessionId)
          if (restored) {
            appStore.getState().selectSession(savedSessionId)
            void appStore.getState().loadChatHistory(savedSessionId)
          }
        }
      } catch {
        /* ignore */
      }
    })().finally(() => {
      setBooted(true)
    })
  })

  // Persist the active session so it's restored next launch — main pane only.
  createEffect(
    () => [booted(), globalCurrentSessionId()] as const,
    ([booted, sessionId]) => {
      if (!booted || isBound || !sessionId) return
      try {
        localStorage.setItem(LAST_SESSION_KEY, sessionId)
      } catch {
        /* ignore */
      }
    },
  )

  // Session summaries for children are tree-scoped. Hydrate only the tree that
  // a visible pane needs; repeated panes/selections share the in-flight request.
  const canHydrateSessionTree = createMemo(() => isBound || booted())
  createEffect(
    () => [canHydrateSessionTree(), sessionIndexRevision(), sid()] as const,
    ([canHydrate, , sessionId]) => {
      if (!sessionId || !canHydrate) return
      void appStore.getState().loadSubagentSessions(sessionId, { force: true }).catch(() => {})
    },
  )

  const select = (id: string) => {
    if (navigationRef.current.sessionId !== id) {
      // Navigation detaches only this pane's observer.  The backend run keeps
      // going and can be observed again when its session is reopened.
      abortRef.current?.abort()
      retainTerminalAcrossUnmount()
      stopStream(null)
    }
    appStore.getState().selectSession(id)
    void appStore.getState().loadChatHistory(id)
  }

  // Restored ordinary identities are scoped to this tab's same generation.
  const makeRestoredOrdinaryStopFence = (runSid: string, operationId: number, originalOperationId: string): ContinuousStopFence => {
    const backendScope = getBackendStorageScope()
    const priorFence = continuousStopFences.get(runSid)
    let restored!: ContinuousStopFence
    restored = { sessionId: runSid, operationId, stop: coalesceExactStop(async (onDispatched) => {
      const capability = await readUpstreamRetryCapability()
      const current = readOrdinaryRetryFence(backendScope, runSid)
      if (!current || current.operationId !== originalOperationId || !current.started) throw new Error("Execution identity unavailable")
      if (capability === "unsupported") {
        if (continuousStopFences.get(runSid) !== priorFence && continuousStopFences.get(runSid) !== restored)
          throw new Error("Legacy Stop no longer owns this session")
        return requestLegacyStop(runSid, onDispatched)
      }
      if (capability !== "supported" || !isRetryRunId(current.runId)) throw new Error("Exact Stop identity unavailable")
      return stopExactContinuousRun(runSid, current.runId, onDispatched)
    }) }
    return restored
  }

  // Give every ordinary start a pane-owned identity before its ACK. A guarded
  // session reserves a unique persistent generation before the request is sent.
  const startOrdinaryExecution = (
    runSid: string,
    operationId: number,
    execute: () => Promise<ExecuteResponse>,
    getObservedRunId?: () => string | null,
  ) => {
    const backendScope = getBackendStorageScope()
    // Reserve synchronously: an acknowledged user message must dispatch its
    // Execute before send() resolves, without awaiting a capability request.
    const reservation = beginOrdinaryRetryFence(backendScope, runSid, { ensureGuard: true })
    if (reservation.kind === "unavailable" && mountedRef.current && navigationRef.current.sessionId === runSid)
      setUpstreamRetryFeedback({ sessionId: runSid, operationId, status: "identity_unsaved" })
    const execution = execute()
    let acknowledgedRunId: string | undefined
    let restoredStopFence: ContinuousStopFence | undefined
    const ownFence: ContinuousStopFence = { sessionId: runSid, operationId, stop: coalesceExactStop(async (onDispatched) => {
      const observedRunId = getObservedRunId?.()
      const receiptRunId = acknowledgedRunId
      const priorStop = restoredStopFence
      const ack = await execution
      if (ack?.session_id !== runSid) throw new Error("Execution identity unavailable")
      if (ack.status !== "started") {
        // A Root Inbox activation can consume the input before this Execute
        // checks it. Only stop the exact run already bound to this observer.
        const isCurrent = () => continuousStopFences.get(runSid) === ownFence && getBackendStorageScope() === backendScope
        if (!isCurrent()) throw new Error("Execution identity unavailable")
        if (receiptRunId != null && priorStop) return priorStop.stop(onDispatched)
        if (observedRunId && receiptRunId != null && observedRunId !== receiptRunId)
          throw new Error("Execution identity changed")
        const runId = receiptRunId ?? observedRunId
        if ((ack.status === "completed" || ack.status === "already_running") && isRetryRunId(runId)) {
          return stopExactContinuousRun(runSid, runId, onDispatched, isCurrent)
        }
        if (priorStop) return priorStop.stop(onDispatched)
        throw new Error("Execution did not start")
      }
      const capability = await readUpstreamRetryCapability()
      if (capability === "unsupported") {
        const current = readOrdinaryRetryFence(backendScope, runSid)
        const owns = reservation.kind === "reserved"
          ? current?.operationId === reservation.reservation.operationId && current.started
          : readContinuousRetryFence(backendScope, runSid).kind === "clear"
        if ((ack.run_id != null && !isRetryRunId(ack.run_id)) || !owns || continuousStopFences.get(runSid) !== ownFence)
          throw new Error("Legacy Stop no longer owns this session")
        return requestLegacyStop(runSid, onDispatched)
      }
      if (capability !== "supported" || !isRetryRunId(ack.run_id)) throw new Error("Exact Stop identity unavailable")
      return stopExactContinuousRun(runSid, ack.run_id, onDispatched)
    }) }
    continuousStopFences.set(runSid, ownFence)
    paneStopFencesRef.current.set(runSid, ownFence)
    void execution.then((ack) => {
      if (ack?.session_id !== runSid) return
      if (ack.status === "already_running" || ack.status === "completed") acknowledgedRunId = ack.run_id ?? undefined
      if (reservation.kind !== "reserved") return
      if (ack.status === "started") {
        const saved = ack.run_id == null
          ? confirmOrdinaryStartedWithoutRunId(reservation.reservation)
          : confirmContinuousRetryFence(reservation.reservation, ack.run_id)
        if ((!saved || !isRetryRunId(ack.run_id)) && continuousStopFences.get(runSid) === ownFence
            && paneStopFencesRef.current.get(runSid) === ownFence && mountedRef.current && navigationRef.current.sessionId === runSid)
          setUpstreamRetryFeedback({ sessionId: runSid, operationId, status: "identity_unsaved" })
      } else if (ack.status === "already_running" || ack.status === "completed" || ack.status === "error" || ack.status === "cancelled") {
        const restored = restoreConfirmedUnstartedRetryFence(reservation.reservation)
        const canObserve = getObservedRunId && (ack.status === "already_running" || ack.status === "completed")
        if (restored && continuousStopFences.get(runSid) === ownFence && paneStopFencesRef.current.get(runSid) === ownFence) {
          const previous = readOrdinaryRetryFence(backendScope, runSid)
          if (previous?.started) {
            const priorFence = makeRestoredOrdinaryStopFence(runSid, operationId, previous.operationId)
            if (canObserve) restoredStopFence = priorFence
            else {
              continuousStopFences.set(runSid, priorFence)
              paneStopFencesRef.current.set(runSid, priorFence)
            }
          }
        }
      }
    }, () => {})
    return execution
  }

  // Capture the observed run at the click, before awaiting capability or
  // dispatch. A later operation must never supply the target of this click.
  const makeUnownedStopFence = (
    runSid: string,
    operationId: number,
    getObservedRunId?: () => string | null,
  ): ContinuousStopFence => {
    const backendScope = getBackendStorageScope()
    const priorFence = continuousStopFences.get(runSid)
    const isCurrent = () => continuousStopFences.get(runSid) === priorFence && getBackendStorageScope() === backendScope
      && readContinuousRetryFence(backendScope, runSid).kind === "clear"
    return { sessionId: runSid, operationId, observation: true, stop: coalesceExactStop(async (onDispatched) => {
      const observedRunId = getObservedRunId?.()
      const capability = await readUpstreamRetryCapability()
      if (!isCurrent()) throw new Error("Execution identity unavailable")
      if (capability === "unsupported") return requestLegacyStop(runSid, onDispatched)
      if (capability === "supported" && observedRunId) return stopExactContinuousRun(runSid, observedRunId, onDispatched, isCurrent)
      throw new Error("Execution identity unavailable")
    }) }
  }

  // Execute a session + subscribe to its token stream. Shared by send (after a
  // new user message) and by regenerate / retry / edit (after a truncate).
  const runStream = async (
      runSid: string,
      opts?: {
        resume?: boolean
        upstreamRetry?: UpstreamRetrySelection
        liveBootstrapResume?: boolean
        operationId?: number
        pendingOperationId?: number
        /** Exact chat ACK identity; missing ids leave failed tool evidence unconfirmed. */
        acknowledgedMessageId?: string | null
        /** `null` explicitly omits an execute-time override (Auto). */
        reasoningEffort?: ReasoningEffort | null
        /** Keep a just-acknowledged new session on its submitted model. */
        modelSelection?: { model: string; modelRef?: ProviderModelRef }
      },
    ) => {
      if (!opts?.resume && isSessionExecutionBlocked(runSid)) throw new Error(uiText("session_compatibility_execution_blocked"))
      const operationId = opts?.operationId ?? operationSequenceRef.current + 1
      const backendScope = getBackendStorageScope()
      const reservation = !opts?.resume && opts?.upstreamRetry
        ? beginContinuousRetryFence(backendScope, runSid) : null
      if (!opts?.resume && opts?.upstreamRetry && !reservation) {
        setUpstreamRetryFeedback({ sessionId: runSid, operationId, status: "identity_unavailable" })
        throw new Error(uiText("upstream_retry_identity_unavailable"))
      }
      operationSequenceRef.current = Math.max(operationSequenceRef.current, operationId)
      let startEventRunId: string | null = null
      let activeSnapshotRunId: string | null = null
      let observeAttachedRun = false
      const getObservedRunId = () => startEventRunId ?? activeSnapshotRunId
      const paneFence = paneStopFencesRef.current.get(runSid)
      if (opts?.resume && (!paneFence || paneFence.observation)) {
        const existing = continuousStopFences.get(runSid)
        const ordinary = readOrdinaryRetryFence(backendScope, runSid)
        const saved = readContinuousRetryFence(backendScope, runSid)
        const restored = ordinary?.started ? makeRestoredOrdinaryStopFence(runSid, operationId, ordinary.operationId)
          : saved.kind === "confirmed" ? { sessionId: runSid, operationId,
            stop: coalesceExactStop((onDispatched) => stopExactContinuousRun(runSid, saved.runId, onDispatched)) } : null
        const recoverable = existing ?? restored
        if (recoverable) paneStopFencesRef.current.set(runSid, recoverable)
        else if (saved.kind === "clear") {
          observeAttachedRun = true
          paneStopFencesRef.current.set(runSid, makeUnownedStopFence(runSid, operationId, getObservedRunId))
        }
      }
      // A successor owns fresh buffers, not an earlier completed answer whose
      // exact canonical history has not arrived yet.
      retainTerminalAcrossUnmount()
      if (answerLeaseRef.current) releaseCompletedAnswerLease(answerLeaseRef.current)
      const answerLease = acquireCompletedAnswerLease(runSid)
      answerLeaseRef.current = answerLease
      const publishRunIdentity = (runId: string) => {
        if (answerLease.runId === runId) return
        answerLease.runId = runId
        if (answerLeaseRef.current === answerLease) answerLeaseRef.touch()
      }
      noteSessionOperation(runSid, operationId)
      setUpstreamRetryFeedback(null)
      streamOperationRef.current = operationId
      const baselineMessages = appStore
        .getState()
        .chats.find((chat) => chat.id === runSid)
        ?.messages ?? []
      streamBaselineMessageIdRef.current = baselineMessages.findLast((message) => message.role !== "system")?.id ?? null
      streamBaselineToolResultIdsRef.current = new Set(baselineMessages.flatMap((message) =>
        "type" in message && message.type === "tool_result" ? [message.id] : []))
      streamUserMessageIdRef.current = opts?.acknowledgedMessageId ?? null
      const interjections = new Set<string>()
      const ownsStream = () => streamOperationRef.current === operationId && answerLease.valid
      const terminal = { settlement: null as Promise<void> | null, pendingRead: null as Promise<void> | null }
      // ONE live subscription per hook instance: sever the previous one FIRST
      // so its handlers can't pollute the buffers we're about to re-key to a
      // (possibly different) session. Abort synchronously removes the
      // subscriber from the shared WS channel.
      abortRef.current?.abort()
      publishCompression(null)
      retainedTerminalRef.current = null
      setStreamSid(runSid)
      setStreamPhaseState("streaming")
      resetOutputRate()
      resetLivePublish()
      streamBufRef.current = ""
      reasonBufRef.current = ""
      childBufRef.current = {}
      liveSegRef.current = []
      toolCallsByIdRef.current.clear()
      setLiveSegmentsState(EMPTY_SEGMENTS)
      setStreamStatus(null)
      setStreamingText("")
      setStreamingReasoningText(null)
      // Only canonical pending reads and matching acknowledgements settle a question.
      const ac = new AbortController()
      abortRef.current = ac
      const subscription = { operationId, sessionId: runSid }
      subscriptionRef.current = subscription
      subscribedSidRef.current = runSid
      const ownsRunEvent = () => ownsStream() && !ac.signal.aborted && mountedRef.current && !terminal.settlement
      let observedOutput = false
      const ownsOutput = () => {
        if (!ownsRunEvent()) return false
        observedOutput = true
        return true
      }
      const readRunBeforeAttaching = async (): Promise<string | null> => {
        const lookup = new AbortController()
        const cancelLookup = () => lookup.abort()
        const deadline = new Promise<null>((resolve) => {
          lookup.signal.addEventListener("abort", () => resolve(null), { once: true })
        })
        ac.signal.addEventListener("abort", cancelLookup, { once: true })
        // Keep attachment responsive on a slow backend. Results after the
        // stream attaches cannot identify the generation in that stream.
        const timer = setTimeout(cancelLookup, 400)
        try {
          if (!ownsRunEvent() || lookup.signal.aborted || getBackendStorageScope() !== backendScope) return null
          const active = await Promise.race([agentClient.getRunningSessions(lookup.signal), deadline])
          const matching = active?.sessions.filter((entry) => entry.session_id === runSid)
          return matching?.length === 1 && isRetryRunId(matching[0].run_id) ? matching[0].run_id : null
        } catch {
          return null
        } finally {
          clearTimeout(timer)
          ac.signal.removeEventListener("abort", cancelLookup)
        }
      }
      const runBeforeAttachment = observeAttachedRun ? readRunBeforeAttaching() : undefined
      const updateCompression = (
        update: (previous: ContextCompressionFeedback | null) => ContextCompressionFeedback | null,
        phase?: string,
      ) => {
        if (!ownsRunEvent()) return
        const current = compressionRef.current
        const scoped = current?.sessionId === runSid && current.operationId === operationId ? current : null
        // A late result from another phase cannot settle an observed summary.
        if (phase !== undefined && scoped?.value.status === "running" && scoped.phase !== phase) return
        const previous = scoped?.value ?? null
        const next = update(previous)
        if (next !== previous) publishCompression(next ? {
          sessionId: runSid, operationId, phase: phase ?? scoped?.phase ?? "", value: next,
        } : null)
        return { previous, next }
      }
      let executeAcknowledged = false
      let confirmedRunId: string | null = null
      let reconcileTimer: ReturnType<typeof setTimeout> | undefined
      const clearReconcileTimer = () => clearTimeout(reconcileTimer)
      ac.signal.addEventListener("abort", clearReconcileTimer, { once: true })
      // On resume (after answering a question/permission) the backend already
      // continues the suspended run — only subscribe, don't kick a fresh execute.
      if (!opts?.resume) {
        const profile = readExecutionProfile(runSid)
        const executeReasoningEffort = Object.prototype.hasOwnProperty.call(
          opts ?? {},
          "reasoningEffort",
        )
          ? opts?.reasoningEffort ?? undefined
          : profile.reasoningEffort
        if (getRootModeFenceState(runSid) !== "clear") {
          if (reservation) discardUnsentContinuousRetryFence(reservation)
          throw new Error(uiText("the_root_permission_change_is_unconfirmed_your_message__64f12563"))
        }
        const executeModel = opts?.modelSelection?.model ?? profile.model
        const executeModelRef = opts?.modelSelection ? opts.modelSelection.modelRef : profile.modelRef
        let ownFence: ContinuousStopFence | null = null
        let previousFence: ContinuousStopFence | undefined
        let previousPaneFence: ContinuousStopFence | undefined
        const execution = opts?.upstreamRetry
          ? agentClient.execute(runSid, executeModel || undefined, executeReasoningEffort, undefined, executeModelRef, opts.upstreamRetry)
          : startOrdinaryExecution(runSid, operationId, () => opts?.liveBootstrapResume
            ? agentClient.execute(runSid, executeModel || undefined, executeReasoningEffort, undefined, executeModelRef, undefined, true)
            : agentClient.execute(runSid, executeModel || undefined, executeReasoningEffort, undefined, executeModelRef), getObservedRunId)
        if (opts?.upstreamRetry) {
          setUpstreamRetryFeedback({ sessionId: runSid, operationId, status: "requesting" })
          // A Stop clicked before Execute returns waits for that exact ACK. It
          // never falls back to a session-only cancel which could hit a successor.
          ownFence = { sessionId: runSid, operationId, stop: coalesceExactStop((onDispatched) => execution.then(async (ack) => {
            if (ack?.session_id !== runSid || ack.status !== "started" || !isRetryRunId(ack.run_id)) throw new Error("Execution did not start with a valid identity")
            return stopExactContinuousRun(runSid, ack.run_id, onDispatched)
          })) }
          previousFence = continuousStopFences.get(runSid)
          previousPaneFence = paneStopFencesRef.current.get(runSid)
          continuousStopFences.set(runSid, ownFence)
          paneStopFencesRef.current.set(runSid, ownFence)
        }
        void execution.then((ack) => {
          executeAcknowledged = true
          if (ownsRunEvent() && ack?.session_id === runSid && ack.run_id?.trim()) {
            confirmedRunId = ack.run_id
            publishRunIdentity(ack.run_id)
          }
          const identitySaved = !!reservation && ack?.session_id === runSid && ack.status === "started"
            && confirmContinuousRetryFence(reservation, ack.run_id)
          if (reservation && ack?.session_id === runSid
              && (ack.status === "already_running" || ack.status === "completed" || ack.status === "error" || ack.status === "cancelled"))
            restoreConfirmedUnstartedRetryFence(reservation)
          if (ownFence && continuousStopFences.get(runSid) === ownFence && ownsRunEvent()) setUpstreamRetryFeedback((current) => {
            if (current?.operationId !== operationId || current.sessionId !== runSid || current.status !== "requesting") return current
            if (ack?.session_id === runSid && ack.status === "already_running") return { ...current, status: "already_running" }
            if (ack?.session_id === runSid && (ack.status === "completed" || ack.status === "error" || ack.status === "cancelled"))
              return { ...current, status: "not_started" }
            if (!identitySaved) return { ...current, status: "identity_unsaved" }
            return { ...current, status: "enabled" }
          })
          if (ownFence && ownsRunEvent() && ack?.session_id === runSid
              && (ack.status === "completed" || ack.status === "error" || ack.status === "cancelled")) {
            publishSendFailure({ kind: "generation-failed", operationId, sessionId: runSid,
              pendingOperationId: opts?.pendingOperationId, message: uiText("upstream_retry_not_started") })
            stopStream(null, operationId)
            ac.abort()
          }
        }).catch((err) => {
          const refused = !!reservation && isUnpreparedContinuousRetryRefusal(err, runSid)
          if (refused && reservation && ownFence) {
            // The response may arrive after navigation, Stop, or a successor.
            // The storage compare-and-restore protects every newer reservation.
            const restored = restoreConfirmedUnstartedRetryFence(reservation)
            const ownsSharedFence = continuousStopFences.get(runSid) === ownFence
            const ownsPaneFence = paneStopFencesRef.current.get(runSid) === ownFence
            if (restored && ownsSharedFence && ownsPaneFence && mountedRef.current
                && navigationRef.current.sessionId === runSid)
              setUpstreamRetryFeedback((current) => current?.sessionId === runSid && current.operationId === operationId
                ? { ...current, status: "not_started" } : current)
            if (restored && ownsSharedFence) {
              if (reservation.priorTabRaw !== null && previousFence) continuousStopFences.set(runSid, previousFence)
              else continuousStopFences.delete(runSid)
            }
            if (restored && ownsPaneFence) {
              if (reservation.priorTabRaw !== null && previousPaneFence) paneStopFencesRef.current.set(runSid, previousPaneFence)
              else paneStopFencesRef.current.delete(runSid)
            }
          }
          if (!ownsStream()) return
          observeSessionExecutionConflict(runSid, err)
          // A refusal settles the stream; unknown delivery remains guarded.
          publishSendFailure({
            kind: "generation-failed",
            operationId,
            sessionId: runSid,
            pendingOperationId: opts?.pendingOperationId,
            message: refused ? uiText("upstream_retry_not_started") : toFailureMessage(err),
          })
          stopStream(null, operationId)
          ac.abort()
        })
      }

      const settleCompleted = (historyReady = false): void => {
        if (!ownsStream() || terminal.settlement) return
        updateCompression(compressionRunEnded)
        setStreamPhaseState("finalizing")
        terminal.settlement = (async () => {
          // Freeze the fully-streamed text in place while persisted history
          // loads, so terminal delivery never flashes an empty assistant row.
          const finalText = flushBufferedText()
          const acknowledgedMessageId = streamUserMessageIdRef.current
          const observedChat = appStore.getState().chats.find((chat) => chat.id === runSid)
          const observed = observedChat?.messages ?? []
          let needsEarlierAnchor = false
          if (finalText.trim() && answerLease.valid) {
            const baseline = baselineMessages.find((message) => message.id === streamBaselineMessageIdRef.current)
            const handoff: CompletedAnswerHandoff = {
              sessionId: runSid, operationId, handoffId: newCompletedAnswerHandoffId(), runId: confirmedRunId,
              text: finalText, baselineMessageId: streamBaselineMessageIdRef.current,
              baselineMessageText: baseline?.role === "assistant" && baseline.type === "text" ? baseline.content : null,
              excludedCanonicalIds: new Set(answerLease.excludedCanonicalIds),
              acknowledgedMessageId,
              baselineMessageIds: new Set(baselineMessages.map((message) => message.id)),
              anchorSeen: acknowledgedMessageId !== null && observed.some((message) => message.role === "user" && message.id === acknowledgedMessageId),
            }
            const retained = { ...handoff, lease: answerLease }
            retainedTerminalRef.current = retained
            const id = retainCompletedAnswer(answerLease, handoff)
            if (id) {
              retained.handoffId = id
              const anchor = acknowledgedMessageId ?? handoff.baselineMessageId
              // A prior control/status read may have reached the durable reply
              // before this handoff existed to request its earlier User anchor.
              needsEarlierAnchor = Boolean(observedChat?.historyWindow?.beforeMessageId && anchor
                && !observed.some((message) => message.id === anchor && (acknowledgedMessageId === null || message.role === "user")))
            }
          }
          if (!historyReady || needsEarlierAnchor) {
            try {
              // waitForAssistant is a no-op without a real retry budget.
              await appStore.getState().loadChatHistory(runSid, {
                mode: "monotonic",
                waitForAssistant: true,
                retries: 8,
                retryDelayMs: 150,
              })
            } catch (err) {
              console.warn("[createChat] terminal history hydration failed", err)
            }
          }
          if (!ownsStream()) return
          if (!answerLease.valid) { stopStream(null, operationId); return }
          if (opts?.pendingOperationId !== undefined) {
            clearPendingOperation(opts.pendingOperationId)
          }
          const persistedMessages = appStore
            .getState()
            .chats.find((chat) => chat.id === runSid)?.messages ?? []
          reconcileCompletedAnswers(runSid, persistedMessages)
          if (!finalText.trim() || answerLease.confirmed) {
            stopStream(null, operationId)
            return
          }

          // The terminal frame won the race with the final checkpoint. Keep the
          // exact streamed reply visible; the account WebSocket's durable change
          // reconciliation retires it once history catches up.
          const retained = retainedTerminalRef.current
          if (retained) {
            retained.anchorSeen ||= acknowledgedMessageId !== null && persistedMessages.some((message) => message.role === "user" && message.id === acknowledgedMessageId)
            answerLease.handoff = retained
          }
          stopStream(finalText, operationId)
        })().finally(() => {
          // A Complete event can arrive while the channel stays open for
          // child results. Release this pane's subscription after settling.
          ac.abort()
        })
      }

      const settleFailed = (historyReady = false, error?: unknown, diagnostic?: Readonly<PublicRunDiagnostic> | null): void => {
        if (!ownsStream() || terminal.settlement) return
        flushBufferedText()
        updateCompression(compressionRunEnded)
        publishSendFailure({
          ...(diagnostic ? { diagnostic } : {}),
          kind: "generation-failed",
          operationId,
          sessionId: runSid,
          pendingOperationId: opts?.pendingOperationId,
          message: toFailureMessage(error),
        })
        terminal.settlement = (async () => {
          let historyLoaded = historyReady
          if (!historyReady) {
            try {
              await appStore.getState().loadChatHistory(runSid, { throwOnError: true })
              historyLoaded = true
            } catch (err) {
              console.warn("[createChat] failed-generation history hydration failed", err)
            }
          }
          if (!ownsStream()) return
          if (historyLoaded && opts?.pendingOperationId !== undefined) {
            clearPendingOperation(opts.pendingOperationId)
          }
          stopStream(null, operationId, historyLoaded ? undefined : "tool-results")
          ac.abort()
        })()
      }

      const settleCancelled = (historyReady = false): void => {
        if (!ownsStream() || terminal.settlement) return
        flushBufferedText()
        updateCompression((previous) => compressionRunEnded(previous, true))
        terminal.settlement = (async () => {
          let historyLoaded = historyReady
          if (!historyReady) {
            try {
              await appStore.getState().loadChatHistory(runSid)
              historyLoaded = true
            } catch (err) {
              console.warn("[createChat] cancelled-generation history hydration failed", err)
            }
          }
          if (!ownsStream()) return
          if (historyLoaded && opts?.pendingOperationId !== undefined) {
            clearPendingOperation(opts.pendingOperationId)
          }
          stopStream(null, operationId)
        })()
      }

      // A fenced-out runner can disappear without publishing either a semantic
      // terminal or a WS terminal control. Owned sends must reconcile too:
      // their `sending` flag otherwise prevents the passive recovery effect.
      // Start only after execute acknowledges admission, and confirm idle twice
      // with fresh detail reads so a stale pre-start summary cannot stop a run.
      let observedIdle = false
      let subscriptionOpen = true
      const canReconcile = () => ownsStream() && subscriptionOpen && !ac.signal.aborted && !terminal.settlement
      const reconcileOwnedRun = async () => {
        if (!canReconcile()) return
        let delay = 5_000
        try {
          if (!executeAcknowledged) return
          const { session } = await agentClient.getSession(runSid)
          if (!canReconcile()) return
          if (session.id !== runSid || session.is_running || session.has_pending_question
              || session.last_run_status === "suspended" && session.has_pending_question !== false) {
            observedIdle = false
            return
          }
          if (!observedIdle) {
            observedIdle = true
            delay = 2_000
            return
          }
          await appStore.getState().refreshChatsNow()
          if (!canReconcile()) return
          if (appStore.getState().chats.find((chat) => chat.id === runSid)?.isRunning) {
            observedIdle = false
            return
          }
          if (session.last_run_status === "suspended") {
            const scope = navigationRef.current
            if (scope.sessionId !== runSid || await reconcileQuestion(scope) !== "absent" || !canReconcile()) return
          }
          let historyReady = false
          try {
            await appStore.getState().loadChatHistory(runSid, { mode: "monotonic", throwOnError: true })
            historyReady = true
          } catch (err) {
            console.warn("[createChat] owned-stream history reconciliation failed", err)
          }
          if (!canReconcile()) return
          const currentQuestion = questionStateRef.current
          if (appStore.getState().chats.find((chat) => chat.id === runSid)?.isRunning
              || currentQuestion.scope.sessionId === runSid && currentQuestion.question) {
            observedIdle = false
            return
          }
          // A failed read cannot confirm completion. A canonical run error can
          // still settle while its terminal tool evidence remains available.
          if (!historyReady && session.last_run_status !== "error") return
          const tail = appStore.getState().chats.find((chat) => chat.id === runSid)
            ?.messages?.findLast((message) => message.role !== "system")
          // `last_run_status` can be left over from an earlier run when final
          // persistence was fenced out. Require this run's durable text too.
          const finalText = streamBufRef.current.trim()
          const durableReply = finalText && tail?.role === "assistant" && tail.type === "text"
            && tail.id !== streamBaselineMessageIdRef.current && tail.content.trim() === finalText
          if (session.last_run_status === "cancelled") settleCancelled(true)
          // Waiting for children or background work leaves the agent channel
          // open. Settle this pane's response after confirmed suspension so the
          // composer can send again; this never stops the backend task.
          else if (session.last_run_status === "suspended"
              || session.last_run_status === "completed" && durableReply) settleCompleted(true)
          else {
            const decoder = session.last_run_diagnostic == null ? null : await import("@services/chat/runDiagnostic").catch(() => null)
            const message = toFailureMessage(session.last_run_error)
            const diagnostic = decoder && message ? decoder.decodeRunDiagnostic(session.last_run_diagnostic, runSid, message) : null
            settleFailed(historyReady, session.last_run_error, diagnostic)
          }
          ac.abort()
        } catch (err) {
          observedIdle = false
          console.warn("[createChat] owned-stream status reconciliation failed", err)
        } finally {
          if (canReconcile()) {
            reconcileTimer = setTimeout(() => { void reconcileOwnedRun() }, delay)
          }
        }
      }
      if (!opts?.resume) {
        reconcileTimer = setTimeout(() => { void reconcileOwnedRun() }, 5_000)
      }

      const observation = runBeforeAttachment ? {
        beforeAttachment: runBeforeAttachment,
        acceptRunId: (runId: string) => {
          if (ownsRunEvent() && getBackendStorageScope() === backendScope) activeSnapshotRunId = runId
        },
      } : undefined
      await agentClient.subscribeToEvents(
        runSid,
        {
          onExecutionStarted: (runId) => {
            if (ownsRunEvent() && !observedOutput && !startEventRunId && isRetryRunId(runId)) startEventRunId = runId
          },
          onToken: (content) => { if (ownsOutput()) pushToken(content) },
          onReasoningToken: (content) => { if (ownsOutput()) pushReasoning(content) },
          onToolStart: (toolCallId, toolName, args) => {
            // A tool id identifies one invocation within this operation, even
            // when critical events are replayed after a subscription reconnect.
            if (!toolCallId || toolCallsByIdRef.current.has(toolCallId) || !ownsOutput()) return
            // Natural reading order: whatever text streamed before this tool
            // round freezes above it; the buffers restart afterwards.
            freezeTextSegment()
            const call: LiveToolCall = {
              toolCallId,
              toolName,
              args,
              output: "",
              status: "running",
            }
            toolCallsByIdRef.current.set(toolCallId, call)
            const last = liveSegRef.current[liveSegRef.current.length - 1]
            if (last && last.kind === "tools") last.calls.push(call)
            else liveSegRef.current.push({ kind: "tools", calls: [call] })
            setStreamStatus(uiText("running_29ee24a4", { v0: toolName }))
            flushSegments()
          },
          onToolToken: (toolCallId, content) => {
            if (!ownsRunEvent()) return
            const call = toolCallsByIdRef.current.get(toolCallId)
            if (!call || call.status !== "running") return
            call.output += content
            flushSegments()
          },
          onToolComplete: (toolCallId, result) => {
            if (!ownsRunEvent() || !result) return
            const call = toolCallsByIdRef.current.get(toolCallId)
            if (!call || call.status !== "running") return
            if (result.success !== false) {
              const bashId = parseBackgroundBashLaunch(result.result)
              if (bashId) observeBackgroundShells(runSid, [bashId])
            }
            call.status = result.success === false ? "error" : "completed"
            if (typeof result.result === "string") call.output = result.result
            call.images = result.images
            setStreamStatus(null)
            flushSegments()
          },
          onToolError: (toolCallId, error) => {
            if (!ownsRunEvent()) return
            const call = toolCallsByIdRef.current.get(toolCallId)
            if (!call || call.status !== "running") return
            call.status = "error"
            call.error = error
            setStreamStatus(null)
            flushSegments()
          },
          onTaskListUpdated: (taskList) => {
            if (taskList.session_id) {
              appStore.getState().setTaskList(taskList.session_id, taskList)
            }
          },
          onTaskListItemProgress: (delta) => {
            appStore.getState().updateTaskListDelta(delta.session_id, delta)
          },
          onTaskEvaluationStarted: (evalSid) => {
            appStore.getState().setEvaluationState(evalSid, {
              isEvaluating: true,
              reasoning: null,
              timestamp: Date.now(),
            })
          },
          onTaskEvaluationCompleted: (evalSid, updatesCount, reasoning) => {
            appStore.getState().setEvaluationState(evalSid, {
              isEvaluating: false,
              reasoning: updatesCount > 0 ? reasoning : null,
              timestamp: Date.now(),
            })
          },
          onTokenBudgetUpdated: (usage) => {
            if (!ownsRunEvent()) return
            const mapped = mapTokenBudgetUsage(usage)
            if (!mapped) return
            const store = appStore.getState()
            store.updateTokenUsage(runSid, mapped)
            store.setTruncationInfo(runSid, usage.truncation_occurred, usage.segments_removed)
            updateCompression(compressionBudgetReceived)
          },
          onContextCompressionStatus: (phase, status) => {
            const result = updateCompression((previous) => compressionFeedbackFromStatus(previous, status), phase)
            if (result?.next?.status === "running") setStreamStatus(uiText("compressing_context_57b37811"))
            else if (result?.previous?.status === "running") setStreamStatus(null)
          },
          onContextSummarized: () => {
            const result = updateCompression(summaryFeedback)
            if (result?.previous?.status === "running") setStreamStatus(null)
          },
          onSubAgentStarted: (parentSid, childId, title) => {
            if (parentSid === runSid && ownsRunEvent()) observedOutput = true
            appStore.getState().applyChildProgress(parentSid, childId, {
              title,
              status: "running",
            })
          },
          onSubAgentEvent: (parentSid, childId, event) => {
            if (parentSid === runSid && ownsRunEvent()) observedOutput = true
            const e = event as { type?: string; content?: string; tool_name?: string }
            const patch: { outputPreview?: string } = {}
            if (e.type === "token" && e.content) {
              childBufRef.current[childId] = (childBufRef.current[childId] || "") + e.content
              patch.outputPreview = childBufRef.current[childId].slice(-400)
            } else if (e.type === "tool_start" && e.tool_name) {
              patch.outputPreview = uiText("calling_ace05fd8", { v0: e.tool_name })
            }
            if (patch.outputPreview !== undefined) {
              appStore.getState().applyChildProgress(parentSid, childId, patch)
            }
          },
          onSubAgentCompleted: (parentSid, childId, status, error) => {
            appStore.getState().applyChildProgress(parentSid, childId, {
              status: error ? "error" : status || "completed",
              error: error || undefined,
            })
          },
          // A replay can precede the tool result or its history hydration.
          onBashCompleted: (bashId, _command, exitCode, status) => {
            recordBackgroundShellOutcome(runSid, bashId, status, exitCode)
          },
          // Backend-classified notifications (deduped + preference-gated server
          // side, and NOT part of the critical-event replay). Surface as an OS
          // notification (opt-in via lib/notify). Covers needs-clarification /
          // approval / context-critical / sub-agent + background-task completion.
          onNotification: deliverSessionNotification,
          onNeedClarification: () => {
            const scope = navigationRef.current
            if (!ownsStream() || scope.sessionId !== runSid || !ownsQuestionScope(scope)) return
            terminal.pendingRead = (async () => {
              const result = await reconcileQuestion(scope)
              if (result !== "absent" || !ownsQuestionScope(scope)) return
              // A notification can precede publication. Follow up once only on
              // confirmed absence; stale or unavailable reads are not absence.
              if (await reconcileQuestion(scope) === "absent" && ownsQuestionScope(scope)
                  && !questionStateRef.current.question) {
                updateQuestionState((current) => ({ ...current,
                  error: current.error ?? uiText("the_confirmation_request_is_not_ready_please_refresh_3093bf30") }))
              }
            })()
          },
          onMessageAppended: (appendedSessionId, messageId, interjection) => {
            if (appendedSessionId !== runSid) return
            if (ownsRunEvent() && interjection && messageId && !interjections.has(messageId)
                && !baselineMessages.some((message) => message.id === messageId)) {
              interjections.add(messageId)
              streamUserMessageIdRef.current = messageId
              freezeTextSegment()
              liveSegRef.current.push({ kind: "interjection", messageId })
              flushSegments(true)
            }
            // Queued guidance is checkpointed before this event is published.
            // Re-read immediately from the session stream so every visible
            // pane (including a bound split pane) renders the admitted user
            // message without waiting for the account feed or a reload.
            void appStore.getState().loadChatHistory(runSid, {
              mode: "monotonic",
            })
          },
          onChildApprovalRequested: (childSessionId, requestId, req) =>
            setPendingApproval({
              childSessionId,
              requestId,
              toolName: req.toolName,
              permission: req.permission,
              resource: req.resource,
            }),
          onSessionHistoryCommitted: (committedSessionId) => {
            if (committedSessionId !== runSid) return
            // This event is the server's post-persistence barrier. Re-read once;
            // the retained terminal effect above swaps the live tail out only
            // after this authoritative history lands in the store.
            void appStore.getState().loadChatHistory(runSid, {
              mode: "monotonic",
            })
          },
          onComplete: () => {
            settleCompleted()
          },
          onError: (message, diagnostic) => {
            settleFailed(false, message, diagnostic)
          },
          onCancelled: () => {
            settleCancelled()
          },
        },
        ac,
        ...(observation ? [observation] : []),
      ).finally(() => {
        subscriptionOpen = false
        clearReconcileTimer()
        ac.signal.removeEventListener("abort", clearReconcileTimer)
        if (subscriptionRef.current === subscription) {
          subscriptionRef.current = null
          subscribedSidRef.current = null
        }
      })
      if (terminal.settlement) {
        await terminal.settlement
      } else if (ownsStream()) {
        flushBufferedText()
        if (terminal.pendingRead) await terminal.pendingRead
        if (!ownsStream()) return
        const currentQuestion = questionStateRef.current
        if (currentQuestion.scope.sessionId === runSid && ownsQuestionScope(currentQuestion.scope)
            && currentQuestion.question) {
          try {
            await appStore.getState().loadChatHistory(runSid)
            if (opts?.pendingOperationId !== undefined) clearPendingOperation(opts.pendingOperationId)
          } catch { /* Keep the current history while awaiting the user's answer. */ }
          stopStream(null, operationId)
          return
        }
        // The WS transport can deliver its terminal control even if the
        // immediately preceding semantic Complete/Error frame was lost during
        // subscription admission or recovery. Reconcile authoritative summary
        // + history before turning that control-only close into a false error.
        const readRunStatus = () => appStore
          .getState()
          .chats.find((chat) => chat.id === runSid)?.lastRunStatus
        try {
          await appStore.getState().refreshChatsNow()
        } catch (err) {
          console.warn("[createChat] terminal-control summary reconciliation failed", err)
        }
        if (!ownsStream()) return

        let status = readRunStatus()
        if (status === "completed") {
          settleCompleted()
        } else if (status === "error") {
          settleFailed()
        } else if (status === "cancelled") {
          settleCancelled()
        } else if (status === "suspended") {
          try {
            await reconcileQuestion(navigationRef.current)
            await appStore.getState().loadChatHistory(runSid)
            if (opts?.pendingOperationId !== undefined) {
              clearPendingOperation(opts.pendingOperationId)
            }
          } catch { /* Keep the current history while awaiting the user's answer. */ }
          stopStream(null, operationId)
          return
        } else {
          const finalText = streamBufRef.current
          let historyReady = false
          try {
            await appStore.getState().loadChatHistory(runSid, {
              mode: "monotonic",
              throwOnError: true,
              waitForAssistant: Boolean(finalText.trim()),
              retries: finalText.trim() ? 8 : 0,
              retryDelayMs: 150,
            })
            historyReady = true
          } catch (err) {
            console.warn("[createChat] terminal-control history reconciliation failed", err)
          }
          if (!ownsStream()) return
          const persistedMessages = appStore
            .getState()
            .chats.find((chat) => chat.id === runSid)?.messages ?? []
          reconcileCompletedAnswers(runSid, persistedMessages)
          const baseline = baselineMessages.find((message) => message.id === streamBaselineMessageIdRef.current)
          const candidate: CompletedAnswerHandoff = {
            sessionId: runSid, operationId, text: finalText, baselineMessageId: streamBaselineMessageIdRef.current,
            baselineMessageText: baseline?.role === "assistant" && baseline.type === "text" ? baseline.content : null,
            baselineMessageIds: new Set(baselineMessages.map((message) => message.id)),
            excludedCanonicalIds: new Set(answerLease.excludedCanonicalIds),
            acknowledgedMessageId: streamUserMessageIdRef.current, anchorSeen: false,
          }
          if (finalText.trim() && projectCompletedAnswers(persistedMessages, [candidate]).remaining.length === 0) {
            settleCompleted(historyReady)
          } else {
            // The first summary read can still race the runner's post-save
            // status transition. Re-read after the bounded history wait.
            try {
              await appStore.getState().refreshChatsNow()
            } catch (err) {
              console.warn("[createChat] terminal-control final summary reconciliation failed", err)
            }
            if (!ownsStream()) return
            status = readRunStatus()
            if (status === "completed") settleCompleted(historyReady)
            else if (status === "cancelled") settleCancelled(historyReady)
            else settleFailed(historyReady)
          }
        }
        if (terminal.settlement) await terminal.settlement
      }
    }

  // Sever only the UI subscription when this hook instance unmounts. A chat
  // POST that is already in flight may still be acknowledged afterwards; its
  // exact template lease is committed and its server-side generation is
  // started without publishing stale pane state or navigation.
  onSettled(() => {
    mountedRef.current = true
    setOwned(true)
    return () => {
      mountedRef.current = false
      resetLivePublish()
      retainTerminalAcrossUnmount()
      if (answerLeaseRef.current) releaseCompletedAnswerLease(answerLeaseRef.current)
      answerLeaseRef.current = null
      streamOperationRef.current = null
      subscriptionRef.current = null
      subscribedSidRef.current = null
      abortRef.current?.abort()
    }
  })

  // ── Passive observation: engage runs driven ELSEWHERE ────────────────
  // A run started on another device, by a schedule, or before a reload flips
  // this session's execution phase to busy via the session summary. If nothing
  // here is subscribed to its agent channel yet, subscribe (no execute) so live
  // tokens stream in instead of the transcript freezing until terminal.
  const summaryRunning = createStoreSelector(appStore, (state) => selectSessionById(sid())(state)?.isRunning ?? false)
  const summarySuspended = createStoreSelector(appStore, (state) => selectSessionById(sid())(state)?.lastRunStatus === "suspended")
  const summaryHasWorkWait = createStoreSelector(appStore, (state) => hasSessionWorkWait(selectSessionById(sid())(state)?.activity))
  const shouldObserve = createStoreSelector(appStore, (state) => {
    const sessionId = sid()
    return sessionId ? selectShouldObserve(sessionId)(state) : false
  })
  const stoppingInPane = createMemo(() => upstreamRetryFeedback()?.sessionId === sid() && upstreamRetryFeedback()?.status === "stopping")
  createEffect(
    () => [owned(), sid(), shouldObserve(), summarySuspended(), summaryRunning(), summaryHasWorkWait(), sending(), stoppingInPane()] as const,
    ([active, sessionId, observe, suspended, running, workWait, , stopping]) => untrack(() => {
      // A confirmed wait still tails the resumed run. Without that projection,
      // a suspended summary can refer to an older run waiting on a person.
      if (!active || !sessionId || !observe || suspended && !running && !workWait) return
      if (activeSendRef.current) return
      if (stopping) return
      if (subscribedSidRef.current === sessionId) return
      void runStream(sessionId, { resume: true })
    }),
  )

  // ── Stranded-terminal reconcile ───────────────────────────────────────
  // If the summary settles (is_running=false via the feed) while we still hold
  // a live subscription for that session, the agent channel probably missed
  // its terminal frame (e.g. frozen background WS). Give the channel a grace
  // period to deliver, then force-settle: abort + reload history.
  createEffect(
    () => [sid(), summaryRunning(), summaryHasWorkWait(), sending()] as const,
    ([sessionId, running, workWait, sending]) => {
      if (!sessionId || running || workWait) return
      if (subscribedSidRef.current !== sessionId || sending) return
      const timer = setTimeout(() => {
        if (subscribedSidRef.current !== sessionId) return
        const latestChat = appStore.getState().chats.find((chat) => chat.id === sessionId)
        if (latestChat?.isRunning || hasSessionWorkWait(latestChat?.activity)) return
        const operationId = streamOperationRef.current
        abortRef.current?.abort()
        void appStore.getState().loadChatHistory(sessionId).then(() => {
          if (streamOperationRef.current === operationId) stopStream(null)
        })
      }, 2_000)
      return () => clearTimeout(timer)
    },
  )

  // ── Pending-question rehydration ──────────────────────────────────────
  // The execution reducer retains only terminal statuses. Keep the raw pane
  // summary's suspended hint even when its optional pending flag is absent.
  const pendingRecovery = createStoreSelector(appStore, (state) => {
    const sessionId = sid()
    const execution = sessionId ? state.executionBySession[sessionId] : undefined
    return [
      execution?.interaction.pendingQuestion ?? null,
      execution?.backend.hasPendingQuestion ?? null,
      execution?.backend.hasPendingQuestion || summarySuspended() ? execution?.backend ?? null : null,
      execution?.backend.lastRunStatus ?? null,
    ] as const
  }, shallow)
  const recoveredQuestion = () => pendingRecovery()[0]
  const hasPendingQuestion = () => pendingRecovery()[1]
  const pendingSummary = () => pendingRecovery()[2]
  const lastRunStatus = () => pendingRecovery()[3]
  // A run suspended on a question keeps waiting across reloads and devices,
  // but the ask event only flows to the subscription that was live when it
  // fired. Account-feed recovery can also discover a pending question after
  // the pane's initial read or its agent subscription has ended. Treat those
  // store snapshots as notifications, never as typed decision authority.
  // Fresh pending summaries matter even when their legacy display payload is
  // unchanged: request generation, policy revision or allowed choices may differ.
  // A fresh suspended summary also retries an earlier pre-publication read.
  // Even an explicit false flag is only a hint; the canonical GET (and existing
  // submission fences) decides absence. GET completion never changes this signal.
  // The reducer replaces backend only on summary reads; its object identity also
  // distinguishes snapshots received within the same syncedAt millisecond.
  createEffect(
    () => [owned(), sid(), recoveredQuestion(), hasPendingQuestion(), pendingSummary(), lastRunStatus(), summarySuspended()] as const,
    ([active, sessionId]) => untrack(() => {
      if (!active) return
      const scope = navigationRef.current
      // Recovery within the same visit must preserve in-flight/uncertain decisions.
      // Only navigation resets ownership; the canonical reader fences stale GETs
      // and replaces a question when its server identity or allowed choices change.
      if (!sameQuestionScope(questionStateRef.current.scope, scope)) {
        questionSubmitRef.current = null
        updateQuestionState(() => ({ scope, question: null, loading: false, submitting: false,
          unavailable: false, error: null, retry: null, recordedKey: null }))
      }
      if (!sessionId) return
      void reconcileQuestion(scope)
    }),
  )

  // ── Tab-visibility reconcile (main instance only) ────────────────────
  // A backgrounded tab/webview freezes the WS and every reconnect timer; runs
  // that finished (or started) while hidden never delivered their frames. On
  // regain: refresh summaries (settles finished runs), reconcile the open
  // conversation, and let the observe effect re-engage anything still running.
  onSettled(() => {
    if (isBound) return
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return
      const store = appStore.getState()
      void store.refreshChatsNow()
      const cur = store.currentSessionId
      if (cur) store.reconcileOpenSession(cur, "visibility_regain")
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  })

  // Re-run the conversation after a server-side truncate/restore (regenerate,
  // retry, edit). Shows the streaming placeholder + reloads history on done.
  const rerun = async (
      runSid: string,
      opts?: {
        prepare?: () => Promise<unknown>
        upstreamRetry?: UpstreamRetrySelection
        expectedFailureOperationId?: number
        pendingOperationId?: number
        preserveFailureOnPrepareError?: boolean
      },
    ): Promise<boolean> => {
      if (activeSendRef.current || isSessionExecutionBlocked(runSid)) return false
      if (getRootModeFenceState(runSid) !== "clear") return false
      if (
        opts?.expectedFailureOperationId !== undefined &&
        getSendFailure(runSid)?.operationId !== opts.expectedFailureOperationId
      ) {
        return false
      }
      const profile = readExecutionProfile(runSid)
      const modelSelection = { model: profile.model, modelRef: profile.modelRef }
      const selectedReasoningEffort = profile.reasoningEffort
      const operation: ActiveSendOperation = {
        id: operationSequenceRef.current + 1,
        phase: "preparing",
        originSessionId: runSid,
        originNavigationEpoch: navigationRef.current.epoch,
        acknowledgedSessionId: runSid,
        pendingOperationId: opts?.pendingOperationId,
      }
      operationSequenceRef.current = operation.id
      noteSessionOperation(runSid, operation.id)
      activeSendRef.current = operation
      if (mountedRef.current) {
        setSending(true)
        setSubmissionPending(true)
      }
      let streamStarted = false
      let operationReleased = false
      const releaseOperation = () => {
        if (activeSendRef.current?.id !== operation.id) return
        activeSendRef.current = null
        operationReleased = true
        if (mountedRef.current) {
          setSubmissionPending(false)
          setSending(false)
        }
      }
      try {
        await opts?.prepare?.()
        if (activeSendRef.current?.id !== operation.id) return false
        // Continuous negotiation is read-only: navigation or a replaced failure
        // must cancel this explicit request, rather than starting it off-screen.
        if (opts?.upstreamRetry && (!mountedRef.current
          || navigationRef.current.sessionId !== operation.originSessionId
          || navigationRef.current.epoch !== operation.originNavigationEpoch
          || opts.expectedFailureOperationId !== undefined
            && getSendFailure(runSid)?.operationId !== opts.expectedFailureOperationId)) return false
        if (getRootModeFenceState(runSid) !== "clear" || isSessionExecutionBlocked(runSid)) return false
        if (
          opts?.expectedFailureOperationId !== undefined &&
          getSendFailure(runSid)?.operationId !== opts.expectedFailureOperationId
        ) {
          // The lock makes this unreachable during normal UI operation. If an
          // external callback replaced the failure after a destructive prepare,
          // still run the exact session so truncation cannot strand it.
          console.warn("[createChat] retry failure ownership changed after preparation")
        } else {
          clearSendFailure(runSid, opts?.expectedFailureOperationId)
        }
        operation.phase = "generating"

        const stillAtOrigin =
          mountedRef.current &&
          navigationRef.current.sessionId === operation.originSessionId &&
          navigationRef.current.epoch === operation.originNavigationEpoch
        if (!stillAtOrigin) {
          // Preparation can be destructive (retry truncate / edit restore). If
          // the user left meanwhile, finish that exact session in the
          // background without taking over the new pane's subscription or Stop
          // control. Release the hook first so the newly visible session can
          // submit immediately while this detached start settles.
          releaseOperation()
          try {
            await startOrdinaryExecution(runSid, operation.id, () => agentClient.execute(runSid, modelSelection.model || undefined, selectedReasoningEffort, undefined, modelSelection.modelRef))
            try {
              await appStore.getState().loadChatHistory(runSid)
              if (operation.pendingOperationId !== undefined) {
                clearPendingOperation(operation.pendingOperationId)
              }
            } catch (err) {
              console.warn("[createChat] detached rerun history hydration failed", err)
            }
            return true
          } catch (err) {
            observeSessionExecutionConflict(runSid, err)
            console.warn("[createChat] detached rerun start failed", err)
            publishSendFailure({
              kind: "generation-failed",
              operationId: operation.id,
              sessionId: runSid,
              pendingOperationId: operation.pendingOperationId,
              message: toFailureMessage(err),
            })
            return false
          }
        }

        if (mountedRef.current) setSubmissionPending(false)
        const stream = runStream(runSid, {
          upstreamRetry: opts?.upstreamRetry,
          modelSelection,
          reasoningEffort: selectedReasoningEffort ?? null,
          operationId: operation.id,
          pendingOperationId: operation.pendingOperationId,
        })
        streamStarted = true
        void appStore
          .getState()
          .loadChatHistory(runSid)
          .then(() => {
            if (operation.pendingOperationId !== undefined) {
              clearPendingOperation(operation.pendingOperationId)
            }
          })
          .catch((err) => console.warn("[createChat] rerun history hydration failed", err))
        await stream
        return true
      } catch (err) {
        observeSessionExecutionConflict(runSid, err)
        console.error("[createChat] rerun failed", err)
        if (opts?.upstreamRetry && !streamStarted && mountedRef.current)
          setUpstreamRetryFeedback({ sessionId: runSid, operationId: operation.id, status: "unavailable" })
        if (streamStarted || !opts?.preserveFailureOnPrepareError) {
          publishSendFailure({
            kind: "generation-failed",
            operationId: operation.id,
            sessionId: runSid,
            pendingOperationId: operation.pendingOperationId,
            message: toFailureMessage(err),
          })
        }
        stopStream(null, operation.id)
        return false
      } finally {
        if (!operationReleased && activeSendRef.current?.id === operation.id) {
          activeSendRef.current = null
          if (mountedRef.current) {
            setSubmissionPending(false)
            setSending(false)
          }
        }
      }
    }

  const regenerate = async () => {
    const sessionId = readSessionId()
    if (!sessionId) return
    await rerun(sessionId, {
      prepare: async () => {
        const result = await agentClient.truncateSessionMessages(sessionId, { mode: "after_last_user" }).catch(() => null)
        if (result?.success && result.session_id === sessionId) {
          const messages = appStore.getState().chats.find((chat) => chat.id === sessionId)?.messages ?? []
          invalidateCompletedAnswers(sessionId, { messages, targetId: messages.findLast((message) => message.role === "user")?.id ?? null })
        }
      },
    })
  }

  const retry = async (failure?: GenerationFailure, options?: { upstreamRetry?: UpstreamRetrySelection }) => {
    const sessionId = readSessionId()
      const upstreamRetry = options?.upstreamRetry
      const prepare = async (sessionId: string) => {
        if (upstreamRetry) {
          if (!await supportsContinuousUpstreamRetry()) throw new Error(uiText("upstream_retry_unavailable"))
          // Resume Execute only. No Chat, truncate, or tool replay.
        } else await agentClient.truncateSessionMessages(sessionId, { mode: "error_retry" })
      }
      const currentFailure = getSendFailure(sessionId ?? null)
      const target = failure ?? (currentFailure?.kind === "generation-failed" ? currentFailure : undefined)
      if (target) {
        if (getSendFailure(target.sessionId)?.operationId !== target.operationId) return
        await rerun(target.sessionId, {
          upstreamRetry,
          expectedFailureOperationId: target.operationId,
          pendingOperationId: target.pendingOperationId,
          preserveFailureOnPrepareError: true,
          prepare: () => prepare(target.sessionId),
        })
        return
      }

      // `sendFailure` is intentionally local to the mounted hook. After a
      // reload, pane remount, or session switch the durable session summary is
      // the only remaining failure authority. Let that persisted error use the
      // same safe resume path instead of rendering a retry button that no-ops.
      if (!sessionId || currentChat()?.lastRunStatus !== "error") return
      await rerun(sessionId, {
        upstreamRetry,
        preserveFailureOnPrepareError: true,
        prepare: () => prepare(sessionId),
      })
    }

  // Edit a user message in place, drop everything after it, and re-run.
  const editMessage = async (messageId: string, text: string) => {
    const sessionId = readSessionId()
      const body = text.trim()
      if (!sessionId || !body) return
      await rerun(sessionId, {
        prepare: async () => {
          await agentClient.patchSessionMessage(sessionId, messageId, { content: body }).catch(() => {})
          const result = await agentClient
            .restoreSessionState(sessionId, { target_message_id: messageId, restore_files: false })
            .catch(() => null)
          if (result?.success && result.session_id === sessionId && result.target_message_id === messageId) {
            const messages = appStore.getState().chats.find((chat) => chat.id === sessionId)?.messages ?? []
            invalidateCompletedAnswers(sessionId, { messages, targetId: messageId })
          }
        },
      })
    }

  const send = async (
      text: string,
      opts?: {
        skillIds?: string[]
        /** Explicit Root-only selection; undefined preserves the durable value. */
        rootOrchestrationOnly?: boolean
        thinkingMode?: import("@services/chat/AgentService").ThinkingMode
        images?: Array<{ base64: string; name?: string; size?: number; type?: string }>
        workspacePath?: string | null
        projectId?: string | null
        templatePrompt?: PendingTemplatePromptSnapshot | null
        /** Initial permission mode when this send creates a NEW session. */
        permissionMode?: SessionPermissionMode
        /** Frozen picker value for this new-session submission. */
        reasoningSelection?: ReasoningEffortSelection
        /** Optional first-send preparation fence, including null → null navigation. */
        isOriginCurrent?: () => boolean
        /** This Root's initial execution opted into a negotiated live offer. */
        liveBootstrapResume?: boolean
      },
    ): Promise<SendSubmissionResult> => {
      if (opts?.isOriginCurrent && !opts.isOriginCurrent()) return { kind: "blocked" }
      const startSid = readSessionId()
      if (isSessionExecutionBlocked(startSid)) return { kind: "blocked" }
      const body = text.trim()
      if (!body && !opts?.images?.length) return { kind: "ignored" }
      const submittedImages = opts?.images?.map((image) => ({ ...image })) ?? []
      if (activeSendRef.current) return { kind: "busy" }

      // Re-read saved admission at submission so a cached callback cannot
      // submit a removed model or a disabled provider.
      const {
        model: submittedModel,
        modelRef: submittedModelRef,
        reasoningEffort: defaultReasoningEffort,
      } = readExecutionProfile(startSid)
      if (!startSid && !submittedModelRef) return { kind: "blocked" }
      if (startSid && getRootModeFenceState(startSid) !== "clear") return { kind: "blocked" }
      // Existing Root mode changes use a separate, recoverable operation.
      if (startSid && typeof opts?.rootOrchestrationOnly === "boolean") return { kind: "blocked" }
      if (startSid && opts?.thinkingMode !== undefined) return { kind: "blocked" }
      const submittedThinkingMode = !startSid ? opts?.thinkingMode : undefined
      if (submittedThinkingMode !== undefined
        && (submittedThinkingMode !== "standard" && submittedThinkingMode !== "ultra"
          || opts?.rootOrchestrationOnly !== undefined
            && opts.rootOrchestrationOnly !== (submittedThinkingMode === "ultra"))) return { kind: "blocked" }
      const submittedReasoningEffort = startSid
        ? defaultReasoningEffort
        : opts?.reasoningSelection === "auto"
          ? undefined
          : opts?.reasoningSelection ?? defaultReasoningEffort
      const operation: ActiveSendOperation = {
        id: operationSequenceRef.current + 1,
        phase: "submitting",
        originSessionId: startSid,
        originNavigationEpoch: navigationRef.current.epoch,
      }
      const baselineMessageIds = new Set(
        (selectSessionById(startSid ?? null)(appStore.getState())?.messages ?? []).map((message) => message.id),
      )
      operationSequenceRef.current = operation.id
      noteSessionOperation(startSid, operation.id)
      activeSendRef.current = operation
      if (mountedRef.current) {
        setSending(true)
        setSubmissionPending(true)
      }
      clearSendFailure(startSid)

      const templatePrompt = !startSid ? opts?.templatePrompt ?? null : null
      let acknowledgedSessionId: string
      let acknowledgedMessageId: string | null = null
      try {
        // Client-side prompt enhancement (OS info + operational guidance + the
        // user's own enhancement text), recomputed per send like lotus does.
        const enhancePrompt = getSystemPromptEnhancementText().trim()
        // New sessions keep the selected/default system-prompt preset as their
        // durable base. A just-picked home-dashboard template is appended as a
        // task-mode block instead of replacing that base prompt. Existing
        // sessions keep the prompt they were created with.
        let systemPrompt: string | undefined
        if (!startSid) {
          const st = appStore.getState()
          systemPrompt = composeNewSessionSystemPrompt(
            st.systemPrompts,
            st.lastSelectedPromptId,
            templatePrompt?.prompt,
          )
        }
        const res = await agentClient.sendMessage({
          message: body,
          session_id: startSid ?? undefined,
          model: submittedModel,
          // Complete provider+model ref: a bare `model` alone is outranked by
          // the server's `defaults.chat` under `features.provider_model_ref`.
          model_ref: submittedModelRef,
          reasoning_effort: !startSid ? submittedReasoningEffort : undefined,
          enhance_prompt: enhancePrompt || undefined,
          system_prompt: systemPrompt,
          selected_skill_ids: opts?.skillIds?.length ? opts.skillIds : undefined,
          root_orchestration_only: !startSid
            ? submittedThinkingMode === undefined ? opts?.rootOrchestrationOnly : submittedThinkingMode === "ultra"
            : undefined,
          thinking_mode: !startSid
            ? submittedThinkingMode ?? (opts?.rootOrchestrationOnly === undefined
              ? undefined : opts.rootOrchestrationOnly ? "ultra" : "standard")
            : undefined,
          images: submittedImages.length ? submittedImages : undefined,
          // Only meaningful when creating a NEW session; an existing session keeps
          // the cwd it was created with.
          workspace_path: !startSid && opts?.workspacePath ? opts.workspacePath : undefined,
          // Explicit Project for a NEW session; an existing session keeps the
          // Project it was created with (PATCH is the only reassignment path).
          project_id: !startSid && opts?.projectId ? opts.projectId : undefined,
          // Initial permission mode for a NEW session; existing sessions keep
          // their stored mode (PATCH is the only change path).
          permission_mode: !startSid && opts?.permissionMode ? opts.permissionMode : undefined,
        })
        acknowledgedSessionId =
          typeof res?.session_id === "string" ? res.session_id.trim() : ""
        if (!acknowledgedSessionId || (startSid && acknowledgedSessionId !== startSid)) {
          throw new Error("The chat submission response did not acknowledge the expected session.")
        }
        acknowledgedMessageId = typeof res.message_id === "string" && res.message_id.trim() ? res.message_id.trim() : null
        recordUsedModel(submittedModel)
      } catch (err) {
        console.error("[createChat] message submission was not acknowledged", err)
        const compatibilityConflict = observeSessionExecutionConflict(startSid, err)
        const rejectionCode = submissionRejectionCode(err)
        if (activeSendRef.current?.id === operation.id) activeSendRef.current = null
        if (mountedRef.current) {
          setSubmissionPending(false)
          setSending(false)
          setPendingState((current) => {
            if (!startSid || !current.claimed.has(startSid) || [...current.entries.values()].some((entry) => entry.sid === startSid)) return current
            const claimed = new Map(current.claimed)
            claimed.delete(startSid)
            return { ...current, claimed }
          })
          if (!compatibilityConflict) publishSendFailure({
            kind: "submission-unconfirmed",
            operationId: operation.id,
            sessionId: startSid,
            message: toFailureMessage(err),
            ...(rejectionCode ? {
              rejectionCode,
              rootModeSelectionSubmitted: rejectionCode !== "session_project_running_conflict" && typeof opts?.rootOrchestrationOnly === "boolean",
            } : {}),
          })
        }
        if (compatibilityConflict) return { kind: "blocked" }
        return { kind: "unconfirmed", operationId: operation.id, ...(rejectionCode ? { rejectionCode } : {}) }
      }

      operation.phase = "generating"
      operation.acknowledgedSessionId = acknowledgedSessionId
      operation.pendingOperationId = operation.id
      noteSessionOperation(acknowledgedSessionId, operation.id)
      // The user just submitted into this session: promote it to the front of
      // the sidebar instead of leaving it under its original creation day.
      recordSessionUserInput(acknowledgedSessionId)
      if (templatePrompt) acknowledgePendingTemplatePrompt(templatePrompt)

      // A valid ACK retains its submitted content even after navigation.
      // Navigation and stream ownership below still belong to the viewed pane.
      if (mountedRef.current && (body || submittedImages.length)) {
        setPendingState((current) => ({ ...current, entries: new Map(current.entries).set(operation.id, {
          operationId: operation.id,
          sid: acknowledgedSessionId,
          text: body,
          images: submittedImages.map((image, index) => ({
            id: `pending-${operation.id}-${index}`, name: image.name ?? "image", size: image.size ?? 0,
            type: image.type || "image/png", base64: image.base64,
            url: image.base64.startsWith("data:") ? image.base64 : `data:${image.type || "image/png"};base64,${image.base64}`,
          })),
          acknowledgedMessageId,
          baselineMessageIds,
        }) }))
      }

      let navigated = false
      const stillAtOrigin =
        mountedRef.current &&
        navigationRef.current.sessionId === operation.originSessionId &&
        navigationRef.current.epoch === operation.originNavigationEpoch &&
        (opts?.isOriginCurrent?.() ?? true)

      if (!stillAtOrigin) {
        // A valid late acknowledgement still owns a server-side generation, but
        // it must not replace the session subscription the user is viewing now.
        if (mountedRef.current) {
          setSubmissionPending(false)
          setSending(false)
        }
        if (activeSendRef.current?.id === operation.id) activeSendRef.current = null
        if (isSessionExecutionBlocked(acknowledgedSessionId)) {
          publishSendFailure({ kind: "generation-failed", operationId: operation.id, sessionId: acknowledgedSessionId,
            message: uiText("session_compatibility_execution_blocked") })
        } else if (getRootModeFenceState(acknowledgedSessionId) !== "clear") {
          publishSendFailure({
            kind: "generation-failed",
            operationId: operation.id,
            sessionId: acknowledgedSessionId,
            message: uiText("the_root_permission_change_is_unconfirmed_your_message__64f12563"),
          })
        } else {
          void startOrdinaryExecution(acknowledgedSessionId, operation.id, () => opts?.liveBootstrapResume
            ? agentClient.execute(acknowledgedSessionId, submittedModel || undefined, submittedReasoningEffort, undefined, submittedModelRef, undefined, true)
            : agentClient.execute(acknowledgedSessionId, submittedModel || undefined, submittedReasoningEffort, undefined, submittedModelRef))
            .catch((err) => {
              observeSessionExecutionConflict(acknowledgedSessionId, err)
              console.warn("[createChat] detached generation start failed", err)
              publishSendFailure({
                kind: "generation-failed",
                operationId: operation.id,
                sessionId: acknowledgedSessionId,
                message: toFailureMessage(err),
              })
            })
        }
        if (acknowledgedSessionId !== startSid) {
          void appStore
            .getState()
            .refreshChatsNow()
            .catch((err) => console.warn("[createChat] detached session refresh failed", err))
        }
      } else {
        setSubmissionPending(false)
        if (acknowledgedSessionId !== startSid) {
          if (isBound) {
            if (onSessionCreated) {
              onSessionCreated(acknowledgedSessionId)
              navigated = true
            }
          } else {
            appStore.getState().selectSession(acknowledgedSessionId)
            navigated = true
          }
        }

        // Start execute + the exact session subscription before resolving the
        // acknowledgement to the composer. Session-list/history hydration is
        // auxiliary and must never prevent an acknowledged message from running.
        void runStream(acknowledgedSessionId, {
          operationId: operation.id,
          pendingOperationId: operation.pendingOperationId,
          acknowledgedMessageId,
          liveBootstrapResume: opts?.liveBootstrapResume,
          reasoningEffort: submittedReasoningEffort ?? null,
          modelSelection: { model: submittedModel, modelRef: submittedModelRef },
        })
          .catch((err) => {
            console.error("[createChat] acknowledged generation failed", err)
            publishSendFailure({
              kind: "generation-failed",
              operationId: operation.id,
              sessionId: acknowledgedSessionId,
              pendingOperationId: operation.pendingOperationId,
              message: toFailureMessage(err),
            })
            stopStream(null, operation.id)
          })
          .finally(() => {
            if (activeSendRef.current?.id === operation.id) activeSendRef.current = null
            if (mountedRef.current) setSending(false)
          })

        void (async () => {
          if (acknowledgedSessionId !== startSid) {
            await appStore
              .getState()
              .refreshChatsNow()
              .catch((err) => console.warn("[createChat] acknowledged session refresh failed", err))
          }
          await appStore.getState().loadChatHistory(acknowledgedSessionId, { mode: "monotonic" })
          clearPendingOperation(operation.id)
        })().catch((err) => {
          console.warn("[createChat] acknowledged message hydration failed", err)
        })
      }

      return {
        kind: "accepted",
        operationId: operation.id,
        sessionId: acknowledgedSessionId,
        navigated,
      }
    }

  const stop = () => {
    const active = activeSendRef.current
    if (active?.phase === "submitting" || active?.phase === "preparing") return
    const targetSessionId = active?.acknowledgedSessionId ?? sid()
    const pendingOperationId = active?.pendingOperationId
    const operationId = active?.id ?? streamOperationRef.current ?? undefined
    // Continuous retries retain the Execute ACK for an exact-run REST Stop.
    // Ordinary Stop keeps its existing realtime-first path before detaching.
    let exactStop = targetSessionId
      ? paneStopFencesRef.current.get(targetSessionId) ?? continuousStopFences.get(targetSessionId)
      : undefined
    const persisted = targetSessionId ? readContinuousRetryFence(getBackendStorageScope(), targetSessionId) : { kind: "clear" as const }
    const ordinary = targetSessionId ? readOrdinaryRetryFence(getBackendStorageScope(), targetSessionId) : null
    if (!exactStop && targetSessionId && ordinary?.started)
      exactStop = makeRestoredOrdinaryStopFence(targetSessionId, operationId ?? 0, ordinary.operationId)
    if (!exactStop && targetSessionId && persisted.kind === "confirmed") {
      const sessionId = targetSessionId, runId = persisted.runId
      exactStop = { sessionId, operationId: operationId ?? 0,
        stop: coalesceExactStop((onDispatched) => stopExactContinuousRun(sessionId, runId, onDispatched)) }
      continuousStopFences.set(sessionId, exactStop)
    }
    if (!exactStop && targetSessionId && persisted.kind !== "clear") {
      // A pending, corrupt or unreadable marker is not permission to stop the
      // current session owner; it might be a different run after reload.
      setUpstreamRetryFeedback({ sessionId: targetSessionId, operationId: operationId ?? 0, status: "identity_unavailable" })
      return
    }
    if (!exactStop && targetSessionId) exactStop = makeUnownedStopFence(targetSessionId, operationId ?? 0)
    const stopFence = exactStop
    if (stopFence) {
      if (stoppingFencesRef.current.has(stopFence)) return
      stoppingFencesRef.current.add(stopFence)
      paneStopFencesRef.current.set(stopFence.sessionId, stopFence)
    }
    const ownsStopFence = () => !!stopFence
      && paneStopFencesRef.current.get(stopFence.sessionId) === stopFence
    if (stopFence) setUpstreamRetryFeedback({ sessionId: stopFence.sessionId, operationId: stopFence.operationId, status: "stopping" })
    const stoppedSubscription = abortRef.current
    const keepPartialAnswer = Boolean(stopFence && subscribedSidRef.current === targetSessionId && (
      streamBufRef.current.trim() || liveSegRef.current.some((segment) => segment.kind === "text" && segment.text.trim())
    ))
    const stopRequest = stopFence ? stopFence.stop(() => stoppedSubscription?.abort()) : targetSessionId ? agentClient.stopGeneration(targetSessionId) : null
    if (targetSessionId && !stopFence) {
      const store = appStore.getState()
      store.markCancel(targetSessionId)
      store.updateSession(targetSessionId, { isRunning: false }, { skipBackendPatch: true })
    }
    const compression = compressionRef.current
    if (compression?.sessionId === targetSessionId && compression.operationId === operationId) {
      // A local Stop ends observation; its request is not a confirmed summary cancellation.
      const value = compressionRunEnded(compression.value)
      if (value !== compression.value) publishCompression({ ...compression, value: value! })
    }
    // Failed capability/identity checks never dispatch, so detach on rejection.
    // stopStream fences callbacks while a request awaits its exact identity.
    if (stopFence && stopRequest) void stopRequest.catch(() => stoppedSubscription?.abort())
    else stoppedSubscription?.abort()
    stopStream(null, operationId, keepPartialAnswer ? "partial-answer" : undefined)
    if (!targetSessionId || !stopRequest) return
    void (async () => {
      const dispatched = await stopRequest.then(
        (kind) => kind ?? "legacy",
        () => null,
      )
      if (dispatched !== "legacy") {
        // A failed Stop or even a successful exact Stop needs reconciliation;
        // a successful legacy Stop retains its existing local behavior.
        await appStore.getState().refreshChatsNow().catch(() => {})
      }
      try {
        if (dispatched === "exact" && keepPartialAnswer) {
          // The Stop receipt precedes the cancelled runner's last checkpoint.
          const loadStoppedHistory = () => appStore.getState().loadChatHistory(targetSessionId, {
            mode: "monotonic", waitForAssistant: true, retries: 8, retryDelayMs: 150, throwOnError: true,
          })
          try {
            await loadStoppedHistory()
          } catch (error) {
            // The account feed can start its own read before the checkpoint.
            // A superseded read has not hydrated the partial answer.
            if (!(error instanceof DOMException) || error.name !== "AbortError" || !mountedRef.current
                || navigationRef.current.sessionId !== targetSessionId || abortRef.current !== stoppedSubscription
                || answerLeaseRef.current?.valid === false) throw error
            await loadStoppedHistory()
          }
        } else {
          await appStore.getState().loadChatHistory(targetSessionId)
        }
        if (pendingOperationId !== undefined) clearPendingOperation(pendingOperationId)
      } catch (err) {
        console.warn("[createChat] stopped-generation history hydration failed", err)
      } finally {
        if (stopFence) stoppingFencesRef.current.delete(stopFence)
        if (keepPartialAnswer && mountedRef.current && navigationRef.current.sessionId === targetSessionId
            && abortRef.current === stoppedSubscription && streamOperationRef.current === null) stopStream(null)
        if (stopFence && mountedRef.current && navigationRef.current.sessionId === stopFence.sessionId && ownsStopFence()) {
          setUpstreamRetryFeedback({ sessionId: stopFence.sessionId, operationId: stopFence.operationId,
            status: dispatched === null ? "stop_unconfirmed" : "stop_requested" })
        }
      }
    })()
  }

  const newChat = () => {
    if (navigationRef.current.sessionId !== null) {
      // A new composer must not inherit the previous session's live observer or
      // stream buffer.  This does not cancel the server-side generation.
      abortRef.current?.abort()
      retainTerminalAcrossUnmount()
      stopStream(null)
    }
    appStore.getState().selectSession(null)
  }

  const deleteMessage = async (messageId: string) => {
    const sessionId = readSessionId()
      if (!sessionId) return
      const deleted = await agentClient.deleteSessionMessage(sessionId, messageId).then(() => true, () => false)
      if (deleted) {
        invalidateCompletedAnswerForDeletedMessage(sessionId, messageId)
        const store = appStore.getState()
        store.invalidateHistoryAfterMessageDelete(sessionId, messageId)
        await store.loadChatHistory(sessionId, { resetHistoryWindow: true })
      } else {
        await appStore.getState().loadChatHistory(sessionId)
      }
    }

  // Fork the conversation from a message: backend clones the session up to that
  // message into a fresh one; we switch to the new branch.
  const fork = async (messageId: string): Promise<string | undefined> => {
    const sessionId = readSessionId()
      if (!sessionId) return undefined
      if (getRootModeFenceState(sessionId) !== "clear") return undefined
      try {
        const res = await apiClient.post<{ session?: { id?: string; session_id?: string } }>(
          `sessions/${encodeURIComponent(sessionId)}/fork`,
          { up_to_message_id: messageId },
        )
        const newId = res?.session?.id ?? res?.session?.session_id
        if (!newId) return undefined
        // Await the full switch so the caller's loading spinner spans the whole
        // operation and clears exactly when we land on the new branch.
        await appStore.getState().refreshChatsNow()
        // Bound pane adopts the branch locally; main pane switches global current.
        if (isBound) onSessionCreated?.(newId)
        else appStore.getState().selectSession(newId)
        await appStore.getState().loadChatHistory(newId)
        return newId
      } catch {
        return undefined
      }
    }

  const submitQuestion = async (
    text: string,
    displayedScope: QuestionScope | undefined,
    displayedKey: string | null,
    retryPrevious = false,
  ) => {
    const current = questionStateRef.current
    const { scope, question } = current
    if (!scope.sessionId || isSessionExecutionBlocked(scope.sessionId) || !ownsQuestionScope(scope) || !question
        || questionSubmitRef.current || current.loading || current.submitting) return
    const key = questionKey(question)
    if (!displayedScope || !sameQuestionScope(displayedScope, scope) || displayedKey !== key) return
    if (current.recordedKey === key || (!retryPrevious && (current.unavailable || current.retry))) return
    if (retryPrevious && !current.retry) return
    let decision: PermissionDecisionRequest | null = null
    if (question.interaction_kind === "permission") {
      const request = question.permission_request
      if (retryPrevious) {
        const retry = current.retry!
        if (retry.request_id !== request.request_id || retry.request_generation !== request.request_generation
            || retry.expected_policy_revision !== request.policy_revision
            || !permissionDecisionFor(request, retry.decision)) return
        decision = retry
      } else {
        decision = permissionDecisionFor(request, text)
        if (!decision) return
      }
    } else if (!text.trim() || (!question.allow_custom && !question.options.includes(text))) return
    const token = { scope, key, awaitingResponse: true }
    questionSubmitRef.current = token
    const ownsSubmission = () => questionSubmitRef.current === token && ownsQuestionScope(scope)
      && questionStateRef.current.question !== null && questionKey(questionStateRef.current.question) === key
    updateQuestionState((state) => ({ ...state, submitting: true, error: null }))
    try {
      let status: string | undefined
      let continuationConfirmed: boolean
      if (decision) {
        const result = await agentClient.submitPermissionDecision(scope.sessionId, decision)
        status = result.autoResumeStatus
        continuationConfirmed = result.continuationConfirmed
      } else {
        const result = await apiClient.post<{ success?: boolean; auto_resume_status?: string }>(
          `respond/${encodeURIComponent(scope.sessionId)}`, { response: text, expected_tool_call_id: question.tool_call_id },
        )
        if (result?.success !== true) throw new Error("Unconfirmed clarification response")
        status = result.auto_resume_status
        continuationConfirmed = ["started", "already_running", "completed"].includes(status ?? "")
      }
      token.awaitingResponse = false
      if (!ownsSubmission()) return
      ++questionReadSequenceRef.current
      updateQuestionState((state) => ({ ...state, question: null, retry: null, recordedKey: key,
        recordedPermission: decision && question.interaction_kind === "permission"
          ? { question, decision: decision.decision, continued: continuationConfirmed && !!status }
          : state.recordedPermission,
        unavailable: false, loading: false,
        error: continuationConfirmed ? null : uiText("your_response_was_recorded_but_task_continuation_is_unc_844b0635") }))
      await reconcileQuestion(scope, !continuationConfirmed)
      if (!ownsQuestionScope(scope) || questionSubmitRef.current !== token) return
      void appStore.getState().loadChatHistory(scope.sessionId).catch(() => {})
      if (continuationConfirmed && (status === "started" || status === "already_running")
          && !questionStateRef.current.question && subscribedSidRef.current !== scope.sessionId) {
        // The server owns continuation. Reuse the existing observation path only.
        void runStream(scope.sessionId, { resume: true })
      }
    } catch (error) {
      observeSessionExecutionConflict(scope.sessionId, error)
      token.awaitingResponse = false
      if (!ownsSubmission()) return
      const rejected = isApiError(error) && error.status >= 400 && error.status < 500
      updateQuestionState((state) => ({ ...state, retry: !rejected ? decision : null,
        unavailable: rejected,
        error: rejected ? uiText("the_request_or_permissions_have_changed_confirm_again_u_a1ebae48")
          : decision ? uiText("submission_is_unconfirmed_refresh_or_retry_the_last_sub_f3127c94")
            : uiText("the_response_result_is_unconfirmed_refresh_the_current__2c1a59fd") }))
      await reconcileQuestion(scope, true)
    } finally {
      if (questionSubmitRef.current === token) {
        questionSubmitRef.current = null
        if (ownsQuestionScope(scope)) updateQuestionState((state) => ({ ...state, submitting: false }))
      }
    }
  }

  const questionActions = createMemo(() => {
    const scope = visibleQuestionState()?.scope
    const question = pendingQuestion()
    const key = question ? questionKey(question) : null
    return {
      answer: (text: string) => submitQuestion(text, scope, key),
      retry: () => submitQuestion("", scope, key, true),
    }
  })

  const refreshQuestion = () => reconcileQuestion()

  const respondApproval = async (approved: boolean) => {
      const pa = pendingApproval()
      if (!pa || isSessionExecutionBlocked(pa.childSessionId) || approvalSubmitRef.current) return
      approvalSubmitRef.current = pa
      setApprovalSubmission({ request: pa, submitting: true, error: null })
      try {
        const result = await agentClient.respondToChildApproval(pa.childSessionId, pa.requestId, approved)
        if (result.delivered !== true) throw new Error("Unconfirmed Child approval delivery")
        // A late acknowledgement belongs only to the request the Human answered.
        setPendingApproval((current) => current === pa ? null : current)
      } catch (error) {
        const incompatible = observeSessionExecutionConflict(pa.childSessionId, error)
        const refused = isApiError(error) && error.status >= 400 && error.status < 500
        setApprovalSubmission({ request: pa, submitting: false,
          error: incompatible || refused ? uiText("the_request_or_permissions_have_changed_confirm_again_u_a1ebae48")
            : uiText("submission_is_unconfirmed_refresh_or_retry_the_last_sub_f3127c94") })
      } finally {
        if (approvalSubmitRef.current === pa) approvalSubmitRef.current = null
        setApprovalSubmission((current) => current?.request === pa ? { ...current, submitting: false } : current)
      }
    }

  return {
    get booted() { return isBound ? true : booted() },
    get chats() { return chats() },
    get currentSessionId() { return sid() },
    get currentChat() { return currentChat() },
    get messages() { return messages() },
    get streaming() { return streaming() },
    get streamPhase() { return streamPhase() },
    get streamingReasoning() { return streamingReasoning() },
    get liveSegments() { return liveSegments() },
    get streamStatus() { return streamStatus() },
    get contextCompression() { return contextCompression() },
    get outputRate() { return outputRate() },
    get upstreamRetryStatus() {
      const feedback = upstreamRetryFeedback()
      return feedback?.sessionId === sid() ? feedback.status : null
    },
    get pendingUserText() { return pendingUserText() },
    get pendingUserImages() { return pendingUserImages() },
    get pendingUserMessages() { return pendingUserMessages() },
    executionCompatibility,
    get sending() { return sending() },
    get submissionPending() { return submissionPending() },
    select,
    send,
    stop,
    newChat,
    deleteMessage,
    fork,
    regenerate,
    retry,
    editMessage,
    get sendFailure() { return sendFailure() },
    get pendingQuestion() { return pendingQuestion() },
    get recordedPermission() { return visibleQuestionState()?.recordedPermission },
    get questionLoading() { return visibleQuestionState()?.loading ?? false },
    get questionSubmitting() { return visibleQuestionState()?.submitting ?? false },
    get questionUnavailable() {
      const visible = visibleQuestionState()
      const question = pendingQuestion()
      return (visible?.unavailable ?? false) || (!!question && visible?.recordedKey === questionKey(question))
    },
    get questionError() { return visibleQuestionState()?.error ?? null },
    get questionCanRetry() { return !!visibleQuestionState()?.retry },
    refreshQuestion,
    get retryQuestion() { return questionActions().retry },
    get pendingApproval() { return pendingApproval() },
    get approvalSubmitting() { return approvalSubmission()?.submitting ?? false },
    get approvalError() { return approvalSubmission()?.request === pendingApproval() ? approvalSubmission()?.error ?? null : null },
    approvalCompatibility,
    get answerQuestion() { return questionActions().answer },
    respondApproval,
  }
}
