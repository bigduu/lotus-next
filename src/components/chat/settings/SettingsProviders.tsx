import { useEffect, useState } from "react"
import { Trash2, Plus, Check, Pencil } from "lucide-react"
import { settingsService, type DeviceCodeInfo } from "@services/config/SettingsService"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import type { ProviderInstance, ProviderType } from "@shared/types/providerConfig"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

const PROVIDER_TYPES: ProviderType[] = ["anthropic", "openai", "gemini", "copilot", "bodhi"]
const input =
  "w-full rounded-md border bg-background px-2.5 py-1.5 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"

type Cfg = Record<string, unknown>
const str = (v: unknown) => (typeof v === "string" ? v : v == null ? "" : String(v))

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
      <input className={input} type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

function CopilotAuth() {
  const [authed, setAuthed] = useState<boolean | null>(null)
  const [device, setDevice] = useState<DeviceCodeInfo | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    settingsService
      .getCopilotAuthStatus()
      .then((s) => setAuthed(s.authenticated))
      .catch(() => setAuthed(false))
  }, [])

  const login = async () => {
    setBusy(true)
    try {
      const d = await settingsService.startCopilotAuth()
      setDevice(d)
      try {
        window.open(d.verification_uri, "_blank", "noopener")
      } catch {
        /* popup blocked — user can click the link */
      }
      await settingsService.completeCopilotAuth({
        device_code: d.device_code,
        interval: d.interval ?? 5,
        expires_in: d.expires_in,
      })
      const s = await settingsService.getCopilotAuthStatus()
      setAuthed(s.authenticated)
      setDevice(null)
    } catch {
      setDevice(null)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2.5">
      <div className="text-xs font-medium text-muted-foreground">Copilot 授权</div>
      {authed ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-emerald-500">✓ 已登录</span>
          <Button
            size="sm"
            variant="secondary"
            onClick={async () => {
              await settingsService.logoutCopilot().catch(() => {})
              setAuthed(false)
            }}
          >
            退出
          </Button>
        </div>
      ) : device ? (
        <div className="space-y-1 text-sm">
          <p>
            打开{" "}
            <a href={device.verification_uri} target="_blank" rel="noopener noreferrer" className="text-primary underline">
              {device.verification_uri}
            </a>
          </p>
          <p>
            输入代码:<span className="font-mono text-base font-semibold tracking-wider">{device.user_code}</span>
          </p>
          <p className="text-xs text-muted-foreground">授权后这里会自动完成…</p>
        </div>
      ) : (
        <Button size="sm" onClick={login} disabled={busy}>
          {busy ? "登录中…" : "登录 GitHub Copilot"}
        </Button>
      )}
    </div>
  )
}

