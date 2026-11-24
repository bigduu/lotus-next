import { createMemo, onSettled, type Accessor } from "solid-js"
import { uiLanguage } from "@shared/i18n/text"
import { appStore } from "@shared/store/appStore/state"
import type { InputState } from "@shared/store/appStore/slices/inputStateSlice"
import { tokenBudgetRevision } from "@shared/store/appStore/slices/tokenBudgetSlice"
import type { ChatItem } from "@shared/types/chatMessages"
import { mapTokenBudgetUsage } from "@shared/types/tokenBudget"
import { agentClient } from "@services/chat/AgentService"
import { getApiErrorCode, getErrorMessage, isApiError } from "@services/api/errors"
import { observeSessionExecutionConflict } from "@services/chat/sessionExecutionCompatibility"
import { createUiText } from "../../shell/uiText"
import { createStoreSelector } from "../../state/createStoreSelector"
import { createExternalSnapshot } from "../snapshots"

const COMMAND = "/compact"
const requests = new Set<string>()
const listeners = new Set<() => void>()
let version = 0

function subscribe(listener: () => void) {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

function notify() {
  version += 1
  for (const listener of listeners) listener()
}

type Draft = Pick<InputState, "content" | "contentRevision">

function sessionFence(state: ReturnType<typeof appStore.getState>, id: string) {
  const clear = state.conversationClears[id]
  if (clear?.busy || clear?.error === "unknown" || clear?.error === "readback_failed") return "clear"
  return state.permissionModeRequests[id]?.status === "saving" ? "permission" : null
}

/** An explicit manual compaction never creates a transcript turn. */
export function createManualCompaction(options: {
  chat: { readonly currentSessionId: string | null; readonly currentChat: ChatItem | null | undefined }
  draftKey: Accessor<string>
  restricted: (id: string) => boolean
  blocked: (id: string) => boolean
  waiting: Accessor<boolean>
  hasExtras: Accessor<boolean>
  dismiss: () => void
  focus: () => void
  onNotice: (message: string, error?: boolean, detail?: string) => void
}) {
  const text = createUiText()
  const scope = createMemo(() => ({ id: options.chat.currentSessionId, key: options.draftKey() }), {
    equals: (previous, next) => previous?.id === next.id && previous?.key === next.key,
  })
  const changes = createExternalSnapshot(subscribe, () => version)
  const fence = createStoreSelector(appStore, (state) => {
    const id = scope().id
    return id ? sessionFence(state, id) : null
  })
  let mounted = true
  onSettled(() => () => { mounted = false })

  const pending = () => {
    changes()
    const id = scope().id
    return id !== null && requests.has(id)
  }

  const unavailable = () => {
    const id = scope().id
    const chat = options.chat.currentChat
    if (!id) return text("compact_open_session")
    if (options.restricted(id)) return text("compact_root_only")
    if (options.blocked(id) || fence() === "clear") return text("compact_session_unavailable")
    if (options.waiting() || pending() || chat?.isRunning || (chat?.runningChildCount ?? 0) > 0 ||
      fence() === "permission") return text("compact_wait_for_session")
    if (options.hasExtras()) return text("compact_send_alone")
    return null
  }

  async function request(draft: Draft, fromMenu = false) {
    const origin = scope()
    const id = origin.id
    const store = appStore.getState()
    if (!mounted || store.currentSessionId !== id) return
    const reason = unavailable()
    if (!id || reason) {
      if (reason) options.onNotice(reason)
      return
    }
    const saved = store.chats.find((candidate) => candidate.id === id)
    const binding = store.managedHistoryBindings[id]
    const clear = store.conversationClears[id]
    const currentDraft = store.getInputState(origin.key)
    if (!saved || binding || sessionFence(store, id) || requests.has(id) ||
      currentDraft.content !== draft.content || currentDraft.contentRevision !== draft.contentRevision ||
      (!fromMenu && draft.content.trim().toLowerCase() !== COMMAND)) return

    const sameTarget = () => {
      const state = appStore.getState()
      const current = state.chats.find((candidate) => candidate.id === id)
      return current?.createdAt === saved.createdAt && current.createdAtExact === saved.createdAtExact &&
        state.managedHistoryBindings[id] === binding && state.conversationClears[id] === clear
    }
    const report = (message: string, error?: boolean, detail?: string) => {
      if (mounted && scope() === origin && appStore.getState().currentSessionId === id && sameTarget()) {
        options.onNotice(message, error, detail)
      }
    }

    requests.add(id)
    notify()
    try {
      let revision = draft.contentRevision
      if (fromMenu) {
        if (!store.setInputContentIfRevision(origin.key, revision, COMMAND)) return
        const normalized = appStore.getState().getInputState(origin.key)
        if (normalized.content !== COMMAND) return
        revision = normalized.contentRevision
      }
      if (!sameTarget() || appStore.getState().currentSessionId !== id) return
      const previous = tokenBudgetRevision(appStore.getState, id)
      options.dismiss()
      options.focus()
      const receipt = await agentClient.compactSessionContext(id)
      if (!sameTarget()) return
      const latest = appStore.getState()
      latest.setInputContentIfRevision(origin.key, revision, "")
      if (receipt.status === "unchanged") {
        report(text("compact_context_unchanged"))
        return
      }

      const current = tokenBudgetRevision(appStore.getState, id)
      const usage = mapTokenBudgetUsage(receipt.token_usage)
      if (usage && previous.usage === current.usage) latest.updateTokenUsage(id, usage, { fromSnapshot: true })
      if (previous.truncation === current.truncation) {
        latest.setTruncationInfo(id, receipt.token_usage.truncation_occurred, receipt.token_usage.segments_removed, { fromSnapshot: true })
      }
      const percent = new Intl.NumberFormat(uiLanguage(), { maximumFractionDigits: 1 })
      report(text("compact_context_applied", {
        before: percent.format(receipt.usage_before_percent), after: percent.format(receipt.usage_after_percent),
      }))
      // The acknowledgement settles the operation. History readback can run
      // independently and merge only monotonic data into the transcript.
      void latest.loadChatHistory(id, { mode: "monotonic" }).catch(() => {})
    } catch (error) {
      if (!sameTarget()) return
      observeSessionExecutionConflict(id, error)
      if (isApiError(error) && error.status === 422 && getApiErrorCode(error) === "context_summary_empty") {
        report(text("context_compression_notice_empty_summary"), true)
      } else {
        report(text(isApiError(error) && error.status === 404 ? "compact_context_not_found" : "compact_context_unconfirmed"),
          true, getErrorMessage(error))
      }
    } finally {
      requests.delete(id)
      notify()
    }
  }

  return { pending, unavailable, request }
}
