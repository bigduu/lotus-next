import { useCallback, useEffect, useMemo, useRef, useState } from "react"

import { agentClient } from "@services/chat/AgentService"
import {
  onReconnected,
  subscribeMessages,
  type MessageChannelControl,
  type MessageChannelEvent,
} from "@services/chat/v2Stream"
import {
  applyMessageChannelControl,
  applyMessageChannelEvent,
  applyMessageHistory,
  emptyMessageTranscript,
  markMessageTranscriptReconcile,
  messageTranscriptToUi,
  type MessageTranscriptState,
} from "@services/chat/messageTranscript"

interface ScopedTranscript {
  sessionId: string | null
  transcript: MessageTranscriptState
  loading: boolean
  error: string | null
  truncated: boolean
}

export interface SubagentTranscript {
  messages: ReturnType<typeof messageTranscriptToUi>
  loading: boolean
  error: string | null
  truncated: boolean
  streaming: boolean
  retry: () => void
}

const initialScope = (sessionId: string | null): ScopedTranscript => ({
  sessionId,
  transcript: emptyMessageTranscript(),
  loading: sessionId !== null,
  error: null,
  truncated: false,
})

export function useSubagentTranscript(sessionId: string | null): SubagentTranscript {
  const [scope, setScope] = useState<ScopedTranscript>(() => initialScope(sessionId))
  const retryRef = useRef<() => void>(() => {})

  useEffect(() => {
    const scoped = initialScope(sessionId)
    let current = scoped
    let active = true
    let requestInFlight = false
    let requestAgain = false
    let requestSequence = 0

    const publish = (next: ScopedTranscript) => {
      current = next
      if (active) setScope(next)
    }
    const updateTranscript = (
      apply: (state: MessageTranscriptState) => MessageTranscriptState,
    ): MessageTranscriptState => {
      const transcript = apply(current.transcript)
      publish({ ...current, transcript })
      return transcript
    }

    publish(scoped)
    if (!sessionId) {
      retryRef.current = () => {}
      return () => {
        active = false
      }
    }

    const reconcile = async (): Promise<void> => {
      if (!active) return
      if (requestInFlight) {
        requestAgain = true
        return
      }
      requestInFlight = true
      requestAgain = false
      const request = ++requestSequence
      const revision = current.transcript.reconcileRevision
      try {
        const history = await agentClient.getMessageHistory(sessionId)
        if (!active || request !== requestSequence) return
        const transcript = applyMessageHistory(current.transcript, history, revision)
        publish({ ...current, transcript, loading: false, error: null, truncated: history.truncated })
      } catch {
        if (!active || request !== requestSequence) return
        publish({
          ...current,
          loading: false,
          error: "子代理消息暂时无法加载，请稍后重试。",
        })
        return
      } finally {
        if (request === requestSequence) requestInFlight = false
      }
      if (!active) return
      if (requestAgain || current.transcript.needsReconcile) {
        requestAgain = false
        void reconcile()
      }
    }

    const reconcileAfter = (
      apply: (state: MessageTranscriptState) => MessageTranscriptState,
    ) => {
      const previousRevision = current.transcript.reconcileRevision
      const transcript = updateTranscript(apply)
      if (transcript.reconcileRevision !== previousRevision) {
        void reconcile()
      }
    }

    // Subscribe first. The server snapshot + queued live tail close the REST race.
    const subscription = subscribeMessages(sessionId, {
      onEvent: (event: MessageChannelEvent) => {
        reconcileAfter((state) => applyMessageChannelEvent(state, event))
      },
      onControl: (control: MessageChannelControl) => {
        reconcileAfter((state) => applyMessageChannelControl(state, control))
      },
    })
    const offReconnected = onReconnected(() => {
      reconcileAfter(markMessageTranscriptReconcile)
    })

    retryRef.current = () => {
      if (!active) return
      publish({ ...current, loading: current.transcript.history.length === 0, error: null })
      updateTranscript(markMessageTranscriptReconcile)
      void reconcile()
    }

    // Only now request the selected child's projected history.
    void reconcile()

    return () => {
      active = false
      requestSequence += 1
      retryRef.current = () => {}
      offReconnected()
      subscription.close()
    }
  }, [sessionId])

  const visible = scope.sessionId === sessionId ? scope : initialScope(sessionId)
  const retry = useCallback(() => retryRef.current(), [])
  const messages = useMemo(
    () => messageTranscriptToUi(visible.transcript),
    [visible.transcript],
  )
  const streaming = visible.transcript.terminal === null
    && visible.transcript.live.some((message) => message.content.length > 0)

  return {
    messages,
    loading: visible.loading,
    error: visible.error,
    truncated: visible.truncated,
    streaming,
    retry,
  }
}
