import { createEffect, createMemo, createSignal, onSettled, type Accessor } from "solid-js"
import { uiText } from "@shared/i18n/text"
import {
  agentClient, isThinkingMode, type ThinkingMode, type ReasoningEffort,
  type RootModeOperationResponse, type SessionKind,
} from "@services/chat/AgentService"
import { isReasoningEffort } from "@shared/utils/reasoningEffort"
import { getErrorMessage, isApiError } from "@services/api/errors"
import { appStore } from "@shared/store/appStore/state"
import {
  beginRootModeOperation, finishRootModeOperation, readRootModeFence,
  rootModeStorageKeyMatches, subscribeRootModeFence, type RootModeOperation,
} from "@/lib/rootModeTransitionState"

export type RootModeAuthority = {
  sessionId: string
  enabled: boolean
  thinkingMode: ThinkingMode
  ordinaryEffort: ReasoningEffort | null
  epoch: number
  birthToken: string
  isRunning: boolean
}
type Outcome = RootModeOperationResponse["status"] | "birth_mismatch"
export type RootModeChangeResult = { status: Outcome | "unchanged" | "unconfirmed"; authority: RootModeAuthority | null }
type RecoveryResult = { outcomes: Map<string, Outcome>; authority: RootModeAuthority | null }
type SavedSelection = {
  sessionId: string
  kind: SessionKind | null
  authority: RootModeAuthority | null
  loading: boolean
  error: string | null
}

function validEpoch(value: unknown): value is number {
  return Number.isSafeInteger(value) && (value as number) >= 0
}

/** A 2xx response is safe only when it proves this exact operation is terminal. */
function verifiedOutcome(response: RootModeOperationResponse, operation: RootModeOperation): boolean {
  if (!response || !validEpoch(response.root_tool_authority_revision)
    || response.operation_id !== operation.operationId
    || response.expected_epoch !== operation.expectedEpoch) return false
  if (response.status === "fenced_by_successor") {
    return validEpoch(response.current_epoch) && response.current_epoch > operation.expectedEpoch
      && typeof response.current_enabled === "boolean"
      && isThinkingMode(response.current_thinking_mode)
      && (response.current_thinking_mode === "ultra") === response.current_enabled
  }
  return ["committed", "fenced", "rejected_incompatible"].includes(response.status)
    && response.operation_id === operation.operationId
    && response.expected_epoch === operation.expectedEpoch
    && response.resulting_epoch === operation.expectedEpoch + 1
    && typeof response.enabled_at_completion === "boolean"
    && isThinkingMode(response.thinking_mode_at_completion)
    && (response.thinking_mode_at_completion === "ultra") === response.enabled_at_completion
    && (response.status !== "committed" || response.enabled_at_completion === operation.enabled)
}

function birthMismatch(error: unknown): boolean {
  if (!isApiError(error) || error.status !== 412 || !error.body) return false
  try {
    const body = JSON.parse(error.body) as { error?: { code?: unknown } }
    return body.error?.code === "root_mode_birth_mismatch"
  } catch { return false }
}

const outcomeNotice = (status: RootModeOperationResponse["status"]): string | null => {
  switch (status) {
    case "committed": return null
    case "rejected_incompatible": return uiText("bamboo_rejected_this_root_mode_change_the_current_mode__5b0f50d4")
    case "fenced": return uiText("the_change_request_was_safely_canceled_the_current_mode_45bd934b")
    case "fenced_by_successor": return uiText("another_operation_updated_root_mode_the_current_mode_wa_e0dd0ad0")
  }
}

