import { useEffect, useRef, useState } from "react"
import { Trash2, Plus, Pencil, RefreshCw } from "lucide-react"
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
          ? "实例已保存且列表已重新加载，但创建响应缺少有效实例 ID。请从列表中选择实例继续，勿重复创建。"
          : "实例已保存，但创建响应和实例列表均无法安全确认。请重新加载列表后继续，勿重复创建。",
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
          ? `「${created.label}」实例已保存，但重新加载的列表尚未确认该实例。模型发现仍会继续；请重新加载后编辑，勿重复创建。`
          : `「${created.label}」实例已保存，但实例列表重新加载失败。模型发现仍会继续；请重新加载后编辑，勿重复创建。`,
      )
    }

    setFetchingId(created.id)
    setFetchNotice(
      result.instanceConfirmed ? { id: created.id, text: "实例已保存，正在获取模型…", tone: "loading" } : null,
    )
    try {
      await fetchCatalogModels(created.id)
      const count = useProviderStore.getState().getModelsForProvider(created.id).length
      const text =
        count > 0
          ? `实例已保存，并发现 ${count} 个模型。请选择模型后再次保存。`
          : "实例已保存，但未发现模型。可手动输入自定义模型 ID 后再次保存。"
      if (result.instanceConfirmed) {
        setFetchNotice({
          id: created.id,
          text,
          tone: count > 0 ? "success" : "warning",
        })
      } else {
        setCreateRecoveryNotice(`${text} 实例列表重新加载失败，请重新加载后继续，勿重复创建。`)
      }
    } catch {
      const text = "实例已保存，但模型发现失败。可手动输入自定义模型 ID 后再次保存。"
      if (result.instanceConfirmed) {
        setFetchNotice({ id: created.id, text, tone: "warning" })
      } else {
        setCreateRecoveryNotice(`${text} 实例列表重新加载失败，请重新加载后继续，勿重复创建。`)
      }
    } finally {
      setFetchingId(null)
    }
  }

  const disabledProviderGuidance = (id: string): string | null => {
    if (id === chatProviderId) {
      return "请先将「对话」模型偏好切换到其他已启用提供方并保存，再停用此实例。"
    }
    if (id === compatibilityProviderId) {
      return "请先在「默认模型偏好」中确认并保存「对话」提供方，再停用此实例。"
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
      setListError(`「${inst.label || inst.type}」${next ? "启用" : "停用"}失败:${getErrorMessage(e)}`)
    }
  }

  const fetchModels = async (inst: ProviderInstance) => {
    setFetchingId(inst.id)
    setFetchNotice(null)
    try {
      await fetchCatalogModels(inst.id)
      const count = useProviderStore.getState().getModelsForProvider(inst.id).length
      setFetchNotice({
        id: inst.id,
        text: count > 0 ? `已刷新 ${count} 个模型` : "未发现模型，可在编辑器中手动输入自定义模型 ID。",
        tone: count > 0 ? "success" : "warning",
      })
    } catch {
      setFetchNotice({
        id: inst.id,
        text: "模型发现失败，请检查实例配置后重试。",
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
        setCreateRecoveryNotice("实例已保存，但重新加载的列表仍未确认该实例。请稍后重试并勿重复创建。")
      } else {
        setCreateRecoveryNotice(
          "列表已重新加载，但创建响应缺少有效实例 ID。请从列表中选择刚保存的实例继续，勿重复创建。",
        )
      }
    } catch {
      setListError("实例已保存，但提供方列表仍无法重新加载。请稍后重试，勿重复创建。")
    }
  }

  const modelsForInstance = (instanceId: string) =>
    catalog?.models.filter((model) => model.reference.provider === instanceId) ?? []

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
        <p className="text-xs text-muted-foreground">配置 LLM 提供方、API Key 与可用模型。</p>
        {!adding && canManage && !createRecoveryNotice ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setAdding(true)
            }}
          >
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
      {providerStatus === "degraded" ? (
        <div role="alert" className="rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
          提供方或模型偏好中有失效引用（{repairIssues.length} 处）。有效实例仍可管理，但聊天与运行时暂不会使用这些偏好；请在下方选择现有实例和模型并保存偏好完成修复。
        </div>
      ) : null}
      {createRecoveryNotice ? (
        <div role="status" className="flex items-start justify-between gap-3 rounded-lg border border-amber-500/50 bg-amber-500/5 p-3 text-xs text-amber-700 dark:text-amber-300">
          <span>{createRecoveryNotice}</span>
          <Button size="sm" variant="secondary" onClick={() => void retryLoad()}>
            重新加载
          </Button>
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
                          已停用
                        </Badge>
                      ) : null}
                    </div>
                    <div className="truncate text-xs text-muted-foreground">
                      {PROVIDER_LABELS[inst.type] ?? inst.type}
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
                    onClick={() => {
                      setEditing(inst.id)
                      if (createRecoveryNotice && pendingCreatedId === null) {
                        setCreateRecoveryNotice(null)
                      }
                    }}
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
        <p className="text-xs text-muted-foreground">暂无提供方实例,点击「新增」创建。</p>
      ) : null}

      <div hidden={!canManage}>
        <DefaultsEditor />
      </div>

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
