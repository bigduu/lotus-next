import { createEffect, createMemo, createSignal, untrack, type Accessor } from "solid-js"
import { uiText } from "@shared/i18n/text"

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

export function createSubagentTranscript(currentSessionId: Accessor<string | null>): SubagentTranscript {
  const [scope, setScope] = createSignal<ScopedTranscript>(initialScope(untrack(currentSessionId)))
  let retryCurrent = () => {}

  createEffect(currentSessionId, (sessionId) => {
    const scoped = initialScope(sessionId)
    let current = scoped
    let active = true
    let requestInFlight = false
    let requestAgain = false
    let requestSequence = 0
    const isCurrent = () => active && currentSessionId() === sessionId

    const publish = (next: ScopedTranscript) => {
      current = next
      if (isCurrent()) setScope(next)
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
      retryCurrent = () => {}
      return () => {
        active = false
      }
    }

    const reconcile = async (): Promise<void> => {
      if (!isCurrent()) return
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
        if (!isCurrent() || request !== requestSequence) return
        const transcript = applyMessageHistory(current.transcript, history, revision)
        publish({ ...current, transcript, loading: false, error: null, truncated: history.truncated })
      } catch {
        if (!isCurrent() || request !== requestSequence) return
        publish({
          ...current,
          loading: false,
          error: uiText("subagent_messages_cannot_be_loaded_right_now_try_again__3a4bddca"),
        })
        return
      } finally {
        if (request === requestSequence) requestInFlight = false
      }
      if (!isCurrent()) return
      if (requestAgain || current.transcript.needsReconcile) {
        requestAgain = false
        void reconcile()
      }
    }

    const reconcileAfter = (
      apply: (state: MessageTranscriptState) => MessageTranscriptState,
    ) => {
      if (!isCurrent()) return
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

    retryCurrent = () => {
      if (!isCurrent()) return
      publish({ ...current, loading: current.transcript.history.length === 0, error: null })
      updateTranscript(markMessageTranscriptReconcile)
      void reconcile()
    }

    // Only now request the selected child's projected history.
    void reconcile()

    return () => {
      active = false
      requestSequence += 1
      retryCurrent = () => {}
      offReconnected()
      subscription.close()
    }
  })

  const visible = createMemo(() => scope().sessionId === currentSessionId() ? scope() : initialScope(currentSessionId()))
  const messages = createMemo(() => messageTranscriptToUi(visible().transcript))
  return {
    get messages() { return messages() },
    get loading() { return visible().loading },
    get error() { return visible().error },
    get truncated() { return visible().truncated },
    get streaming() {
      return visible().transcript.terminal === null && visible().transcript.live.some((message) => message.content.length > 0)
    },
    retry: () => retryCurrent(),
  }
}
