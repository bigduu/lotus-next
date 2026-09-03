import { useCallback, useEffect, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import {
  useAppStore,
  initializeStore,
  selectSessionById,
  selectShouldObserve,
} from "@shared/store/appStore"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import { agentClient } from "@services/chat/AgentService"
import { apiClient } from "@services/api"
import { notify } from "@/lib/notify"
import { mapTokenBudgetUsage } from "@shared/types/tokenBudget"
import { getSystemPromptEnhancementText } from "@shared/utils/systemPromptEnhancement"
import { isCopilotConclusionWithOptionsEnhancementEnabled } from "@shared/utils/copilotConclusionWithOptionsEnhancementUtils"
import {
  acknowledgePendingTemplatePrompt,
  type PendingTemplatePromptSnapshot,
} from "@/lib/taskTemplates"

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

export type SubmissionUnconfirmedFailure = {
  kind: "submission-unconfirmed"
  operationId: number
  sessionId: string | null
}

export type GenerationFailure = {
  kind: "generation-failed"
  operationId: number
  sessionId: string
  pendingOperationId?: number
}

export type SendFailure = SubmissionUnconfirmedFailure | GenerationFailure

export type SendSubmissionResult =
  | { kind: "accepted"; operationId: number; sessionId: string; navigated: boolean }
  | { kind: "unconfirmed"; operationId: number }
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
  // Provider TYPE of the default instance — drives provider-specific prompt
  // enhancement segments (e.g. the Copilot conclusion-with-options contract).
  const providerType = useProviderStore((s) => {
    const id = s.defaultProviderInstanceId
    return (id ? s.providerInstances.find((i) => i.id === id) : undefined)?.type
  })
  const reasoningEffort =
    useAppStore((s) => s.inputStates[sid ?? ""]?.reasoningEffort) ?? globalReasoningEffort

  const [booted, setBooted] = useState(false)
  const [streamingText, setStreamingText] = useState<string | null>(null)
  // The session the live stream belongs to — so streaming only renders in ITS
  // conversation, never leaking into another session the user switched to.
  const [streamSid, setStreamSid] = useState<string | null>(null)
  // Optimistic just-sent user message (shows instantly before history reloads).
  const [pending, setPending] = useState<{
    operationId: number
    sid: string
    text: string
  } | null>(null)
  const [sending, setSending] = useState(false)
  const [submissionPending, setSubmissionPending] = useState(false)
  const [sendFailures, setSendFailures] = useState<ReadonlyMap<string | null, SendFailure>>(
    () => new Map(),
  )
  const [pendingQuestion, setPendingQuestion] = useState<PendingQuestion | null>(null)
  const [pendingApproval, setPendingApproval] = useState<PendingApproval | null>(null)
  const abortRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(false)
  const operationSequenceRef = useRef(0)
  const activeSendRef = useRef<ActiveSendOperation | null>(null)
  const sendFailuresRef = useRef<ReadonlyMap<string | null, SendFailure>>(new Map())
  const latestOperationBySessionRef = useRef<Map<string | null, number>>(new Map())
  const streamOperationRef = useRef<number | null>(null)
  const subscriptionRef = useRef<{ operationId: number; sessionId: string } | null>(null)
  const navigationRef = useRef({ sessionId: sid, epoch: 0 })
  if (navigationRef.current.sessionId !== sid) {
    navigationRef.current = {
      sessionId: sid,
      epoch: navigationRef.current.epoch + 1,
    }
  }
  // The session whose agent channel this instance is CURRENTLY subscribed to
  // (null once the subscription settles). Guards the passive-observe engine
  // against double-subscribing a run we already drive/watch.
  const subscribedSidRef = useRef<string | null>(null)
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
  const pendingUserText = pending?.sid === sid ? pending.text : null
  const sendFailure = sendFailures.get(sid ?? null) ?? null

  const noteSessionOperation = useCallback((sessionId: string | null, operationId: number) => {
    const current = latestOperationBySessionRef.current.get(sessionId)
    if (current === undefined || operationId > current) {
      latestOperationBySessionRef.current.set(sessionId, operationId)
    }
  }, [])

  const publishSendFailure = useCallback((failure: SendFailure) => {
    const latestOperation = latestOperationBySessionRef.current.get(failure.sessionId)
    if (latestOperation !== undefined && latestOperation > failure.operationId) return false
    const current = sendFailuresRef.current.get(failure.sessionId)
    if (current && current.operationId > failure.operationId) return false
    const next = new Map(sendFailuresRef.current)
    next.set(failure.sessionId, failure)
    sendFailuresRef.current = next
    if (mountedRef.current) setSendFailures(next)
    return true
  }, [])

  const clearSendFailure = useCallback(
    (sessionId: string | null, expectedOperationId?: number) => {
      const current = sendFailuresRef.current.get(sessionId)
      if (!current || (expectedOperationId !== undefined && current.operationId !== expectedOperationId)) {
        return false
      }
      const next = new Map(sendFailuresRef.current)
      next.delete(sessionId)
      sendFailuresRef.current = next
      if (mountedRef.current) setSendFailures(next)
      return true
    },
    [],
  )

  const getSendFailure = useCallback((sessionId: string | null) => {
    return sendFailuresRef.current.get(sessionId) ?? null
  }, [])

  const clearPendingOperation = useCallback((operationId: number) => {
    if (!mountedRef.current) return
    setPending((current) => (current?.operationId === operationId ? null : current))
  }, [])

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
    (final: string | null, operationId?: number) => {
      if (operationId !== undefined && streamOperationRef.current !== operationId) return
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
      streamOperationRef.current = null
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
    async (
      runSid: string,
      opts?: { resume?: boolean; operationId?: number; pendingOperationId?: number },
    ) => {
      const operationId = opts?.operationId ?? operationSequenceRef.current + 1
      operationSequenceRef.current = Math.max(operationSequenceRef.current, operationId)
      noteSessionOperation(runSid, operationId)
      streamOperationRef.current = operationId
      const ownsStream = () => streamOperationRef.current === operationId
      const terminal = { settlement: null as Promise<void> | null }
      // ONE live subscription per hook instance: sever the previous one FIRST
      // so its handlers can't pollute the buffers we're about to re-key to a
      // (possibly different) session. Abort synchronously removes the
      // subscriber from the shared WS channel.
      abortRef.current?.abort()
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
      const subscription = { operationId, sessionId: runSid }
      subscriptionRef.current = subscription
      subscribedSidRef.current = runSid
      // On resume (after answering a question/permission) the backend already
      // continues the suspended run — only subscribe, don't kick a fresh execute.
      if (!opts?.resume) {
        void agentClient.execute(runSid, effectiveModel || undefined, reasoningEffort).catch(() => {
          if (!ownsStream()) return
          // The run never started, so no terminal will ever arrive — settle
          // the subscription instead of leaving it (and the UI) hanging.
          publishSendFailure({
            kind: "generation-failed",
            operationId,
            sessionId: runSid,
            pendingOperationId: opts?.pendingOperationId,
          })
          stopStream(null, operationId)
          ac.abort()
        })
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
          onComplete: () => {
            if (!ownsStream() || terminal.settlement) return
            terminal.settlement = (async () => {
              // Freeze the fully-streamed text in place while persisted history
              // loads, so terminal delivery never flashes an empty assistant row.
              if (rafRef.current != null) {
                cancelAnimationFrame(rafRef.current)
                rafRef.current = null
              }
              const finalText = streamBufRef.current
              if (finalText) setStreamingText(finalText)
              let historyLoaded = false
              try {
                // waitForAssistant is a no-op without a real retry budget.
                await useAppStore.getState().loadChatHistory(runSid, {
                  waitForAssistant: true,
                  retries: 8,
                  retryDelayMs: 150,
                })
                historyLoaded = true
              } catch (err) {
                console.warn("[useChat] terminal history hydration failed", err)
              }
              if (!ownsStream()) return
              if (historyLoaded && opts?.pendingOperationId !== undefined) {
                clearPendingOperation(opts.pendingOperationId)
              }
              stopStream(historyLoaded ? null : finalText || null, operationId)
            })()
          },
          onError: () => {
            if (!ownsStream() || terminal.settlement) return
            publishSendFailure({
              kind: "generation-failed",
              operationId,
              sessionId: runSid,
              pendingOperationId: opts?.pendingOperationId,
            })
            terminal.settlement = (async () => {
              let historyLoaded = false
              try {
                await useAppStore.getState().loadChatHistory(runSid)
                historyLoaded = true
              } catch (err) {
                console.warn("[useChat] failed-generation history hydration failed", err)
              }
              if (!ownsStream()) return
              if (historyLoaded && opts?.pendingOperationId !== undefined) {
                clearPendingOperation(opts.pendingOperationId)
              }
              stopStream(null, operationId)
            })()
          },
          onCancelled: () => {
            if (!ownsStream() || terminal.settlement) return
            terminal.settlement = (async () => {
              let historyLoaded = false
              try {
                await useAppStore.getState().loadChatHistory(runSid)
                historyLoaded = true
              } catch (err) {
                console.warn("[useChat] cancelled-generation history hydration failed", err)
              }
              if (!ownsStream()) return
              if (historyLoaded && opts?.pendingOperationId !== undefined) {
                clearPendingOperation(opts.pendingOperationId)
              }
              stopStream(null, operationId)
            })()
          },
        },
        ac,
      ).finally(() => {
        if (subscriptionRef.current === subscription) {
          subscriptionRef.current = null
          subscribedSidRef.current = null
        }
      })
      if (terminal.settlement) {
        await terminal.settlement
      } else if (ownsStream()) {
        // The transport contract settles only on terminal or abort. Reaching
        // here while still owning the stream is therefore a broken generation,
        // not a successful completion.
        publishSendFailure({
          kind: "generation-failed",
          operationId,
          sessionId: runSid,
          pendingOperationId: opts?.pendingOperationId,
        })
        stopStream(null, operationId)
      }
    },
    [
      effectiveModel,
      reasoningEffort,
      freezeTextSegment,
      pushToken,
      pushReasoning,
      setStreamStatus,
      flushSegments,
      stopStream,
      clearPendingOperation,
      publishSendFailure,
      noteSessionOperation,
    ],
  )

  // Sever only the UI subscription when this hook instance unmounts. A chat
  // POST that is already in flight may still be acknowledged afterwards; its
  // exact template lease is committed and its server-side generation is
  // started without publishing stale React state or navigation.
  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      streamOperationRef.current = null
      subscriptionRef.current = null
      subscribedSidRef.current = null
      abortRef.current?.abort()
    }
  }, [])

  // ── Passive observation: engage runs driven ELSEWHERE ────────────────
  // A run started on another device, by a schedule, or before a reload flips
  // this session's execution phase to busy via the session summary. If nothing
  // here is subscribed to its agent channel yet, subscribe (no execute) so live
  // tokens stream in instead of the transcript freezing until terminal.
  const shouldObserve = useAppStore((s) => (sid ? selectShouldObserve(sid)(s) : false))
  useEffect(() => {
    if (!sid || !shouldObserve) return
    if (activeSendRef.current) return
    if (subscribedSidRef.current === sid) return
    void runStream(sid, { resume: true })
  }, [sid, shouldObserve, sending, runStream])

  // ── Stranded-terminal reconcile ───────────────────────────────────────
  // If the summary settles (is_running=false via the feed) while we still hold
  // a live subscription for that session, the agent channel probably missed
  // its terminal frame (e.g. frozen background WS). Give the channel a grace
  // period to deliver, then force-settle: abort + reload history.
  const summaryRunning = currentChat?.isRunning ?? false
  useEffect(() => {
    if (!sid || summaryRunning) return
    if (subscribedSidRef.current !== sid) return
    if (sending) return // we drive this run; send() owns settling
    const timer = setTimeout(() => {
      if (subscribedSidRef.current !== sid) return
      const stillRunning = useAppStore.getState().chats.find((c) => c.id === sid)?.isRunning
      if (stillRunning) return
      abortRef.current?.abort()
      void useAppStore
        .getState()
        .loadChatHistory(sid)
        .then(() => stopStream(null))
    }, 2_000)
    return () => clearTimeout(timer)
  }, [sid, summaryRunning, sending, stopStream])

  // ── Pending-question rehydration ──────────────────────────────────────
  // A run suspended on a question keeps waiting across reloads and devices,
  // but the ask event only flows to the subscription that was live when it
  // fired. On every session open, ask the backend for the pending question so
  // the dialog reappears (and stale dialogs from the previous session clear).
  useEffect(() => {
    setPendingQuestion(null)
    if (!sid) return
    let stale = false
    void apiClient
      .get<{
        has_pending_question: boolean
        question?: string
        options?: string[]
        allow_custom?: boolean
      }>(`respond/${encodeURIComponent(sid)}/pending`)
      .then((res) => {
        if (stale || !res?.has_pending_question) return
        setPendingQuestion({
          question: res.question ?? "",
          options: res.options ?? [],
          allowCustom: res.allow_custom ?? true,
        })
      })
      .catch(() => {
        /* best-effort rehydration */
      })
    return () => {
      stale = true
    }
  }, [sid])

  // ── Tab-visibility reconcile (main instance only) ────────────────────
  // A backgrounded tab/webview freezes the WS and every reconnect timer; runs
  // that finished (or started) while hidden never delivered their frames. On
  // regain: refresh summaries (settles finished runs), reconcile the open
  // conversation, and let the observe effect re-engage anything still running.
  useEffect(() => {
    if (isBound) return
    const onVisibility = () => {
      if (document.visibilityState !== "visible") return
      const store = useAppStore.getState()
      void store.refreshChatsNow()
      const cur = store.currentSessionId
      if (cur) store.reconcileOpenSession(cur, "visibility_regain")
    }
    document.addEventListener("visibilitychange", onVisibility)
    return () => document.removeEventListener("visibilitychange", onVisibility)
  }, [isBound])

  // Re-run the conversation after a server-side truncate/restore (regenerate,
  // retry, edit). Shows the streaming placeholder + reloads history on done.
  const rerun = useCallback(
    async (
      runSid: string,
      opts?: {
        prepare?: () => Promise<unknown>
        expectedFailureOperationId?: number
        pendingOperationId?: number
        preserveFailureOnPrepareError?: boolean
      },
    ): Promise<boolean> => {
      if (activeSendRef.current) return false
      if (
        opts?.expectedFailureOperationId !== undefined &&
        getSendFailure(runSid)?.operationId !== opts.expectedFailureOperationId
      ) {
        return false
      }
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
        if (
          opts?.expectedFailureOperationId !== undefined &&
          getSendFailure(runSid)?.operationId !== opts.expectedFailureOperationId
        ) {
          // The lock makes this unreachable during normal UI operation. If an
          // external callback replaced the failure after a destructive prepare,
          // still run the exact session so truncation cannot strand it.
          console.warn("[useChat] retry failure ownership changed after preparation")
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
            await agentClient.execute(runSid, effectiveModel || undefined, reasoningEffort)
            try {
              await useAppStore.getState().loadChatHistory(runSid)
              if (operation.pendingOperationId !== undefined) {
                clearPendingOperation(operation.pendingOperationId)
              }
            } catch (err) {
              console.warn("[useChat] detached rerun history hydration failed", err)
            }
            return true
          } catch (err) {
            console.warn("[useChat] detached rerun start failed", err)
            publishSendFailure({
              kind: "generation-failed",
              operationId: operation.id,
              sessionId: runSid,
              pendingOperationId: operation.pendingOperationId,
            })
            return false
          }
        }

        if (mountedRef.current) setSubmissionPending(false)
        const stream = runStream(runSid, {
          operationId: operation.id,
          pendingOperationId: operation.pendingOperationId,
        })
        streamStarted = true
        void useAppStore
          .getState()
          .loadChatHistory(runSid)
          .then(() => {
            if (operation.pendingOperationId !== undefined) {
              clearPendingOperation(operation.pendingOperationId)
            }
          })
          .catch((err) => console.warn("[useChat] rerun history hydration failed", err))
        await stream
        return true
      } catch (err) {
        console.error("[useChat] rerun failed", err)
        if (streamStarted || !opts?.preserveFailureOnPrepareError) {
          publishSendFailure({
            kind: "generation-failed",
            operationId: operation.id,
            sessionId: runSid,
            pendingOperationId: operation.pendingOperationId,
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
    },
    [
      clearPendingOperation,
      clearSendFailure,
      effectiveModel,
      getSendFailure,
      noteSessionOperation,
      publishSendFailure,
      reasoningEffort,
      runStream,
      stopStream,
    ],
  )

  const regenerate = useCallback(async () => {
    if (!sid) return
    await rerun(sid, {
      prepare: () =>
        agentClient.truncateSessionMessages(sid, { mode: "after_last_user" }).catch(() => {}),
    })
  }, [sid, rerun])

  const retry = useCallback(
    async (failure?: GenerationFailure) => {
      const currentFailure = getSendFailure(sid ?? null)
      const target = failure ?? (currentFailure?.kind === "generation-failed" ? currentFailure : undefined)
      if (!target || getSendFailure(target.sessionId)?.operationId !== target.operationId) return
      await rerun(target.sessionId, {
        expectedFailureOperationId: target.operationId,
        pendingOperationId: target.pendingOperationId,
        preserveFailureOnPrepareError: true,
        prepare: () =>
          agentClient.truncateSessionMessages(target.sessionId, { mode: "error_retry" }),
      })
    },
    [getSendFailure, rerun, sid],
  )

  // Edit a user message in place, drop everything after it, and re-run.
  const editMessage = useCallback(
    async (messageId: string, text: string) => {
      const body = text.trim()
      if (!sid || !body) return
      await rerun(sid, {
        prepare: async () => {
          await agentClient.patchSessionMessage(sid, messageId, { content: body }).catch(() => {})
          await agentClient
            .restoreSessionState(sid, { target_message_id: messageId, restore_files: false })
            .catch(() => {})
        },
      })
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
        templatePrompt?: PendingTemplatePromptSnapshot | null
      },
    ): Promise<SendSubmissionResult> => {
      const body = text.trim()
      if (!body && !opts?.images?.length) return { kind: "ignored" }
      if (activeSendRef.current) return { kind: "busy" }

      const startSid = sid
      const operation: ActiveSendOperation = {
        id: operationSequenceRef.current + 1,
        phase: "submitting",
        originSessionId: startSid,
        originNavigationEpoch: navigationRef.current.epoch,
      }
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
      try {
        // Client-side prompt enhancement (OS info + operational guidance + the
        // user's own enhancement text), recomputed per send like lotus does.
        const enhancePrompt = getSystemPromptEnhancementText(providerType).trim()
        // New sessions honor (in priority order) a just-picked home-dashboard
        // template's base prompt, then the selected system-prompt preset;
        // existing sessions keep the prompt they were created with.
        let systemPrompt: string | undefined
        if (!startSid) {
          const st = useAppStore.getState()
          const preset = st.lastSelectedPromptId
            ? st.systemPrompts.find((p) => p.id === st.lastSelectedPromptId)
            : undefined
          systemPrompt = templatePrompt?.prompt.trim() || preset?.content?.trim() || undefined
        }
        const res = await agentClient.sendMessage({
          message: body,
          session_id: startSid ?? undefined,
          model: effectiveModel,
          enhance_prompt: enhancePrompt || undefined,
          copilot_conclusion_with_options_enhancement_enabled:
            providerType === "copilot" && isCopilotConclusionWithOptionsEnhancementEnabled(),
          system_prompt: systemPrompt,
          selected_skill_ids: opts?.skillIds?.length ? opts.skillIds : undefined,
          images: opts?.images?.length ? opts.images : undefined,
          // Only meaningful when creating a NEW session; an existing session keeps
          // the cwd it was created with.
          workspace_path: !startSid && opts?.workspacePath ? opts.workspacePath : undefined,
        })
        acknowledgedSessionId =
          typeof res?.session_id === "string" ? res.session_id.trim() : ""
        if (!acknowledgedSessionId || (startSid && acknowledgedSessionId !== startSid)) {
          throw new Error("The chat submission response did not acknowledge the expected session.")
        }
      } catch (err) {
        console.error("[useChat] message submission was not acknowledged", err)
        if (activeSendRef.current?.id === operation.id) activeSendRef.current = null
        if (mountedRef.current) {
          setSubmissionPending(false)
          setSending(false)
          publishSendFailure({
            kind: "submission-unconfirmed",
            operationId: operation.id,
            sessionId: startSid,
          })
        }
        return { kind: "unconfirmed", operationId: operation.id }
      }

      operation.phase = "generating"
      operation.acknowledgedSessionId = acknowledgedSessionId
      operation.pendingOperationId = operation.id
      noteSessionOperation(acknowledgedSessionId, operation.id)
      if (templatePrompt) acknowledgePendingTemplatePrompt(templatePrompt)

      let navigated = false
      const stillAtOrigin =
        mountedRef.current &&
        navigationRef.current.sessionId === operation.originSessionId &&
        navigationRef.current.epoch === operation.originNavigationEpoch

      if (!stillAtOrigin) {
        // A valid late acknowledgement still owns a server-side generation, but
        // it must not replace the session subscription the user is viewing now.
        if (mountedRef.current) {
          setSubmissionPending(false)
          setSending(false)
        }
        if (activeSendRef.current?.id === operation.id) activeSendRef.current = null
        void agentClient
          .execute(acknowledgedSessionId, effectiveModel || undefined, reasoningEffort)
          .catch((err) => {
            console.warn("[useChat] detached generation start failed", err)
            publishSendFailure({
              kind: "generation-failed",
              operationId: operation.id,
              sessionId: acknowledgedSessionId,
            })
          })
        if (acknowledgedSessionId !== startSid) {
          void useAppStore
            .getState()
            .refreshChatsNow()
            .catch((err) => console.warn("[useChat] detached session refresh failed", err))
        }
      } else {
        setSubmissionPending(false)
        if (body) {
          setPending({
            operationId: operation.id,
            sid: acknowledgedSessionId,
            text: body,
          })
        }

        if (acknowledgedSessionId !== startSid) {
          if (isBound) {
            if (onSessionCreated) {
              onSessionCreated(acknowledgedSessionId)
              navigated = true
            }
          } else {
            useAppStore.getState().selectSession(acknowledgedSessionId)
            navigated = true
          }
        }

        // Start execute + the exact session subscription before resolving the
        // acknowledgement to the composer. Session-list/history hydration is
        // auxiliary and must never prevent an acknowledged message from running.
        void runStream(acknowledgedSessionId, {
          operationId: operation.id,
          pendingOperationId: operation.pendingOperationId,
        })
          .catch((err) => {
            console.error("[useChat] acknowledged generation failed", err)
            publishSendFailure({
              kind: "generation-failed",
              operationId: operation.id,
              sessionId: acknowledgedSessionId,
              pendingOperationId: operation.pendingOperationId,
            })
            stopStream(null, operation.id)
          })
          .finally(() => {
            if (activeSendRef.current?.id === operation.id) activeSendRef.current = null
            if (mountedRef.current) setSending(false)
          })

        void (async () => {
          if (acknowledgedSessionId !== startSid) {
            await useAppStore
              .getState()
              .refreshChatsNow()
              .catch((err) => console.warn("[useChat] acknowledged session refresh failed", err))
          }
          await useAppStore.getState().loadChatHistory(acknowledgedSessionId)
          clearPendingOperation(operation.id)
        })().catch((err) => {
          console.warn("[useChat] acknowledged message hydration failed", err)
        })
      }

      return {
        kind: "accepted",
        operationId: operation.id,
        sessionId: acknowledgedSessionId,
        navigated,
      }
    },
    [
      sid,
      isBound,
      onSessionCreated,
      effectiveModel,
      providerType,
      reasoningEffort,
      runStream,
      stopStream,
      clearPendingOperation,
      clearSendFailure,
      noteSessionOperation,
      publishSendFailure,
    ],
  )

  const stop = useCallback(() => {
    const active = activeSendRef.current
    if (active?.phase === "submitting" || active?.phase === "preparing") return
    const targetSessionId = active?.acknowledgedSessionId ?? sid
    const pendingOperationId = active?.pendingOperationId
    const operationId = active?.id ?? streamOperationRef.current ?? undefined
    abortRef.current?.abort()
    stopStream(null, operationId)
    if (!targetSessionId) return
    void (async () => {
      await agentClient.stopGeneration(targetSessionId).catch(() => {})
      try {
        await useAppStore.getState().loadChatHistory(targetSessionId)
        if (pendingOperationId !== undefined) clearPendingOperation(pendingOperationId)
      } catch (err) {
        console.warn("[useChat] stopped-generation history hydration failed", err)
      }
    })()
  }, [clearPendingOperation, sid, stopStream])

  const newChat = useCallback(() => {
    useAppStore.getState().selectSession(null)
    stopStream(null)
  }, [stopStream])

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
        const res = await apiClient.post<{ session?: { id?: string; session_id?: string } }>(
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
      await apiClient
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
    submissionPending,
    select,
    send,
    stop,
    newChat,
    deleteMessage,
    fork,
    regenerate,
    retry,
    editMessage,
    sendFailure,
    pendingQuestion,
    pendingApproval,
    answerQuestion,
    respondApproval,
  }
}
