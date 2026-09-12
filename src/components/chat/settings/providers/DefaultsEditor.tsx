import { useEffect, useMemo, useRef, useState } from "react"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import {
  PROVIDER_DEFAULT_MODEL_REF_KEYS,
  findProviderSnapshotRelationIssues,
  type DefaultsConfig,
  type ProviderDefaultModelRefKey,
  type ProviderSnapshotRelationIssue,
} from "@shared/types/providerConfig"
import type { ProviderModelRef } from "@shared/types/providerModelRef"
import { apiClient, getErrorMessage } from "@services/api"
import { Button } from "@/components/ui/button"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { cn } from "@/lib/utils"
import { EditableModelCombobox } from "./EditableModelCombobox"

const UNSET = "__unset__"

const ROLES = [
  { key: "chat", label: "对话(必填)", required: true },
  { key: "fast", label: "快速", required: false },
  { key: "task_summary", label: "任务摘要", required: false },
  { key: "vision", label: "视觉", required: false },
  { key: "memory_background", label: "记忆后台", required: false },
  { key: "planning", label: "规划", required: false },
  { key: "search", label: "搜索", required: false },
  { key: "code_review", label: "代码审查", required: false },
  { key: "sub_agent", label: "子代理", required: false },
] as const satisfies readonly {
  key: ProviderDefaultModelRefKey
  label: string
  required: boolean
}[]

type DraftRef = { provider: string; model: string }
type DraftRefs = Record<ProviderDefaultModelRefKey, DraftRef>

interface DefaultsDraft {
  roles: DraftRefs
  subagentModels: Record<string, DraftRef>
}

const emptyRef = (): DraftRef => ({ provider: "", model: "" })

const copyRef = (ref?: ProviderModelRef): DraftRef => ({
  provider: ref?.provider ?? "",
  model: ref?.model ?? "",
})

function draftFromDefaults(defaults: DefaultsConfig | undefined): DefaultsDraft {
  const roles = Object.fromEntries(
    PROVIDER_DEFAULT_MODEL_REF_KEYS.map((key) => [key, copyRef(defaults?.[key])]),
  ) as DraftRefs

  const subagentModels = Object.fromEntries(
    Object.entries(defaults?.subagent_models ?? {}).map(([name, ref]) => [
      name,
      copyRef(ref),
    ]),
  )
  return { roles, subagentModels }
}

const serializeDraft = (draft: DefaultsDraft): string => JSON.stringify(draft)

const hasCompatibilityRouteIssue = (issues: readonly ProviderSnapshotRelationIssue[]) =>
  issues.some((issue) => issue.kind === "default_provider_instance")

const hasRoleIssue = (
  issues: readonly ProviderSnapshotRelationIssue[],
  role: ProviderDefaultModelRefKey,
) => issues.some((issue) => issue.kind === "default_model_ref" && issue.role === role)

const hasSubagentIssue = (
  issues: readonly ProviderSnapshotRelationIssue[],
  subagent: string,
) => issues.some((issue) => issue.kind === "subagent_model_ref" && issue.subagent === subagent)

