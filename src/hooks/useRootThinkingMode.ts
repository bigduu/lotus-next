import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useRef, useState, useSyncExternalStore } from "react"
import { useAppStore } from "@shared/store/appStore"
import type { ReasoningEffortSelection } from "@shared/utils/reasoningEffort"
import { getErrorMessage } from "@services/api/errors"
import type { useRootOrchestrationMode } from "./useRootOrchestrationMode"

export type ThinkingPickerSelection = ReasoningEffortSelection | "ultra"

// One browser runtime can show the same Root in both panes. Share only the UI
// lock and a completion notification; the durable fence still owns recovery.
const active = new Set<string>()
const completions = new Map<string, number>()
const listeners = new Set<() => void>()
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener) } }
const notify = () => { for (const listener of listeners) listener() }

/** Compose the existing boundaries without adding a combined durable operation. */
export function useRootThinkingMode({
  sessionId, draftKey, ordinarySelection, root, disabled,
}: {
  sessionId: string | null
  draftKey: string
  ordinarySelection: ReasoningEffortSelection
  root: ReturnType<typeof useRootOrchestrationMode>
  disabled: boolean
}) {
  useUiLocale()
  const key = sessionId ? `session:${sessionId}` : `draft:${draftKey}`
  const navigation = useRef({ key, epoch: 0 })
  if (navigation.current.key !== key) navigation.current = { key, epoch: navigation.current.epoch + 1 }
  const mounted = useRef(true)
  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; navigation.current.epoch += 1 }
  }, [])
  const [failure, setFailure] = useState<{ key: string; epoch: number; message: string } | null>(null)
  const draftMode = useAppStore((s) => s.inputStates[draftKey]?.thinkingMode
    ?? s.getInputState(draftKey).thinkingMode ?? "standard")
  const selected = sessionId ? root.selected : draftMode === "ultra"
  const thinkingMode = sessionId ? selected === null ? null : selected ? "ultra" : "standard" : draftMode
  const ordinaryValue = sessionId && !root.child && root.authority
    ? root.authority.ordinaryEffort ?? "auto" : ordinarySelection
  const blocked = Boolean(sessionId && !root.child && (root.loading || root.unsafe || root.confirmed === null))
  const busy = useSyncExternalStore(subscribe, () => active.has(key), () => false)
  const completion = useSyncExternalStore(subscribe, () => completions.get(key) ?? 0, () => 0)
  const observed = useRef({ key, revision: completion })
  if (observed.current.key !== key) observed.current = { key, revision: completion }
  const syncing = Boolean(sessionId && !root.child && observed.current.revision !== completion)
  const { child, refresh: readAuthority } = root
  useEffect(() => {
    if (observed.current.revision === completion) return
    observed.current.revision = completion
    setFailure(null)
    if (!sessionId || child) return
    // A sibling pane finished the compound UI sequence. Read current authority;
    // never recover an operation merely because its marker appeared.
    void readAuthority(sessionId)
  }, [completion, sessionId, key, child, readAuthority])
  const controlDisabled = disabled || busy || blocked || syncing || Boolean(root.authority?.isRunning)
  const localError = failure?.key === key && failure.epoch === navigation.current.epoch ? failure.message : null

  const choose = async (selection: ThinkingPickerSelection) => {
    if (controlDisabled || active.has(key) || selection === "ultra" && !root.isRoot) return
    const epoch = navigation.current.epoch
    const current = () => mounted.current && navigation.current.key === key && navigation.current.epoch === epoch
    const report = (message: string) => { if (current()) setFailure({ key, epoch, message }) }
    setFailure(null)
    if (!sessionId) {
      const store = useAppStore.getState()
      if (!store.setInputThinkingMode(draftKey, selection === "ultra" ? "ultra" : "standard")) {
        report(uiText("could_not_save_the_draft_s_thinking_mode_check_browser__14cd9961"))
        return
      }
      if (selection !== "ultra") store.setInputReasoningEffort(draftKey, selection)
      return
    }
    active.add(key)
    notify()
    let exitedUltra = false
    const birthToken = root.authority?.birthToken
    const wasUltra = root.authority?.thinkingMode === "ultra"
    try {
      if (!root.child) {
        const result = await root.change(selection === "ultra")
        if (!current()) return
        const proof = result.authority
        if (!proof || proof.birthToken !== birthToken || proof.sessionId !== sessionId
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
        if (selection === "ultra") return // Keep the independent ordinary override/default.
        exitedUltra = wasUltra
        if (proof.isRunning) throw new Error(uiText("the_session_is_running_wait_for_it_to_finish_before_sel_d3b71735"))
      }
      if (selection === "ultra") return
      await useAppStore.getState().changeSessionReasoningEffort(sessionId, selection === "auto" ? null : selection)
      if (!current() || root.child) return
      const proof = await root.refresh(sessionId)
      if (!current()) return
      if (!proof || proof.birthToken !== birthToken || proof.thinkingMode !== "standard"
        || (proof.ordinaryEffort ?? "auto") !== selection) {
        report(uiText("the_standard_reasoning_level_is_unconfirmed_actual_mode_a1eda4b7"))
      }
    } catch (error) {
      if (!current()) return
      const actual = !root.child ? await root.refresh(sessionId) : null
      report(uiText("your_draft_is_preserved_select_again_or_reload_server_s_f14be63a", { v0: exitedUltra && actual?.thinkingMode === "standard" ? uiText("standard_unconfirmed_after_ultra") : uiText("standard_unconfirmed"), v1: getErrorMessage(error) }))
    } finally {
      active.delete(key)
      const revision = (completions.get(key) ?? 0) + 1
      completions.set(key, revision)
      if (current()) observed.current.revision = revision
      notify()
    }
  }

  const retry = async () => {
    if (active.has(key)) return
    const epoch = navigation.current.epoch
    await root.retry()
    if (mounted.current && navigation.current.key === key && navigation.current.epoch === epoch) setFailure(null)
  }

  return {
    ...root, selected: syncing ? null : selected, thinkingMode: syncing ? null : thinkingMode,
    ordinaryValue, busy, blocked: blocked || syncing,
    controlDisabled, choose, retry,
    error: localError ?? root.error,
    requestValue: sessionId ? undefined : draftMode === "ultra",
  }
}
