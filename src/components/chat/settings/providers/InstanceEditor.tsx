import { useState } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import type { ProviderInstance, ProviderType } from "@shared/types/providerConfig"
import { PROVIDER_LABELS } from "@shared/types/providerConfig"
import { getErrorMessage } from "@services/api"
import { isMaskedSecret } from "@/lib/secrets"
import { VENDOR_PRESETS } from "@/lib/providerPresets"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { CopilotAuth } from "./CopilotAuth"

const PROVIDER_TYPES: ProviderType[] = ["anthropic", "openai", "gemini", "copilot", "bodhi"]
const REASONING_EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const
const UNSET = "__unset__"

const API_KEY_PLACEHOLDER: Record<ProviderType, string> = {
  anthropic: "sk-ant-…",
  openai: "sk-…",
  gemini: "AIza…",
  copilot: "",
  bodhi: "bhi_sk_…",
}

export interface InstanceSavePayload {
  type: ProviderType
  label: string
  enabled: boolean
  config: Record<string, unknown>
}

interface Draft {
  type: ProviderType
  label: string
  enabled: boolean
  apiKey: string
  baseUrl: string
  model: string
  reasoningEffort: string
  responsesOnlyModels: string
  headlessAuth: boolean
  targetProvider: string
  requestOverridesJson: string
}

const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v))

function draftFromInstance(inst: ProviderInstance | null): Draft {
  const cfg = (inst?.config ?? {}) as Record<string, unknown>
  return {
    type: inst?.type ?? "anthropic",
    label: inst?.label ?? "",
    enabled: inst?.enabled ?? true,
    apiKey: isMaskedSecret(cfg.api_key) ? "" : str(cfg.api_key),
    baseUrl: str(cfg.base_url),
    model: str(cfg.model),
    reasoningEffort: str(cfg.reasoning_effort),
    responsesOnlyModels: Array.isArray(cfg.responses_only_models)
      ? (cfg.responses_only_models as unknown[]).map(str).filter(Boolean).join("\n")
      : "",
    headlessAuth: cfg.headless_auth === true,
    targetProvider: str(cfg.target_provider),
    requestOverridesJson:
      cfg.request_overrides != null ? JSON.stringify(cfg.request_overrides, null, 2) : "",
  }
}

/**
 * Build the config payload from the draft.
 *
 * Edit mode sends explicit `null` for cleared optional fields — the backend
 * PUT deep-merges the patch onto the existing instance, so omitting a key
 * would keep the old value instead of clearing it.
 */
