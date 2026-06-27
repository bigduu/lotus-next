import { useCallback, useEffect, useRef, useState } from "react"
import { useShallow } from "zustand/react/shallow"
import {
  useAppStore,
  initializeStore,
  selectCurrentMessages,
  selectCurrentChat,
} from "@shared/store/appStore"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import { agentClient } from "@services/chat/AgentService"
import { agentApiClient } from "@services/api"

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

/**
 * Minimal P0 chat orchestration on top of the ported store + AgentService.
 *
 * Session list, history and persisted messages come from the store; live token
 * streaming is held locally here (the full jotai streaming machine is a later
 * port). On terminal we reload history so the persisted assistant message
 * replaces the live buffer.
 */
export function useChat() {
  const chats = useAppStore(useShallow((s) => s.chats))
  const currentSessionId = useAppStore((s) => s.currentSessionId)
  const currentChat = useAppStore(selectCurrentChat)
  const messages = useAppStore(useShallow(selectCurrentMessages))
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
    useAppStore((s) => s.inputStates[currentSessionId ?? ""]?.reasoningEffort) ??
    globalReasoningEffort

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

  // Streaming / optimistic message are scoped to the current session.
  const streaming = streamSid === currentSessionId ? streamingText : null
  const pendingUserText =
    pending && (pending.sid === currentSessionId || pending.sid === null) ? pending.text : null

  const pushToken = useCallback((c: string) => {
    streamBufRef.current += c
    if (rafRef.current == null) {
      rafRef.current = requestAnimationFrame(() => {
        rafRef.current = null
        setStreamingText(streamBufRef.current)
      })
    }
  }, [])

  const stopStream = useCallback((final: string | null) => {
    if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current)
      rafRef.current = null
    }
    streamBufRef.current = ""
    setStreamingText(final)
  }, [])

  const LAST_SESSION_KEY = "lotus_next_last_session"

  useEffect(() => {
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
  }, [])

  // Persist the active session so it's restored next launch.
  useEffect(() => {
    if (!currentSessionId) return
    try {
      localStorage.setItem(LAST_SESSION_KEY, currentSessionId)
    } catch {
      /* ignore */
    }
  }, [currentSessionId])

  const select = useCallback((id: string) => {
    useAppStore.getState().selectSession(id)
    void useAppStore.getState().loadChatHistory(id)
  }, [])

  // Execute a session + subscribe to its token stream. Shared by send (after a
  // new user message) and by regenerate / retry / edit (after a truncate).
  const runStream = useCallback(
    async (sid: string) => {
      setStreamSid(sid)
      streamBufRef.current = ""
      setStreamingText("")
      const ac = new AbortController()
      abortRef.current = ac
      void agentClient.execute(sid, effectiveModel || undefined, reasoningEffort).catch(() => {})
      await agentClient.subscribeToEvents(
        sid,
        {
          onToken: pushToken,
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
            setPendingQuestion(null)
            await useAppStore.getState().loadChatHistory(sid, { waitForAssistant: true })
            stopStream(null)
          },
          onError: async () => {
            setPendingQuestion(null)
            setSendError(true)
            await useAppStore.getState().loadChatHistory(sid)
            stopStream(null)
          },
          onCancelled: async () => {
            setPendingQuestion(null)
            await useAppStore.getState().loadChatHistory(sid)
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
    async (sid: string) => {
      if (sending) return
      setSending(true)
      setSendError(false)
      try {
        await useAppStore.getState().loadChatHistory(sid)
        await runStream(sid)
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
    if (!currentSessionId) return
    await agentClient.truncateSessionMessages(currentSessionId, { mode: "after_last_user" }).catch(() => {})
    await rerun(currentSessionId)
  }, [currentSessionId, rerun])

  const retry = useCallback(async () => {
    if (!currentSessionId) return
    await agentClient.truncateSessionMessages(currentSessionId, { mode: "error_retry" }).catch(() => {})
    await rerun(currentSessionId)
  }, [currentSessionId, rerun])

  // Edit a user message in place, drop everything after it, and re-run.
  const editMessage = useCallback(
    async (messageId: string, text: string) => {
      const sid = currentSessionId
      const body = text.trim()
      if (!sid || !body) return
      await agentClient.patchSessionMessage(sid, messageId, { content: body }).catch(() => {})
      await agentClient
        .restoreSessionState(sid, { target_message_id: messageId, restore_files: false })
        .catch(() => {})
      await rerun(sid)
    },
    [currentSessionId, rerun],
  )

  const send = useCallback(
    async (
      text: string,
      opts?: {
        skillIds?: string[]
        images?: Array<{ base64: string; name?: string; size?: number; type?: string }>
      },
    ) => {
      const body = text.trim()
      if ((!body && !opts?.images?.length) || sending) return
      const startSid = currentSessionId
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
          session_id: currentSessionId ?? undefined,
          model: effectiveModel,
          selected_skill_ids: opts?.skillIds?.length ? opts.skillIds : undefined,
          images: opts?.images?.length ? opts.images : undefined,
        })
        const sid = res.session_id

        if (sid !== startSid) {
          // New session: re-key the optimistic message + stream to the real id.
          if (body) setPending({ sid, text: body })
          setStreamSid(sid)
          await useAppStore.getState().refreshChatsNow()
          useAppStore.getState().selectSession(sid)
        }
        // Real user message is now persisted — reload, then drop the optimistic one.
        await useAppStore.getState().loadChatHistory(sid)
        setPending(null)

        await runStream(sid)
      } catch (err) {
        console.error("[useChat] send failed", err)
        setSendError(true)
        stopStream(null)
      } finally {
        setSending(false)
      }
    },
    [currentSessionId, effectiveModel, sending, runStream],
  )

  const stop = useCallback(() => {
    abortRef.current?.abort()
    if (currentSessionId) void agentClient.stopGeneration(currentSessionId).catch(() => {})
    stopStream(null)
  }, [currentSessionId])

  const newChat = useCallback(() => {
    useAppStore.getState().selectSession(null)
    stopStream(null)
  }, [])

  const deleteMessage = useCallback(
    async (messageId: string) => {
      if (!currentSessionId) return
      await agentClient.deleteSessionMessage(currentSessionId, messageId).catch(() => {})
      await useAppStore.getState().loadChatHistory(currentSessionId)
    },
    [currentSessionId],
  )

  // Fork the conversation from a message: backend clones the session up to that
  // message into a fresh one; we switch to the new branch.
  const fork = useCallback(
    async (messageId: string): Promise<string | undefined> => {
      if (!currentSessionId) return undefined
      try {
        const res = await agentApiClient.post<{ session?: { id?: string; session_id?: string } }>(
          `sessions/${encodeURIComponent(currentSessionId)}/fork`,
          { up_to_message_id: messageId },
        )
        const newId = res?.session?.id ?? res?.session?.session_id
        if (!newId) return undefined
        // Await the full switch so the caller's loading spinner spans the whole
        // operation and clears exactly when we land on the new branch.
        await useAppStore.getState().refreshChatsNow()
        useAppStore.getState().selectSession(newId)
        await useAppStore.getState().loadChatHistory(newId)
        return newId
      } catch {
        return undefined
      }
    },
    [currentSessionId],
  )

  // Answering a clarification resumes the SAME run — the original subscription
  // is still open (a pending question keeps the stream live), so tokens keep
  // flowing into onToken. No new run / no `sending` conflict.
  const answerQuestion = useCallback(
    async (text: string) => {
      if (!currentSessionId) return
      setPendingQuestion(null)
      await agentApiClient
        .post(`respond/${encodeURIComponent(currentSessionId)}`, { response: text })
        .catch(() => {})
    },
    [currentSessionId],
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
    booted,
    chats,
    currentSessionId,
    currentChat,
    messages,
    streaming,
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
