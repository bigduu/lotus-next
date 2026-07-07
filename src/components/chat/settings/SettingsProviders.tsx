import { useEffect, useState } from "react"
import { Trash2, Plus, Check, Pencil, RefreshCw } from "lucide-react"
import { settingsService } from "@services/config/SettingsService"
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
  const instances = useProviderStore((s) => s.providerInstances)
  const defaultId = useProviderStore((s) => s.defaultProviderInstanceId)
  const loadInstances = useProviderStore((s) => s.loadProviderInstances)
  const loadCatalog = useProviderStore((s) => s.loadCatalog)
  const storeError = useProviderStore((s) => s.error)

  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)
  const [listError, setListError] = useState<string | null>(null)
  const [deleting, setDeleting] = useState<ProviderInstance | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState<string | null>(null)
  const [fetchingId, setFetchingId] = useState<string | null>(null)
  const [fetchNotice, setFetchNotice] = useState<{ id: string; text: string; error: boolean } | null>(null)

  useEffect(() => {
    void loadInstances()
  }, [loadInstances])

  const reload = () => void loadInstances()

  const createInstance = async (v: InstanceSavePayload) => {
    await settingsService.createProviderInstance({
      type: v.type,
      label: v.label,
      enabled: v.enabled,
      config: v.config,
    })
    setAdding(false)
    reload()
  }

  const updateInstance = async (id: string, v: InstanceSavePayload) => {
    // The backend PUT ignores `type` — provider type is immutable after create.
    await settingsService.updateProviderInstance(id, {
      label: v.label,
      enabled: v.enabled,
      config: v.config,
    })
    setEditing(null)
    reload()
  }

  const toggleEnabled = async (inst: ProviderInstance, next: boolean) => {
    setListError(null)
    try {
      await settingsService.updateProviderInstance(inst.id, { enabled: next })
      reload()
    } catch (e) {
      setListError(`「${inst.label || inst.type}」${next ? "启用" : "停用"}失败:${getErrorMessage(e)}`)
    }
  }

  const setDefault = async (inst: ProviderInstance) => {
    setListError(null)
    try {
      await settingsService.setDefaultProviderInstance(inst.id)
      reload()
    } catch (e) {
      setListError(`设为默认失败:${getErrorMessage(e)}`)
    }
  }

  const fetchModels = async (inst: ProviderInstance) => {
    setFetchingId(inst.id)
    setFetchNotice(null)
    try {
      const res = await settingsService.fetchCatalogModels(inst.id)
      const fetched = res.fetched ?? []
      const entry =
        fetched.find((f) => f.provider === inst.id) ??
        fetched.find((f) => f.provider === inst.type) ??
        fetched[0]
      if (entry?.error) {
        setFetchNotice({ id: inst.id, text: `拉取失败:${entry.error}`, error: true })
      } else {
        const count = entry?.models?.length ?? 0
        setFetchNotice({ id: inst.id, text: `已拉取 ${count} 个模型`, error: false })
        await loadCatalog()
      }
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
      await settingsService.deleteProviderInstance(deleting.id)
      setDeleting(null)
      reload()
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
        {!adding ? (
          <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>
            <Plus className="size-4" /> 新增
          </Button>
        ) : null}
      </div>

      {storeError ? <p className="text-xs text-destructive">加载失败:{storeError}</p> : null}
      {listError ? <p className="text-xs text-destructive">{listError}</p> : null}

      {adding ? <InstanceEditor instance={null} onCancel={() => setAdding(false)} onSave={createInstance} /> : null}

      <ul className="space-y-2">
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
      </ul>

      {instances.length === 0 && !adding && !storeError ? (
        <p className="text-xs text-muted-foreground">暂无提供方实例,点击「新增」创建。</p>
      ) : null}

      <DefaultsEditor />

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
