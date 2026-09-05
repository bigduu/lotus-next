import { useEffect, useRef, useState } from "react"
import {
  getNotificationChannelsConfig,
  getNotificationConfigErrorCode,
  getSafeNotificationErrorMessage,
  putNotificationChannelsConfig,
  testNotificationChannels,
  type CredentialChange,
  type NotificationConfigEnvelope,
  type NotificationCredentialStatus,
  type NotificationMutationData,
} from "@services/notification/notificationChannelsApi.ts"
import { isMaskedSecret } from "@/lib/secrets.ts"
import { Button } from "@/components/ui/button.tsx"
import { Input } from "@/components/ui/input.tsx"
import { Switch } from "@/components/ui/switch.tsx"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select.tsx"

type DesktopMode = "auto" | "on" | "off"
type CredentialIntent = CredentialChange["action"]

interface ChannelsDraft {
  desktopMode: DesktopMode
  ntfyEnabled: boolean
  ntfyBaseUrl: string
  ntfyTopic: string
  ntfyToken: string
  ntfyCredentialIntent: CredentialIntent
  barkEnabled: boolean
  barkBaseUrl: string
  barkDeviceKey: string
  barkCredentialIntent: CredentialIntent
}

interface ConflictState {
  latest: NotificationConfigEnvelope | null
  refreshing: boolean
  refreshError: string | null
}

const DEFAULT_NTFY_BASE_URL = "https://ntfy.sh"
const DEFAULT_BARK_BASE_URL = "https://api.day.app"

const draftFromSnapshot = (snapshot: NotificationConfigEnvelope): ChannelsDraft => ({
  desktopMode:
    snapshot.data.desktop.enabled === true
      ? "on"
      : snapshot.data.desktop.enabled === false
        ? "off"
        : "auto",
  ntfyEnabled: snapshot.data.ntfy.enabled,
  ntfyBaseUrl: snapshot.data.ntfy.baseUrl,
  ntfyTopic: snapshot.data.ntfy.topic,
  ntfyToken: "",
  ntfyCredentialIntent: "keep",
  barkEnabled: snapshot.data.bark.enabled,
  barkBaseUrl: snapshot.data.bark.baseUrl,
  barkDeviceKey: "",
  barkCredentialIntent: "keep",
})

const initialDraft = (): ChannelsDraft => ({
  desktopMode: "auto",
  ntfyEnabled: false,
  ntfyBaseUrl: DEFAULT_NTFY_BASE_URL,
  ntfyTopic: "",
  ntfyToken: "",
  ntfyCredentialIntent: "keep",
  barkEnabled: false,
  barkBaseUrl: DEFAULT_BARK_BASE_URL,
  barkDeviceKey: "",
  barkCredentialIntent: "keep",
})

class DraftValidationError extends Error {}

const requiredBaseUrl = (rawValue: string, label: string): string => {
  if (!rawValue.trim()) throw new DraftValidationError(`${label} 不能为空。`)
  if (rawValue.trim() !== rawValue) {
    throw new DraftValidationError(`${label} 不能包含首尾空格。`)
  }
  return rawValue
}

const credentialChange = (
  intent: CredentialIntent,
  rawValue: string,
  status: NotificationCredentialStatus,
  label: string,
): CredentialChange => {
  const value = rawValue.trim()
  if (intent === "clear") return { action: "clear" }
  if (intent === "replace") {
    if (!value) throw new DraftValidationError(`${label} 不能为空。`)
    if (isMaskedSecret(value)) throw new DraftValidationError(`${label} 不能使用凭据掩码。`)
    return { action: "replace", value }
  }
  if (value) throw new DraftValidationError(`${label} 的凭据意图不明确。`)
  if (status.state === "error") {
    throw new DraftValidationError(`${label} 状态异常，请输入新凭据或明确清除。`)
  }
  return { action: "keep" }
}