/** Edit all defaults.* references while preserving server authority. */
export function DefaultsEditor() {
  const runtimeSnapshot = useProviderStore((state) => state.providerSnapshot)
  const repairSnapshot = useProviderStore((state) => state.providerRepairSnapshot)
  const repairIssues = useProviderStore((state) => state.providerRepairIssues)
  const providerStatus = useProviderStore((state) => state.providerStatus)
  const providerError = useProviderStore((state) => state.providerError)
  const loadProviderInstances = useProviderStore((state) => state.loadProviderInstances)
  const getModelsForProvider = useProviderStore((state) => state.getModelsForProvider)
  const catalog = useProviderStore((state) => state.catalog)

  const snapshot = runtimeSnapshot ?? repairSnapshot
  const instances = snapshot?.instances ?? []
  const defaults = snapshot?.defaults
  const canManage = providerStatus === "ready" || providerStatus === "degraded"

  const initialDraft = draftFromDefaults(defaults)
  const [draft, setDraft] = useState<DefaultsDraft>(() => initialDraft)
  const [baseline, setBaseline] = useState(() => serializeDraft(initialDraft))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty = useMemo(() => serializeDraft(draft) !== baseline, [draft, baseline])
  const compatibilitySyncRequired =
    (defaults?.chat.provider ?? "") !== "" &&
    defaults?.chat.provider !== (snapshot?.default_provider_instance_id ?? "")
  const dirtyRef = useRef(dirty)
  const savingRef = useRef(false)
  dirtyRef.current = dirty

  useEffect(() => {
    if (dirtyRef.current || savingRef.current) return
    const next = draftFromDefaults(defaults)
    setDraft(next)
    setBaseline(serializeDraft(next))
  }, [defaults])

  const setRole = (role: ProviderDefaultModelRefKey, patch: Partial<DraftRef>) =>
    setDraft((current) => ({
      ...current,
      roles: {
        ...current.roles,
        [role]: { ...current.roles[role], ...patch },
      },
    }))

  const setSubagent = (subagent: string, patch: Partial<DraftRef>) =>
    setDraft((current) => ({
      ...current,
      subagentModels: {
        ...current.subagentModels,
        [subagent]: { ...(current.subagentModels[subagent] ?? emptyRef()), ...patch },
      },
    }))

  const save = async () => {
    const instancesById = new Map(instances.map((instance) => [instance.id, instance]))
    for (const role of ROLES) {
      const value = draft.roles[role.key]
      if (!value.provider && !value.model.trim()) {
        if (role.required) {
          setError("对话(chat)默认模型必须选择提供方并填写模型")
          return
        }
        if (hasRoleIssue(repairIssues, role.key)) {
          setError(`「${role.label}」的失效引用必须显式替换为现有实例和模型`)
          return
        }
        continue
      }
      if (!value.provider || !value.model.trim()) {
        setError(`「${role.label}」必须同时选择提供方并填写模型`)
        return
      }
      const selectedInstance = instancesById.get(value.provider)
      if (!selectedInstance) {
        setError(`「${role.label}」引用的提供方已失效，请选择现有实例`)
        return
      }
      if (!selectedInstance.enabled) {
        setError(`「${role.label}」引用的提供方已停用，请先启用该实例或选择其他已启用实例`)
        return
      }
    }

    for (const [subagent, value] of Object.entries(draft.subagentModels)) {
      const selectedInstance = instancesById.get(value.provider)
      if (!value.provider || !value.model.trim() || !selectedInstance) {
        setError(`子代理「${subagent}」的失效引用必须显式替换为现有实例和模型`)
        return
      }
      if (!selectedInstance.enabled) {
        setError(`子代理「${subagent}」引用的提供方已停用，请先启用该实例或选择其他已启用实例`)
        return
      }
    }

    savingRef.current = true
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      const payload: Record<string, unknown> = {}
      for (const role of ROLES) {
        const value = draft.roles[role.key]
        const filled = value.provider !== "" && value.model.trim() !== ""
        payload[role.key] = filled
          ? { provider: value.provider, model: value.model.trim() }
          : null
      }
      payload.subagent_models = Object.fromEntries(
        Object.entries(draft.subagentModels).map(([subagent, value]) => [
          subagent,
          { provider: value.provider, model: value.model.trim() },
        ]),
      )

      // Bamboo rewrites model_limits.json on every config write, so carry the
      // current value to avoid deleting an unrelated authoritative sidecar.
      const current = await apiClient.get<{ model_limits?: unknown }>("/bamboo/config")
      await apiClient.post("/bamboo/config", {
        defaults: payload,
        // Bamboo still needs this compatibility route internally. The Chat
        // model preference is the sole user choice, so keep both values atomic.
        default_provider_instance: draft.roles.chat.provider,
        ...(current?.model_limits !== undefined ? { model_limits: current.model_limits } : {}),
      })

      const refreshed = await loadProviderInstances()
      const confirmed = draftFromDefaults(refreshed.defaults)
      setDraft(confirmed)
      setBaseline(serializeDraft(confirmed))
      dirtyRef.current = false

      const remainingIssues = findProviderSnapshotRelationIssues(refreshed)
      if (remainingIssues.length > 0) {
        setError(
          `偏好已保存，但仍有 ${remainingIssues.length} 处失效引用；请完成其余替换后再使用聊天。`,
        )
      } else {
        setSaved(true)
        setTimeout(() => setSaved(false), 2500)
      }
    } catch (caught) {
      setError(getErrorMessage(caught))
    } finally {
      savingRef.current = false
      setSaving(false)
    }
  }

  const providerOptions = (current: string) => {
    const known = instances.some((instance) => instance.id === current)
    return (
      <>
        {current && !known ? (
          <SelectItem value={current} disabled>
            {current}(已失效，请替换)
          </SelectItem>
        ) : null}
        {instances.map((instance) => (
          <SelectItem key={instance.id} value={instance.id} disabled={!instance.enabled}>
            {instance.label || instance.type}
            {!instance.enabled ? "（已停用）" : ""}
          </SelectItem>
        ))}
      </>
    )
  }

  if (!canManage) {
    const message =
      providerStatus === "incompatible"
        ? "当前 Bamboo 的提供方配置格式与 Lotus Next 不兼容。"
        : providerStatus === "unavailable"
          ? "提供方设置当前不可用。"
          : "正在加载提供方设置…"
    return (
      <section className="rounded-lg border p-3">
        <p
          role={
            providerStatus === "unavailable" || providerStatus === "incompatible"
              ? "alert"
              : undefined
          }
          className="text-xs text-muted-foreground"
        >
          {message}
          {providerError ? ` ${providerError}` : ""}
        </p>
      </section>
    )
  }

  return (
    <section className="rounded-lg border p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">默认模型偏好</div>
      <p className="mb-2 text-xs text-muted-foreground">
        按用途指定模型；未设置的用途回落到「对话」模型。模型 ID 可从发现结果选择，也可手动输入。
      </p>

      {hasCompatibilityRouteIssue(repairIssues) || compatibilitySyncRequired ? (
        <p role="alert" className="mb-2 rounded-md border border-amber-500/50 p-2 text-xs text-amber-700 dark:text-amber-300">
          当前提供方路由尚未与「对话」模型偏好同步。确认「对话」提供方和模型后保存偏好，Lotus Next 会自动完成同步。
        </p>
      ) : null}

      <div className="space-y-2">
        {ROLES.map((role) => {
          const value = draft.roles[role.key]
          const models = value.provider && catalog ? getModelsForProvider(value.provider) : []
          const invalid = hasRoleIssue(repairIssues, role.key)
          return (
            <div
              key={role.key}
              className={cn(
                "grid grid-cols-[5.5rem_1fr_1fr] items-center gap-2 rounded-md",
                invalid && "border border-amber-500/50 bg-amber-500/5 p-1",
              )}
            >
              <span className="truncate text-xs text-muted-foreground">{role.label}</span>
              <Select
                value={value.provider || UNSET}
                onValueChange={(provider) => {
                  if (provider === UNSET) {
                    setRole(role.key, emptyRef())
                    return
                  }
                  setRole(role.key, {
                    provider,
                    model: provider === value.provider ? value.model : "",
                  })
                }}
              >
                <SelectTrigger className="w-full" aria-label={`${role.label}提供方`}>
                  <SelectValue placeholder="提供方" />
                </SelectTrigger>
                <SelectContent>
                  {!role.required && !invalid ? <SelectItem value={UNSET}>未设置</SelectItem> : null}
                  {providerOptions(value.provider)}
                </SelectContent>
              </Select>
              <EditableModelCombobox
                label={`${role.label}模型`}
                hideLabel
                value={value.model}
                models={models}
                placeholder="模型 ID"
                disabled={!value.provider}
                onChange={(model) => setRole(role.key, { model })}
              />
            </div>
          )
        })}
      </div>

      {Object.keys(draft.subagentModels).length > 0 ? (
        <div className="mt-3 space-y-2">
          <div className="text-xs font-medium text-muted-foreground">子代理模型映射</div>
          {Object.entries(draft.subagentModels).map(([subagent, value]) => {
            const models = value.provider && catalog ? getModelsForProvider(value.provider) : []
            const invalid = hasSubagentIssue(repairIssues, subagent)
            return (
              <div
                key={subagent}
                className={cn(
                  "grid grid-cols-[5.5rem_1fr_1fr] items-center gap-2 rounded-md",
                  invalid && "border border-amber-500/50 bg-amber-500/5 p-1",
                )}
              >
                <span className="truncate text-xs text-muted-foreground" title={subagent}>
                  {subagent}
                </span>
                <Select
                  value={value.provider}
                  onValueChange={(provider) =>
                    setSubagent(subagent, {
                      provider,
                      model: provider === value.provider ? value.model : "",
                    })
                  }
                >
                  <SelectTrigger className="w-full" aria-label={`子代理 ${subagent} 提供方`}>
                    <SelectValue placeholder="提供方" />
                  </SelectTrigger>
                  <SelectContent>{providerOptions(value.provider)}</SelectContent>
                </Select>
                <EditableModelCombobox
                  label={`子代理 ${subagent} 模型`}
                  hideLabel
                  value={value.model}
                  models={models}
                  placeholder="模型 ID"
                  disabled={!value.provider}
                  onChange={(model) => setSubagent(subagent, { model })}
                />
              </div>
            )
          })}
        </div>
      ) : null}

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

      <div className="mt-2.5 flex items-center justify-end gap-2">
        {saved ? <span className="text-xs text-emerald-500">已保存</span> : null}
        <Button
          size="sm"
          onClick={() => void save()}
          disabled={saving || (!dirty && !compatibilitySyncRequired)}
        >
          {saving ? "保存中…" : "保存偏好"}
        </Button>
      </div>
    </section>
  )
}
