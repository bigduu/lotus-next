import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useMarkSessionRead } from "@/lib/sessionReadState"
import { useMediaQuery } from "@shared/hooks/useMediaQuery"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import {
  ChevronDown,
  ChevronLeft,
  RotateCcw,
  Download,
  FileDown,
  Columns2,
  X,
  PanelRightOpen,
} from "lucide-react"
import { useShallow } from "zustand/react/shallow"
import { Button } from "@/components/ui/button"
import { workspaceService } from "@services/workspace"
import type { WorkspaceFileEntry } from "@services/workspace/types"
import { QuestionDialog, ApprovalDialog } from "@/components/chat/Dialogs"
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
import { commandService, type CommandItem } from "@services/command"
import { prepareWorkflowSelection, workflowUnavailableReason, type TypedWorkflowDraft, type WorkflowSelection } from "@services/command/workflowCatalog"
import { getErrorMessage } from "@services/api/errors"
import type { ChildProgress } from "@shared/store/appStore/slices/executionStateSlice/types"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
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
import { TicketWorkPanel } from "@/components/chat/TicketWorkPanel"
import { SupervisorOverview } from "@/components/chat/SupervisorOverview"
import { isDefaultSupervisor } from "@/lib/supervisor"
import type { PendingRequest as TicketRequest } from "@services/tickets/types"
import { SessionGuidance } from "@/components/app/SessionGuidance"
import { Composer } from "@/components/app/Composer"
import { Toasts } from "@/components/app/Toasts"
import { ImageLightbox } from "@/components/app/ImageLightbox"
import { peekPendingTemplatePrompt } from "@/lib/taskTemplates"
import { ContextUsageRing } from "@/components/app/ContextUsageRing"
import { ReasoningPicker } from "@/components/chat/ReasoningPicker"
import { ModelPicker } from "@/components/chat/ModelPicker"
import { NewSessionPermissionControl, PermissionModeControl } from "@/components/chat/PermissionModeControl"
import { RootOrchestrationControl } from "@/components/chat/RootOrchestrationControl"
import { useWorkflowCatalog } from "@/components/chat/useWorkflowCatalog"
import { WorkflowSelectionControl } from "@/components/chat/WorkflowSelectionControl"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import type { ChatItem } from "@shared/types/chatMessages"
import type { SessionPermissionMode } from "@services/chat/AgentService"
import { useNewSessionPermission } from "@shared/store/newSessionPermission"
import {
  collectLiveSessionFileChanges,
  collectSessionFileChanges,
  mergeSessionFileChanges,
} from "@/lib/sessionFileChanges"
import { getFileChangePayloadDiffStats } from "@shared/utils/resultFormatters"
import { describeRunFailure } from "@/lib/runFailureGuidance"

/** Secondary (split) pane config — a slim header with its own session picker. */
type SecondaryConfig = {
  sessionId: string | null
  chats: ChatItem[]
  onPickSession: (id: string | null) => void
  onClose: () => void
  hideClose?: boolean
}

type Attachment = { id: string; base64: string; name: string; type: string; size: number; url: string }
type SelectedWorkflow = { name: string; content: string }
type EnvironmentPreference = "auto" | "open" | "closed"

const MESSAGE_COLUMN_MAX_WIDTH = 1152
const ENVIRONMENT_OCCUPIED_WIDTH = 332
const ENVIRONMENT_CONTENT_SHIFT = ENVIRONMENT_OCCUPIED_WIDTH / 2

// Once the card fits beside the full 72rem message column, reveal it and
// recenter that column within the remaining space. The card still floats, but
// the transcript slides left by half of its 20rem width plus 0.75rem edge.
const ENVIRONMENT_AUTO_SHOW_MIN_WIDTH =
  MESSAGE_COLUMN_MAX_WIDTH + ENVIRONMENT_OCCUPIED_WIDTH

