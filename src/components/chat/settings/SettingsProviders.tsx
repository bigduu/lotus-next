import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useRef, useState } from "react"
import { Trash2, Plus, Pencil, RefreshCw } from "lucide-react"
import { getErrorMessage } from "@services/api"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import { useAppStore } from "@shared/store/appStore"
import type { ProviderInstance } from "@shared/types/providerConfig"
import { getRuntimeModelIds, PROVIDER_LABELS } from "@shared/types/providerConfig"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"
import { Switch } from "@/components/ui/switch"
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogTitle,
  ResponsiveDialogDescription,
} from "@/components/ui/responsive-dialog"
import { cn } from "@/lib/utils"
import { InstanceEditor, type InstanceSavePayload } from "./providers/InstanceEditor"
import { DefaultsEditor } from "./providers/DefaultsEditor"

export function SettingsProviders() {
  useUiLocale()
  const snapshot = useProviderStore((s) => s.providerSnapshot)
  const repairSnapshot = useProviderStore((s) => s.providerRepairSnapshot)
  const repairIssues = useProviderStore((s) => s.providerRepairIssues)
  const providerStatus = useProviderStore((s) => s.providerStatus)
  const providerError = useProviderStore((s) => s.providerError)
  const loadInstances = useProviderStore((s) => s.loadProviderInstances)
  const createProviderInstance = useProviderStore((s) => s.createProviderInstance)
  const updateProviderInstance = useProviderStore((s) => s.updateProviderInstance)
  const deleteProviderInstance = useProviderStore((s) => s.deleteProviderInstance)
  const loadCatalog = useProviderStore((s) => s.loadCatalog)
  const fetchCatalogModels = useProviderStore((s) => s.fetchCatalogModels)
  const catalog = useProviderStore((s) => s.catalog)
  const discoveries = useProviderStore((s) => s.discoveredModelsByProvider)

  const settingsSnapshot = snapshot ?? repairSnapshot
  const instances = settingsSnapshot?.instances ?? []
  const chatProviderId = settingsSnapshot?.defaults?.chat.provider ?? null
  const compatibilityProviderId = settingsSnapshot?.default_provider_instance_id ?? null
  const canManage = providerStatus === "ready" || providerStatus === "degraded"

  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ProviderInstance | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [fetchingId, setFetchingId] = useState<string | null>(null)
  const [fetchNotice, setFetchNotice] = useState<{
    id: string
    text: string
    tone: "loading" | "success" | "warning" | "error"
  } | null>(null)
  const [createRecoveryNotice, setCreateRecoveryNotice] = useState<string | null>(null)
  const [pendingCreatedId, setPendingCreatedId] = useState<string | null>(null)
  const catalogLoadRequested = useRef(false)

  useEffect(() => {
    void loadInstances().catch(() => undefined)
  }, [loadInstances])

  useEffect(() => {
    if (!canManage || catalog !== null || catalogLoadRequested.current) return
    catalogLoadRequested.current = true
    void loadCatalog()
  }, [canManage, catalog, loadCatalog])

  const createInstance = async (v: InstanceSavePayload) => {
    const result = await createProviderInstance({
      type: v.type,
      label: v.label,
      enabled: v.enabled,
      config: v.config,
    })
    setAdding(false)

    if (!result.responseValid || !result.instance) {
      setPendingCreatedId(null)
      setCreateRecoveryNotice(
        result.authorityRefreshed
          ? uiText("the_instance_was_saved_and_the_list_reloaded_but_the_cr_6fe3f38e")
          : uiText("the_instance_was_saved_but_neither_the_creation_respons_a47ff1ce"),
      )
      return
    }

    const created = result.instance
    if (result.instanceConfirmed) {
      setEditing(created.id)
      setPendingCreatedId(null)
      setCreateRecoveryNotice(null)
    } else {
      setPendingCreatedId(created.id)
      setCreateRecoveryNotice(
        result.authorityRefreshed
          ? uiText("was_saved_but_the_reloaded_list_has_not_confirmed_it_mo_ff5cbaca", { v0: created.label })
          : uiText("was_saved_but_the_instance_list_could_not_be_reloaded_m_673d8238", { v0: created.label }),
      )
    }

    setFetchingId(created.id)
    setFetchNotice(
      result.instanceConfirmed ? { id: created.id, text: uiText("instance_saved_discovering_models_83ad3667"), tone: "loading" } : null,
    )
    try {
      await fetchCatalogModels(created.id)
      const count = useProviderStore.getState().discoveredModelsByProvider[created.id]?.length ?? 0
      const text =
        count > 0
          ? uiText("runtime_models_saved_discovered", { count })
          : uiText("instance_saved_but_no_models_were_found_enter_a_custom__a6488023")
      if (result.instanceConfirmed) {
        setFetchNotice({
          id: created.id,
          text,
          tone: count > 0 ? "success" : "warning",
        })
      } else {
        setCreateRecoveryNotice(uiText("the_instance_list_could_not_be_reloaded_reload_before_c_b8ee7a2a", { v0: text }))
      }
    } catch {
      const text = uiText("instance_saved_but_model_discovery_failed_enter_a_custo_e47612cc")
      if (result.instanceConfirmed) {
        setFetchNotice({ id: created.id, text, tone: "warning" })
      } else {
        setCreateRecoveryNotice(uiText("the_instance_list_could_not_be_reloaded_reload_before_c_b8ee7a2a", { v0: text }))
      }
    } finally {
      setFetchingId(null)
    }
  }

  const disabledProviderGuidance = (id: string): string | null => {
    if (id === chatProviderId) {
      return uiText("switch_the_chat_model_preference_to_another_enabled_pro_9448959e")
    }
    if (id === compatibilityProviderId) {
      return uiText("confirm_and_save_the_chat_provider_in_default_model_pre_0f535ee4")
    }
    return null
  }

  const updateInstance = async (id: string, v: InstanceSavePayload) => {
    if (!v.enabled) {
      const guidance = disabledProviderGuidance(id)
      if (guidance) throw new Error(guidance)
    }
    // The backend PUT ignores `type` — provider type is immutable after create.
    await updateProviderInstance(id, {
      label: v.label,
      enabled: v.enabled,
      config: v.config,
    })
    await loadCatalog()
    await useAppStore.getState().fetchModels()
    setFetchNotice((notice) => (notice?.id === id ? null : notice))
    setEditing(null)
  }

  const toggleEnabled = async (inst: ProviderInstance, next: boolean) => {
    setListError(null)
    if (!next) {
      const guidance = disabledProviderGuidance(inst.id)
      if (guidance) {
        setListError(guidance)
        return
      }
    }
    try {
      await updateProviderInstance(inst.id, { enabled: next })
    } catch (e) {
      setListError(uiText("failed_72c709b0", { v0: inst.label || inst.type, v1: next ? uiText("enable_action") : uiText("disable_4e6fd0e2"), v2: getErrorMessage(e) }))
    }
  }

  const fetchModels = async (inst: ProviderInstance) => {
    setEditing(inst.id)
    setFetchingId(inst.id)
    setFetchNotice(null)
    try {
      await fetchCatalogModels(inst.id)
      const count = useProviderStore.getState().discoveredModelsByProvider[inst.id]?.length ?? 0
      setFetchNotice({
        id: inst.id,
        text: count > 0 ? uiText("runtime_models_discovered", { count }) : uiText("no_models_found_you_can_enter_a_custom_model_id_in_the__f7b4e163"),
        tone: count > 0 ? "success" : "warning",
      })
    } catch {
      setFetchNotice({
        id: inst.id,
        text: uiText("model_discovery_failed_check_the_instance_settings_and__c3f830b9"),
        tone: "error",
      })
    } finally {
      setFetchingId(null)
    }
  }

  const retryLoad = async () => {
    setListError(null)
    try {
      const refreshed = await loadInstances()
      const createdId = pendingCreatedId
      if (createdId && refreshed.instances.some((instance) => instance.id === createdId)) {
        setCreateRecoveryNotice(null)
        setPendingCreatedId(null)
        setEditing(createdId)
      } else if (createdId) {
        setCreateRecoveryNotice(uiText("instance_saved_but_the_reloaded_list_has_not_confirmed__1d5018ee"))
      } else {
        setCreateRecoveryNotice(
          uiText("the_list_was_reloaded_but_the_creation_response_has_no__08755e58"),
        )
      }
    } catch {
      setListError(uiText("instance_saved_but_the_provider_list_still_cannot_be_re_6fdc1782"))
    }
  }

  const modelsForInstance = (instanceId: string) =>
    discoveries[instanceId] ?? catalog?.models.filter((model) => model.reference.provider === instanceId) ?? []

  const confirmDelete = async () => {
    if (!deleting) return
    setDeleteBusy(true)
    setDeleteError(null)
    try {
      await deleteProviderInstance(deleting.id)
      setDeleting(null)
    } catch (e) {
      setDeleteError(getErrorMessage(e))
    } finally {
      setDeleteBusy(false)
    }
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">{uiText("configure_llm_providers_api_keys_and_available_models_4caf6573")}</p>
        {!adding && canManage && !createRecoveryNotice ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setAdding(true)
            }}
          >
            <Plus className="size-4" />{uiText("add_0006d696")}</Button>
        ) : null}
      </div>

      {providerStatus === "idle" || providerStatus === "loading" ? (
        <p className="text-xs text-muted-foreground">{uiText("loading_provider_settings_46da40c3")}</p>
      ) : null}
      {providerStatus === "unavailable" ? (
        <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-xs text-destructive">
          {uiText("provider_settings_are_currently_unavailable_b04506b2")}{providerError ? ` ${providerError}` : ""}
        </div>
      ) : null}
      {providerStatus === "incompatible" ? (
        <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-xs text-destructive">
          {uiText("this_bamboo_provider_configuration_format_is_incompatib_8eefe79f")}{providerError ? ` ${providerError}` : ""}
        </div>
      ) : null}
      {providerStatus === "degraded" ? (
        <div role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
          {uiText("provider_or_model_preferences_contain_broken_references_a5de7472")}{repairIssues.length} {uiText("valid_instances_can_still_be_managed_but_chat_and_runti_301d8be4")}</div>
      ) : null}
      {createRecoveryNotice ? (
        <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
          <span>{createRecoveryNotice}</span>
          <Button size="sm" variant="secondary" onClick={() => void retryLoad()}>
            {uiText("reload_7bdd5ce1")}</Button>
        </div>
      ) : null}
      {listError ? <p className="text-xs text-destructive">{listError}</p> : null}

      {adding && canManage ? (
        <InstanceEditor instance={null} onCancel={() => setAdding(false)} onSave={createInstance} />
      ) : null}

      {canManage ? <ul className="space-y-2">
        {instances.map((inst: ProviderInstance) => (
          <li key={inst.id} className="rounded-lg border p-3">
            {editing === inst.id ? (
              <InstanceEditor
                instance={inst}
                modelOptions={modelsForInstance(inst.id)}
                initialRuntimeModels={getRuntimeModelIds(inst, settingsSnapshot?.defaults)}
                defaults={settingsSnapshot?.defaults}
                onCancel={() => setEditing(null)}
                onSave={(v) => updateInstance(inst.id, v)}
              />
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{inst.label || inst.type}</span>
                      {!inst.enabled ? (
                        <Badge variant="secondary" className="shrink-0 px-1.5 text-[10px]">
                          {uiText("disabled_a8c3698b")}</Badge>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {PROVIDER_LABELS[inst.type] ?? inst.type}
                    </div>
                  </div>
                  <Switch
                    checked={inst.enabled}
                    onCheckedChange={(v) => void toggleEnabled(inst, v)}
                    aria-label={inst.enabled ? uiText("disable_4e6fd0e2") : uiText("enable_action")}
                    className="shrink-0"
                  />
                  <button
                    onClick={() => void fetchModels(inst)}
                    aria-label={uiText("discover_models_22572a98")}
                    title={uiText("discover_models_22572a98")}
                    disabled={fetchingId === inst.id}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <RefreshCw className={cn("size-3.5", fetchingId === inst.id && "animate-spin")} />
                  </button>
                  <button
                    onClick={() => {
                      setEditing(inst.id)
                      if (createRecoveryNotice && pendingCreatedId === null) {
                        setCreateRecoveryNotice(null)
                      }
                    }}
                    aria-label={uiText("edit_05183656")}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setDeleteError(null)
                      setDeleting(inst)
                    }}
                    aria-label={uiText("delete_2f9daa82")}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
              </>
            )}
            {fetchNotice && fetchNotice.id === inst.id ? (
              <p
                role="status"
                className={cn(
                  "mt-1.5 text-xs",
                  fetchNotice.tone === "success" && "text-emerald-500",
                  fetchNotice.tone === "loading" && "text-muted-foreground",
                  fetchNotice.tone === "warning" && "text-amber-600 dark:text-amber-300",
                  fetchNotice.tone === "error" && "text-destructive",
                )}
              >
                {fetchNotice.text}
              </p>
            ) : null}
          </li>
        ))}
      </ul> : null}

      {canManage && instances.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground">{uiText("no_provider_instances_yet_click_add_to_create_one_9f673789")}</p>
      ) : null}

      <div hidden={!canManage}>
        <DefaultsEditor />
      </div>

      <ResponsiveDialog open={deleting != null} onOpenChange={(open) => (!open ? setDeleting(null) : null)}>
        <ResponsiveDialogContent className="gap-3 p-4">
          <ResponsiveDialogTitle>{uiText("delete_provider_instance_c190bd28")}</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            {uiText("delete_72f49a52")}{deleting?.label || deleting?.type}{uiText("default_model_preferences_that_reference_it_will_become_2c834ea2")}</ResponsiveDialogDescription>
          {deleteError ? <p className="text-xs text-destructive">{uiText("deletion_failed_8b176752")}{deleteError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              {uiText("cancel_2cd0f3be")}</Button>
            <Button size="sm" variant="destructive" onClick={() => void confirmDelete()} disabled={deleteBusy}>
              {deleteBusy ? uiText("deleting_5e8e7af5") : uiText("delete_2f9daa82")}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
