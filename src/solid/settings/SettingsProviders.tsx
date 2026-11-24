import { createEffect, createMemo, createSignal, For, onSettled, Show } from "solid-js"
import { Pencil, Plus, RefreshCw, Trash2 } from "@lucide/solid"
import { serviceFactory } from "@services/common/ServiceFactory"
import { getErrorMessage } from "@services/api"
import { appStore } from "@shared/store/appStore/state"
import { providerStore } from "@shared/store/appStore/slices/providerState"
import { getRuntimeModelIds, PROVIDER_LABELS, type ProviderInstance } from "@shared/types/providerConfig"
import { cn } from "@/lib/utils"
import { createUiText } from "../shell/uiText"
import { createStoreSelector } from "../state/createStoreSelector"
import { Badge } from "../ui/badge"
import { Button } from "../ui/button"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "../ui/responsive-dialog"
import { Switch } from "../ui/switch"
import { DefaultsEditor } from "./DefaultsEditor"
import { InstanceEditor } from "./InstanceEditor"
import type { InstanceSavePayload } from "./instanceDraft"
import type { ModelDiscoveryNotice } from "./RuntimeModelsEditor"

export function SettingsProviders(props: { onModelReady?: () => void }) {
  const text = createUiText()
  const state = createStoreSelector(providerStore, (value) => value)
  const snapshot = createMemo(() => state().providerSnapshot ?? state().providerRepairSnapshot)
  const instances = () => snapshot()?.instances ?? []
  const canManage = () => state().providerStatus === "ready" || state().providerStatus === "degraded"
  const [editing, setEditing] = createSignal<string | null>(null)
  const [supportsFirstRun, setSupportsFirstRun] = createSignal(false)
  const [adding, setAdding] = createSignal(false)
  const [listError, setListError] = createSignal<string | null>(null)
  const [deleting, setDeleting] = createSignal<ProviderInstance | null>(null)
  const [deleteBusy, setDeleteBusy] = createSignal(false)
  const [deleteError, setDeleteError] = createSignal<string | null>(null)
  const [fetchingId, setFetchingId] = createSignal<string | null>(null)
  const [fetchNotice, setFetchNotice] = createSignal<(ModelDiscoveryNotice & { id: string }) | null>(null)
  const [createNotice, setCreateNotice] = createSignal<string | null>(null)
  const [pendingCreatedId, setPendingCreatedId] = createSignal<string | null>(null)
  let requestedCatalog = false

  const loadInstances = () => providerStore.getState().loadProviderInstances()
  onSettled(() => {
    const status = providerStore.getState().providerStatus
    if (status !== "loading") void loadInstances().catch(() => undefined)
    let active = true
    void serviceFactory.getSetupStatus().then((setup) => {
      if (active) setSupportsFirstRun(setup.model_setup_in_app === true)
    }).catch(() => undefined)
    return () => { active = false }
  })
  createEffect(
    () => canManage() && state().catalog === null,
    (needed) => {
      if (!needed || requestedCatalog) return
      requestedCatalog = true
      void providerStore.getState().loadCatalog()
    },
  )

  const disabledGuidance = (id: string) => {
    const current = snapshot()
    if (id === current?.defaults?.chat.provider) {
      return text("switch_the_chat_model_preference_to_another_enabled_pro_9448959e")
    }
    if (id === current?.default_provider_instance_id) {
      return text("confirm_and_save_the_chat_provider_in_default_model_pre_0f535ee4")
    }
    return null
  }

  const discover = async (id: string, created = false) => {
    if (fetchingId()) return
    setFetchingId(id)
    setFetchNotice({
      id,
      text: text(created ? "instance_saved_discovering_models_83ad3667" : "runtime_models_fetching"),
      tone: "loading",
    })
    try {
      await providerStore.getState().fetchCatalogModels(id)
      const count = providerStore.getState().discoveredModelsByProvider[id]?.length ?? 0
      setFetchNotice({
        id,
        text: count > 0
          ? text(created ? "runtime_models_saved_discovered" : "runtime_models_discovered", { count })
          : text(created ? "instance_saved_but_no_models_were_found_enter_a_custom__a6488023"
            : "no_models_found_you_can_enter_a_custom_model_id_in_the__f7b4e163"),
        tone: count > 0 ? "success" : "warning",
      })
    } catch {
      setFetchNotice({
        id,
        text: text(created ? "instance_saved_but_model_discovery_failed_enter_a_custo_e47612cc"
          : "model_discovery_failed_check_the_instance_settings_and__c3f830b9"),
        tone: created ? "warning" : "error",
      })
    } finally {
      setFetchingId(null)
    }
  }

  const createInstance = async (value: InstanceSavePayload) => {
    if (value.type === "bodhi") return
    const result = await providerStore.getState().createProviderInstance({
      type: value.type, label: value.label, enabled: value.enabled, config: value.config,
    })
    setAdding(false)
    if (!result.responseValid || !result.instance) {
      setPendingCreatedId(null)
      setCreateNotice(text(result.authorityRefreshed
        ? "the_instance_was_saved_and_the_list_reloaded_but_the_cr_6fe3f38e"
        : "the_instance_was_saved_but_neither_the_creation_respons_a47ff1ce"))
      return
    }

    const created = result.instance
    if (result.instanceConfirmed) {
      setEditing(created.id)
      setPendingCreatedId(null)
      setCreateNotice(null)
      await discover(created.id, true)
      return
    }
    setPendingCreatedId(created.id)
    setCreateNotice(text(result.authorityRefreshed
      ? "was_saved_but_the_reloaded_list_has_not_confirmed_it_mo_ff5cbaca"
      : "was_saved_but_the_instance_list_could_not_be_reloaded_m_673d8238", { v0: created.label }))
  }
  const retryLoad = async () => {
    setListError(null)
    try {
      const refreshed = await loadInstances()
      const id = pendingCreatedId()
      if (id && refreshed.instances.some((instance) => instance.id === id)) {
        setCreateNotice(null)
        setPendingCreatedId(null)
        setEditing(id)
        await discover(id, true)
      } else if (id) {
        setCreateNotice(text("instance_saved_but_the_reloaded_list_has_not_confirmed__1d5018ee"))
      } else if (createNotice()) {
        setCreateNotice(text("the_list_was_reloaded_but_the_creation_response_has_no__08755e58"))
      }
    } catch {
      setListError(text(createNotice() ? "instance_saved_but_the_provider_list_still_cannot_be_re_6fdc1782"
        : "provider_settings_are_currently_unavailable_b04506b2"))
    }
  }
  const updateInstance = async (id: string, value: InstanceSavePayload) => {
    const blocked = value.enabled ? null : disabledGuidance(id)
    if (blocked) throw new Error(blocked)
    await providerStore.getState().updateProviderInstance(id, {
      label: value.label, enabled: value.enabled, config: value.config,
    })
    await providerStore.getState().loadCatalog()
    await appStore.getState().fetchModels()
    setFetchNotice((notice) => notice?.id === id ? null : notice)
    setEditing(null)
  }
  const toggleEnabled = async (instance: ProviderInstance, enabled: boolean) => {
    setListError(null)
    const blocked = enabled ? null : disabledGuidance(instance.id)
    if (blocked) { setListError(blocked); return }
    try {
      await providerStore.getState().updateProviderInstance(instance.id, { enabled })
    } catch (error) {
      setListError(text("failed_72c709b0", {
        v0: instance.label || instance.type,
        v1: text(enabled ? "enable_action" : "disable_4e6fd0e2"),
        v2: getErrorMessage(error),
      }))
    }
  }
  const confirmDelete = async () => {
    const instance = deleting()
    if (!instance || deleteBusy()) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await providerStore.getState().deleteProviderInstance(instance.id)
      setDeleting(null)
    } catch (error) {
      setDeleteError(getErrorMessage(error))
    } finally {
      setDeleteBusy(false)
    }
  }

  const optionsForInstance = (id: string) => state().discoveredModelsByProvider[id] ??
    state().catalog?.models.filter((model) => model.reference.provider === id) ?? []
  const failure = () => state().providerStatus === "unavailable" || state().providerStatus === "incompatible"

  return (
    <div class="space-y-3">
      <div class="flex items-center justify-between">
        <p class="text-xs text-muted-foreground">{text("configure_llm_providers_api_keys_and_available_models_4caf6573")}</p>
        <Show when={!adding() && canManage() && !createNotice()}>
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus class="size-4" />{text("add_0006d696")}
          </Button>
        </Show>
      </div>

      <Show when={state().providerStatus === "idle" || state().providerStatus === "loading"}>
        <p role="status" class="text-xs text-muted-foreground">{text("loading_provider_settings_46da40c3")}</p>
      </Show>
      <Show when={failure()}>
        <div role="alert" class="flex items-center justify-between gap-2 rounded-lg border border-destructive/40 p-3 text-xs text-destructive">
          <span>{text(state().providerStatus === "incompatible"
            ? "this_bamboo_provider_configuration_format_is_incompatib_8eefe79f"
            : "provider_settings_are_currently_unavailable_b04506b2")}{state().providerError ? ` ${state().providerError}` : ""}</span>
          <Show when={!createNotice()}><Button size="sm" variant="secondary" onClick={() => void retryLoad()}>{text("reload_7bdd5ce1")}</Button></Show>
        </div>
      </Show>
      <Show when={state().providerStatus === "degraded"}>
        <div role="alert" class="rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
          {text("provider_or_model_preferences_contain_broken_references_a5de7472")}{state().providerRepairIssues.length}
          {" "}{text("valid_instances_can_still_be_managed_but_chat_and_runti_301d8be4")}
        </div>
      </Show>
      <Show when={createNotice()}>
        <div role="status" class="flex items-start justify-between gap-3 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
          <span>{createNotice()}</span>
          <Button size="sm" variant="secondary" onClick={() => void retryLoad()}>{text("reload_7bdd5ce1")}</Button>
        </div>
      </Show>
      <Show when={listError()}><p role="alert" class="text-xs text-destructive">{listError()}</p></Show>
      <Show when={adding() && canManage()}>
        <InstanceEditor instance={null} onCancel={() => setAdding(false)} onSave={createInstance} />
      </Show>

      <Show when={canManage()}>
        <ul class="space-y-2">
          <For each={instances()} keyed={(instance) => instance.id}>{(instance) => {
            const id = () => instance().id
            return (
              <li class="rounded-lg border p-3">
                <Show when={editing() === id()} fallback={
                  <div class="flex items-center gap-2">
                    <div class="min-w-0 flex-1">
                      <div class="flex items-center gap-1.5">
                        <span class="truncate text-sm font-medium">{instance().label || instance().type}</span>
                        <Show when={!instance().enabled}>
                          <Badge variant="secondary" class="shrink-0 px-1.5 text-[10px]">{text("disabled_a8c3698b")}</Badge>
                        </Show>
                      </div>
                      <div class="truncate text-xs text-muted-foreground">{PROVIDER_LABELS[instance().type] ?? instance().type}</div>
                    </div>
                    <Switch checked={instance().enabled} class="shrink-0"
                      aria-label={text(instance().enabled ? "disable_4e6fd0e2" : "enable_action")}
                      onCheckedChange={(enabled) => void toggleEnabled(instance(), enabled)} />
                    <button type="button" disabled={fetchingId() !== null}
                      aria-label={text("discover_models_22572a98")} title={text("discover_models_22572a98")}
                      class="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                      onClick={() => { setEditing(id()); void discover(id()) }}>
                      <RefreshCw class={cn("size-3.5", fetchingId() === id() && "animate-spin")} />
                    </button>
                    <button type="button" aria-label={text("edit_05183656")}
                      class="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                      onClick={() => {
                        setEditing(id())
                        if (createNotice() && !pendingCreatedId()) setCreateNotice(null)
                      }}><Pencil class="size-3.5" /></button>
                    <button type="button" aria-label={text("delete_2f9daa82")}
                      class="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                      onClick={() => { setDeleteError(null); setDeleting(instance()) }}><Trash2 class="size-3.5" /></button>
                  </div>
                }>
                  <InstanceEditor
                    instance={instance()}
                    modelOptions={optionsForInstance(id())}
                    initialRuntimeModels={getRuntimeModelIds(instance(), snapshot()?.defaults)}
                    defaults={snapshot()?.defaults}
                    onFetchModels={() => void discover(id())}
                    fetchingModels={fetchingId() === id()}
                    fetchModelsNotice={fetchNotice()?.id === id() ? fetchNotice() ?? undefined : undefined}
                    onCancel={() => setEditing(null)}
                    onSave={(value) => updateInstance(id(), value)}
                  />
                </Show>
              </li>
            )
          }}</For>
        </ul>
        <Show when={!instances().length && !adding()}>
          <p class="text-xs text-muted-foreground">{text("no_provider_instances_yet_click_add_to_create_one_9f673789")}</p>
        </Show>
      </Show>
      <DefaultsEditor verifyFirstModel={supportsFirstRun()} onModelReady={props.onModelReady} />
      <ResponsiveDialog open={deleting() !== null} onOpenChange={(open) => { if (!open && !deleteBusy()) setDeleting(null) }}>
        <ResponsiveDialogContent class="gap-3 p-4">
          <ResponsiveDialogTitle>{text("delete_provider_instance_c190bd28")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {text("delete_72f49a52")}{deleting()?.label || deleting()?.type}{text("default_model_preferences_that_reference_it_will_become_2c834ea2")}
          </ResponsiveDialogDescription>
          <Show when={deleteError()}><p role="alert" class="text-xs text-destructive">{text("deletion_failed_8b176752")}{deleteError()}</p></Show>
          <div class="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDeleting(null)} disabled={deleteBusy()}>{text("cancel_2cd0f3be")}</Button>
            <Button size="sm" variant="destructive" onClick={() => void confirmDelete()} disabled={deleteBusy()}>
              {text(deleteBusy() ? "deleting_5e8e7af5" : "delete_2f9daa82")}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