/** Existing Roots use message-free, terminally recoverable mode operations. */
export function createRootModeAuthority(sessionId: Accessor<string | null>, kind: Accessor<SessionKind | undefined>) {
  const [fenceRevision, setFenceRevision] = createSignal(0)
  const fence = createMemo(() => {
    fenceRevision()
    const id = sessionId()
    return id ? readRootModeFence(id) : { kind: "clear" as const }
  })
  const unsafe = () => fence().kind !== "clear"
  const [newSelection, setNewSelection] = createSignal(false)
  const [saved, setSaved] = createSignal<SavedSelection | null>(null)
  const [recoveryFailure, setRecoveryFailure] = createSignal<{ sessionId: string; message: string } | null>(null)
  const [recoveringId, setRecoveringId] = createSignal<string | null>(null)
  let readGeneration = 0
  let mounted = true
  const recoveryActive = new Map<string, Promise<RecoveryResult>>()
  const ownsSession = (id: string) => mounted && sessionId() === id

  onSettled(() => () => {
    mounted = false
    ++readGeneration
  })
  createEffect(sessionId, (id) => {
    const update = () => setFenceRevision((value) => value + 1)
    const unsubscribe = subscribeRootModeFence(id, update)
    update()
    return unsubscribe
  })

  const refresh = async (id: string, notice: string | null = null, minimumEpoch = 0) => {
    const generation = ++readGeneration
    setSaved((previous) => ({
      sessionId: id,
      kind: previous?.sessionId === id ? previous.kind : null,
      authority: previous?.sessionId === id ? previous.authority : null,
      loading: true,
      error: null,
    }))
    try {
      const response = await agentClient.getSession(id)
      if (readGeneration !== generation || !ownsSession(id)) return null
      const session = response.session
      if (session.id === id && session.kind === "child") {
        setSaved({ sessionId: id, kind: "child", authority: null, loading: false, error: null })
        return null
      }
      if (session.id !== id || session.kind !== "root" || typeof session.root_orchestration_only !== "boolean"
        || !isThinkingMode(session.thinking_mode)
        || (session.thinking_mode === "ultra") !== session.root_orchestration_only
        || session.reasoning_effort != null && !isReasoningEffort(session.reasoning_effort)
        || !validEpoch(session.root_mode_transition_epoch)
        || typeof session.root_mode_birth_token !== "string"
        || !/^[0-9a-f]{64}$/i.test(session.root_mode_birth_token)) {
        setSaved({
          sessionId: id, kind: session.kind ?? null, authority: null, loading: false,
          error: uiText("thinking_mode_could_not_be_confirmed_bamboo_did_not_ret_ba55db0f"),
        })
        return null
      }
      const authority: RootModeAuthority = {
        sessionId: id, enabled: session.root_orchestration_only, thinkingMode: session.thinking_mode,
        ordinaryEffort: session.reasoning_effort ?? null,
        epoch: session.root_mode_transition_epoch, birthToken: session.root_mode_birth_token,
        isRunning: session.is_running === true,
      }
      if (authority.epoch < minimumEpoch) {
        setSaved({ sessionId: id, kind: "root", authority: null, loading: false,
          error: uiText("current_state_predates_the_confirmed_mode_change_reload_07a3df79") })
        return null
      }
      setSaved({
        sessionId: id, kind: "root", authority,
        loading: false, error: notice,
      })
      appStore.setState((state) => ({
        chats: state.chats.map((chat) => chat.id === id
          ? { ...chat, config: { ...chat.config, reasoningEffort: authority.ordinaryEffort } }
          : chat),
      }))
      return authority
    } catch (error) {
      if (readGeneration !== generation || !ownsSession(id)) return null
      setSaved({
        sessionId: id, kind: null, authority: null,
        loading: false, error: uiText("could_not_read_root_mode_a54a59bf", { v0: getErrorMessage(error) }),
      })
      return null
    }
  }

  const recoverPending = (id: string): Promise<RecoveryResult> => {
    const ongoing = recoveryActive.get(id)
    if (ongoing) return ongoing
    const pending = (async () => {
      const initial = readRootModeFence(id)
      const outcomes = new Map<string, Outcome>()
      if (initial.kind !== "pending") return { outcomes, authority: null }
      setRecoveringId(id)
      setRecoveryFailure(null)
      let notice: string | null = null
      let failure: string | null = null
      let minimumEpoch = 0
      for (const operation of initial.operations) {
        try {
          const response = await agentClient.recoverRootMode(id, operation)
          if (!verifiedOutcome(response, operation)) throw new Error(uiText("bamboo_did_not_return_terminal_state_evidence_matching__e7c81005"))
          if (!finishRootModeOperation(id, operation)) throw new Error(uiText("could_not_clear_the_local_safety_marker_88e9a7a3"))
          outcomes.set(operation.operationId, response.status)
          minimumEpoch = Math.max(minimumEpoch, response.status === "fenced_by_successor"
            ? response.current_epoch : response.resulting_epoch)
          notice = outcomeNotice(response.status)
        } catch (error) {
          if (birthMismatch(error) && finishRootModeOperation(id, operation)) {
            outcomes.set(operation.operationId, "birth_mismatch")
            notice = uiText("session_identity_changed_the_current_root_mode_was_relo_1fc1b49a")
          } else {
            failure = uiText("could_not_confirm_root_mode_change_retry_recovery_1fff2314", { v0: getErrorMessage(error) })
          }
        }
      }
      if (ownsSession(id)) {
        setRecoveringId(null)
        setRecoveryFailure(failure ? { sessionId: id, message: failure } : null)
      }
      const authority = readRootModeFence(id).kind === "clear" && ownsSession(id)
        ? await refresh(id, notice, minimumEpoch) : null
      return { outcomes, authority }
    })().finally(() => { recoveryActive.delete(id) })
    recoveryActive.set(id, pending)
    return pending
  }

  const sessionIdentity = createMemo(() => [sessionId(), kind()] as const, {
    equals: (previous, next) => previous?.[0] === next[0] && previous?.[1] === next[1],
  })
  createEffect(
    sessionIdentity,
    ([id, sessionKind]) => {
      if (!id || sessionKind === "child") {
        ++readGeneration
        setSaved(null)
        setRecoveryFailure(null)
        if (!id) setNewSelection(false)
        return
      }
      const pending = readRootModeFence(id)
      if (pending.kind === "pending") void recoverPending(id)
      else void refresh(id)
      const externalChange = (event: StorageEvent) => {
        // A newly created marker never cancels an in-flight selection.
        // Clearing the last marker does require a fresh authority read.
        if (rootModeStorageKeyMatches(id, event.key) && readRootModeFence(id).kind === "clear") {
          void refresh(id)
        }
      }
      window.addEventListener("storage", externalChange)
      return () => {
        ++readGeneration
        window.removeEventListener("storage", externalChange)
      }
    },
  )

  const detail = createMemo(() => {
    const current = saved()
    return current?.sessionId === sessionId() ? current : null
  })
  const child = () => Boolean(sessionId() && (kind() === "child" || detail()?.kind === "child"))
  const authority = () => detail()?.authority ?? null
  const confirmed = () => unsafe() || detail()?.loading ? null : authority()?.enabled ?? null
  const selected = () => sessionId() ? confirmed() : newSelection()
  const loading = () => Boolean(sessionId() && !child() && (!detail() || detail()?.loading))

  const change = async (next: boolean): Promise<RootModeChangeResult> => {
    const id = sessionId()
    if (!id) { setNewSelection(next); return { status: "unchanged", authority: null } }
    const proof = authority()
    if (child() || unsafe() || loading() || !proof || proof.isRunning || recoveringId() === id
      || readRootModeFence(id).kind !== "clear")
      return { status: "unconfirmed", authority: null }
    const operation = beginRootModeOperation(id, proof.epoch, proof.birthToken, next)
    if (!operation) {
      setRecoveryFailure({ sessionId: id, message: uiText("could_not_save_the_root_mode_safety_marker_the_change_w_4c40ae2b") })
      return { status: "unconfirmed", authority: null }
    }
    ++readGeneration
    setRecoveryFailure(null)
    try {
      const response = await agentClient.selectRootMode(id, operation)
      if (!verifiedOutcome(response, operation)) throw new Error(uiText("bamboo_did_not_return_terminal_state_evidence_matching__e7c81005"))
      if (!finishRootModeOperation(id, operation)) throw new Error(uiText("could_not_clear_the_local_safety_marker_88e9a7a3"))
      if (ownsSession(id) && readRootModeFence(id).kind === "clear") {
        const minimumEpoch = response.status === "fenced_by_successor" ? response.current_epoch : response.resulting_epoch
        return { status: response.status, authority: await refresh(id, outcomeNotice(response.status), minimumEpoch) }
      }
    } catch (error) {
      if (birthMismatch(error) && finishRootModeOperation(id, operation)) {
        return { status: "birth_mismatch", authority: ownsSession(id)
          ? await refresh(id, uiText("session_identity_changed_the_current_root_mode_was_relo_1fc1b49a")) : null }
      } else {
        const recovered = await recoverPending(id)
        return { status: recovered.outcomes.get(operation.operationId) ?? "unconfirmed", authority: recovered.authority }
      }
    }
    return { status: "unconfirmed", authority: null }
  }

  const retry = () => {
    const id = sessionId()
    if (!id || child()) return Promise.resolve()
    return readRootModeFence(id).kind === "pending"
      ? recoverPending(id).then((result) => result.authority) : refresh(id)
  }

  const error = () => {
    const id = sessionId()
    const pending = fence()
    const failure = recoveryFailure()
    if (!unsafe()) return failure?.sessionId === id ? failure.message : detail()?.error ?? null
    if (pending.kind === "legacy") return uiText("the_legacy_chat_mode_change_has_no_recoverable_request__b94e28d9")
    if (pending.kind === "invalid") return uiText("the_local_root_mode_request_record_is_invalid_and_canno_6ef1c36c")
    if (pending.kind === "storage-unavailable") return uiText("could_not_read_local_root_permission_safety_state_retry_0f33322f")
    if (recoveringId() === id) return uiText("confirming_the_terminal_state_of_the_root_mode_change_s_ae6d8992")
    return failure?.sessionId === id ? failure.message
      : uiText("the_root_mode_change_is_unconfirmed_sending_is_temporar_94ddc690")
  }

  return {
    get child() { return child() },
    get unsafe() { return unsafe() },
    get selected() { return selected() },
    get confirmed() { return confirmed() },
    get loading() { return loading() },
    get authority() { return authority() },
    get isRoot() { return !sessionId() || !child() && (kind() === "root" || detail()?.kind === "root") },
    get recovering() { return Boolean(recoveringId() && recoveringId() === sessionId()) },
    get recoverable() { return fence().kind === "pending" },
    get errorIsPendingNotice() {
      return unsafe() && fence().kind === "pending" && recoveryFailure()?.sessionId !== sessionId()
    },
    get error() { return error() },
    change, refresh, retry,
  }
}