const mutationFromDraft = (
  draft: ChannelsDraft,
  snapshot: NotificationConfigEnvelope,
): NotificationMutationData => ({
  desktop: {
    enabled: draft.desktopMode === "auto" ? null : draft.desktopMode === "on",
  },
  ntfy: {
    enabled: draft.ntfyEnabled,
    base_url: requiredBaseUrl(draft.ntfyBaseUrl, "ntfy Base URL"),
    topic: draft.ntfyTopic.trim(),
    credential_change: credentialChange(
      draft.ntfyCredentialIntent,
      draft.ntfyToken,
      snapshot.data.ntfy.credential,
      "ntfy Token",
    ),
  },
  bark: {
    enabled: draft.barkEnabled,
    base_url: requiredBaseUrl(draft.barkBaseUrl, "Bark Base URL"),
    credential_change: credentialChange(
      draft.barkCredentialIntent,
      draft.barkDeviceKey,
      snapshot.data.bark.credential,
      "Bark Device Key",
    ),
  },
})

const credentialDescription = (credential: NotificationCredentialStatus): string => {
  switch (credential.state) {
    case "configured":
      return "已安全配置"
    case "from_env":
      return "由环境变量提供"
    case "error":
      return "凭据状态异常，保存前必须替换或清除"
    default:
      return "未配置"
  }
}

function Field({
  label,
  value,
  onChange,
  type = "text",
  placeholder,
  disabled = false,
}: {
  label: string
  value: string
  onChange: (value: string) => void
  type?: string
  placeholder?: string
  disabled?: boolean
}) {
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <Input
        type={type}
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        onChange={(event) => onChange(event.target.value)}
      />
    </label>
  )
}

