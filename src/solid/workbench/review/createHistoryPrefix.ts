import { createEffect, createMemo, createSignal, type Accessor } from "solid-js"
import { appStore, selectSessionById, type AppState } from "@shared/store/appStore/state"
import type { Message } from "@shared/types/chatMessages"
import { createStoreSelector } from "../../state/createStoreSelector"

interface Options {
  sessionId: Accessor<string | null>
  connectionScope: Accessor<string | null>
  enabled: Accessor<boolean>
}

interface Boundary {
  sessionId: string
  createdAt: number
  createdAtExact?: string
  beforeMessageId: string | null
  startIndex: number
  invalidated: boolean
  binding: AppState["managedHistoryBindings"][string] | undefined
  clear: AppState["conversationClears"][string] | undefined
}

interface Request {
  boundary: Boundary
  scope: string | null
}

interface Result {
  request: Request
  messages: readonly Message[] | null
}

interface HistoryPrefix {
  messages: readonly Message[]
  status: "loading" | "unavailable" | null
  canRead: boolean
}

const EMPTY_MESSAGES: readonly Message[] = []

function readBoundary(state: AppState, sessionId: string | null): Boundary | null {
  if (!sessionId || state.currentSessionId !== sessionId) return null
  const chat = selectSessionById(sessionId)(state)
  const window = chat?.historyWindow
  if (!chat || !window) return null
  return {
    sessionId,
    createdAt: chat.createdAt,
    createdAtExact: chat.createdAtExact,
    beforeMessageId: window.beforeMessageId,
    startIndex: window.startIndex,
    invalidated: window.invalidated === true,
    binding: state.managedHistoryBindings[sessionId],
    clear: state.conversationClears[sessionId],
  }
}

function sameBoundary(previous: Boundary | null, next: Boundary | null): boolean {
  return previous === next || Boolean(previous && next
    && previous.sessionId === next.sessionId
    && previous.createdAt === next.createdAt && previous.createdAtExact === next.createdAtExact
    && previous.beforeMessageId === next.beforeMessageId && previous.startIndex === next.startIndex
    && previous.invalidated === next.invalidated && previous.binding === next.binding && previous.clear === next.clear)
}

/** Read the omitted prefix for workbench consumers without prepending to the chat viewport. */
export function createHistoryPrefix(options: Options): Accessor<HistoryPrefix> {
  const boundary = createStoreSelector(appStore, (state) => readBoundary(state, options.sessionId()), sameBoundary)
  const [result, setResult] = createSignal<Result | null>(null)
  const canRead = () => {
    const current = boundary()
    return Boolean(current?.beforeMessageId && !current.invalidated)
  }
  const request = createMemo<Request | null>(() => {
    const current = boundary()
    return options.enabled() && current?.beforeMessageId && !current.invalidated
      ? { boundary: current, scope: options.connectionScope() }
      : null
  }, {
    equals: (previous, next) => previous === next || Boolean(previous && next
      && previous.scope === next.scope && previous.boundary === next.boundary),
  })

  createEffect(request, (reading) => {
    setResult(null)
    if (!reading) return
    const { boundary, scope } = reading
    const { sessionId } = boundary
    const controller = new AbortController()
    const isCurrent = () => !controller.signal.aborted && request() === reading
      && options.connectionScope() === scope && sameBoundary(readBoundary(appStore.getState(), sessionId), boundary)

    const state = appStore.getState()
    const window = selectSessionById(sessionId)(state)?.historyWindow
    if (!window || !isCurrent()) {
      setResult({ request: reading, messages: null })
      return
    }

    void state.readHistoryPrefix(sessionId, window, isCurrent, controller.signal).then(
      (messages) => { if (isCurrent()) setResult({ request: reading, messages }) },
      () => { if (isCurrent()) setResult({ request: reading, messages: null }) },
    )
    return () => controller.abort()
  })

  return createMemo(() => {
    const reading = request()
    const settled = result()
    const latest = settled?.request === reading ? settled : null
    let status: HistoryPrefix["status"] = null
    if (boundary()?.invalidated || (reading && latest?.messages === null)) status = "unavailable"
    else if (reading && !latest) status = "loading"
    return { messages: latest?.messages ?? EMPTY_MESSAGES, status, canRead: canRead() }
  })
}
