import { createMemo, createSignal, onSettled, type Accessor } from "solid-js"
import { appStore } from "@shared/store/appStore/state"
import type { Message } from "@shared/types/chatMessages"
import { getApiErrorCode, getErrorMessage, isApiError, isRequestError } from "@services/api/errors"
import { isSessionExecutionBlocked } from "@services/chat/sessionExecutionCompatibility"
import { getRootModeFenceState } from "@/lib/rootModeTransitionState"
import { createUiText } from "../../shell/uiText"
import { createStoreSelector } from "../../state/createStoreSelector"
import type { createChat } from "../createChat"
import { collectMessageActions, findRegenerationKey, messageText, type MessageHistoryEntry } from "../history/historyProjection"
import type { createRootModeAuthority } from "../model/createRootModeAuthority"

export type MessageTarget = { key: string; message: Message; text: string }
type EditDraft = { target: MessageTarget; text: string }
type Action = "edit" | "fork" | "delete" | "regenerate"
export type MessageNotice = { text: string; error: boolean; details?: string; ifVacant?: true }

function sameTarget(current: MessageTarget | undefined, expected: MessageTarget): boolean {
  return Boolean(current && current.key === expected.key && current.message.id === expected.message.id
    && current.message.createdAt === expected.message.createdAt && current.message.role === expected.message.role
    && current.text === expected.text)
}

