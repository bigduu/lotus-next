import type { SideChatIntent } from "@/lib/sideChatIntent"
import { createEffect, createMemo, createSignal, onSettled, untrack, type Accessor } from "solid-js"
import { appStore } from "@shared/store/appStore/state"
import type { InputState } from "@shared/store/appStore/slices/inputStateSlice"
import type { SkillDefinition } from "@shared/types/skill"
import { uiLanguage, uiText } from "@shared/i18n/text"
import { agentClient } from "@services/chat/AgentService"
import { getErrorMessage, isApiError } from "@services/api/errors"
import type { SessionLoopCommand, SessionLoopStatus } from "@services/chat/sessionLoop"
import { isSessionExecutionBlocked, observeSessionExecutionConflict } from "@services/chat/sessionExecutionCompatibility"
import { workspaceService } from "@services/workspace/WorkspaceService"
import type { WorkspaceFileEntry } from "@services/workspace/types"
import { getRootModeFenceState } from "@/lib/rootModeTransitionState"
import { recordSessionUserInput } from "@/lib/sidebarSessionOrderState"
import { isDefaultSupervisor } from "@/lib/supervisor"
import type { ComposerInputHandle, FileSuggestion } from "../../composer/ComposerEditor"
import { createStoreSelector } from "../../state/createStoreSelector"
import type { createChat } from "../createChat"
import { createExternalSnapshot } from "../snapshots"
import { createManualCompaction } from "../compact/createManualCompaction"
import { parseComposerCommand } from "./parseComposerCommand"

type Draft = Pick<InputState, "content" | "contentRevision">
type Result = "handled" | "pass"
type Notice = { message: string; error: boolean; detail?: string }
type GoalCommand = Extract<NonNullable<ReturnType<typeof parseComposerCommand>>, { kind: "goal" }>

export interface ComposerCommandsOptions {
  chat: ReturnType<typeof createChat>
  draftKey: Accessor<string>
  workspacePath: Accessor<string | null | undefined>
  inputId: string
  running: Accessor<boolean>
  blocked: Accessor<boolean>
  hasAttachments: Accessor<boolean>
  queueBusy: Accessor<boolean>
  queuePending: Accessor<boolean>
  compactionWait?: Accessor<boolean>
  thinkingMode: Accessor<"ultra" | "standard" | null>
  extraSessionRestricted?: Accessor<boolean>
  openGoal?: (sessionId: string) => void
  openWorkflowRuns?: (sessionId: string) => void
  openSideChat?: Accessor<((intent?: SideChatIntent) => void) | undefined>
}

const operations = new Set<string>()
const listeners = new Set<() => void>()
let operationsRevision = 0
const subscribeOperations = (onChange: () => void) => {
  listeners.add(onChange)
  return () => { listeners.delete(onChange) }
}
const notifyOperations = () => {
  ++operationsRevision
  for (const listener of listeners) listener()
}
const loopRunLabels = {
  completed: "session_loop_run_completed", failed: "session_loop_run_failed",
  cancelled: "session_loop_run_cancelled", suspended: "session_loop_run_suspended",
  dispatch_failed: "session_loop_run_dispatch_failed", running: "session_loop_run_running",
} as const

