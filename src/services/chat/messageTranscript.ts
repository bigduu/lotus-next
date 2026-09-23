import type { MessageHistoryResponse } from "./AgentService"
import type {
  MessageChannelControl,
  MessageChannelEvent,
  MessageTerminalReason,
  VisibleMessageItem,
} from "./v2Stream"
import type { Message } from "@shared/types/chat"

export interface MessageTranscriptState {
  history: MessageHistoryResponse["messages"]
  /** Durable on the server, retained locally until projected history confirms it. */
  committedReplay: VisibleMessageItem[]
  /** Text owned by the current runner generation and not yet durably reconciled. */
  live: VisibleMessageItem[]
  liveVersion: number | null
  terminal: MessageTerminalReason | null
  commitPending: boolean
  needsReconcile: boolean
  reconcileRevision: number
}

export const emptyMessageTranscript = (): MessageTranscriptState => ({
  history: [],
  committedReplay: [],
  live: [],
  liveVersion: null,
  terminal: null,
  commitPending: false,
  needsReconcile: false,
  reconcileRevision: 0,
})

const utf8 = new TextEncoder()

const bytesEqual = (left: Uint8Array, right: Uint8Array): boolean =>
  left.length === right.length && left.every((value, index) => value === right[index])

const applyDelta = (current: string, offset: number, content: string): string | null => {
  const currentBytes = utf8.encode(current)
  const deltaBytes = utf8.encode(content)
  if (offset > currentBytes.length) return null
  if (offset === currentBytes.length) return current + content
  const existing = currentBytes.slice(offset, offset + deltaBytes.length)
  return bytesEqual(existing, deltaBytes) ? current : null
}

const mergeReplay = (
  current: VisibleMessageItem[],
  incoming: VisibleMessageItem[],
): VisibleMessageItem[] => {
  const next = [...current]
  const indexes = new Map(next.map((message, index) => [message.id, index]))
  for (const message of incoming) {
    const index = indexes.get(message.id)
    if (index === undefined) {
      indexes.set(message.id, next.length)
      next.push(message)
    } else {
      next[index] = message
    }
  }
  return next
}

const mergeHistory = (
  current: MessageHistoryResponse["messages"],
  incoming: MessageHistoryResponse["messages"],
  isDelta: boolean,
): MessageHistoryResponse["messages"] => {
  if (!isDelta) return incoming
  const next = [...current]
  const indexes = new Map(next.map((message, index) => [message.id, index]))
  for (const message of incoming) {
    const index = indexes.get(message.id)
    if (index === undefined) {
      indexes.set(message.id, next.length)
      next.push(message)
    } else {
      next[index] = message
    }
  }
  return next
}

export const applyMessageHistory = (
  state: MessageTranscriptState,
  response: MessageHistoryResponse,
  requestRevision: number = state.reconcileRevision,
): MessageTranscriptState => {
  const current = requestRevision === state.reconcileRevision
  const retiresCommittedReplay = current && state.commitPending
  return {
    ...state,
    history: mergeHistory(state.history, response.messages, response.is_delta),
    committedReplay: retiresCommittedReplay ? [] : state.committedReplay,
    commitPending: retiresCommittedReplay ? false : state.commitPending,
    needsReconcile: current ? false : state.needsReconcile,
  }
}

export const applyMessageChannelEvent = (
  state: MessageTranscriptState,
  event: MessageChannelEvent,
): MessageTranscriptState => {
  if (event.type === "snapshot") {
    if (event.history_committed) {
      return {
        ...state,
        committedReplay: mergeReplay(state.committedReplay, state.live),
        live: [],
        liveVersion: event.version,
        terminal: event.terminal ?? state.terminal,
        commitPending: true,
        needsReconcile: true,
        reconcileRevision: state.reconcileRevision + 1,
      }
    }
    return {
      ...state,
      live: event.messages,
      liveVersion: event.version,
      terminal: event.terminal ?? null,
      needsReconcile: true,
      reconcileRevision: state.reconcileRevision + 1,
    }
  }

  if (state.liveVersion !== null && event.version <= state.liveVersion) return state
  if (event.type === "started") {
    const exists = state.live.some((message) => message.id === event.message_id)
    return {
      ...state,
      live: exists
        ? state.live
        : [...state.live, { id: event.message_id, content: "", created_at: event.created_at }],
      liveVersion: event.version,
      terminal: null,
      needsReconcile: true,
      reconcileRevision: state.reconcileRevision + 1,
    }
  }
  if (event.type === "discarded") {
    return {
      ...state,
      history: state.history.filter((message) => message.id !== event.message_id),
      committedReplay: state.committedReplay.filter((message) => message.id !== event.message_id),
      live: state.live.filter((message) => message.id !== event.message_id),
      liveVersion: event.version,
    }
  }

  const index = state.live.findIndex((message) => message.id === event.message_id)
  const current = index >= 0 ? state.live[index] : null
  const content = applyDelta(current?.content ?? "", event.offset, event.content)
  if (content === null) {
    return {
      ...state,
      liveVersion: event.version,
      needsReconcile: true,
      reconcileRevision: state.reconcileRevision + 1,
    }
  }
  const nextMessage: VisibleMessageItem = {
    id: event.message_id,
    content,
    created_at: current?.created_at ?? event.created_at,
  }
  const live = [...state.live]
  if (index >= 0) live[index] = nextMessage
  else live.push(nextMessage)
  return {
    ...state,
    live,
    liveVersion: event.version,
  }
}

export const markMessageTranscriptReconcile = (
  state: MessageTranscriptState,
): MessageTranscriptState => ({
  ...state,
  needsReconcile: true,
  reconcileRevision: state.reconcileRevision + 1,
})

export const applyMessageChannelControl = (
  state: MessageTranscriptState,
  control: MessageChannelControl,
): MessageTranscriptState => {
  if (control.type === "gap") {
    return {
      ...state,
      needsReconcile: true,
      reconcileRevision: state.reconcileRevision + 1,
    }
  }
  if (control.type === "terminal") return { ...state, terminal: control.reason }
  return {
    ...state,
    committedReplay: mergeReplay(state.committedReplay, state.live),
    live: [],
    liveVersion: Math.max(state.liveVersion ?? 0, control.version),
    commitPending: true,
    needsReconcile: true,
    reconcileRevision: state.reconcileRevision + 1,
  }
}

const preferLiveContent = (history: string, live: string): string => {
  if (!live) return history
  if (!history) return live
  if (live.startsWith(history)) return live
  if (history.startsWith(live)) return history
  return live
}

export const messageTranscriptToUi = (state: MessageTranscriptState): Message[] => {
  const replay = mergeReplay(state.committedReplay, state.live)
  const replayById = new Map(replay.map((message) => [message.id, message]))
  const seen = new Set<string>()
  const messages: Message[] = state.history.map((message) => {
    seen.add(message.id)
    const live = replayById.get(message.id)
    const content = live ? preferLiveContent(message.content, live.content) : message.content
    return message.role === "user"
      ? { id: message.id, role: "user", content, createdAt: message.created_at }
      : { id: message.id, role: "assistant", type: "text", content, createdAt: message.created_at }
  })
  for (const message of replay) {
    if (seen.has(message.id) || !message.content) continue
    messages.push({
      id: message.id,
      role: "assistant",
      type: "text",
      content: message.content,
      createdAt: message.created_at,
    })
  }
  return messages
}

export const lastProjectedMessageId = (state: MessageTranscriptState): string | undefined =>
  state.history.at(-1)?.id