function InstanceEditor({
  initial,
  onSave,
  onCancel,
}: {
  initial: { type: ProviderType; label: string; config: Cfg }
  onSave: (v: { type: ProviderType; label: string; config: Cfg }) => void
  onCancel: () => void
}) {
  const [type, setType] = useState<ProviderType>(initial.type)
  const [label, setLabel] = useState(initial.label)
  const [cfg, setCfg] = useState<Cfg>(initial.config)
  const set = (k: string, v: string) => setCfg((c) => ({ ...c, [k]: v }))

  return (
    <div className="space-y-2.5 rounded-lg border bg-muted/30 p-3">
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">类型</span>
        <select className={input} value={type} onChange={(e) => setType(e.target.value as ProviderType)}>
          {PROVIDER_TYPES.map((t) => (
            <option key={t} value={t} className="bg-card">
              {t}
            </option>
          ))}
        </select>
      </label>
      <Field label="名称" value={label} onChange={setLabel} placeholder="如 我的 Anthropic" />
      {type === "copilot" ? (
        <CopilotAuth />
      ) : (
        <>
          <Field label="API Key" value={str(cfg.api_key)} onChange={(v) => set("api_key", v)} type="password" placeholder="sk-…" />
          <Field label="Base URL(可选)" value={str(cfg.base_url)} onChange={(v) => set("base_url", v)} placeholder="https://api.anthropic.com" />
        </>
      )}
      <Field label="默认模型(可选)" value={str(cfg.model)} onChange={(v) => set("model", v)} placeholder="glm-5.2" />
      <div className="grid grid-cols-2 gap-2">
        <Field label="Max tokens" value={str(cfg.max_tokens)} onChange={(v) => set("max_tokens", v)} placeholder="8000" />
        <label className="block">
          <span className="mb-1 block text-xs text-muted-foreground">推理强度</span>
          <select className={input} value={str(cfg.reasoning_effort) || "medium"} onChange={(e) => set("reasoning_effort", e.target.value)}>
            {["low", "medium", "high", "xhigh", "max"].map((r) => (
              <option key={r} value={r} className="bg-card">
                {r}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="flex justify-end gap-2 pt-1">
        <Button size="sm" variant="secondary" onClick={onCancel}>
          取消
        </Button>
        <Button size="sm" onClick={() => onSave({ type, label: label.trim() || type, config: cfg })}>
          保存
        </Button>
      </div>
    </div>
  )
}

export function SettingsProviders() {
  const instances = useProviderStore((s) => s.providerInstances)
  const defaultId = useProviderStore((s) => s.defaultProviderInstanceId)
  const loadInstances = useProviderStore((s) => s.loadProviderInstances)
  const [editing, setEditing] = useState<string | null>(null)
  const [adding, setAdding] = useState(false)

  useEffect(() => {
    void loadInstances()
  }, [loadInstances])

  const reload = () => void loadInstances()

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

      {adding ? (
        <InstanceEditor
          initial={{ type: "anthropic", label: "", config: { reasoning_effort: "medium" } }}
          onCancel={() => setAdding(false)}
          onSave={async (v) => {
            await settingsService
              .createProviderInstance({ type: v.type, label: v.label, enabled: true, config: v.config })
              .catch(() => {})
            setAdding(false)
            reload()
          }}
        />
      ) : null}

      <ul className="space-y-2">
        {instances.map((inst: ProviderInstance) => (
          <li key={inst.id} className="rounded-lg border p-3">
            {editing === inst.id ? (
              <InstanceEditor
                initial={{ type: inst.type, label: inst.label, config: (inst.config as Cfg) ?? {} }}
                onCancel={() => setEditing(null)}
                onSave={async (v) => {
                  await settingsService
                    .updateProviderInstance(inst.id, { label: v.label, config: v.config })
                    .catch(() => {})
                  setEditing(null)
                  reload()
                }}
              />
            ) : (
              <div className="flex items-center gap-2">
                <button
                  onClick={async () => {
                    await settingsService.setDefaultProviderInstance(inst.id).catch(() => {})
                    reload()
                  }}
                  aria-label="设为默认"
                  className={cn(
                    "flex size-5 shrink-0 items-center justify-center rounded-full border",
                    inst.id === defaultId ? "border-primary bg-primary text-primary-foreground" : "text-transparent hover:border-primary",
                  )}
                >
                  <Check className="size-3" />
                </button>
                <div className="min-w-0 flex-1">
                  <div className="truncate text-sm font-medium">{inst.label || inst.type}</div>
                  <div className="text-xs text-muted-foreground">
                    {inst.type}
                    {inst.id === defaultId ? " · 默认" : ""}
                  </div>
                </div>
                <button onClick={() => setEditing(inst.id)} aria-label="编辑" className="shrink-0 rounded p-1 text-muted-foreground hover:text-foreground">
                  <Pencil className="size-3.5" />
                </button>
                <button
                  onClick={async () => {
                    await settingsService.deleteProviderInstance(inst.id).catch(() => {})
                    reload()
                  }}
                  aria-label="删除"
                  className="shrink-0 rounded p-1 text-muted-foreground hover:text-destructive"
                >
                  <Trash2 className="size-3.5" />
                </button>
              </div>
            )}
          </li>
        ))}
      </ul>
    </div>
  )
}