type ComposerSubmissionSnapshot = Readonly<{
  draftKey: string
  draftRevision: number
  attachmentRevision: number
  skillRevision: number
  workflowRevision: number
  text: string
  attachments: readonly Readonly<Attachment>[]
  selectedSkill: Readonly<SkillDefinition> | null
  selectedWorkflow: Readonly<SelectedWorkflow> | null
  typedWorkflow: Readonly<WorkflowSelection> | null
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

/**
 * A self-contained chat column: header + messages + composer + this pane's
 * transient overlays (toasts, image lightbox, question/approval dialogs). It is
 * driven entirely by the `chat` bundle it receives (any `useChat(...)` instance),
 * so the same component renders the main pane and — later — additional panes
 * each bound to a different session. Per-pane input state (draft, attachments,
 * skill, scroll anchor, …) lives here; cross-pane globals (sidebar, settings,
 * workspace picker, inspector) stay in the parent and arrive as callbacks.
 */
export function ChatPane({
  chat,
  pickedWorkspace,
  pendingProjectId,
  onSelectProject,
  onOpenWorkspacePicker,
  onOpenInspector,
  onOpenReview,
  workPanelTarget,
  onOpenWork,
  onWorkReference,
  sidePaneOpen,
  onToggleSidePane,
  splitOpen,
  onToggleSplit,
  onSelectSubAgent,
  onOpenSidebar,
  sidebarCollapsed,
  secondary,
  pageVisible = true,
}: {
  chat: ChatState
  pickedWorkspace: string | null
  /** Project preselected for the next NEW session (project-grouped sidebar). */
  pendingProjectId?: string | null
  /** Chip-driven project selection for the next NEW session. */
  onSelectProject?: (projectId: string | null) => void
  onOpenWorkspacePicker: () => void
  onOpenInspector: () => void
  onOpenReview?: () => void
  workPanelTarget?: HTMLElement | null
  onOpenWork?: () => void
  onWorkReference?: () => void
  sidePaneOpen?: boolean
  onToggleSidePane?: () => void
  splitOpen: boolean
  onToggleSplit: () => void
  /** Opens a child without replacing this pane's current session. */
  onSelectSubAgent?: (childId: string) => void
  onOpenSidebar: () => void
  sidebarCollapsed: boolean
  /** When set, render a slim split-pane header (session picker) instead of the full one. */
  secondary?: SecondaryConfig
  /** Retain the mounted conversation while another app page is visible. */
  pageVisible?: boolean
}) {
  useUiLocale()
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
    outputRate,
    pendingUserText,
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
  const currentlyRunning = currentChat?.isRunning === true || (sending && streaming !== null)
  const visibleSendFailure = sendFailure?.sessionId === currentSessionId ? sendFailure : null
  const persistedRunError = !visibleSendFailure
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
  const queue = useGuidanceQueue(currentSessionId, currentlyRunning)
  const tickets = useTicketWork(currentSessionId)
  const ticketIngress = useTicketIngress(currentSessionId)
  const ticketScope = tickets.state?.current.scope
  const pendingTicketMessage = ticketIngress.hasPending(currentSessionId)
  const semanticComposer = tickets.negotiated === false || pendingTicketMessage || ticketScope?.capabilities?.semantic_messages_v1 === true
    && ticketScope.mutation_enabled === true
    && ticketScope.binding.supervisor_session_id === currentSessionId
  const [ticketReference, setTicketReference] = useState<TicketRequest | null>(null)
  const [selectedWorkId, setSelectedWorkId] = useState<string | null>(null)
  const workPanelHost = useRef(workPanelTarget)
  workPanelHost.current = workPanelTarget
  const openTicketWork = (workId: string | null) => {
    setSelectedWorkId(workId)
    onOpenWork?.()
    requestAnimationFrame(() => workPanelHost.current?.querySelector<HTMLElement>('[data-testid="ticket-work-overview"]')?.focus())
  }
  const replayReferences = ticketIngress.references(currentSessionId)
  const visibleTicketReference = pendingTicketMessage && replayReferences?.in_reply_to
    ? { work_id: replayReferences.thread_id ?? replayReferences.in_reply_to, id: replayReferences.in_reply_to }
    : ticketReference
  useEffect(() => { setTicketReference(null); setSelectedWorkId(null) }, [currentSessionId])
  // The secondary chat hook remains mounted when its pane closes. Read state
  // follows the rendered pane, including the same breakpoint as its md:flex.
  const splitVisible = useMediaQuery("(min-width: 768px)")
  const [chatLayoutRef, chatLayoutWidth] = useContainerWidth<HTMLDivElement>()
  const environmentHasRoom = chatLayoutWidth >= ENVIRONMENT_AUTO_SHOW_MIN_WIDTH
  useMarkSessionRead(pageVisible && (!secondary || splitVisible) ? currentChat : null)
  const [environmentPreference, setEnvironmentPreference] =
    useState<EnvironmentPreference>("auto")
  const environmentId = useId()

  useEffect(() => {
    setEnvironmentPreference("auto")
  }, [currentSessionId])

  const environmentOpen = environmentPreference === "open"
    || (environmentPreference === "auto" && environmentHasRoom)
  const environmentVisible = !secondary && environmentOpen && !(sidePaneOpen ?? false)
  const messageContentShift = environmentVisible
    ? -Math.min(
        ENVIRONMENT_CONTENT_SHIFT,
        Math.max(0, (chatLayoutWidth - MESSAGE_COLUMN_MAX_WIDTH) / 2),
      )
    : 0

  // Live in-run token budget (pushed over the agent channel) — beats the
  // persisted config snapshot, which only refreshes on history reload.
  const liveTokenUsage = useAppStore((s) =>
    currentSessionId ? s.tokenUsages[currentSessionId] : undefined,
  )
  const tokenUsage = liveTokenUsage ?? currentChat?.config?.tokenUsage

  // Per-session persisted draft (survives session switches + reloads via the
  // inputStates slice). New-chat drafts key off a per-pane sentinel so the
  // main pane's and a split pane's empty composers don't share one draft.
  const draftKey = currentSessionId ?? (secondary ? "__new_chat_pane2__" : "")
  const draft = useAppStore((s) => s.inputStates[draftKey]?.content ?? "")
  const composerInputRef = useRef<HTMLTextAreaElement>(null)
  const currentDraftKeyRef = useRef(draftKey)
  currentDraftKeyRef.current = draftKey
  const setDraft = (value: string | ((prev: string) => string)) => {
    const store = useAppStore.getState()
    const prev = store.inputStates[draftKey]?.content ?? ""
    store.setInputContent(draftKey, typeof value === "function" ? value(prev) : value)
  }
  const [dragOver, setDragOver] = useState(false)
  const [goalSaving, setGoalSaving] = useState(false)
  const goalRequestActive = useRef(false)
  const [selectedSkill, setSelectedSkill] = useState<SkillDefinition | null>(null)
  // Workflow commands for the slash menu; the picked one expands into the
  // message on send (content + user input).
  const [workflowCmds, setWorkflowCmds] = useState<CommandItem[]>([])
  const [selectedWorkflow, setSelectedWorkflow] = useState<SelectedWorkflow | null>(null)
  const [typedWorkflow, setTypedWorkflow] = useState<TypedWorkflowDraft | null>(null)
  const [workflowPicker, setWorkflowPicker] = useState<"composer" | "environment" | null>(null)
  const [removedWorkflow, setRemovedWorkflow] = useState<{ draft: TypedWorkflowDraft; revision: number } | null>(null)
  const [workflowError, setWorkflowError] = useState<string | null>(null)
  const rootAuthority = useRootOrchestrationMode(currentSessionId, currentChat?.kind)
  const [rootModeConflict, setRootModeConflict] = useState<string | null>(null)
  useEffect(() => { setRootModeConflict(null) }, [currentSessionId])
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const attachmentRevisionRef = useRef(0)
  const skillRevisionRef = useRef(0)
  const workflowRevisionRef = useRef(0)
  const changeAttachments = (value: Attachment[] | ((prev: Attachment[]) => Attachment[])) => {
    attachmentRevisionRef.current += 1
    setAttachments(value)
  }
  const changeSelectedSkill = (value: SkillDefinition | null) => {
    skillRevisionRef.current += 1
    setSelectedSkill(value)
  }
  const changeSelectedWorkflow = (value: SelectedWorkflow | null) => {
    workflowRevisionRef.current += 1
    if (!value) setRootModeConflict(null)
    setSelectedWorkflow(value)
    setRemovedWorkflow(null)
    if (value) { setTypedWorkflow(null); setWorkflowError(null) }
  }
  const changeTypedWorkflow = (value: TypedWorkflowDraft | null) => {
    workflowRevisionRef.current += 1
    setTypedWorkflow(value); setWorkflowError(null)
    setRemovedWorkflow(null)
    if (!value) setWorkflowPicker(null)
    if (value) { setSelectedWorkflow(null); changeSelectedSkill(null) }
  }
  // Catalog selections are local to this composer/session. Do not move a
  // version from one Session authority into another, or migrate legacy drafts.
  useEffect(() => {
    workflowRevisionRef.current += 1
    setTypedWorkflow(null); setWorkflowError(null); setWorkflowPicker(null); setRemovedWorkflow(null)
  }, [currentSessionId])
  const [preview, setPreview] = useState<string | null>(null)
  const [toast, setToast] = useState<string | null>(null)
  const [forking, setForking] = useState(false)
  const toastTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const showToast = (msg: string) => {
    setToast(msg)
    if (toastTimer.current) clearTimeout(toastTimer.current)
    toastTimer.current = setTimeout(() => setToast(null), 2500)
  }

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
  // Sub-agents to display: persistent child sessions from the index (survive
  // reload, navigable) overlaid with live progress (status/preview during a run).
  const mergedSubAgents = useMemo(() => {
    const out: Record<string, ChildProgress> = {}
    for (const c of chats) {
      if (currentSessionId && c.parentSessionId === currentSessionId) {
        out[c.id] = {
          title: c.title || c.subagentType || undefined,
          status: c.isRunning ? "running" : "completed",
        }
      }
    }
    for (const [id, p] of Object.entries(subAgents)) {
      out[id] = { ...out[id], ...p }
    }
    return out
  }, [chats, currentSessionId, subAgents])
  const models = useAppStore(useShallow((s) => s.models))
  const selectedModel = useAppStore((s) => s.selectedModel)
  const setSelectedModel = useAppStore((s) => s.setSelectedModel)
  const changeSessionModel = useAppStore((s) => s.changeSessionModel)
  const defaultChatModel = useProviderStore((s) => s.providerSnapshot?.defaults?.chat?.model)
  const chatReasoningEffort = useProviderStore(
    (s) => s.providerSnapshot?.defaults?.chat?.reasoning_effort,
  )
  const inputReasoningSelection = useAppStore(
    (s) => s.inputStates[draftKey]?.reasoningEffort,
  )
  // A new composer mirrors the Chat-role setting exactly. Provider-instance
  // defaults are intentionally not resolved into the selection: that is what
  // Auto delegates to Bamboo. Existing sessions show their durable override.
  const reasoningSelection: ReasoningEffortSelection = currentSessionId
    ? currentChat?.config?.reasoningEffort ??
      currentChat?.config?.model_ref?.reasoning_effort ??
      "auto"
    : inputReasoningSelection ?? chatReasoningEffort ?? "auto"
  const clearInputReasoningEffort = useAppStore((s) => s.clearInputReasoningEffort)
  const rootMode = useRootThinkingMode({
    sessionId: currentSessionId, draftKey, ordinarySelection: reasoningSelection, root: rootAuthority,
    disabled: submissionPending || currentlyRunning || queue.busy || queue.hasUnconfirmed,
  })
  const rootSessionUnsafe = () => rootMode.busy || rootMode.blocked
    || Boolean(currentSessionId && getRootModeFenceState(currentSessionId) !== "clear")
  const skillModeConflict = selectedSkill && rootMode.selected === true && !rootMode.child
    ? uiText("the_selected_skill_is_incompatible_with_ultra_orchestra_fd2e7fa6")
    : null
  // Existing sessions display their durable model. The global selection is
  // only a draft for a new session and cannot relabel a running session.
  const activeModel = currentSessionId
    ? currentChat?.config?.model_ref?.model || currentChat?.config?.model || defaultChatModel || ""
    : selectedModel || defaultChatModel || ""
  const [modelSaving, setModelSaving] = useState(false)
  const modelControlDisabled = modelSaving || currentlyRunning || submissionPending
    || queue.busy || queue.hasUnconfirmed
  const handleModelChange = async (model: string) => {
    if (modelControlDisabled || model === activeModel) return
    if (!currentSessionId) {
      setSelectedModel(model)
      return
    }

    setModelSaving(true)
    try {
      await changeSessionModel(currentSessionId, model)
    } catch {
      if (currentDraftKeyRef.current === currentSessionId) {
        showToast(uiText("could_not_save_the_model_please_try_again_631991a6"))
      }
    } finally {
      setModelSaving(false)
    }
  }

  // Escape hides the pickers until the draft changes again (typing re-opens).
  const [menusDismissed, setMenusDismissed] = useState(false)
  useEffect(() => {
    setMenusDismissed(false)
  }, [draft])

  const slashQuery = !menusDismissed && draft.startsWith("/") ? draft.slice(1) : null
  const catalogState = useWorkflowCatalog(currentSessionId, slashQuery !== null || workflowPicker !== null)
  const workflowDisabled = submissionPending || currentlyRunning || queue.hasUnconfirmed || rootMode.unsafe
  // A hidden Environment must not strand its open editor (phone/workbench changes).
  useEffect(() => {
    if (workflowPicker === "environment" && !environmentVisible) setWorkflowPicker("composer")
  }, [workflowPicker, environmentVisible])
  const openWorkflowPicker = (surface: "composer" | "environment") => {
    setMenusDismissed(true)
    setWorkflowPicker(surface)
  }
  const removeTypedWorkflow = () => {
    if (!typedWorkflow || workflowDisabled) return
    const previous = typedWorkflow
    changeTypedWorkflow(null)
    setRemovedWorkflow({ draft: previous, revision: workflowRevisionRef.current })
    composerInputRef.current?.focus()
  }

  // @file references: detect a trailing "@query" and list workspace files.
  const atQuery = (() => {
    if (menusDismissed) return null
    const m = draft.match(/@([^\s@]*)$/)
    return m ? m[1] : null
  })()
  const workspacePath = currentChat?.config?.workspacePath
  // For a NEW session, a selected Project owns the workspace: its primary
  // path overrides a manually-picked one, and @-file completion follows it.
  const selectedProjectPath = useAppStore((state) =>
    pendingProjectId ? state.projects[pendingProjectId]?.project_path : undefined,
  )
  const displayWorkspace = workspacePath ?? selectedProjectPath ?? pickedWorkspace
  const currentProjectName = useAppStore((state) => {
    const projectId = currentChat?.config?.projectId
    return projectId ? state.projects[projectId]?.name : undefined
  })
  const persistedFileChanges = useMemo(() => collectSessionFileChanges(messages), [messages])
  const liveFileChanges = useMemo(
    () => collectLiveSessionFileChanges(liveSegments),
    [liveSegments],
  )
  const sessionFileChanges = useMemo(
    () => mergeSessionFileChanges(persistedFileChanges, liveFileChanges),
    [persistedFileChanges, liveFileChanges],
  )
  const fileChangeSummary = useMemo(() => {
    const filePaths = new Set<string>()
    let addedLines = 0
    let removedLines = 0

    for (const change of sessionFileChanges) {
      filePaths.add(change.payload.file_path)
      const stats = getFileChangePayloadDiffStats(change.payload)
      addedLines += stats.added
      removedLines += stats.removed
    }

    return { changedFiles: filePaths.size, addedLines, removedLines }
  }, [sessionFileChanges])
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
    // @-file references follow the EFFECTIVE workspace — the session's cwd, or the
    // one picked for a new chat — so completions match where the agent will run.
    if (atQuery === null || !displayWorkspace) return
    if (filesLoadedForRef.current === displayWorkspace) return
    const target = displayWorkspace
    filesLoadedForRef.current = target
    workspaceService
      .listWorkspaceFiles(target)
      .then(setWorkspaceFiles)
      .catch(() => {
        // Don't cache a transient failure as an empty list — let the next
        // @-open retry the fetch.
        if (filesLoadedForRef.current === target) filesLoadedForRef.current = null
        setWorkspaceFiles([])
      })
  }, [atQuery, displayWorkspace])

  const pickFile = (entry: WorkspaceFileEntry) => {
    setDraft((d) => d.replace(/@[^\s@]*$/, `@${entry.path} `))
  }

  // Lazily fetch workflow commands the first time a slash menu opens.
  const workflowsLoadedRef = useRef(false)
  useEffect(() => {
    if (slashQuery === null || workflowsLoadedRef.current) return
    workflowsLoadedRef.current = true
    commandService
      .listCommands()
      .then((res) =>
        setWorkflowCmds((res.commands ?? []).filter((c) => c.type === "workflow")),
      )
      .catch(() => {
        /* slash menu simply shows skills only */
      })
  }, [slashQuery])

  const submit = () => {
    // Keep an in-flight admission from capturing or clearing a second draft.
    if (submissionPending || modelSaving || queue.busy || ticketIngress.busy || rootMode.busy || goalRequestActive.current) return
    if (semanticComposer && !tickets.canSendIngress) { showToast(uiText("ticket_the_ticket_connection_or_write_permission_is__c3da124f")); return }
    if (rootSessionUnsafe()) {
      setRootModeConflict(uiText("the_root_permission_change_is_unconfirmed_sending_and_e_a75a6b4f"))
      return
    }
    const storeAtSubmit = useAppStore.getState()
    const draftAtSubmit = storeAtSubmit.inputStates[draftKey]
    const text = draftAtSubmit?.content ?? ""
    const goalCommand = !selectedWorkflow && !typedWorkflow && !selectedSkill && attachments.length === 0
      ? /^\/goal(?:\s+([\s\S]*))?$/i.exec(text.trim()) : null
    if (goalCommand && !pendingTicketMessage && (currentSessionId || !goalCommand[1]?.trim())) {
      if (!currentSessionId) { showToast(uiText("open_a_session_before_setting_a_goal_83867da8")); return }
      const revision = draftAtSubmit?.contentRevision ?? 0
      const objective = goalCommand[1]?.trim()
      if (!objective) {
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
      void agentClient.sendMessage({ message: text.trim(), session_id: sessionId, model: currentChat?.config?.model ?? "" }).then(async (response) => {
        if (response.session_id !== sessionId || !response.goal_command) throw new Error("Goal command was not acknowledged")
        useAppStore.getState().setInputContentIfRevision(draftKey, revision, "")
        if (currentDraftKeyRef.current === draftKey) {
          const action = response.goal_command.action
          showToast(action === "off" ? uiText("goal_paused_c6289896") : action === "clear" ? uiText("goal_cleared_0cfc707e") : action === "on_no_prompt" ? uiText("set_a_goal_first_cc87f18f") : action === "status" ? uiText("goal_settings_opened_63de7dc7") : uiText("goal_set_724a547c"))
          if (action === "status" || action === "on_no_prompt") onOpenInspector()
        }
        try { await useAppStore.getState().loadChatHistory(sessionId) }
        catch { /* The command acknowledgement already confirms the saved configuration. */ }
        // Execution admission handles an already-running session atomically.
        // The run may finish while the Goal command is being acknowledged.
        if (response.goal_command.should_execute) {
          if (getRootModeFenceState(sessionId) !== "clear") {
            if (currentDraftKeyRef.current === draftKey) showToast(uiText("root_permissions_are_unconfirmed_the_goal_was_saved_but_bd40481a"))
            return
          }
          try { await agentClient.execute(sessionId, currentChat?.config?.model) }
          catch { if (currentDraftKeyRef.current === draftKey) showToast(uiText("goal_saved_send_a_message_to_continue_ba844fbc")) }
        }
      }).catch(() => {
        if (currentDraftKeyRef.current === draftKey) showToast(uiText("could_not_save_the_goal_your_command_is_preserved_pleas_ac375306"))
      }).finally(() => { goalRequestActive.current = false; setGoalSaving(false) })
      return
    }
    if (!text.trim() && attachments.length === 0 && !selectedWorkflow) return
    let workflowSelection: WorkflowSelection | null = null
    if (typedWorkflow) {
      if (currentlyRunning || queue.hasUnconfirmed) {
        setWorkflowError(uiText("wait_for_the_current_run_to_finish_before_sending_the_s_8a1c6253"))
        return
      }
      try { workflowSelection = prepareWorkflowSelection(typedWorkflow) }
      catch (failure) { setWorkflowError(getErrorMessage(failure)); return }
    }
    if (selectedWorkflow && !rootMode.child && (rootMode.selected === true || (currentSessionId && rootMode.selected === null))) {
      setRootModeConflict(uiText("the_selected_text_workflow_is_incompatible_with_ultra_o_b46c71ea"))
      return
    }
    setRootModeConflict(null)
    setWorkflowError(null)
    if ((currentlyRunning || queue.hasUnconfirmed) && selectedSkill) {
      showToast(uiText("remove_the_selected_skill_before_queueing_the_message_e38f6811"))
      return
    }
    const snapshot: ComposerSubmissionSnapshot = Object.freeze({
      draftKey,
      draftRevision: draftAtSubmit?.contentRevision ?? 0,
      attachmentRevision: attachmentRevisionRef.current,
      skillRevision: skillRevisionRef.current,
      workflowRevision: workflowRevisionRef.current,
      text,
      attachments: Object.freeze(attachments.map((attachment) => Object.freeze({ ...attachment }))),
      selectedSkill: selectedSkill
        ? Object.freeze({ ...selectedSkill, tool_refs: [...selectedSkill.tool_refs] })
        : null,
      selectedWorkflow: selectedWorkflow ? Object.freeze({ ...selectedWorkflow }) : null,
      typedWorkflow: workflowSelection ? Object.freeze(workflowSelection) : null,
      workspacePath: selectedProjectPath ?? pickedWorkspace,
      projectId: pendingProjectId ?? null,
      templatePrompt: !currentSessionId && !secondary ? peekPendingTemplatePrompt() : null,
      // The home picker's selection only applies when this send creates a new
      // session; an existing session keeps its stored permission mode.
      permissionMode: !currentSessionId ? useNewSessionPermission.getState().mode : null,
      rootOrchestrationOnly: !currentSessionId && draftAtSubmit?.thinkingMode !== undefined
        ? draftAtSubmit.thinkingMode === "ultra" : rootMode.requestValue,
      thinkingMode: !currentSessionId ? draftAtSubmit?.thinkingMode : undefined,
      thinkingModeRevision: !currentSessionId ? draftAtSubmit?.thinkingModeRevision : undefined,
      reasoningSelection: !currentSessionId ? inputReasoningSelection : undefined,
    })
    // Workflow expansion: the workflow's markdown is the message body; any
    // typed text is appended as extra input (lotus token semantics).
    const finalText = snapshot.selectedWorkflow
      ? `${snapshot.selectedWorkflow.content}${text.trim() ? `\n\n${text.trim()}` : ""}`
      : text
    const images = snapshot.attachments.map((a) => ({ base64: a.base64, name: a.name, size: a.size, type: a.type }))
    if (semanticComposer && (snapshot.selectedSkill || snapshot.selectedWorkflow || snapshot.typedWorkflow)) {
      showToast(uiText("ticket_enter_ticket_instructions_directly_in_the_mes_2bddd839"))
      return
    }
    const frozenReference = ticketReference
    const submission = semanticComposer && currentSessionId
      ? ticketIngress.send({ session_id: currentSessionId, message: finalText,
          model: activeModel, model_ref: currentChat?.config.model_ref ?? undefined,
          images: images.length ? images : undefined,
          ...(frozenReference ? { thread_id: frozenReference.work_id, in_reply_to: frozenReference.id } : {}),
        })
      : currentSessionId && (currentlyRunning || queue.hasUnconfirmed)
      ? queue.send(finalText, images)
      : send(finalText, {
          skillIds: snapshot.selectedSkill ? [snapshot.selectedSkill.id] : undefined,
          ...(snapshot.typedWorkflow ? { workflowSelection: snapshot.typedWorkflow } : {}),
          images: images.length ? images : undefined,
          workspacePath: snapshot.workspacePath,
          projectId: snapshot.projectId,
          templatePrompt: snapshot.templatePrompt,
          permissionMode: snapshot.permissionMode ?? undefined,
          rootOrchestrationOnly: snapshot.rootOrchestrationOnly,
          thinkingMode: snapshot.thinkingMode,
          reasoningSelection: snapshot.reasoningSelection,
        })
    void submission
      .then((result) => {
        if (currentSessionId && !rootMode.child && !currentlyRunning && !queue.hasUnconfirmed
          && result.kind !== "busy" && result.kind !== "ignored" && result.kind !== "blocked") {
          void rootMode.refresh(currentSessionId)
        }
        if (result.kind === "unconfirmed") {
          if (result.workflowError && currentDraftKeyRef.current === snapshot.draftKey) {
            const guidance: Record<string, string> = {
              root_orchestration_incompatible_mode: uiText("the_selected_workflow_is_incompatible_with_ultra_orches_de35fdd7"),
              workflow_revision_missing: uiText("the_selected_workflow_is_no_longer_available_refresh_th_7bd9ac1f"),
              workflow_revision_mismatch: uiText("the_selected_workflow_revision_has_changed_refresh_the__bcef1f66"),
              workflow_source_mismatch: uiText("the_selected_workflow_source_has_changed_refresh_the_ca_8af8563c"),
              workflow_manual_only: uiText("this_workflow_cannot_be_selected_explicitly_select_anot_78f7dbdc"),
              workflow_selection_invalid: uiText("the_workflow_or_arguments_do_not_match_the_current_defi_0bb6277d"),
              workflow_snapshot_unavailable: uiText("bamboo_cannot_preserve_the_selected_workflow_definition_43555a20"),
              workflow_snapshot_too_large: uiText("the_workflow_definition_exceeds_bamboo_s_snapshot_budge_0dc8f7de"),
              workflow_context_invalid: uiText("bamboo_cannot_prepare_the_workflow_context_check_the_ar_83c4fc3e"),
            }
            setWorkflowError(uiText("your_draft_and_selection_are_preserved_a3485200", { v0: guidance[result.workflowError.code] ?? uiText("workflow_not_accepted"), v1: result.workflowError.code, v2: result.workflowError.message }))
          }
          if (currentDraftKeyRef.current === snapshot.draftKey) composerInputRef.current?.focus()
          return
        }
        if (result.kind !== "accepted") return
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
        if (workflowRevisionRef.current === snapshot.workflowRevision) { setSelectedWorkflow(null); setTypedWorkflow(null); setRemovedWorkflow(null); setWorkflowPicker(null) }
      })
      .catch((err) => {
        // send() normally resolves a typed outcome. Preserve every composer
        // field if an unexpected client exception escapes that boundary.
        console.error("[ChatPane] submission coordinator failed", err)
        if (currentDraftKeyRef.current === snapshot.draftKey) composerInputRef.current?.focus()
      })
    // Re-pin to bottom on send — the ResizeObserver keeps it there as the reply
    // grows and as the streaming→markdown swap relayouts.
    pinToBottom()
  }

  const pickSkill = (skill: SkillDefinition) => {
    changeTypedWorkflow(null)
    changeSelectedSkill(skill)
    setDraft("")
  }

  const pickWorkflow = (command: CommandItem) => {
    const revision = ++workflowRevisionRef.current
    setDraft("")
    commandService
      .getWorkflowCommand(command.name)
      .then((detail) => {
        if (workflowRevisionRef.current !== revision) return
        changeSelectedWorkflow({
          name: command.display_name || command.name,
          content: detail.content,
        })
      })
      .catch(() => showToast(uiText("could_not_load_workflow_ed648068", { v0: command.name })))
  }

  const handleFork = (id: string) => {
    if (rootSessionUnsafe()) { setRootModeConflict(uiText("the_root_permission_change_is_unconfirmed_forking_is_un_ca51f044")); return }
    setForking(true)
    void fork(id).then((nid) => {
      setForking(false)
      if (nid) showToast(uiText("forked_into_a_new_session_from_here_b0abc6b8"))
      else showToast(uiText("could_not_fork_this_backend_does_not_support_session_fo_006caf5c"))
    })
  }

  const launchWorkbench = (action: () => void) => {
    action()
  }
  const selectSubAgentInPane = onSelectSubAgent ?? secondary?.onPickSession ?? select
  const overflowItems = [
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
    {
      label: splitOpen ? uiText("close_side_by_side_comparison_2b7637f6") : uiText("compare_side_by_side_a17b7763"),
      icon: <Columns2 className="size-4" />,
      onClick: () => launchWorkbench(onToggleSplit),
    },
  ]
  const workflowControl = (surface: "composer" | "environment") => (
    <WorkflowSelectionControl key={`${currentSessionId ?? "new"}:${surface}`} sessionId={currentSessionId}
      variant={surface} selected={typedWorkflow} onChange={changeTypedWorkflow} onRemove={removeTypedWorkflow}
      open={workflowPicker === surface} onOpenChange={(open) => {
        if (open) openWorkflowPicker(surface)
        else { setWorkflowPicker(null); setMenusDismissed(true) }
      }}
      catalogState={catalogState} onArgsFocus={() => setMenusDismissed(true)}
      onReturnFocus={() => composerInputRef.current?.focus()} disabled={workflowDisabled} error={workflowError} />
  )
  const environmentCard = !secondary && currentSessionId ? (
    <EnvironmentCard
      id={environmentId}
      workspace={displayWorkspace}
      projectName={currentProjectName}
      workflowControl={workflowControl("environment")}
      placement={currentChat?.placement}
      changedFiles={fileChangeSummary.changedFiles}
      addedLines={fileChangeSummary.addedLines}
      removedLines={fileChangeSummary.removedLines}
      sources={environmentSources}
      onOpenReview={() => launchWorkbench(onOpenReview ?? onOpenInspector)}
      onPreviewImage={setPreview}
    />
  ) : null

  return (
    <>
      <div
        className="relative flex min-w-0 flex-1 flex-col"
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
        {dragOver ? (
          <div className="pointer-events-none absolute inset-0 z-[60] m-3 flex items-center justify-center rounded-2xl border-2 border-dashed border-primary bg-primary/10 text-sm font-medium text-primary">
            {uiText("drop_to_add_images_6ccb05f2")}</div>
        ) : null}

        {secondary ? (
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
            <Select
              value={secondary.sessionId ?? undefined}
              onValueChange={(v) => secondary.onPickSession(v || null)}
            >
              <SelectTrigger size="sm" className="min-w-0 flex-1">
                <SelectValue placeholder={uiText("select_a_session_to_compare_74d69a72")} />
              </SelectTrigger>
              <SelectContent>
                {secondary.chats
                  .filter((c) => !c.parentSessionId || c.id === secondary.sessionId)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title || uiText("new_session_c57c30bc")}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {currentSessionId ? (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label={uiText("inspector_fc48a7f2")}
                  onClick={() => launchWorkbench(onOpenInspector)}
                >
                  <PanelRightOpen />
                </Button>
              </>
            ) : null}
            {!secondary.hideClose ? (
              <Button size="icon" variant="ghost" aria-label={uiText("close_pane_1cd5deec")} onClick={secondary.onClose}>
                <X />
              </Button>
            ) : null}
          </div>
        ) : (
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
            sidePaneOpen={sidePaneOpen ?? false}
            onToggleSidePane={() => launchWorkbench(onToggleSidePane ?? onOpenInspector)}
            sidebarCollapsed={sidebarCollapsed}
            supervisorControl={currentChat && isDefaultSupervisor(currentChat) && ticketScope?.binding.supervisor_session_id === currentSessionId ? (
              <SupervisorOverview controller={tickets} running={currentlyRunning} onSelectWork={onOpenWork ? openTicketWork : undefined} />
            ) : null}
          />
        )}

        <div ref={chatLayoutRef} data-chat-layout className="relative flex min-h-0 flex-1">
          <div
            data-chat-body
            className="relative flex min-w-0 flex-1 flex-col"
          >
        {currentChat?.planMode ? (
          <div className="border-b bg-primary/10 px-3 py-1.5 text-center text-xs font-medium text-primary">
            {uiText("plan_mode_7cbb85b7")} {(currentChat.planMode as { status?: string }).status
              ? ` · ${(currentChat.planMode as { status?: string }).status}`
              : ""}
          </div>
        ) : null}

        {currentChat?.parentSessionId ? (
          <button
            onClick={() =>
              secondary
                ? secondary.onPickSession(currentChat.parentSessionId as string)
                : select(currentChat.parentSessionId as string)
            }
            className="flex w-full items-center gap-1.5 border-b bg-muted/40 px-3 py-1.5 text-xs font-medium text-muted-foreground hover:text-foreground"
          >
            <ChevronLeft className="size-3.5" />{uiText("subagent_back_to_parent_session_5f5fc758")}</button>
        ) : null}

        {!currentSessionId && !secondary && !sending && !pendingUserText ? (
          // Main-pane home view: session shortcuts + quick-start templates.
          // The composer below stays live — a template only prefills it.
          <HomeDashboard
            chats={chats}
            onOpenSession={select}
            onPickTemplate={(prefill) => setDraft(prefill)}
          />
        ) : (
        <MessageList
          key={currentSessionId ?? "new-session"}
          scrollRef={scrollRef}
          contentRef={contentRef}
          onScroll={handleScroll}
          messages={messages}
          mergedSubAgents={mergedSubAgents}
          sending={currentlyRunning}
          latestRunFinished={
            !currentlyRunning &&
            streamPhase === null &&
            currentChat?.lastRunStatus === "completed"
          }
          streaming={streaming}
          streamingActive={streamPhase === "streaming"}
          streamingReasoning={streamingReasoning}
          liveSegments={liveSegments}
          streamStatus={streamStatus}
          pendingUserText={pendingUserText}
          contentShiftX={messageContentShift}
          forking={forking}
          onSelectSubAgent={(childId) => {
            selectSubAgentInPane(childId)
          }}
          onPreviewImage={setPreview}
          onRegenerate={() => {
            if (rootSessionUnsafe()) { setRootModeConflict(uiText("the_root_permission_change_is_unconfirmed_regeneration__134c0a98")); return }
            if (modelSaving) { showToast(uiText("saving_model_please_wait_04e35c5e")); return }
            void regenerate()
          }}
          onFork={handleFork}
          onDelete={(id) => void deleteMessage(id)}
          onEditMessage={(id, text) => {
            if (rootSessionUnsafe()) { setRootModeConflict(uiText("the_root_permission_change_is_unconfirmed_editing_and_r_45b99ff9")); return }
            if (modelSaving) { showToast(uiText("saving_model_please_wait_04e35c5e")); return }
            void editMessage(id, text)
          }}
        />
        )}

        {visibleSendFailure || persistedRunError ? (
          <div
            role="alert"
            aria-live="assertive"
            className="mx-auto mb-1 flex w-[calc(100%-1.5rem)] max-w-6xl flex-wrap items-center justify-between gap-2 rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm"
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
            {rootMode.unsafe ? null : generationFailed ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={sending || modelSaving}
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

        {queue.error && <div role="alert" className="mx-auto mb-1 w-[calc(100%-1.5rem)] max-w-6xl rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive">{queue.error}</div>}
        {workPanelTarget ? createPortal(ticketScope?.binding.supervisor_session_id === currentSessionId ? (
          <TicketWorkPanel controller={tickets} selectedWorkId={selectedWorkId} onShowAll={() => openTicketWork(null)} onReference={tickets.canSendIngress && ticketScope.capabilities?.message_references_v1 === true && !pendingTicketMessage ? (request) => {
            setTicketReference(request)
            onWorkReference?.()
            requestAnimationFrame(() => composerInputRef.current?.focus())
          } : undefined} />
        ) : <p role="status" className="p-4 text-sm text-muted-foreground">{tickets.negotiated ? uiText("supervisor_work_unavailable") : uiText("loading_4927a53b")}</p>, workPanelTarget) : null}
        {semanticComposer && visibleTicketReference ? <div className="mx-4 mb-2 flex items-center gap-2 text-xs" data-testid="ticket-reference">
          <span>{uiText("ticket_reference", { title: tickets.state?.works[visibleTicketReference.work_id]?.ticket.contract.title ?? uiText("supervisor_work_tab") })}</span>
          <button type="button" className="underline" disabled={pendingTicketMessage} onClick={() => setTicketReference(null)}>{uiText("ticket_clear_reference_b2e538a2")}</button>
        </div> : null}
        {semanticComposer && (ticketIngress.error || pendingTicketMessage) ? <div role="alert" className="mx-4 mb-2 text-xs text-destructive">{ticketIngress.error ?? uiText("ticket_the_previous_message_is_not_confirmed_retry_w_7369504e")}
          {ticketIngress.executePending === currentSessionId ? <button type="button" className="ml-2 underline" onClick={() => void ticketIngress.retryExecute()}>{uiText("ticket_retry_start_47d5cd3e")}</button> : null}
        </div> : null}
        <div data-composer-region className="relative shrink-0">
          {/* Keep the jump control centered on the same max-width column as the composer. */}
          {!atBottom && (
            <div
              data-scroll-to-bottom-anchor
              className="pointer-events-none absolute inset-x-0 top-0 z-20 mx-auto flex max-w-6xl -translate-y-1/2 justify-center px-3"
              style={{ transform: `translateX(${messageContentShift}px)`, transition: "transform 200ms ease-out" }}
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
          <Composer
          draft={draft}
          contentShiftX={messageContentShift}
          outputRate={outputRate}
          onDraftChange={setDraft}
          onSubmit={submit}
          onStop={stop}
          sending={currentlyRunning}
          queueMode={queue.mode}
          onQueueModeChange={currentSessionId && !submissionPending && !semanticComposer ? queue.setMode : undefined}
          sendWhileRunning={semanticComposer}
          queueControls={currentSessionId && !semanticComposer ? <SessionGuidance key={currentSessionId} sessionId={currentSessionId} messages={queue.pending} busy={queue.busy} onCancel={(id) => void queue.cancel(id)} onPreview={setPreview} /> : null}
          workflowControl={workflowPicker === "composer" || typedWorkflow || workflowError ? workflowControl("composer") : null}
          catalogState={catalogState}
          catalogDisabled={workflowDisabled}
          onPickCatalogEntry={(entry) => {
            if (workflowDisabled || workflowUnavailableReason(entry)) return
            const selection = { entry, argsText: "{}" }
            let needsArgs = false
            try { prepareWorkflowSelection(selection) } catch { needsArgs = true }
            changeTypedWorkflow(selection)
            setDraft("")
            setMenusDismissed(true)
            setWorkflowPicker(needsArgs ? "composer" : null)
            composerInputRef.current?.focus()
          }}
          workflowUndoControl={removedWorkflow && removedWorkflow.revision === workflowRevisionRef.current ? <div className="px-2 pt-1 text-xs text-muted-foreground">
            {uiText("catalog_workflow_removed_81a37c5b") + " "}<button type="button" className="text-primary hover:underline" disabled={workflowDisabled}
              onClick={() => {
                if (!workflowDisabled && removedWorkflow.revision === workflowRevisionRef.current) changeTypedWorkflow(removedWorkflow.draft)
              }}>{uiText("undo_removal_2016190c")}</button>
          </div> : null}
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
                ordinaryValue={rootMode.ordinaryValue}
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
              <ReasoningPicker
                value={rootMode.ordinaryValue}
                allowUltra={rootMode.isRoot}
                thinkingMode={rootMode.thinkingMode}
                onChange={(selection) => { setRootModeConflict(null); void rootMode.choose(selection) }}
                disabled={rootMode.controlDisabled || ticketIngress.busy}
                menuPlacement="up"
                menuAlign="right"
              />
              {models.length > 0 ? (
                <ModelPicker
                  models={
                    activeModel && !models.includes(activeModel)
                      ? [activeModel, ...models]
                      : models
                  }
                  value={activeModel}
                  onChange={(model) => void handleModelChange(model)}
                  disabled={modelControlDisabled}
                  menuPlacement="up"
                  menuAlign="right"
                />
              ) : null}
            </>
          )}
          submissionPending={submissionPending || goalSaving || queue.busy || ticketIngress.busy || modelSaving || rootMode.busy}
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
          workflows={workflowCmds}
          selectedWorkflow={selectedWorkflow}
          onClearWorkflow={() => changeSelectedWorkflow(null)}
          onPickWorkflow={pickWorkflow}
          onOpenCatalog={() => openWorkflowPicker("composer")}
          onPickCatalog={() => { openWorkflowPicker("composer"); if (slashQuery !== null) setDraft("") }}
          onPickGoal={currentSessionId ? () => { launchWorkbench(onOpenInspector); setDraft(""); setMenusDismissed(true) } : undefined}
          slashQuery={slashQuery}
          atQuery={atQuery}
          displayWorkspace={displayWorkspace}
          workspaceFiles={workspaceFiles}
          onPickFile={pickFile}
          hasSession={!!currentSessionId}
          onOpenWorkspacePicker={onOpenWorkspacePicker}
          selectedProjectId={pendingProjectId ?? null}
          onSelectProject={(projectId) => onSelectProject?.(projectId)}
          onDismissMenus={() => setMenusDismissed(true)}
        />
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

      <Toasts forking={forking} toast={toast} />

      <ImageLightbox src={preview} onClose={() => setPreview(null)} />

      {!pendingQuestion && questionError ? (
        <div role="alert" className="mx-4 mb-3 flex items-center gap-3 rounded-lg border p-3 text-sm">
          <span>{questionError}</span>
          <button type="button" className="shrink-0 underline" disabled={questionLoading || questionSubmitting} onClick={() => void refreshQuestion()}>
            {questionLoading ? uiText("refreshing_71659de8") : uiText("refresh_request_0ab317cc")}
          </button>
        </div>
      ) : null}

      {pendingApproval ? (
        <ApprovalDialog a={pendingApproval} onRespond={(ok) => void respondApproval(ok)} />
      ) : pendingQuestion ? (
        <QuestionDialog q={pendingQuestion} onAnswer={(t) => void answerQuestion(t)}
          loading={questionLoading} submitting={questionSubmitting} unavailable={questionUnavailable}
          error={questionError} canRetry={questionCanRetry}
          onRefresh={() => void refreshQuestion()} onRetry={() => void retryQuestion()} />
      ) : null}
    </>
  )
}