function describeLoop({ loop }: SessionLoopStatus) {
  const labels = { paused: "session_loop_paused", stopped: "session_loop_stopped", expired: "session_loop_expired" } as const
  const summary = !loop ? uiText("session_loop_absent") : loop.state === "scheduled"
    ? uiText(loop.mode === "adaptive" ? "session_loop_adaptive_scheduled" : "session_loop_scheduled")
    : uiText(labels[loop.state])
  const details: string[] = []
  if (loop?.next_fire_at) {
    const time = new Intl.DateTimeFormat(uiLanguage(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(loop.next_fire_at))
    details.push(uiText("session_loop_next_run", { time }))
  }
  if (loop?.last_run_status) {
    const label = loopRunLabels[loop.last_run_status as keyof typeof loopRunLabels] ?? "session_loop_run_unconfirmed"
    details.push(uiText("session_loop_last_result", { result: uiText(label) }))
  }
  return details.length ? `${summary} ${details.join(" · ")}` : summary
}

export function createComposerCommands(options: ComposerCommandsOptions) {
  const { chat, draftKey, workspacePath } = options
  const inputs = createStoreSelector(appStore, (state) => state.inputStates)
  const skills = createStoreSelector(appStore, (state) => state.skills)
  const scope = createMemo(() => ({ key: draftKey(), sessionId: chat.currentSessionId }), {
    equals: (previous, next) => previous?.key === next.key && previous?.sessionId === next.sessionId,
  })
  const draftText = createMemo(() => inputs()[scope().key]?.content ?? "")
  const menuDraft = createMemo(() => ({ scope: scope(), content: draftText() }))
  const [notice, setNotice] = createSignal<{ scope: ReturnType<typeof scope>; value: Notice } | null>(null)
  const [skill, setSkill] = createSignal<{ scope: ReturnType<typeof scope>; value: SkillDefinition } | null>(null)
  const [dismissed, setDismissed] = createSignal<ReturnType<typeof menuDraft> | null>(null)
  const [suggestion, setSuggestion] = createSignal<{ scope: ReturnType<typeof scope>; path: string; item: FileSuggestion } | null>(null)
  const [loadedFiles, setLoadedFiles] = createSignal<{ path: string; files: WorkspaceFileEntry[] } | null>(null)
  const [localBusy, setLocalBusy] = createSignal(false)
  const version = createExternalSnapshot(subscribeOperations, () => operationsRevision)
  let inputHandle: ComposerInputHandle | null = null
  let mounted = true
  onSettled(() => () => { mounted = false })

  const chosenSkill = () => {
    const choice = skill()
    return choice?.scope === scope() ? choice.value : null
  }
  const isDismissed = (draft: ReturnType<typeof menuDraft>) => {
    const closed = dismissed()
    return closed?.scope === draft.scope && closed.content === draft.content
  }
  createEffect(menuDraft, (draft) => {
    if (untrack(() => dismissed() && !isDismissed(draft))) setDismissed(null)
  })
  const slashQuery = createMemo(() => {
    const draft = menuDraft()
    return draft.content.startsWith("/") && !isDismissed(draft) ? draft.content.slice(1) : null
  })
  const fileSuggestion = createMemo(() => {
    const next = suggestion()
    return next?.scope === scope() && next.path === workspacePath() ? next.item : null
  })
  createEffect(workspacePath, () => { setLoadedFiles(null) })
  const filePickerPath = createMemo(() => slashQuery() === null && fileSuggestion() ? workspacePath() : null)
  createEffect(filePickerPath, (path) => {
    if (!path || untrack(() => loadedFiles()?.path === path)) return
    let current = true
    void workspaceService.listWorkspaceFiles(path).then((files) => {
      if (current && mounted && filePickerPath() === path) setLoadedFiles({ path, files })
    }).catch(() => {})
    return () => { current = false }
  })

  const report = (message: string, error = false, detail?: string, origin = scope()) => {
    if (mounted && scope() === origin) setNotice({ scope: origin, value: { message, error, detail } })
  }
  const dismiss = () => {
    // A menu action may normalize the draft before Solid publishes the store snapshot.
    setDismissed({ scope: scope(), content: appStore.getState().getInputState(draftKey()).content })
  }
  const commandBusy = () => {
    const id = chat.currentSessionId
    version()
    return localBusy() || Boolean(id && operations.has(id))
  }
  const busy = () => commandBusy() || compaction.pending()
  const run = async <T,>(id: string, request: () => Promise<T>): Promise<T> => {
    operations.add(id)
    setLocalBusy(true)
    notifyOperations()
    try {
      return await request()
    } finally {
      operations.delete(id)
      setLocalBusy(false)
      notifyOperations()
    }
  }
  const blocked = (id: string) =>
    options.blocked() || chat.submissionPending || chat.executionCompatibility.blocked
    || isSessionExecutionBlocked(id) || getRootModeFenceState(id) !== "clear"
  const restricted = (id: string) => {
    const item = chat.currentChat
    const managed = appStore.getState().managedHistoryBindings?.[id]
    return !item || item.id !== id || item.kind === "child" || Boolean(item.parentSessionId)
      || isDefaultSupervisor(item) || Boolean(managed || options.extraSessionRestricted?.())
  }
  const needsIdle = () => options.running() || chat.currentChat?.lastRunStatus === "suspended"
    || chat.currentChat?.activity === "waiting_bash" || chat.currentChat?.activity === "waiting_children"
    || chat.pendingApproval || chat.pendingQuestion || chat.questionLoading || chat.questionSubmitting
    || options.queueBusy() || commandBusy()
  const hasExtras = () => options.hasAttachments() || Boolean(chosenSkill())
  const liveDraft = (draft: Draft, origin = scope()) => {
    const current = appStore.getState().getInputState(origin.key)
    return mounted && scope() === origin && current.content === draft.content && current.contentRevision === draft.contentRevision
  }
  const clear = (key: string, revision: number) => appStore.getState().setInputContentIfRevision(key, revision, "")
  const focus = () => inputHandle?.focus()

  const compaction = createManualCompaction({
    chat, draftKey, restricted, blocked, hasExtras, dismiss, focus, onNotice: report,
    waiting: () => Boolean(needsIdle() || options.queuePending() || options.compactionWait?.()),
  })
  const handleCompact = (draft: Draft) => {
    if (parseComposerCommand(draft.content)?.kind !== "compact") return false
    setNotice(null)
    void compaction.request(draft)
    return true
  }

  const loopUnavailable = (id: string, action: SessionLoopCommand | "natural") => {
    if (restricted(id)) return uiText("session_loop_ordinary_only")
    const startsLoop = action === "natural" || (action.action !== "status" && action.action !== "stop")
    if (startsLoop && options.thinkingMode() === "ultra") return uiText("session_loop_standard_only")
    if (blocked(id)) return uiText("session_loop_session_unavailable")
    if (hasExtras()) return uiText("session_loop_send_alone")
    if (busy() || action === "natural" && needsIdle()) return uiText("session_loop_wait_for_session")
    return null
  }

  const executeLoop = (draft: Draft, action: SessionLoopCommand | "natural" | "invalid"): Result | Promise<Result> => {
    const origin = scope()
    const id = origin.sessionId
    if (action === "invalid" || !id) {
      report(uiText(action === "invalid" ? "session_loop_usage" : "session_loop_open_session"))
      return "handled"
    }
    const reason = loopUnavailable(id, action)
    if (reason) { report(reason); return "handled" }
    dismiss()
    const failed = (error: unknown): Result => {
      observeSessionExecutionConflict(id, error)
      const unavailable = isApiError(error) && (error.status === 404 || error.status === 405)
      report(uiText(unavailable ? "session_loop_backend_unavailable" : "session_loop_unconfirmed"), true,
        unavailable ? undefined : getErrorMessage(error), origin)
      return "handled"
    }
    if (action === "natural") {
      return run(id, () => agentClient.applySessionLoop(id, { action: "status" })).then(() => {
        if (!liveDraft(draft, origin)) return "handled"
        const changed = loopUnavailable(id, action)
        if (changed) { report(changed); return "handled" }
        return "pass"
      }, failed)
    }
    void run(id, () => agentClient.applySessionLoop(id, action)).then((result) => {
      clear(origin.key, draft.contentRevision)
      report(describeLoop(result), false, undefined, origin)
    }).catch(failed)
    return "handled"
  }

  const executeGoal = (draft: Draft, command: GoalCommand): Result => {
    const origin = scope()
    const id = origin.sessionId
    const resume = command.action === "resume"
    if (resume && (!id || hasExtras() || restricted(id))) {
      report(uiText("goal_resume_chat_only"), true)
      return "handled"
    }
    if (hasExtras() || !id && command.action === "configure") return "pass"
    if (!id) {
      report(uiText("open_a_session_before_setting_a_goal_83867da8"))
      return "handled"
    }
    if (blocked(id) || restricted(id) || busy()) {
      report(uiText("the_root_permission_change_is_unconfirmed_sending_and_e_a75a6b4f"), true)
      return "handled"
    }
    if (command.action === "open") {
      if (!options.openGoal) { report(uiText("operation_failed_0c3b4cf7"), true); return "handled" }
      options.openGoal(id)
      clear(origin.key, draft.contentRevision)
      dismiss()
      return "handled"
    }
    const model = chat.currentChat?.config?.model
    dismiss()
    void run(id, async () => {
      const response = resume ? await agentClient.resumeGoal(id) : await agentClient.sendMessage({
        message: command.message, session_id: id, model: model ?? "",
      })
      const goal = response.goal_command
      if (response.session_id !== id || !goal || typeof goal.action !== "string" || typeof goal.should_execute !== "boolean") {
        throw new Error("Goal command was not acknowledged")
      }
      recordSessionUserInput(id)
      clear(origin.key, draft.contentRevision)
      const labels = {
        off: "goal_paused_c6289896", clear: "goal_cleared_0cfc707e", on_no_prompt: "set_a_goal_first_cc87f18f",
        status: "goal_settings_opened_63de7dc7", resume: "goal_resume_queued",
      } as const
      const label = labels[goal.action as keyof typeof labels] ?? "goal_set_724a547c"
      if (goal.action === "status" && !options.openGoal) report(uiText("operation_failed_0c3b4cf7"), true, undefined, origin)
      else report(uiText(label), false, undefined, origin)
      if ((goal.action === "status" || goal.action === "on_no_prompt") && mounted && scope() === origin) options.openGoal?.(id)
      try { await appStore.getState().loadChatHistory(id) }
      catch { /* The acknowledgement already confirms the persisted Goal. */ }
      if (!goal.should_execute) return
      if (getRootModeFenceState(id) !== "clear") {
        report(uiText("root_permissions_are_unconfirmed_the_goal_was_saved_but_bd40481a"), true, undefined, origin)
        return
      }
      if (isSessionExecutionBlocked(id)) return
      try { await agentClient.execute(id, model) }
      catch (error) {
        observeSessionExecutionConflict(id, error)
        report(uiText("goal_saved_send_a_message_to_continue_ba844fbc"), true, getErrorMessage(error), origin)
      }
    }).catch((error) => {
      observeSessionExecutionConflict(id, error)
      const unavailable = resume && isApiError(error) && (error.status === 404 || error.status === 405)
      report(uiText(unavailable ? "goal_resume_unavailable" : "could_not_save_the_goal_your_command_is_preserved_pleas_ac375306"),
        true, getErrorMessage(error), origin)
    })
    return "handled"
  }

  const workflow = () => {
    const id = chat.currentSessionId
    if (!id || !options.openWorkflowRuns) {
      report(uiText("workflow_run_not_found"), true)
      return
    }
    dismiss()
    options.openWorkflowRuns(id)
  }

  const sideChatPrompt = (content: string) => {
    const normalized = content.trim()
    return options.openSideChat?.() && /^\/side(?:\s|$)/i.test(normalized)
      ? normalized.slice("/side".length).trim() : null
  }
  const openSideChat = (draft: Draft, prompt: string) => {
    const open = options.openSideChat?.()
    if (!open || !liveDraft(draft)) return
    const origin = scope()
    open({
      prompt,
      onApplied: () => {
        if (mounted && scope() === origin) clear(origin.key, draft.contentRevision)
      },
    })
    dismiss()
  }
  const handleSideChat = (draft: Draft) => {
    const prompt = sideChatPrompt(draft.content)
    if (prompt === null) return false
    openSideChat(draft, prompt)
    return true
  }

  function handleSubmit(draft: Draft): Result | Promise<Result> {
    const command = parseComposerCommand(draft.content)
    if (!command) {
      if (chosenSkill() && (options.running() || options.queueBusy())) {
        report(uiText("remove_the_selected_skill_before_queueing_the_message_e38f6811"))
        return "handled"
      }
      return "pass"
    }
    if (!liveDraft(draft)) return "handled"
    setNotice(null)
    if (command.kind === "loop") return executeLoop(draft, command.action)
    if (command.kind === "goal") return executeGoal(draft, command)
    if (command.kind === "compact") return "handled"
    workflow()
    return "handled"
  }

  return {
    inputId: options.inputId,
    get slashQuery() { return slashQuery() },
    get fileSuggestion() { return fileSuggestion() },
    get files() {
      const list = loadedFiles()
      return list && list.path === workspacePath() ? list.files : []
    },
    get skills() { return skills() },
    get selectedSkill() { return chosenSkill() },
    get busy() { return busy() },
    get notice() {
      const next = notice()
      return next?.scope === scope() ? next.value : null
    },
    get compactUnavailable() { return compaction.unavailable() },
    get compactPending() { return compaction.pending() },
    handleCompact,
    get canOpenGoal() { return Boolean(chat.currentSessionId && options.openGoal) },
    get canOpenWorkflowRuns() { return Boolean(chat.currentSessionId && options.openWorkflowRuns) },
    get canOpenSideChat() { return Boolean(options.openSideChat?.()) },
    isSideChatCommand: (content: string) => sideChatPrompt(content) !== null,
    selectSideChat() { openSideChat(appStore.getState().getInputState(draftKey()), "") },
    handleSideChat,
    setInputRef(handle: ComposerInputHandle | null) { inputHandle = handle },
    setFileSuggestion(next: FileSuggestion | null) {
      const path = workspacePath()
      setSuggestion(next && path ? { scope: scope(), path, item: next } : null)
    },
    dismiss, clearNotice: () => setNotice(null),
    clearSkill(expected?: SkillDefinition) {
      if (!expected || chosenSkill() === expected) setSkill(null)
    },
    pickSkill(next: SkillDefinition) {
      const origin = scope()
      const draft = appStore.getState().getInputState(origin.key)
      if (appStore.getState().setInputContentIfRevision(origin.key, draft.contentRevision, "")) setSkill({ scope: origin, value: { ...next, tool_refs: [...next.tool_refs] } })
      focus()
    },
    pickCompact() { setNotice(null); void compaction.request(appStore.getState().getInputState(draftKey()), true) },
    openGoal() {
      const origin = scope()
      if (!origin.sessionId || !options.openGoal) return
      const draft = appStore.getState().getInputState(origin.key)
      if (!draft.content.startsWith("/")) return
      options.openGoal(origin.sessionId)
      clear(origin.key, draft.contentRevision)
      dismiss()
    },
    openWorkflowRuns: workflow,
    handleSubmit,
  }
}
