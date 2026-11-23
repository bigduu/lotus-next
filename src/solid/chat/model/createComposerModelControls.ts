import { createEffect, createMemo, createSignal, onSettled, untrack, type Accessor } from "solid-js"
import { appStore } from "@shared/store/appStore/state"
import { providerStore } from "@shared/store/appStore/slices/providerState"
import { getRuntimeModelIds, resolveAdmittedModelRef, resolveNewChatModelRef } from "@shared/types/providerConfig"
import type { ProviderModelRef } from "@shared/types/providerModelRef"
import { uiText } from "@shared/i18n/text"
import { getErrorMessage } from "@services/api/errors"
import { getSessionCompatibilitySnapshot, isSessionExecutionBlocked, subscribeSessionCompatibility } from "@services/chat/sessionExecutionCompatibility"
import { getRootModeFenceState } from "@/lib/rootModeTransitionState"
import { createStoreSelector } from "../../state/createStoreSelector"
import type { createChat } from "../createChat"
import type { createRootModeAuthority } from "./createRootModeAuthority"
import { createThinkingMode } from "./createThinkingMode"

export function createComposerModelControls(input: {
  chat: ReturnType<typeof createChat>
  draftKey: Accessor<string>
  disabled: Accessor<boolean>
  root: ReturnType<typeof createRootModeAuthority>
}) {
  const sessionId = () => input.chat.currentSessionId
  const root = input.root
  createEffect(
    () => [sessionId(), input.chat.currentChat?.isRunning === true] as const,
    ([id, running], previous) => {
      if (!id || running || previous?.[0] !== id || !previous[1]) return
      if (untrack(() => !root.child && !root.unsafe)) void root.refresh(id)
    },
  )
  const providerSnapshot = createStoreSelector(providerStore, (state) => state.providerSnapshot)
  const providerStatus = createStoreSelector(providerStore, (state) => state.providerStatus)
  const selectedModel = createStoreSelector(appStore, (state) => state.selectedModel)
  const draftEffort = createStoreSelector(appStore, (state) => state.inputStates[input.draftKey()]?.reasoningEffort)
  const [compatibilityRevision, setCompatibilityRevision] = createSignal(0)
  onSettled(() => subscribeSessionCompatibility(() => setCompatibilityRevision((value) => value + 1)))
  const ordinarySelection = createMemo(() => {
    const id = sessionId()
    if (!id) return draftEffort() ?? providerSnapshot()?.defaults?.chat?.reasoning_effort ?? "auto"
    compatibilityRevision()
    const current = input.chat.currentChat
    const work = getSessionCompatibilitySnapshot(id).workReasoning
    if (work && work.createdAt === current?.createdAtExact) return work.effort ?? "auto"
    return current?.config?.reasoningEffort ?? current?.config?.model_ref?.reasoning_effort ?? "auto"
  })

  let modelSaveActive = false
  const [modelSaving, setModelSaving] = createSignal(false)
  const [modelError, setModelError] = createSignal<{ sessionId: string | null; message: string } | null>(null)
  createEffect(sessionId, () => { setModelError(null) })
  const disabled = () => input.disabled() || modelSaving()
    || input.chat.currentChat?.isRunning === true || root.authority?.isRunning === true
    || input.chat.executionCompatibility.blocked
  const thinking = createThinkingMode({
    sessionId, draftKey: input.draftKey, ordinarySelection, root, disabled,
    defaultChatUltra: () => providerSnapshot()?.features?.chat_ultra_by_default === true,
  })
  const modelDisabled = () => disabled() || thinking.busy || root.unsafe
  const legacyModel = () => sessionId() ? input.chat.currentChat?.config?.model : undefined
  const activeModel = createMemo(() => sessionId()
    ? input.chat.currentChat?.config?.model_ref ?? (legacyModel() ? undefined : providerSnapshot()?.defaults?.chat)
    : resolveNewChatModelRef(providerSnapshot(), selectedModel()))
  const modelGroups = createMemo(() => {
    const snapshot = providerSnapshot()
    if (providerStatus() !== "ready" || !snapshot) return []
    const groups = snapshot.instances.filter((instance) => instance.enabled)
      .map((instance) => ({
        provider: instance.id,
        label: instance.label || instance.id,
        models: getRuntimeModelIds(instance, snapshot.defaults),
      }))
      .filter((group) => group.models.length > 0)
    return groups.map((group) =>
      groups.some((other) => other.provider !== group.provider && other.label === group.label)
        ? { ...group, label: `${group.label} (${group.provider})` }
        : group,
    )
  })

  const chooseModel = async (model: ProviderModelRef) => {
    const id = sessionId()
    if (modelDisabled() || modelSaveActive || isSessionExecutionBlocked(id)) return
    const reference = activeModel()
    if (reference?.provider === model.provider && reference.model === model.model) return
    const { providerSnapshot, providerStatus } = providerStore.getState()
    const admitted = providerStatus === "ready" && resolveAdmittedModelRef(providerSnapshot, model)
    if (!admitted) return
    if (!id) {
      appStore.getState().setSelectedModel(admitted)
      return
    }
    if (getRootModeFenceState(id) !== "clear") return
    modelSaveActive = true
    setModelSaving(true)
    setModelError(null)
    try {
      await appStore.getState().changeSessionModel(id, admitted)
    } catch (error) {
      if (sessionId() === id) setModelError({ sessionId: id, message: `${uiText("could_not_save_the_model_please_try_again_631991a6")} ${getErrorMessage(error)}` })
    } finally {
      modelSaveActive = false
      setModelSaving(false)
    }
  }

  return {
    root,
    thinking,
    get modelGroups() { return modelGroups() },
    get model() { return activeModel()?.model || legacyModel() || "" },
    get modelProvider() { return activeModel()?.provider },
    get modelDisabled() { return modelDisabled() },
    get busy() { return modelSaving() || thinking.busy },
    get sendBlocked() {
      const id = sessionId()
      return modelSaving() || modelSaveActive || thinking.busy || thinking.blocked
        || Boolean(id && getRootModeFenceState(id) !== "clear")
    },
    get requestValue() { return thinking.requestValue },
    get thinkingMode() { return thinking.thinkingMode },
    get modelError() {
      const error = modelError()
      return error?.sessionId === sessionId() ? error.message : null
    },
    chooseModel,
  }
}