function buildPayload(
  draft: Draft,
  isEdit: boolean,
  hasStoredApiKey: boolean,
): { payload: InstanceSavePayload } | { error: string } {
  const type = draft.type
  const config: Record<string, unknown> = {}

  const setOrClear = (key: string, value: unknown, hasValue: boolean) => {
    if (hasValue) config[key] = value
    else if (isEdit) config[key] = null
  }

  if (type !== "copilot") {
    const apiKey = draft.apiKey.trim()
    if (apiKey) {
      config.api_key = apiKey
    } else if (!(isEdit && hasStoredApiKey)) {
      return { error: "API Key 不能为空" }
    }
    // Empty while editing a configured instance: omit api_key = keep stored key.
    setOrClear("base_url", draft.baseUrl.trim(), draft.baseUrl.trim() !== "")
  }

  setOrClear("model", draft.model.trim(), draft.model.trim() !== "")
  setOrClear("reasoning_effort", draft.reasoningEffort, draft.reasoningEffort !== "")

  // NOTE: no max_tokens field here on purpose — the backend instance→provider
  // projection hardcodes it to None (bamboo provider_registry.rs), so an
  // instance-level max_tokens would be accepted but silently inert.

  if (type === "openai" || type === "copilot") {
    const models = draft.responsesOnlyModels
      .split(/[\s,]+/)
      .map((m) => m.trim())
      .filter(Boolean)
    if (models.length > 0 || isEdit) config.responses_only_models = models
  }

  if (type === "copilot") {
    config.headless_auth = draft.headlessAuth
  }

  if (type === "bodhi") {
    setOrClear("target_provider", draft.targetProvider, draft.targetProvider !== "")
  }

  const overridesRaw = draft.requestOverridesJson.trim()
  if (overridesRaw) {
    try {
      config.request_overrides = JSON.parse(overridesRaw)
    } catch (e) {
      return { error: `request_overrides JSON 解析失败:${(e as Error).message}` }
    }
  } else if (isEdit) {
    config.request_overrides = null
  }

  return {
    payload: {
      type,
      label: draft.label.trim() || PROVIDER_LABELS[type] || type,
      enabled: draft.enabled,
      config,
    },
  }
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
}: {
  label: string
  value: string
  onChange: (v: string) => void
  type?: string
  placeholder?: string
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <Input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/**
 * Create / edit form for a provider instance.
 *
 * The provider type is locked on existing instances — the backend PUT strips
 * `provider_type` from config patches, so editing it would be silently dropped.
 */
export function InstanceEditor({
  instance,
  onSave,
  onCancel,
}: {
  /** null = create mode */
  instance: ProviderInstance | null
  /** Should throw on failure — the error is surfaced inline. */
  onSave: (payload: InstanceSavePayload) => Promise<void>
  onCancel: () => void
}) {
  const isEdit = instance != null
  const hasStoredApiKey = isMaskedSecret(
    ((instance?.config ?? {}) as Record<string, unknown>).api_key,
  )
  const [draft, setDraft] = useState<Draft>(() => draftFromInstance(instance))
  const [showAdvanced, setShowAdvanced] = useState(() => {
    const d = draftFromInstance(instance)
    return d.requestOverridesJson !== "" || d.responsesOnlyModels !== ""
  })
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Purely a form-filling helper — the selection itself is never persisted.
  const [presetId, setPresetId] = useState("")

  const patch = (p: Partial<Draft>) => setDraft((d) => ({ ...d, ...p }))
  const type = draft.type
  const preset = VENDOR_PRESETS.find((p) => p.id === presetId) ?? null

  const applyPreset = (id: string) => {
    if (id === UNSET) {
      setPresetId("")
      return
    }
    const p = VENDOR_PRESETS.find((x) => x.id === id)
    if (!p) return
    setPresetId(id)
    setDraft((d) => ({
      ...d,
      // Type is immutable on existing instances; mismatched presets are
      // disabled in edit mode so this never flips a locked type.
      type: p.provider_type,
      baseUrl: p.base_url,
      label: d.label.trim() === "" ? p.label : d.label,
    }))
  }

  const submit = async () => {
    const result = buildPayload(draft, isEdit, hasStoredApiKey)
    if ("error" in result) {
      setError(result.error)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(result.payload)
    } catch (e) {
      setError(getErrorMessage(e))
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">
          厂商预设(可选,仅快速填充表单,不会保存)
        </span>
        <Select value={presetId || UNSET} onValueChange={applyPreset}>
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value={UNSET}>不使用预设</SelectItem>
            {VENDOR_PRESETS.map((p) => (
              <SelectItem
                key={p.id}
                value={p.id}
                disabled={isEdit && p.provider_type !== type}
              >
                {p.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        {preset?.note ? (
          <span className="mt-1 block text-xs text-muted-foreground">{preset.note}</span>
        ) : null}
      </label>

      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">
          类型{isEdit ? "(创建后不可修改)" : ""}
        </span>
        <Select
          value={type}
          onValueChange={(v) => {
            // A preset implies a type — manual type edits detach the preset.
            setPresetId("")
            patch({ type: v as ProviderType })
          }}
          disabled={isEdit}
        >
          <SelectTrigger className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {PROVIDER_TYPES.map((t) => (
              <SelectItem key={t} value={t}>
                {PROVIDER_LABELS[t] ?? t}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </label>

      <Field label="名称" value={draft.label} onChange={(v) => patch({ label: v })} placeholder={`如 我的 ${PROVIDER_LABELS[type]}`} />

      <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-2">
        <span className="text-sm">启用该实例</span>
        <Switch checked={draft.enabled} onCheckedChange={(v) => patch({ enabled: v })} />
      </div>

      {type === "copilot" ? (
        <CopilotAuth />
      ) : (
        <>
          <Field
            label="API Key"
            value={draft.apiKey}
            onChange={(v) => patch({ apiKey: v })}
            type="password"
            placeholder={hasStoredApiKey ? "已配置，留空保持不变" : API_KEY_PLACEHOLDER[type]}
          />
          <Field
            label="Base URL(可选)"
            value={draft.baseUrl}
            onChange={(v) => patch({ baseUrl: v })}
            placeholder={
              type === "anthropic"
                ? "https://api.anthropic.com"
                : type === "openai"
                  ? "https://api.openai.com/v1"
                  : type === "gemini"
                    ? "https://generativelanguage.googleapis.com/v1beta"
                    : "http://localhost:8080"
            }
          />
        </>
      )}

      {type === "bodhi" ? (
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">目标上游(可选)</span>
          <Select
            value={draft.targetProvider || UNSET}
            onValueChange={(v) => patch({ targetProvider: v === UNSET ? "" : v })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>未设置</SelectItem>
              <SelectItem value="openai">OpenAI</SelectItem>
              <SelectItem value="anthropic">Anthropic</SelectItem>
              <SelectItem value="gemini">Gemini</SelectItem>
            </SelectContent>
          </Select>
        </label>
      ) : null}

      {type === "copilot" ? (
        <div className="flex items-center justify-between rounded-md border bg-background px-2.5 py-2">
          <div>
            <div className="text-sm">Headless 授权</div>
            <div className="text-xs text-muted-foreground">在控制台打印登录链接,不自动打开浏览器</div>
          </div>
          <Switch checked={draft.headlessAuth} onCheckedChange={(v) => patch({ headlessAuth: v })} />
        </div>
      ) : null}

      <Field
        label="默认模型(可选)"
        value={draft.model}
        onChange={(v) => patch({ model: v })}
        placeholder={preset ? preset.suggested_models.join(", ") : "glm-5.2"}
      />

      <div>
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">推理强度(可选)</span>
          <Select
            value={draft.reasoningEffort || UNSET}
            onValueChange={(v) => patch({ reasoningEffort: v === UNSET ? "" : v })}
          >
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={UNSET}>默认(不指定)</SelectItem>
              {REASONING_EFFORTS.map((r) => (
                <SelectItem key={r} value={r}>
                  {r}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </label>
      </div>

      <button
        type="button"
        onClick={() => setShowAdvanced((v) => !v)}
        className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground"
      >
        {showAdvanced ? <ChevronDown className="size-3.5" /> : <ChevronRight className="size-3.5" />}
        高级设置
      </button>

      {showAdvanced ? (
        <div className="space-y-2.5">
          {type === "openai" || type === "copilot" ? (
            <label className="block">
              <span className="mb-1 block text-xs text-muted-foreground">
                Responses-only 模型(可选,空格/逗号/换行分隔,支持尾部通配 gpt-5*)
              </span>
              <Textarea
                className="min-h-14 resize-y font-mono text-xs"
                value={draft.responsesOnlyModels}
                placeholder={"gpt-5.3-codex\ngpt-5*"}
                onChange={(e) => patch({ responsesOnlyModels: e.target.value })}
              />
            </label>
          ) : null}
          <label className="block">
            <span className="mb-1 block text-xs text-muted-foreground">
              请求覆写 request_overrides(可选,JSON)
            </span>
            <Textarea
              className="min-h-20 resize-y font-mono text-xs"
              value={draft.requestOverridesJson}
              placeholder='{"common":{"headers":{"X-Custom":"value"}}}'
              onChange={(e) => patch({ requestOverridesJson: e.target.value })}
            />
          </label>
        </div>
      ) : null}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}

      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="secondary" onClick={onCancel} disabled={saving}>
          取消
        </Button>
        <Button size="sm" onClick={() => void submit()} disabled={saving}>
          {saving ? "保存中…" : "保存"}
        </Button>
      </div>
    </div>
  )
}
