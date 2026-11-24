import { createEffect, createSignal, onSettled, untrack, type Accessor } from "solid-js"
import { uiText } from "@shared/i18n/text"
import { appStore } from "@shared/store/appStore/state"
import type { ReasoningEffortSelection } from "@shared/utils/reasoningEffort"
import { getErrorMessage } from "@services/api/errors"
import { createStoreSelector } from "../../state/createStoreSelector"
import { createExternalSnapshot } from "../snapshots"
import type { createRootModeAuthority } from "./createRootModeAuthority"

export type ThinkingPickerSelection = ReasoningEffortSelection | "ultra"

// Sibling panes coordinate UI ownership. Durable recovery stays with the exact
// Root operation record and canonical terminal receipt.
const active = new Set<string>()
const completions = new Map<string, number>()
const listeners = new Set<() => void>()
let revision = 0
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const notify = () => { ++revision; for (const listener of listeners) listener() }

export function createThinkingMode(input: {
  sessionId: Accessor<string | null>
  draftKey: Accessor<string>
  ordinarySelection: Accessor<ReasoningEffortSelection>
  root: ReturnType<typeof createRootModeAuthority>
  disabled: Accessor<boolean>
  defaultChatUltra: Accessor<boolean>
}) {
  const { sessionId, draftKey, ordinarySelection, root, disabled, defaultChatUltra } = input
  const key = () => {
    const id = sessionId()
    return id ? `session:${id}` : `draft:${draftKey()}`
  }
  let navigation = { key: untrack(key), epoch: 0 }
  const updateScope = (current: string) => {
    if (navigation.key !== current) navigation = { key: current, epoch: navigation.epoch + 1 }
  }
  const captureScope = () => {
    updateScope(key())
    return navigation
  }
  createEffect(key, updateScope)
  let mounted = true
  onSettled(() => () => { mounted = false })
  const [failure, setFailure] = createSignal<{ scope: typeof navigation; message: string } | null>(null)
  const draftMode = createStoreSelector(appStore, (state) => {
    const draft = draftKey()
    return state.inputStates[draft]?.thinkingMode
      ?? state.getInputState(draft).thinkingMode ?? (defaultChatUltra() ? "ultra" : "standard")
  })
  const selected = () => sessionId() ? root.selected : draftMode() === "ultra"
  const thinkingMode = () => {
    if (!sessionId()) return draftMode()
    const value = selected()
    return value === null ? null : value ? "ultra" as const : "standard" as const
  }
  const pulse = createExternalSnapshot(subscribe, () => revision)
  const busy = () => { pulse(); return active.has(key()) }
  const completion = () => { pulse(); return completions.get(key()) ?? 0 }
  const [observed, setObserved] = createSignal({ key: untrack(key), version: untrack(completion) })
  const syncing = () => {
    const prior = observed()
    return Boolean(sessionId() && !root.child && prior.key === key() && prior.version !== completion())
  }
  const blocked = () => Boolean(sessionId() && !root.child && (root.loading || root.unsafe || root.confirmed === null))
  const controlDisabled = () => disabled() || busy() || blocked() || syncing() || Boolean(root.authority?.isRunning)
  createEffect(
    () => [sessionId(), key(), completion(), root.child] as const,
    ([id, scopeKey, version, child]) => {
      const prior = untrack(observed)
      if (prior.key !== scopeKey || prior.version === version) {
        if (prior.key !== scopeKey) setObserved({ key: scopeKey, version })
        return
      }
      setObserved({ key: scopeKey, version })
      setFailure(null)
      if (id && !child) void root.refresh(id)
    },
  )

  const choose = async (selection: ThinkingPickerSelection) => {
    const scope = captureScope()
    const id = sessionId()
    if (controlDisabled() || active.has(scope.key) || selection === "ultra" && !root.isRoot) return
    const current = () => mounted && captureScope() === scope
    const report = (message: string) => { if (current()) setFailure({ scope, message }) }
    setFailure(null)
    if (!id) {
      const store = appStore.getState()
      const draft = draftKey()
      if (!store.setInputThinkingMode(draft, selection === "ultra" ? "ultra" : "standard")) {
        report(uiText("could_not_save_the_draft_s_thinking_mode_check_browser__14cd9961"))
        return
      }
      if (selection !== "ultra") store.setInputReasoningEffort(draft, selection)
      return
    }
    active.add(scope.key)
    notify()
    let exitedUltra = false
    const initial = root.authority
    const birthToken = initial?.birthToken
    const wasUltra = initial?.thinkingMode === "ultra"
    const child = root.child
    try {
      if (!child) {
        const result = await root.change(selection === "ultra")
        if (!current()) return
        const proof = result.authority
        if (!proof || proof.birthToken !== birthToken || proof.sessionId !== id
          || result.status !== "committed" && result.status !== "unchanged"
          || proof.thinkingMode !== (selection === "ultra" ? "ultra" : "standard")) {
          const notices: Partial<Record<typeof result.status, string>> = {
            fenced: uiText("this_change_was_canceled_select_again_using_the_current_40e0d507"),
            rejected_incompatible: uiText("the_selected_mode_is_incompatible_with_the_current_plan_2c3c36dd"),
            fenced_by_successor: uiText("another_operation_updated_thinking_mode_select_again_us_6cf74dff"),
            birth_mismatch: uiText("session_identity_changed_select_a_thinking_mode_using_t_fec23538"),
          }
          report(notices[result.status] ?? uiText("the_change_result_is_unconfirmed_recover_or_reload_the__7f8a5ea7"))
          return
        }
        if (selection === "ultra") return
        exitedUltra = wasUltra
        if (proof.isRunning) throw new Error(uiText("the_session_is_running_wait_for_it_to_finish_before_sel_d3b71735"))
      }
      if (selection === "ultra") return
      await appStore.getState().changeSessionReasoningEffort(id, selection === "auto" ? null : selection)
      if (!current() || child) return
      const proof = await root.refresh(id)
      if (!current()) return
      if (!proof || proof.birthToken !== birthToken || proof.thinkingMode !== "standard"
        || (proof.ordinaryEffort ?? "auto") !== selection) {
        report(uiText("the_standard_reasoning_level_is_unconfirmed_actual_mode_a1eda4b7"))
      }
    } catch (error) {
      if (!current()) return
      const actual = !child ? await root.refresh(id) : null
      report(uiText("your_draft_is_preserved_select_again_or_reload_server_s_f14be63a", {
        v0: exitedUltra && actual?.thinkingMode === "standard" ? uiText("standard_unconfirmed_after_ultra") : uiText("standard_unconfirmed"),
        v1: getErrorMessage(error),
      }))
    } finally {
      active.delete(scope.key)
      const version = (completions.get(scope.key) ?? 0) + 1
      completions.set(scope.key, version)
      if (current()) setObserved({ key: scope.key, version })
      notify()
    }
  }

  const retry = async () => {
    const scope = captureScope()
    if (active.has(scope.key)) return
    await root.retry()
    if (mounted && captureScope() === scope) setFailure(null)
  }

  return {
    get selected() { return syncing() ? null : selected() },
    get thinkingMode() { return syncing() ? null : thinkingMode() },
    get ordinaryValue() {
      return sessionId() && !root.child && root.authority
        ? root.authority.ordinaryEffort ?? "auto" : ordinarySelection()
    },
    get busy() { return busy() },
    get blocked() { return blocked() || syncing() },
    get disabled() { return controlDisabled() },
    get error() {
      const local = failure()
      if (local?.scope === captureScope()) return local.message
      return busy() && root.errorIsPendingNotice ? null : root.error
    },
    get requestValue() { return sessionId() ? undefined : draftMode() === "ultra" },
    choose, retry,
  }
}
