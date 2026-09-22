import { useMarkSessionRead } from "@/lib/sessionReadState"
import { useMediaQuery } from "@shared/hooks/useMediaQuery"
import { useEffect, useId, useMemo, useRef, useState } from "react"
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
import { useAppStore, selectChildren } from "@shared/store/appStore"
import { agentClient } from "@services/chat/AgentService"
import { commandService, type CommandItem } from "@services/command"
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
import { SessionGuidance } from "@/components/app/SessionGuidance"
import { Composer } from "@/components/app/Composer"
import { Toasts } from "@/components/app/Toasts"
import { ImageLightbox } from "@/components/app/ImageLightbox"
import { peekPendingTemplatePrompt } from "@/lib/taskTemplates"
import { ContextUsageRing } from "@/components/app/ContextUsageRing"
import { ReasoningPicker } from "@/components/chat/ReasoningPicker"
import { ModelPicker } from "@/components/chat/ModelPicker"
import { NewSessionPermissionControl, PermissionModeControl } from "@/components/chat/PermissionModeControl"
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
  workspacePath: string | null
  projectId: string | null
  templatePrompt: ReturnType<typeof peekPendingTemplatePrompt>
  /** Permission mode to stamp when this submission creates a NEW session. */
  permissionMode: SessionPermissionMode | null
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
  sidePaneOpen,
  onToggleSidePane,
  splitOpen,
  onToggleSplit,
  onSelectSubAgent,
  onOpenSidebar,
  sidebarCollapsed,
  secondary,
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
}) {
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
    ? currentChat.lastRunError?.trim() || "生成失败，服务端未提供错误详情。"
    : null
  const generationFailed = visibleSendFailure?.kind === "generation-failed"
    || persistedRunError !== null
  const runErrorDetail = visibleSendFailure?.message?.trim()
    || (generationFailed && currentChat?.lastRunStatus === "error"
      ? currentChat.lastRunError?.trim() || persistedRunError
      : null)
  const queue = useGuidanceQueue(currentSessionId, currentlyRunning)
  // The secondary chat hook remains mounted when its pane closes. Read state
  // follows the rendered pane, including the same breakpoint as its md:flex.
  const splitVisible = useMediaQuery("(min-width: 768px)")
  const [chatLayoutRef, chatLayoutWidth] = useContainerWidth<HTMLDivElement>()
  const environmentHasRoom = chatLayoutWidth >= ENVIRONMENT_AUTO_SHOW_MIN_WIDTH
  useMarkSessionRead(!secondary || splitVisible ? currentChat : null)
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
    setSelectedWorkflow(value)
  }
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
  const setInputReasoningEffort = useAppStore((s) => s.setInputReasoningEffort)
  const clearInputReasoningEffort = useAppStore((s) => s.clearInputReasoningEffort)
  const changeSessionReasoningEffort = useAppStore((s) => s.changeSessionReasoningEffort)
  const [reasoningSaving, setReasoningSaving] = useState(false)
  const handleReasoningChange = async (selection: ReasoningEffortSelection) => {
    if (reasoningSaving || selection === reasoningSelection) return
    if (!currentSessionId) {
      setInputReasoningEffort(draftKey, selection)
      return
    }

    setReasoningSaving(true)
    try {
      await changeSessionReasoningEffort(
        currentSessionId,
        selection === "auto" ? null : selection,
      )
    } catch {
      showToast("推理强度保存失败，请重试")
    } finally {
      setReasoningSaving(false)
    }
  }
  // What the next send will use: explicit pick → this session's bound model →
  // configured Chat default. Existing child panes must not be relabelled with
  // the root Chat default merely because the global picker is unset.
  const activeModel =
    selectedModel ||
    currentChat?.config?.model_ref?.model ||
    currentChat?.config?.model ||
    defaultChatModel ||
    ""

  // Escape hides the pickers until the draft changes again (typing re-opens).
  const [menusDismissed, setMenusDismissed] = useState(false)
  useEffect(() => {
    setMenusDismissed(false)
  }, [draft])

  const slashQuery = !menusDismissed && draft.startsWith("/") ? draft.slice(1) : null

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
    if (submissionPending || queue.busy || goalRequestActive.current) return
    const storeAtSubmit = useAppStore.getState()
    const draftAtSubmit = storeAtSubmit.inputStates[draftKey]
    const text = draftAtSubmit?.content ?? ""
    const goalCommand = !selectedWorkflow && !selectedSkill && attachments.length === 0
      ? /^\/goal(?:\s+([\s\S]*))?$/i.exec(text.trim()) : null
    if (goalCommand && (currentSessionId || !goalCommand[1]?.trim())) {
      if (!currentSessionId) { showToast("请先打开一个会话，再设置目标。"); return }
      const revision = draftAtSubmit?.contentRevision ?? 0
      const objective = goalCommand[1]?.trim()
      if (!objective) {
        onOpenInspector()
        storeAtSubmit.setInputContentIfRevision(draftKey, revision, "")
        return
      }
      const sessionId = currentSessionId
      goalRequestActive.current = true; setGoalSaving(true)
      void agentClient.sendMessage({ message: text.trim(), session_id: sessionId, model: currentChat?.config?.model ?? "" }).then(async (response) => {
        if (response.session_id !== sessionId || !response.goal_command) throw new Error("Goal command was not acknowledged")
        useAppStore.getState().setInputContentIfRevision(draftKey, revision, "")
        if (currentDraftKeyRef.current === draftKey) {
          const action = response.goal_command.action
          showToast(action === "off" ? "目标已暂停" : action === "clear" ? "目标已清除" : action === "on_no_prompt" ? "请先设置目标" : action === "status" ? "已打开目标设置" : "目标已设置")
          if (action === "status" || action === "on_no_prompt") onOpenInspector()
        }
        try { await useAppStore.getState().loadChatHistory(sessionId) }
        catch { /* The command acknowledgement already confirms the saved configuration. */ }
        // Execution admission handles an already-running session atomically.
        // The run may finish while the Goal command is being acknowledged.
        if (response.goal_command.should_execute) {
          try { await agentClient.execute(sessionId, currentChat?.config?.model) }
          catch { if (currentDraftKeyRef.current === draftKey) showToast("目标已保存，发送消息即可继续推进") }
        }
      }).catch(() => {
        if (currentDraftKeyRef.current === draftKey) showToast("目标保存失败，指令已保留，请重试")
      }).finally(() => { goalRequestActive.current = false; setGoalSaving(false) })
      return
    }
    if (!text.trim() && attachments.length === 0 && !selectedWorkflow) return
    if ((currentlyRunning || queue.hasUnconfirmed) && selectedSkill) {
      showToast("请先移除已选技能，再把消息加入队列。")
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
      workspacePath: selectedProjectPath ?? pickedWorkspace,
      projectId: pendingProjectId ?? null,
      templatePrompt: !currentSessionId && !secondary ? peekPendingTemplatePrompt() : null,
      // The home picker's selection only applies when this send creates a new
      // session; an existing session keeps its stored permission mode.
      permissionMode: !currentSessionId ? useNewSessionPermission.getState().mode : null,
      reasoningSelection: !currentSessionId ? inputReasoningSelection : undefined,
    })
    // Workflow expansion: the workflow's markdown is the message body; any
    // typed text is appended as extra input (lotus token semantics).
    const finalText = snapshot.selectedWorkflow
      ? `${snapshot.selectedWorkflow.content}${text.trim() ? `\n\n${text.trim()}` : ""}`
      : text
    const images = snapshot.attachments.map((a) => ({ base64: a.base64, name: a.name, size: a.size, type: a.type }))
    const submission = currentSessionId && (currentlyRunning || queue.hasUnconfirmed)
      ? queue.send(finalText, images)
      : send(finalText, {
          skillIds: snapshot.selectedSkill ? [snapshot.selectedSkill.id] : undefined,
          images: images.length ? images : undefined,
          workspacePath: snapshot.workspacePath,
          projectId: snapshot.projectId,
          templatePrompt: snapshot.templatePrompt,
          permissionMode: snapshot.permissionMode ?? undefined,
          reasoningSelection: snapshot.reasoningSelection,
        })
    void submission
      .then((result) => {
        if (result.kind === "unconfirmed") {
          if (currentDraftKeyRef.current === snapshot.draftKey) composerInputRef.current?.focus()
          return
        }
        if (result.kind !== "accepted") return

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
          const latestSelection = useAppStore.getState().inputStates[
            snapshot.draftKey
          ]?.reasoningEffort
          if (latestSelection === snapshot.reasoningSelection) {
            clearInputReasoningEffort(snapshot.draftKey)
          }
        }
        if (attachmentRevisionRef.current === snapshot.attachmentRevision) setAttachments([])
        if (skillRevisionRef.current === snapshot.skillRevision) setSelectedSkill(null)
        if (workflowRevisionRef.current === snapshot.workflowRevision) setSelectedWorkflow(null)
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
    changeSelectedSkill(skill)
    setDraft("")
  }

  const pickWorkflow = (command: CommandItem) => {
    setDraft("")
    commandService
      .getWorkflowCommand(command.name)
      .then((detail) =>
        changeSelectedWorkflow({
          name: command.display_name || command.name,
          content: detail.content,
        }),
      )
      .catch(() => showToast(`加载工作流 ${command.name} 失败`))
  }

  const handleFork = (id: string) => {
    setForking(true)
    void fork(id).then((nid) => {
      setForking(false)
      if (nid) showToast("已从这里分叉到新会话")
      else showToast("分叉失败:当前后端暂不支持会话分叉")
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
            label: "导出 Markdown",
            icon: <Download className="size-4" />,
            onClick: () => downloadMarkdown(messages, currentChat?.title || "chat"),
          },
          {
            label: "导出 PDF",
            icon: <FileDown className="size-4" />,
            onClick: () => void downloadPdf(messages, currentChat?.title || "chat"),
          },
        ]
      : []),
    {
      label: splitOpen ? "关闭分屏对比" : "分屏对比",
      icon: <Columns2 className="size-4" />,
      onClick: () => launchWorkbench(onToggleSplit),
    },
  ]
  const environmentCard = !secondary && currentSessionId ? (
    <EnvironmentCard
      id={environmentId}
      workspace={displayWorkspace}
      projectName={currentProjectName}
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
            松开以添加图片
          </div>
        ) : null}

        {secondary ? (
          <div className="flex shrink-0 items-center gap-2 border-b px-3 py-2">
            <Select
              value={secondary.sessionId ?? undefined}
              onValueChange={(v) => secondary.onPickSession(v || null)}
            >
              <SelectTrigger size="sm" className="min-w-0 flex-1">
                <SelectValue placeholder="选择会话并排…" />
              </SelectTrigger>
              <SelectContent>
                {secondary.chats
                  .filter((c) => !c.parentSessionId || c.id === secondary.sessionId)
                  .map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.title || "新会话"}
                    </SelectItem>
                  ))}
              </SelectContent>
            </Select>
            {currentSessionId ? (
              <>
                <Button
                  size="icon"
                  variant="ghost"
                  aria-label="检查器"
                  onClick={() => launchWorkbench(onOpenInspector)}
                >
                  <PanelRightOpen />
                </Button>
              </>
            ) : null}
            {!secondary.hideClose ? (
              <Button size="icon" variant="ghost" aria-label="关闭分栏" onClick={secondary.onClose}>
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
          />
        )}

        <div ref={chatLayoutRef} data-chat-layout className="relative flex min-h-0 flex-1">
          <div
            data-chat-body
            className="relative flex min-w-0 flex-1 flex-col"
          >
        {currentChat?.planMode ? (
          <div className="border-b bg-primary/10 px-3 py-1.5 text-center text-xs font-medium text-primary">
            计划模式
            {(currentChat.planMode as { status?: string }).status
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
            <ChevronLeft className="size-3.5" /> 子代理 · 返回父会话
          </button>
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
          onRegenerate={() => void regenerate()}
          onFork={handleFork}
          onDelete={(id) => void deleteMessage(id)}
          onEditMessage={(id, text) => void editMessage(id, text)}
        />
        )}

        {/* Jump-to-bottom button — shows when scrolled up to read history. */}
        {!atBottom && (
          <button
            onClick={scrollToBottom}
            aria-label="滚动到底部"
            className="absolute bottom-24 left-1/2 z-20 -translate-x-1/2 rounded-full border bg-card p-2 text-muted-foreground shadow-lg transition-colors hover:bg-accent hover:text-foreground"
          >
            <ChevronDown className="size-5" />
          </button>
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
                  ? "发送状态未确认，内容已保留"
                  : "消息已发送，但生成中断"}
              </p>
              {runErrorDetail ? (
                <p className="mt-1 break-words text-xs">
                  错误详情：{runErrorDetail}
                </p>
              ) : null}
            </div>
            {generationFailed ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={sending}
                onClick={() => {
                  if (visibleSendFailure?.kind === "generation-failed") {
                    void retry(visibleSendFailure)
                  } else {
                    void retry()
                  }
                }}
              >
                <RotateCcw className="size-3.5" /> 重试生成
              </Button>
            ) : (
              <Button size="sm" variant="secondary" onClick={() => composerInputRef.current?.focus()}>
                继续编辑
              </Button>
            )}
          </div>
        ) : null}

        {queue.error && <div role="alert" className="mx-auto mb-1 w-[calc(100%-1.5rem)] max-w-6xl rounded-lg border border-destructive/40 px-3 py-2 text-xs text-destructive">{queue.error}</div>}
        {typeof outputRate === "number" && (
          <div className="mx-auto w-full max-w-6xl px-3 text-right text-xs tabular-nums text-muted-foreground" title="根据流式文本估算，不用于计费">
            约 {outputRate.toFixed(1)} token/秒
          </div>
        )}
        <Composer
          draft={draft}
          onDraftChange={setDraft}
          onSubmit={submit}
          onStop={stop}
          sending={currentlyRunning}
          queueMode={queue.mode}
          onQueueModeChange={currentSessionId && !submissionPending ? queue.setMode : undefined}
          queueControls={currentSessionId ? <SessionGuidance key={currentSessionId} sessionId={currentSessionId} messages={queue.pending} busy={queue.busy} onCancel={(id) => void queue.cancel(id)} onPreview={setPreview} /> : null}
          permissionControl={currentSessionId ? (
            <PermissionModeControl
              sessionId={currentSessionId}
              title={currentChat?.title || currentSessionId}
              compact
            />
          ) : (
            <NewSessionPermissionControl />
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
                value={reasoningSelection}
                onChange={(selection) => void handleReasoningChange(selection)}
                disabled={reasoningSaving}
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
                  onChange={setSelectedModel}
                  menuPlacement="up"
                  menuAlign="right"
                />
              ) : null}
            </>
          )}
          submissionPending={submissionPending || goalSaving || queue.busy}
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
            {questionLoading ? "正在刷新…" : "刷新请求"}
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