export function ChannelsSection() {
  const [authority, setAuthority] = useState<NotificationConfigEnvelope | null>(null)
  const [draft, setDraft] = useState<ChannelsDraft>(initialDraft)
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [conflict, setConflict] = useState<ConflictState | null>(null)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const [attempted, setAttempted] = useState<string[] | null>(null)
  const mounted = useRef(false)
  const getGeneration = useRef(0)
  const conflictActionRef = useRef<HTMLButtonElement | null>(null)
  const savedTimer = useRef<number | null>(null)

  const installAuthority = (snapshot: NotificationConfigEnvelope) => {
    setAuthority(snapshot)
    setDraft(draftFromSnapshot(snapshot))
    setConflict(null)
    setSaveError(null)
  }

  const load = async () => {
    const generation = ++getGeneration.current
    setLoading(true)
    setLoadError(null)
    try {
      const snapshot = await getNotificationChannelsConfig()
      if (!mounted.current || generation !== getGeneration.current) return
      installAuthority(snapshot)
    } catch (error) {
      if (!mounted.current || generation !== getGeneration.current) return
      setLoadError(getSafeNotificationErrorMessage(error))
    } finally {
      if (mounted.current && generation === getGeneration.current) setLoading(false)
    }
  }

  useEffect(() => {
    mounted.current = true
    void load()
    return () => {
      mounted.current = false
      getGeneration.current += 1
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current)
    }
  }, [])

  useEffect(() => {
    if (!saving && conflict && !conflict.refreshing) conflictActionRef.current?.focus()
  }, [saving, conflict])

  const patch = (next: Partial<ChannelsDraft>) => {
    if (saving) return
    setDraft((current) => ({ ...current, ...next }))
    setSaved(false)
    setSaveError(null)
  }

  const refreshConflict = async () => {
    const generation = ++getGeneration.current
    setConflict({ latest: null, refreshing: true, refreshError: null })
    try {
      const latest = await getNotificationChannelsConfig()
      if (!mounted.current || generation !== getGeneration.current) return
      setConflict({ latest, refreshing: false, refreshError: null })
    } catch (error) {
      if (!mounted.current || generation !== getGeneration.current) return
      setConflict({
        latest: null,
        refreshing: false,
        refreshError: getSafeNotificationErrorMessage(error),
      })
    }
  }

  const save = async (snapshot: NotificationConfigEnvelope | null) => {
    if (!snapshot || saving) return
    const submittedCredentials = [draft.ntfyToken.trim(), draft.barkDeviceKey.trim()].filter(Boolean)
    let data: NotificationMutationData
    try {
      data = mutationFromDraft(draft, snapshot)
    } catch (error) {
      setSaveError(
        error instanceof DraftValidationError
          ? error.message
          : "通知渠道草稿无效，无法安全保存。",
      )
      return
    }

    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const savedSnapshot = await putNotificationChannelsConfig(snapshot, data)
      if (!mounted.current) return
      installAuthority(savedSnapshot)
      setSaved(true)
      if (savedTimer.current !== null) window.clearTimeout(savedTimer.current)
      savedTimer.current = window.setTimeout(() => {
        if (mounted.current) setSaved(false)
        savedTimer.current = null
      }, 2500)
    } catch (error) {
      if (!mounted.current) return
      if (getNotificationConfigErrorCode(error) === "config_revision_conflict") {
        await refreshConflict()
      } else {
        setSaveError(getSafeNotificationErrorMessage(error, submittedCredentials))
      }
    } finally {
      if (mounted.current) setSaving(false)
    }
  }

  const sendTest = async () => {
    setTesting(true)
    setTestError(null)
    setAttempted(null)
    try {
      const response = await testNotificationChannels()
      if (mounted.current) setAttempted(response.attempted)
    } catch (error) {
      if (mounted.current) setTestError(getSafeNotificationErrorMessage(error))
    } finally {
      if (mounted.current) setTesting(false)
    }
  }

  if (loading) {
    return (
      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">通知渠道</div>
        <p className="text-xs text-muted-foreground">加载中…</p>
      </section>
    )
  }

  if (loadError || !authority) {
    return (
      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">通知渠道</div>
        <div className="flex items-center justify-between gap-2" role="alert">
          <p className="text-xs text-destructive">{loadError ?? "通知渠道配置不可用。"}</p>
          <Button size="sm" variant="secondary" className="shrink-0" onClick={() => void load()}>
            重试
          </Button>
        </div>
      </section>
    )
  }

  const hasStoredNtfyToken = authority.data.ntfy.credential.configured
  const hasStoredBarkKey = authority.data.bark.credential.configured

  return (
    <section className="rounded-lg border p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">通知渠道</div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        配置后端如何投递通知(桌面通知、ntfy、Bark),保存后对所有设备生效。
      </p>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="text-sm font-medium">桌面通知</div>
          <Select
            value={draft.desktopMode}
            onValueChange={(value) => patch({ desktopMode: value as DesktopMode })}
            disabled={saving}
          >
            <SelectTrigger className="w-full" aria-label="桌面通知模式">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">自动(独立运行时开启,Bodhi 内嵌时关闭)</SelectItem>
              <SelectItem value="on">开启</SelectItem>
              <SelectItem value="off">关闭</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">ntfy</div>
              <div
                className={`text-xs ${authority.data.ntfy.credential.state === "error" ? "text-destructive" : "text-muted-foreground"}`}
                role={authority.data.ntfy.credential.state === "error" ? "alert" : undefined}
              >
                {credentialDescription(authority.data.ntfy.credential)}
              </div>
            </div>
            <Switch
              checked={draft.ntfyEnabled}
              onCheckedChange={(value) => patch({ ntfyEnabled: value })}
              aria-label="启用 ntfy"
              disabled={saving}
            />
          </div>
          <Field
            label="ntfy Base URL"
            value={draft.ntfyBaseUrl}
            onChange={(value) => patch({ ntfyBaseUrl: value })}
            placeholder={DEFAULT_NTFY_BASE_URL}
            disabled={saving}
          />
          <Field
            label="Topic"
            value={draft.ntfyTopic}
            onChange={(value) => patch({ ntfyTopic: value })}
            placeholder="my-bamboo-topic"
            disabled={saving}
          />
          <Field
            label="Token(可选,自托管实例)"
            value={draft.ntfyToken}
            onChange={(value) =>
              patch({
                ntfyToken: value,
                ntfyCredentialIntent: value.trim() ? "replace" : "keep",
              })
            }
            type="password"
            disabled={saving || draft.ntfyCredentialIntent === "clear"}
            placeholder={
              draft.ntfyCredentialIntent === "clear"
                ? "保存后将清除"
                : hasStoredNtfyToken
                  ? "已配置，留空保持不变"
                  : "公共 ntfy.sh 主题无需填写"
            }
          />
          {(hasStoredNtfyToken || authority.data.ntfy.credential.state === "error") && (
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() =>
                patch({
                  ntfyToken: "",
                  ntfyCredentialIntent:
                    draft.ntfyCredentialIntent === "clear" ? "keep" : "clear",
                })
              }
            >
              {draft.ntfyCredentialIntent === "clear" ? "取消清除 ntfy Token" : "清除 ntfy Token"}
            </Button>
          )}
        </div>

        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <div className="text-sm font-medium">Bark</div>
              <div
                className={`text-xs ${authority.data.bark.credential.state === "error" ? "text-destructive" : "text-muted-foreground"}`}
                role={authority.data.bark.credential.state === "error" ? "alert" : undefined}
              >
                {credentialDescription(authority.data.bark.credential)}
              </div>
            </div>
            <Switch
              checked={draft.barkEnabled}
              onCheckedChange={(value) => patch({ barkEnabled: value })}
              aria-label="启用 Bark"
              disabled={saving}
            />
          </div>
          <Field
            label="Bark Base URL"
            value={draft.barkBaseUrl}
            onChange={(value) => patch({ barkBaseUrl: value })}
            placeholder={DEFAULT_BARK_BASE_URL}
            disabled={saving}
          />
          <Field
            label="Device Key"
            value={draft.barkDeviceKey}
            onChange={(value) =>
              patch({
                barkDeviceKey: value,
                barkCredentialIntent: value.trim() ? "replace" : "keep",
              })
            }
            type="password"
            disabled={saving || draft.barkCredentialIntent === "clear"}
            placeholder={
              draft.barkCredentialIntent === "clear"
                ? "保存后将清除"
                : hasStoredBarkKey
                  ? "已配置，留空保持不变"
                  : "iOS Bark app 中的设备密钥"
            }
          />
          {(hasStoredBarkKey || authority.data.bark.credential.state === "error") && (
            <Button
              size="sm"
              variant="ghost"
              disabled={saving}
              onClick={() =>
                patch({
                  barkDeviceKey: "",
                  barkCredentialIntent:
                    draft.barkCredentialIntent === "clear" ? "keep" : "clear",
                })
              }
            >
              {draft.barkCredentialIntent === "clear" ? "取消清除 Bark Device Key" : "清除 Bark Device Key"}
            </Button>
          )}
        </div>

        {conflict ? (
          <div className="space-y-2 rounded-md border border-destructive/50 p-2">
            <p className="text-xs text-destructive" role="alert">
              通知渠道配置已被其他客户端更新。你的未保存修改仍保留；请选择载入服务器版本或用最新修订重试。
            </p>
            {conflict.refreshing ? (
              <p className="text-xs text-muted-foreground">正在获取服务器最新版本…</p>
            ) : conflict.latest ? (
              <div className="flex flex-wrap gap-2">
                <Button
                  ref={conflictActionRef}
                  size="sm"
                  variant="secondary"
                  onClick={() => installAuthority(conflict.latest!)}
                  disabled={saving}
                >
                  载入服务器版本
                </Button>
                <Button size="sm" onClick={() => void save(conflict.latest)} disabled={saving}>
                  用当前修改重试
                </Button>
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-xs text-destructive" role="alert">
                  {conflict.refreshError ?? "无法获取服务器最新版本。"}
                </p>
                <Button
                  ref={conflictActionRef}
                  size="sm"
                  variant="secondary"
                  onClick={() => void refreshConflict()}
                  disabled={saving}
                >
                  重新获取最新版本
                </Button>
              </div>
            )}
          </div>
        ) : null}

        {saveError ? (
          <p className="text-xs text-destructive" role="alert">
            {saveError}
          </p>
        ) : null}

        <div className="flex items-end justify-between gap-2 border-t pt-3">
          <div className="space-y-1">
            <Button size="sm" variant="secondary" onClick={() => void sendTest()} disabled={testing}>
              {testing ? "发送中…" : "测试通知渠道"}
            </Button>
            {attempted ? (
              <p className="text-xs text-muted-foreground">
                {attempted.length > 0 ? `已尝试:${attempted.join(", ")}` : "未启用任何渠道"}
              </p>
            ) : null}
            {testError ? (
              <p className="text-xs text-destructive" role="alert">
                {testError}
              </p>
            ) : null}
          </div>
          <div className="flex items-center gap-2">
            {saved ? (
              <span className="text-xs text-emerald-500" role="status" aria-live="polite">
                已保存
              </span>
            ) : null}
            <Button
              size="sm"
              onClick={() => void save(authority)}
              disabled={saving || conflict !== null}
            >
              {saving ? "保存中…" : "保存渠道设置"}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
