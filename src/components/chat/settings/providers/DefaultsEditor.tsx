import { useEffect, useMemo, useRef, useState } from "react"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import type { DefaultsConfig } from "@shared/types/providerConfig"
import type { ProviderModelRef } from "@shared/types/providerModelRef"
import { apiClient, getErrorMessage } from "@services/api"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

const UNSET = "__unset__"

const ROLES = [
  { key: "chat", label: "对话(必填)", required: true },
  { key: "fast", label: "快速", required: false },
  { key: "task_summary", label: "任务摘要", required: false },
  { key: "vision", label: "视觉", required: false },
  { key: "memory_background", label: "记忆后台", required: false },
  { key: "sub_agent", label: "子代理", required: false },
] as const

type RoleKey = (typeof ROLES)[number]["key"]

type DraftRefs = Record<RoleKey, { provider: string; model: string }>

function draftFromDefaults(defaults: DefaultsConfig | undefined, fallbackProvider: string): DraftRefs {
  const pick = (ref?: ProviderModelRef) => ({
    provider: ref?.provider ?? "",
    model: ref?.model ?? "",
  })
  const d: DraftRefs = {
    chat: pick(defaults?.chat),
    fast: pick(defaults?.fast),
    task_summary: pick(defaults?.task_summary),
    vision: pick(defaults?.vision),
    memory_background: pick(defaults?.memory_background),
    sub_agent: pick(defaults?.sub_agent),
  }
  if (!d.chat.provider && fallbackProvider) d.chat.provider = fallbackProvider
  return d
}

/**
 * defaults.* model-preference editor.
 *
 * Persists via `POST /bamboo/config` (deep-merge config patch) — the same
 * instance-mode save path lotus uses — then reloads the provider store so the
 * General-tab default model reflects the persisted value.
 */
export function DefaultsEditor() {
  const instances = useProviderStore((s) => s.providerInstances)
  const defaultId = useProviderStore((s) => s.defaultProviderInstanceId)
  const defaults = useProviderStore((s) => s.providerConfig.defaults)
  const loadProviderInstances = useProviderStore((s) => s.loadProviderInstances)
  const loadCatalog = useProviderStore((s) => s.loadCatalog)
  const getModelsForProvider = useProviderStore((s) => s.getModelsForProvider)
  const catalog = useProviderStore((s) => s.catalog)

  const [draft, setDraft] = useState<DraftRefs>(() => draftFromDefaults(defaults, defaultId ?? ""))
  const [baseline, setBaseline] = useState(() => JSON.stringify(draftFromDefaults(defaults, defaultId ?? "")))
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)

  const dirty = useMemo(() => JSON.stringify(draft) !== baseline, [draft, baseline])
  const dirtyRef = useRef(dirty)
  dirtyRef.current = dirty

  // Re-sync when the store (re)loads — but never clobber in-progress edits.
  useEffect(() => {
    if (dirtyRef.current) return
    const next = draftFromDefaults(defaults, defaultId ?? "")
    setDraft(next)
    setBaseline(JSON.stringify(next))
  }, [defaults, defaultId])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  const setRole = (role: RoleKey, patch: Partial<{ provider: string; model: string }>) =>
    setDraft((d) => ({ ...d, [role]: { ...d[role], ...patch } }))

  const save = async () => {
    if (!draft.chat.provider || !draft.chat.model.trim()) {
      setError("对话(chat)默认模型必须选择提供方并填写模型")
      return
    }
    for (const role of ROLES) {
      const v = draft[role.key]
      if (!role.required && v.provider && !v.model.trim()) {
        setError(`「${role.label}」已选择提供方但未填写模型`)
        return
      }
    }
    setSaving(true)
    setError(null)
    setSaved(false)
    try {
      // Cleared optional roles are sent as explicit null — the backend patch
      // deep-merges, so omitting a key would keep the stored value.
      const payload: Record<string, unknown> = {}
      const normalized = { ...draft }
      for (const role of ROLES) {
        const v = draft[role.key]
        const filled = v.provider !== "" && v.model.trim() !== ""
        payload[role.key] = filled ? { provider: v.provider, model: v.model.trim() } : null
        normalized[role.key] = filled ? { provider: v.provider, model: v.model.trim() } : { provider: "", model: "" }
      }
      // BACKEND GOTCHA (bamboo set.rs): every POST /bamboo/config rewrites
      // model_limits.json from the patch — a patch WITHOUT the key DELETES
      // the file. Fetch the current value and carry it along.
      const current = await apiClient.get<{ model_limits?: unknown }>("/bamboo/config")
      await apiClient.post("/bamboo/config", {
        defaults: payload,
        ...(current?.model_limits !== undefined ? { model_limits: current.model_limits } : {}),
      })
      // Settle local state on the exact values we sent, then let the store
      // reload confirm (the resync effect only applies when not dirty).
      setDraft(normalized)
      setBaseline(JSON.stringify(normalized))
      dirtyRef.current = false
      await loadProviderInstances()
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setError(getErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const providerOptions = (current: string) => {
    const known = instances.some((i) => i.id === current)
    return (
      <>
        {current && !known ? <SelectItem value={current}>{current}(已删除)</SelectItem> : null}
        {instances.map((i) => (
          <SelectItem key={i.id} value={i.id}>
            {i.label || i.type}
            {i.id === defaultId ? " · 默认" : ""}
          </SelectItem>
        ))}
      </>
    )
  }

  return (
    <section className="rounded-lg border p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">默认模型偏好</div>
      <p className="mb-2 text-xs text-muted-foreground">
        按用途指定模型;未设置的用途回落到「对话」模型。
      </p>
      <div className="space-y-2">
        {ROLES.map((role) => {
          const v = draft[role.key]
          const models = v.provider && catalog ? getModelsForProvider(v.provider) : []
          const listId = `defaults-models-${role.key}`
          return (
            <div key={role.key} className="grid grid-cols-[5.5rem_1fr_1fr] items-center gap-2">
              <span className="truncate text-xs text-muted-foreground">{role.label}</span>
              <Select
                value={v.provider || UNSET}
                onValueChange={(val) =>
                  setRole(role.key, val === UNSET ? { provider: "", model: "" } : { provider: val })
                }
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="提供方" />
                </SelectTrigger>
                <SelectContent>
                  {role.required ? null : <SelectItem value={UNSET}>未设置</SelectItem>}
                  {providerOptions(v.provider)}
                </SelectContent>
              </Select>
              <div>
                <Input
                  value={v.model}
                  placeholder="模型名"
                  list={models.length > 0 ? listId : undefined}
                  disabled={!v.provider}
                  onChange={(e) => setRole(role.key, { model: e.target.value })}
                />
                {models.length > 0 ? (
                  <datalist id={listId}>
                    {models.map((m) => (
                      <option key={m.reference.model} value={m.reference.model} />
                    ))}
                  </datalist>
                ) : null}
              </div>
            </div>
          )
        })}
      </div>

      {error ? <p className="mt-2 text-xs text-destructive">{error}</p> : null}

      <div className="mt-2.5 flex items-center justify-end gap-2">
        {saved ? <span className="text-xs text-emerald-500">已保存</span> : null}
        <Button size="sm" onClick={() => void save()} disabled={saving || !dirty}>
          {saving ? "保存中…" : "保存偏好"}
        </Button>
      </div>
    </section>
  )
}