export function createMessageActions(options: {
  chat: ReturnType<typeof createChat>
  entries: Accessor<readonly MessageHistoryEntry[]>
  viewport: () => HTMLElement | null
  rootAuthority: () => ReturnType<typeof createRootModeAuthority> | undefined
  onNotice: () => ((notice: MessageNotice) => void) | undefined
  onForking: () => ((active: boolean) => void) | undefined
}) {
  const text = createUiText()
  const { chat } = options
  const [editing, setEditing] = createSignal<EditDraft | null>(null)
  const [activity, setActivity] = createSignal<Action | null>(null)
  const [notice, setNotice] = createSignal<MessageNotice | null>(null)
  let active: Action | null = null
  let mounted = true
  let focusFrame: number | undefined
  onSettled(() => () => {
    mounted = false
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
  })

  const session = createMemo(() => ({ id: chat.currentSessionId, lifetime: chat.currentChat?.createdAtExact }), {
    equals: (previous, next) => previous?.id === next.id && previous?.lifetime === next.lifetime,
  })
  const owns = (origin: ReturnType<typeof session>) => mounted && session() === origin && appStore.getState().currentSessionId === origin.id
  const managed = createStoreSelector(appStore, (state) => {
    const id = chat.currentSessionId
    return id !== null && Boolean(state.managedHistoryBindings?.[id])
  })
  const running = () => chat.sending || chat.submissionPending || chat.currentChat?.isRunning === true ||
    chat.currentChat?.activity === "waiting_bash" || chat.currentChat?.activity === "waiting_children" ||
    chat.currentChat?.lastRunStatus === "suspended"
  const targets = createMemo(() => {
    const result = new Map<string, MessageTarget>()
    for (const [key, message] of collectMessageActions(options.entries(), !chat.sending)) {
      result.set(key, { key, message, text: messageText(message) })
    }
    return result
  })
  const latestRegenerable = createMemo(() => findRegenerationKey(options.entries()))
  const uniqueIds = createMemo(() => {
    const count = new Map<string, number>()
    for (const message of chat.messages) count.set(message.id, (count.get(message.id) ?? 0) + 1)
    return count
  })
  const rootBlocked = () => {
    const root = options.rootAuthority()
    return Boolean(root && !root.child && (root.loading || root.unsafe || root.confirmed === null))
  }
  const permits = (action: Action, target: MessageTarget) => {
    const id = chat.currentSessionId
    if (!id || active !== null || managed() || !sameTarget(targets().get(target.key), target) ||
      uniqueIds().get(target.message.id) !== 1 || chat.executionCompatibility.blocked ||
      isSessionExecutionBlocked(id) || getRootModeFenceState(id) !== "clear" || rootBlocked()) return false
    const message = target.message
    if (action === "fork" && message.role === "assistant" && message.type === "text" &&
      typeof message.metadata?.backendMessageId === "string" && message.metadata.backendMessageId !== message.id) return false
    if (action === "edit" || action === "regenerate") {
      if (running() || chat.pendingQuestion || chat.pendingApproval) return false
      return action === "edit" ? target.message.role === "user" : latestRegenerable() === target.key
    }
    return true
  }
  const publish = (value: MessageNotice) => {
    const external = options.onNotice()
    if (external) external(value)
    else if (mounted) setNotice((previous) => value.ifVacant ? previous ?? value : value)
  }
  const focusRow = (key: string) => {
    if (focusFrame !== undefined) cancelAnimationFrame(focusFrame)
    focusFrame = requestAnimationFrame(() => {
      focusFrame = undefined
      if (!mounted) return
      const row = Array.from(options.viewport()?.querySelectorAll<HTMLElement>("[data-message-occurrence]") ?? [])
        .find((element) => element.dataset.messageOccurrence === key)
      if (!row?.isConnected) return
      const target = row.querySelector<HTMLElement>('[data-slot="dropdown-menu-trigger"]') ?? row
      target.focus({ preventScroll: true })
    })
  }
  const cancelEdit = () => {
    const draft = editing()
    if (!draft) return
    setEditing(null)
    focusRow(draft.target.key)
  }
  const run = async (action: Action, target: MessageTarget, input?: string) => {
    const origin = session()
    if (!owns(origin) || !permits(action, target)) return
    active = action
    setActivity(action)
    setNotice(null)
    try {
      if (action === "fork") {
        options.onForking()?.(true)
        const id = await chat.fork(target.message.id, { isOriginCurrent: () => owns(origin) })
        if (id && appStore.getState().currentSessionId === id) {
          publish({ text: text("forked_into_a_new_session_from_here_b0abc6b8"), error: false, ifVacant: true })
        } else if (id && owns(origin)) {
          publish({ text: text("session_fork_created_not_opened"), error: true })
        }
        return
      }
      const result = action === "delete" ? await chat.deleteMessage(target.message.id)
        : action === "regenerate" ? await chat.regenerate() : await chat.editMessage(target.message.id, input ?? "")
      if (!result && owns(origin)) {
        if (action === "edit" && sameTarget(targets().get(target.key), target)) {
          setEditing({ target, text: input ?? "" })
        }
        publish({ text: text("operation_failed_0c3b4cf7"), error: true })
      }
    } catch (error) {
      if (!owns(origin)) return
      let details: string | undefined
      if (action === "fork") {
        const httpError = isApiError(error) ? error : undefined
        if (httpError?.status === 404 && !httpError.body?.trim()) {
          publish({ text: text("could_not_fork_this_backend_does_not_support_session_fo_006caf5c"), error: true })
          return
        }
        const code = httpError && getApiErrorCode(httpError)
        switch (code) {
          case "session_fork_source_not_found":
          case "session_fork_message_not_found":
          case "session_fork_invalid_message":
            details = text(code)
            break
          default:
            details = isRequestError(error) && error.kind !== "http"
              ? text("session_fork_response_missing_destination")
              : httpError?.status === 404 && code ? httpError.message : getErrorMessage(error)
        }
      }
      publish({ text: text("operation_failed_0c3b4cf7"), error: true, details })
    } finally {
      active = null
      if (action === "fork") options.onForking()?.(false)
      if (mounted) setActivity(null)
    }
  }
  const saveEdit = () => {
    const draft = editing()
    if (!draft || !draft.text.trim() || !permits("edit", draft.target)) return
    setEditing(null)
    void run("edit", draft.target, draft.text)
  }
  return {
    target: (key: string) => targets().get(key),
    isRegenerable: (key: string) => latestRegenerable() === key,
    allows(action: Action, target: MessageTarget) {
      activity()
      return permits(action, target)
    },
    beginEdit(target: MessageTarget) {
      if (permits("edit", target)) setEditing({ target, text: target.text })
    },
    updateEdit(value: string) {
      setEditing((current) => current ? { ...current, text: value } : null)
    },
    cancelEdit,
    saveEdit,
    fork: (target: MessageTarget) => { void run("fork", target) },
    remove: (target: MessageTarget) => { void run("delete", target) },
    regenerate: (target: MessageTarget) => { void run("regenerate", target) },
    get editing() { return editing() },
    get notice() { return notice() },
  }
}
