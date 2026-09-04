import { useEffect, useState } from "react"
import { Trash2, Plus, Check, Pencil, RefreshCw } from "lucide-react"
import { getErrorMessage } from "@services/api"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import type { ProviderInstance } from "@shared/types/providerConfig"
import { PROVIDER_LABELS } from "@shared/types/providerConfig"
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
  const snapshot = useProviderStore((s) => s.providerSnapshot)
  const providerStatus = useProviderStore((s) => s.providerStatus)
  const providerError = useProviderStore((s) => s.providerError)
  const loadInstances = useProviderStore((s) => s.loadProviderInstances)
  const createProviderInstance = useProviderStore((s) => s.createProviderInstance)
  const updateProviderInstance = useProviderStore((s) => s.updateProviderInstance)
  const deleteProviderInstance = useProviderStore((s) => s.deleteProviderInstance)
  const setDefaultProviderInstance = useProviderStore((s) => s.setDefaultProviderInstance)
  const fetchCatalogModels = useProviderStore((s) => s.fetchCatalogModels)

  const instances = snapshot?.instances ?? []
  const defaultId = snapshot?.default_provider_instance_id ?? null

  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ProviderInstance | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [fetchingId, setFetchingId] = useState<string | null>(null)
  const [fetchNotice, setFetchNotice] = useState<{ id: string; text: string; error: boolean } | null>(null)

  useEffect(() => {
    void loadInstances().catch(() => undefined)
  }, [loadInstances])

  const createInstance = async (v: InstanceSavePayload) => {
    await createProviderInstance({
      type: v.type,
      label: v.label,
      enabled: v.enabled,
      config: v.config,
    })
    setAdding(false)
  }

  const updateInstance = async (id: string, v: InstanceSavePayload) => {
    // The backend PUT ignores `type` — provider type is immutable after create.
    await updateProviderInstance(id, {
      label: v.label,
      enabled: v.enabled,
      config: v.config,
    })
    setEditing(null)
  }

  const toggleEnabled = async (inst: ProviderInstance, next: boolean) => {
    setListError(null)
    try {
      await updateProviderInstance(inst.id, { enabled: next })
    } catch (e) {
      setListError(`「${inst.label || inst.type}」${next ? "启用" : "停用"}失败:${getErrorMessage(e)}`)
    }
  }

  const setDefault = async (inst: ProviderInstance) => {
    setListError(null)
    try {
      await setDefaultProviderInstance(inst.id)
    } catch (e) {
      setListError(`设为默认失败:${getErrorMessage(e)}`)
    }
  }

  const fetchModels = async (inst: ProviderInstance) => {
    setFetchingId(inst.id)
    setFetchNotice(null)
    try {
      await fetchCatalogModels(inst.id)
      const count = useProviderStore.getState().getModelsForProvider(inst.id).length
      setFetchNotice({ id: inst.id, text: `已刷新 ${count} 个模型`, error: false })
    } catch (e) {
      setFetchNotice({ id: inst.id, text: `拉取失败:${getErrorMessage(e)}`, error: true })
    } finally {
      setFetchingId(null)
    }
  }

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
        <p className="text-xs text-muted-foreground">配置 LLM 提供方与 API Key。打勾的是默认。</p>
        {!adding && providerStatus === "ready" ? (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> 新增
          </Button>
        ) : null}
      </div>

      {providerStatus === "idle" || providerStatus === "loading" ? (
        <p className="text-xs text-muted-foreground">正在加载提供方设置…</p>
      ) : null}
      {providerStatus === "unavailable" ? (
        <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-xs text-destructive">
          提供方设置当前不可用。{providerError ? ` ${providerError}` : ""}
        </div>
      ) : null}
      {providerStatus === "incompatible" ? (
        <div role="alert" className="rounded-lg border border-destructive/40 p-3 text-xs text-destructive">
          当前 Bamboo 的提供方配置格式与 Lotus Next 不兼容。{providerError ? ` ${providerError}` : ""}
        </div>
      ) : null}
      {listError ? <p className="text-xs text-destructive">{listError}</p> : null}

      {adding && providerStatus === "ready" ? (
        <InstanceEditor instance={null} onCancel={() => setAdding(false)} onSave={createInstance} />
      ) : null}

      {providerStatus === "ready" ? <ul className="space-y-2">
        {instances.map((inst: ProviderInstance) => (
          <li key={inst.id} className="rounded-lg border p-3">
            {editing === inst.id ? (
              <InstanceEditor
                instance={inst}
                onCancel={() => setEditing(null)}
                onSave={(v) => updateInstance(inst.id, v)}
              />
            ) : (
              <>
                <div className="flex items-center gap-2">
                  <button
                    onClick={() => void setDefault(inst)}
                    aria-label="设为默认"
                    className={cn(
                      "flex size-5 shrink-0 items-center justify-center rounded-full border",
                      inst.id === defaultId
                        ? "border-primary bg-primary text-primary-foreground"
                        : "text-transparent hover:border-primary",
                    )}
                  >
                    <Check className="size-3" />
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-1.5">
                      <span className="truncate text-sm font-medium">{inst.label || inst.type}</span>
                      {!inst.enabled ? (
                        <Badge variant="secondary" className="shrink-0 px-1.5 text-[10px]">
                          已停用
                        </Badge>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {PROVIDER_LABELS[inst.type] ?? inst.type}
                      {inst.id === defaultId ? " · 默认" : ""}
                    </div>
                  </div>
                  <Switch
                    checked={inst.enabled}
                    onCheckedChange={(v) => void toggleEnabled(inst, v)}
                    aria-label={inst.enabled ? "停用" : "启用"}
                    className="shrink-0"
                  />
                  <button
                    onClick={() => void fetchModels(inst)}
                    aria-label="拉取模型列表"
                    title="拉取模型列表"
                    disabled={fetchingId === inst.id}
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground disabled:opacity-50"
                  >
                    <RefreshCw className={cn("size-3.5", fetchingId === inst.id && "animate-spin")} />
                  </button>
                  <button
                    onClick={() => setEditing(inst.id)}
                    aria-label="编辑"
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground"
                  >
                    <Pencil className="size-3.5" />
                  </button>
                  <button
                    onClick={() => {
                      setDeleteError(null)
                      setDeleting(inst)
                    }}
                    aria-label="删除"
                    className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </div>
                {fetchNotice && fetchNotice.id === inst.id ? (
                  <p className={cn("mt-1.5 text-xs", fetchNotice.error ? "text-destructive" : "text-emerald-500")}>
                    {fetchNotice.text}
                  </p>
                ) : null}
              </>
            )}
          </li>
        ))}
      </ul> : null}

      {providerStatus === "ready" && instances.length === 0 && !adding ? (
        <p className="text-xs text-muted-foreground">暂无提供方实例,点击「新增」创建。</p>
      ) : null}

      {providerStatus === "ready" ? <DefaultsEditor /> : null}

      <ResponsiveDialog open={deleting != null} onOpenChange={(open) => (!open ? setDeleting(null) : null)}>
        <ResponsiveDialogContent className="gap-3 p-4">
          <ResponsiveDialogTitle>删除提供方实例</ResponsiveDialogTitle>
          <ResponsiveDialogDescription>
            确定删除「{deleting?.label || deleting?.type}」?引用它的默认模型偏好将失效。
          </ResponsiveDialogDescription>
          {deleteError ? <p className="text-xs text-destructive">删除失败:{deleteError}</p> : null}
          <div className="flex justify-end gap-2">
            <Button size="sm" variant="secondary" onClick={() => setDeleting(null)} disabled={deleteBusy}>
              取消
            </Button>
            <Button size="sm" variant="destructive" onClick={() => void confirmDelete()} disabled={deleteBusy}>
              {deleteBusy ? "删除中…" : "删除"}
            </Button>
          </div>
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </div>
  )
}
