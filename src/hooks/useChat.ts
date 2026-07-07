import { useCallback, useEffect, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import { useAppStore, initializeStore, selectSessionById } from "@shared/store/appStore"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import { agentClient } from "@services/chat/AgentService"
import { agentApiClient } from "@services/api"
import { notify } from "@/lib/notify"
import { mapTokenBudgetUsage } from "@shared/types/tokenBudget"

export type PendingQuestion = {
  question: string
  options: string[]
  allowCustom: boolean
}
export type PendingApproval = {
  childSessionId: string
  requestId: string
  toolName?: string
  permission?: string
  resource?: string
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
}

/**
 * One frozen segment of the CURRENT run's live timeline. Text the model
 * finished streaming before a tool round freezes into a `text` segment; the
 * round's tool calls accumulate in a `tools` segment. The still-streaming tail
 * stays in `streaming`/`streamingReasoning`. On terminal the whole timeline is
 * dropped in favor of the reloaded persisted history.
 */
export type LiveSegment =
  | { kind: "text"; text: string; reasoning: string | null }
  | { kind: "tools"; calls: LiveToolCall[] }

// Stable empty array so instances not owning the live stream don't re-render.
const EMPTY_SEGMENTS: LiveSegment[] = []

/**
 * Minimal P0 chat orchestration on top of the ported store + AgentService.
 *
 * Session list, history and persisted messages come from the store; live token
 * streaming is held locally here (the full jotai streaming machine is a later
 * port). On terminal we reload history so the persisted assistant message
 * replaces the live buffer.
 *
 * `boundSessionId` makes the hook drive a SPECIFIC session instead of the global
 * "current" one — this is what lets multiple panes each run an independent live
 * chat. Called with no argument (the main pane), the hook follows the global
 * `currentSessionId` and behaves exactly as before. A bound instance skips the
 * one-time app bootstrap (the main instance owns it) and never persists the
 * "last session" pointer.
 */
export function useChat(
  boundSessionId?: string | null,
  // For bound instances: when a send/fork creates a NEW session, the bound
  // instance must NOT mutate the global current (that would hijack the main
  // pane). Instead it reports the new id here so the caller can re-bind its own
  // pane to it (e.g. App's setSecondSid).
  onSessionCreated?: (sessionId: string) => void,
) {
  const isBound = boundSessionId !== undefined

  const chats = useAppStore(useShallow((s) => s.chats))
  const globalCurrentSessionId = useAppStore((s) => s.currentSessionId)
  // The session this hook instance drives: a bound pane uses its own id; the
  // main pane follows the global current. Everything below keys off `sid`.
  const sid = isBound ? boundSessionId : globalCurrentSessionId
  const currentChat = useAppStore(selectSessionById(sid))
  const messages = useAppStore(useShallow((s) => selectSessionById(sid)(s)?.messages ?? []))
  const selectedModel = useAppStore((s) => s.selectedModel)
  // Global default model (configured in provider settings). Used when the user
  // hasn't explicitly picked one, so sends honor the default (e.g. glm-5.2)
  // rather than falling back to a session's stale historical model.
  const defaultChatModel = useProviderStore((s) => s.providerConfig?.defaults?.chat?.model)
  const effectiveModel = selectedModel || defaultChatModel || ""
  const globalReasoningEffort = useProviderStore((s) => {
    const id = s.defaultProviderInstanceId
    return (id ? s.providerInstances.find((i) => i.id === id) : undefined)?.config?.reasoning_effort
  })
  const reasoningEffort =
    useAppStore((s) => s.inputStates[sid ?? ""]?.reasoningEffort) ?? globalReasoningEffort

  const [booted, setBooted] = useState(false)
  const [streamingText, setStreamingText] = useState<string | null>(null)
  // The session the live stream belongs to — so streaming only renders in ITS
  // conversation, never leaking into another session the user switched to.
  const [streamSid, setStreamSid] = useState<string | null>(null)
  // Optimistic just-sent user message (shows instantly before history reloads).
  const [pending, setPending] = useState<{ sid: string | null; text: string } | null>(null)
  const [sending, setSending] = useState(false)
  const [sendError, setSendError] = useState(false)
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  // Token buffer + RAF handle — coalesce many tokens into ≤1 state update/frame.
  const streamBufRef = useRef("")
  const rafRef = useRef<number | null>(null)
  // Live reasoning ("思考过程") stream — same RAF-coalescing as content tokens.
  const [streamingReasoningText, setStreamingReasoningText] = useState<string | null>(null)
  const reasonBufRef = useRef("")
  const reasonRafRef = useRef<number | null>(null)
  // Per-child rolling output buffer for live sub-agent previews.
  const childBufRef = useRef<Record<string, string>>({})
  // The current run's frozen live timeline (finished text rounds + tool groups).
  // Mutations happen on the ref; a RAF flush clones into state ≤1×/frame.
  const [liveSegmentsState, setLiveSegmentsState] = useState<LiveSegment[]>([])
  const liveSegRef = useRef<LiveSegment[]>([])
  const segRafRef = useRef<number | null>(null)
  const toolCallsByIdRef = useRef<Map<string, LiveToolCall>>(new Map())
  // One-line "what is the agent doing" status (tool running / compacting…),
  // shown while no text is streaming.
  const [streamStatusState, setStreamStatusState] = useState<string | null>(null)
  const streamStatusRef = useRef<string | null>(null)

  // Streaming / optimistic message are scoped to this instance's session.
  const streaming = streamSid === sid ? streamingText : null
  const streamingReasoning = streamSid === sid ? streamingReasoningText : null
  const liveSegments = streamSid === sid ? liveSegmentsState : EMPTY_SEGMENTS
  const streamStatus = streamSid === sid ? streamStatusState : null
  const pendingUserText =
    pending && (pending.sid === sid || pending.sid === null) ? pending.text : null

  const setStreamStatus = useCallback((status: string | null) => {
    if (streamStatusRef.current === status) return
    streamStatusRef.current = status
    setStreamStatusState(status)
  }, [])

  const flushSegments = useCallback(() => {
    if (segRafRef.current != null) return
    segRafRef.current = requestAnimationFrame(() => {
      segRafRef.current = null
      // Clone (segments + calls) so React sees new references for mutated rows.
      setLiveSegmentsState(
        liveSegRef.current.map((s) =>
          s.kind === "tools" ? { ...s, calls: s.calls.map((c) => ({ ...c })) } : s,
        ),
      )
    })
  }, [])

  // Freeze the currently-buffered assistant text/reasoning into a `text`
  // segment (natural "text → tool call" reading order) and restart the buffers
  // for whatever streams after the tool round. Also fixes the multi-round
  // duplication where every round's text piled up in ONE bubble.
  const freezeTextSegment = useCallback(() => {
    const text = streamBufRef.current
    const reasoning = reasonBufRef.current
    if (!text.trim() && !reasoning.trim()) return
    liveSegRef.current.push({ kind: "text", text, reasoning: reasoning.trim() ? reasoning : null })
    streamBufRef.current = ""
    reasonBufRef.current = ""
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    if (reasonRafRef.current != null) {
      cancelAnimationFrame(reasonRafRef.current)
      reasonRafRef.current = null
    }
    setStreamingText("")
    setStreamingReasoningText(null)
  }, [])

  const pushToken = useCallback(
    (c: string) => {
      // Text is flowing again — the "running tool…" status line is stale.
      setStreamStatus(null)
      streamBufRef.current += c
      if (rafRef.current == null) {
        rafRef.current = requestAnimationFrame(() => {
          rafRef.current = null
          setStreamingText(streamBufRef.current)
        })
      }
    },
    [setStreamStatus],
  )

  const pushReasoning = useCallback((c: string) => {
    reasonBufRef.current += c
    if (reasonRafRef.current == null) {
      reasonRafRef.current = requestAnimationFrame(() => {
        reasonRafRef.current = null
        setStreamingReasoningText(reasonBufRef.current)
      })
    }
  }, [])

  const stopStream = useCallback(
    (final: string | null) => {
      if (rafRef.current != null) {
        cancelAnimationFrame(rafRef.current)
        rafRef.current = null
      }
      if (reasonRafRef.current != null) {
        cancelAnimationFrame(reasonRafRef.current)
        reasonRafRef.current = null
      }
      if (segRafRef.current != null) {
        cancelAnimationFrame(segRafRef.current)
        segRafRef.current = null
      }
      streamBufRef.current = ""
      reasonBufRef.current = ""
      liveSegRef.current = []
      toolCallsByIdRef.current.clear()
      setLiveSegmentsState(EMPTY_SEGMENTS)
      setStreamStatus(null)
      setStreamingText(final)
      setStreamingReasoningText(null)
    },
    [setStreamStatus],
  )

  const LAST_SESSION_KEY = "lotus_next_last_session"

  useEffect(() => {
    // Only the main (unbound) instance bootstraps the app; bound panes mount
    // after boot and reuse the already-initialized store.
    if (isBound) {
      setBooted(true)
      return
    }
    void initializeStore().finally(() => {
      // Restore the last session the user was on (not whatever loadChats defaulted to).
      try {
        const saved = localStorage.getItem(LAST_SESSION_KEY)
        if (saved && useAppStore.getState().chats.some((c) => c.id === saved)) {
          useAppStore.getState().selectSession(saved)
          void useAppStore.getState().loadChatHistory(saved)
        }
      } catch {
        /* ignore */
      }
      setBooted(true)
    })
  }, [isBound])

  // Persist the active session so it's restored next launch — main pane only.
  useEffect(() => {
    if (isBound || !globalCurrentSessionId) return
    try {
      localStorage.setItem(LAST_SESSION_KEY, globalCurrentSessionId)
    } catch {
      /* ignore */
    }
  }, [globalCurrentSessionId, isBound])

  const select = useCallback((id: string) => {
    useAppStore.getState().selectSession(id)
    void useAppStore.getState().loadChatHistory(id)
  }, [])

  // Execute a session + subscribe to its token stream. Shared by send (after a
  // new user message) and by regenerate / retry / edit (after a truncate).
  const runStream = useCallback(
    async (runSid: string, opts?: { resume?: boolean }) => {
      setStreamSid(runSid)
      streamBufRef.current = ""
      reasonBufRef.current = ""
      childBufRef.current = {}
      liveSegRef.current = []
      toolCallsByIdRef.current.clear()
      setLiveSegmentsState(EMPTY_SEGMENTS)
      setStreamStatus(null)
      setStreamingText("")
      setStreamingReasoningText(null)
      // Clear any stale question only when a (re)run actually starts. A pending
      // question must NOT be cleared by the terminal that accompanies a
      // suspend-for-permission, or the approval dialog flashes and vanishes.
      setPendingQuestion(null)
      const ac = new AbortController()
      abortRef.current = ac
      // On resume (after answering a question/permission) the backend already
      // continues the suspended run — only subscribe, don't kick a fresh execute.
      if (!opts?.resume) {
        void agentClient.execute(runSid, effectiveModel || undefined, reasoningEffort).catch(() => {})
      }
      await agentClient.subscribeToEvents(
        runSid,
        {
          onToken: pushToken,
          onReasoningToken: pushReasoning,
          onToolStart: (toolCallId, toolName, args) => {
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
            setStreamStatus(`正在运行 ${toolName}…`)
            flushSegments()
          },
          onToolToken: (toolCallId, content) => {
            const call = toolCallsByIdRef.current.get(toolCallId)
            if (!call) return
            call.output += content
            flushSegments()
          },
          onToolComplete: (toolCallId, result) => {
            const call = toolCallsByIdRef.current.get(toolCallId)
            if (!call) return
            call.status = "completed"
            const r = result as { result?: unknown } | undefined
            if (typeof r?.result === "string" && r.result) call.output = r.result
            setStreamStatus(null)
            flushSegments()
          },
          onToolError: (toolCallId, error) => {
            const call = toolCallsByIdRef.current.get(toolCallId)
            if (!call) return
            call.status = "error"
            call.error = error
            setStreamStatus(null)
            flushSegments()
          },
          onTaskListUpdated: (taskList) => {
            if (taskList.session_id) {
              useAppStore.getState().setTaskList(taskList.session_id, taskList)
            }
          },
          onTaskListItemProgress: (delta) => {
            if (!delta.session_id) return
            const store = useAppStore.getState()
            // No local baseline (fresh open mid-run): fetch the full list once
            // instead of applying a delta onto nothing.
            if (!store.taskLists[delta.session_id]) void store.loadTaskList(delta.session_id)
            else store.updateTaskListDelta(delta.session_id, delta)
          },
          onTaskEvaluationStarted: (evalSid) => {
            useAppStore.getState().setEvaluationState(evalSid, {
              isEvaluating: true,
              reasoning: null,
              timestamp: Date.now(),
            })
          },
          onTaskEvaluationCompleted: (evalSid, updatesCount, reasoning) => {
            useAppStore.getState().setEvaluationState(evalSid, {
              isEvaluating: false,
              reasoning: updatesCount > 0 ? reasoning : null,
              timestamp: Date.now(),
            })
          },
          onTokenBudgetUpdated: (usage) => {
            const mapped = mapTokenBudgetUsage(usage)
            if (!mapped) return
            const store = useAppStore.getState()
            store.updateTokenUsage(runSid, mapped)
            store.setTruncationInfo(runSid, usage.truncation_occurred, usage.segments_removed)
          },
          onContextCompressionStatus: (_phase, status) => {
            if (status === "started") setStreamStatus("正在压缩上下文…")
            else setStreamStatus(null)
          },
          onSubAgentStarted: (parentSid, childId, title) => {
            useAppStore.getState().applyChildProgress(parentSid, childId, {
              title,
              status: "running",
            })
          },
          onSubAgentEvent: (parentSid, childId, event) => {
            const e = event as { type?: string; content?: string; tool_name?: string }
            const patch: { outputPreview?: string } = {}
            if (e.type === "token" && e.content) {
              childBufRef.current[childId] = (childBufRef.current[childId] || "") + e.content
              patch.outputPreview = childBufRef.current[childId].slice(-400)
            } else if (e.type === "tool_start" && e.tool_name) {
              patch.outputPreview = `· 调用 ${e.tool_name}…`
            }
            if (patch.outputPreview !== undefined) {
              useAppStore.getState().applyChildProgress(parentSid, childId, patch)
            }
          },
          onSubAgentCompleted: (parentSid, childId, status, error) => {
            useAppStore.getState().applyChildProgress(parentSid, childId, {
              status: error ? "error" : status || "completed",
              error: error || undefined,
            })
          },
          // A background/async shell finished. Record its outcome in the store
          // keyed by bash_id so the already-rendered tool card flips reactively
          // (no history reload). NO ping is fired here: `bash_completed` is a
          // cached CRITICAL event replayed on every resubscribe, which would
          // burst. The user-facing ping comes from the backend `notification`
          // (category background_task_completed) via `onNotification` below —
          // deduped, preference-gated, and never replayed.
          onBashCompleted: (bashId, _command, exitCode, status) => {
            useAppStore.getState().setBashCompleted(bashId, status, exitCode)
          },
          // Backend-classified notifications (deduped + preference-gated server
          // side, and NOT part of the critical-event replay). Surface as an OS
          // notification (opt-in via lib/notify). Covers needs-clarification /
          // approval / context-critical / sub-agent + background-task completion.
          onNotification: (event) => {
            const e = event as { title?: string; body?: string }
            notify(e.title ?? "", e.body ?? "")
          },
          onNeedClarification: (event) =>
            setPendingQuestion({
              question: event.question ?? "",
              options: event.options ?? [],
              allowCustom: event.allow_custom ?? true,
            }),
          onChildApprovalRequested: (childSessionId, requestId, req) =>
            setPendingApproval({
              childSessionId,
              requestId,
              toolName: req.toolName,
              permission: req.permission,
              resource: req.resource,
            }),
          onComplete: async () => {
            // Freeze the fully-streamed text in place (cancel any pending RAF) so the
            // assistant bubble keeps showing it while the persisted message loads —
            // otherwise it blanks for a beat between "streaming" and "normal".
            if (rafRef.current != null) {
              cancelAnimationFrame(rafRef.current)
              rafRef.current = null
            }
            const finalText = streamBufRef.current
            if (finalText) setStreamingText(finalText)
            // waitForAssistant is a no-op without retries (its loop guard is
            // `attempt < retries`), so pass a real retry budget — otherwise the
            // load can apply a state without the assistant reply and the held
            // bubble clears into a blank/empty view.
            await useAppStore
              .getState()
              .loadChatHistory(runSid, { waitForAssistant: true, retries: 8, retryDelayMs: 150 })
            stopStream(null)
          },
          onError: async () => {
            setSendError(true)
            await useAppStore.getState().loadChatHistory(runSid)
            stopStream(null)
          },
          onCancelled: async () => {
            await useAppStore.getState().loadChatHistory(runSid)
            stopStream(null)
          },
        },
        ac,
      )
    },
    [effectiveModel, reasoningEffort],
  )

  // Re-run the conversation after a server-side truncate/restore (regenerate,
  // retry, edit). Shows the streaming placeholder + reloads history on done.
  const rerun = useCallback(
    async (runSid: string) => {
      if (sending) return
      setSending(true)
      setSendError(false)
      try {
        await useAppStore.getState().loadChatHistory(runSid)
        await runStream(runSid)
      } catch (err) {
        console.error("[useChat] rerun failed", err)
        stopStream(null)
      } finally {
        setSending(false)
      }
    },
    [runStream, sending],
  )

  const regenerate = useCallback(async () => {
    if (!sid) return
    await agentClient.truncateSessionMessages(sid, { mode: "after_last_user" }).catch(() => {})
    await rerun(sid)
  }, [sid, rerun])

  const retry = useCallback(async () => {
    if (!sid) return
    await agentClient.truncateSessionMessages(sid, { mode: "error_retry" }).catch(() => {})
    await rerun(sid)
  }, [sid, rerun])

  // Edit a user message in place, drop everything after it, and re-run.
  const editMessage = useCallback(
    async (messageId: string, text: string) => {
      const body = text.trim()
      if (!sid || !body) return
      await agentClient.patchSessionMessage(sid, messageId, { content: body }).catch(() => {})
      await agentClient
        .restoreSessionState(sid, { target_message_id: messageId, restore_files: false })
        .catch(() => {})
      await rerun(sid)
    },
    [sid, rerun],
  )

  const send = useCallback(
    async (
      text: string,
      opts?: {
        skillIds?: string[]
        images?: Array<{ base64: string; name?: string; size?: number; type?: string }>
        workspacePath?: string | null
      },
    ) => {
      const body = text.trim()
      if ((!body && !opts?.images?.length) || sending) return
      const startSid = sid
      setSending(true)
      setSendError(false)
      // Optimistically show the user's message + streaming placeholder right away,
      // scoped to the session it's being sent to.
      if (body) setPending({ sid: startSid, text: body })
      setStreamSid(startSid)
      streamBufRef.current = ""
      setStreamingText("")
      try {
        const res = await agentClient.sendMessage({
          message: body,
          session_id: sid ?? undefined,
          model: effectiveModel,
          selected_skill_ids: opts?.skillIds?.length ? opts.skillIds : undefined,
          images: opts?.images?.length ? opts.images : undefined,
          // Only meaningful when creating a NEW session; an existing session keeps
          // the cwd it was created with.
          workspace_path: !sid && opts?.workspacePath ? opts.workspacePath : undefined,
        })
        const newSid = res.session_id

        if (newSid !== startSid) {
          // New session: re-key the optimistic message + stream to the real id.
          if (body) setPending({ sid: newSid, text: body })
          setStreamSid(newSid)
          await useAppStore.getState().refreshChatsNow()
          // Bound pane: report the new id (caller re-binds) instead of moving the
          // global current; main pane: select it globally as before.
          if (isBound) onSessionCreated?.(newSid)
          else useAppStore.getState().selectSession(newSid)
        }
        // Real user message is now persisted — reload, then drop the optimistic one.
        await useAppStore.getState().loadChatHistory(newSid)
        setPending(null)

        await runStream(newSid)
      } catch (err) {
        console.error("[useChat] send failed", err)
        setSendError(true)
        stopStream(null)
      } finally {
        setSending(false)
      }
    },
    [sid, isBound, onSessionCreated, effectiveModel, sending, runStream],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    if (sid) void agentClient.stopGeneration(sid).catch(() => {})
    stopStream(null)
  }, [sid])

  const newChat = useCallback(() => {
    useAppStore.getState().selectSession(null)
    stopStream(null)
  }, [])

  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!sid) return
      await agentClient.deleteSessionMessage(sid, messageId).catch(() => {})
      await useAppStore.getState().loadChatHistory(sid)
    },
    [sid],
  )

  // Fork the conversation from a message: backend clones the session up to that
  // message into a fresh one; we switch to the new branch.
  const fork = useCallback(
    async (messageId: string): Promise<string | undefined> => {
      if (!sid) return undefined
      try {
        const res = await agentApiClient.post<{ session?: { id?: string; session_id?: string } }>(
          `sessions/${encodeURIComponent(sid)}/fork`,
          { up_to_message_id: messageId },
        )
        const newId = res?.session?.id ?? res?.session?.session_id
        if (!newId) return undefined
        // Await the full switch so the caller's loading spinner spans the whole
        // operation and clears exactly when we land on the new branch.
        await useAppStore.getState().refreshChatsNow()
        // Bound pane adopts the branch locally; main pane switches global current.
        if (isBound) onSessionCreated?.(newId)
        else useAppStore.getState().selectSession(newId)
        await useAppStore.getState().loadChatHistory(newId)
        return newId
      } catch {
        return undefined
      }
    },
    [sid, isBound, onSessionCreated],
  )

  // Answering a clarification resumes the SAME run — the original subscription
  // is still open (a pending question keeps the stream live), so tokens keep
  // flowing into onToken. No new run / no `sending` conflict.
  const answerQuestion = useCallback(
    async (text: string) => {
      if (!sid) return
      setPendingQuestion(null)
      await agentApiClient
        .post(`respond/${encodeURIComponent(sid)}`, { response: text })
        .catch(() => {})
      // The backend resumes the suspended run — re-subscribe to watch it stream
      // live (and to catch a follow-up permission prompt). Don't re-execute.
      await runStream(sid, { resume: true })
    },
    [sid, runStream],
  )

  const respondApproval = useCallback(
    async (approved: boolean) => {
      const pa = pendingApproval
      setPendingApproval(null)
      if (!pa) return
      await agentClient
        .respondToChildApproval(pa.childSessionId, pa.requestId, approved)
        .catch(() => {})
    },
    [pendingApproval],
  )

  return {
    booted: isBound ? true : booted,
    chats,
    currentSessionId: sid,
    currentChat,
    messages,
    streaming,
    streamingReasoning,
    liveSegments,
    streamStatus,
    pendingUserText,
    sending,
    select,
    send,
    stop,
    newChat,
    deleteMessage,
    fork,
    regenerate,
    retry,
    editMessage,
    sendError,
    pendingQuestion,
    pendingApproval,
    answerQuestion,
    respondApproval,
  }
}
