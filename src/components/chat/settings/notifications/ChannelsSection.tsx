import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useState } from "react"
import { apiClient, getErrorMessage } from "@services/api"
import type { BambooConfig, NotificationsConfig } from "@services/common/ServiceFactory"
import { isMaskedSecret } from "@/lib/secrets"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"

type DesktopMode = "auto" | "on" | "off"

interface ChannelsDraft {
  desktopMode: DesktopMode
  ntfyEnabled: boolean
  ntfyBaseUrl: string
  ntfyTopic: string
  ntfyToken: string
  barkEnabled: boolean
  barkBaseUrl: string
  barkDeviceKey: string
}

const DEFAULT_NTFY_BASE_URL = "https://ntfy.sh"
const DEFAULT_BARK_BASE_URL = "https://api.day.app"

function draftFromConfig(notifications: NotificationsConfig | undefined): ChannelsDraft {
  const desktopEnabled = notifications?.desktop?.enabled
  return {
    desktopMode: desktopEnabled === true ? "on" : desktopEnabled === false ? "off" : "auto",
    ntfyEnabled: notifications?.ntfy?.enabled ?? false,
    ntfyBaseUrl: notifications?.ntfy?.base_url ?? DEFAULT_NTFY_BASE_URL,
    ntfyTopic: notifications?.ntfy?.topic ?? "",
    // Never prefill a masked secret — see isMaskedSecret contract.
    ntfyToken: isMaskedSecret(notifications?.ntfy?.token) ? "" : (notifications?.ntfy?.token ?? ""),
    barkEnabled: notifications?.bark?.enabled ?? false,
    barkBaseUrl: notifications?.bark?.base_url ?? DEFAULT_BARK_BASE_URL,
    barkDeviceKey: isMaskedSecret(notifications?.bark?.device_key)
      ? ""
      : (notifications?.bark?.device_key ?? ""),
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
  useUiLocale()
  return (
    <label className="block">
      <span className="mb-1 block text-xs text-muted-foreground">{label}</span>
      <Input type={type} value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
    </label>
  )
}

/**
 * Notification delivery channels: native desktop plus ntfy/Bark push relays.
 *
 * Reads/writes the generic `notifications` sub-tree of the bamboo config via
 * whole-document `GET`/`POST bamboo/config` (server-side deep-merge patch),
 * the same pattern used by the System-tab sections and `DefaultsEditor` —
 * NOT `SettingsService`, which only covers provider-instance-shaped routes.
 * A partial `{"notifications":{"ntfy":{...}}}` body is safe: it merges onto
 * the existing document and never clobbers sibling channels.
 *
 * The ntfy `token` / Bark `device_key` fields follow the `isMaskedSecret`
 * contract exactly (see `@/lib/secrets`): the server never emits a plaintext
 * secret on GET — it's either absent (nothing configured) or redacted to
 * `****...****` (configured) — so these fields always load empty, and a save
 * only sends a value when the user actually typed a new one. An untouched
 * field on an already-configured channel is omitted from the patch entirely
 * so the server keeps the stored secret (mirrors `preserve_masked_notification_secrets`
 * server-side, though omitting the key outright never even needs that path).
 */
export function ChannelsSection() {
  useUiLocale()
  const [notifications, setNotifications] = useState<NotificationsConfig | undefined>(undefined)
  const [draft, setDraft] = useState<ChannelsDraft>(() => draftFromConfig(undefined))
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testError, setTestError] = useState<string | null>(null)
  const [attempted, setAttempted] = useState<string[] | null>(null)

  const load = async () => {
    setLoading(true)
    setLoadError(null)
    try {
      const cfg = await apiClient.get<BambooConfig>("bamboo/config")
      setNotifications(cfg.notifications)
      setDraft(draftFromConfig(cfg.notifications))
    } catch (e) {
      setLoadError(getErrorMessage(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    void load()
  }, [])

  const patch = (p: Partial<ChannelsDraft>) => setDraft((d) => ({ ...d, ...p }))

  const hasStoredNtfyToken = isMaskedSecret(notifications?.ntfy?.token)
  const hasStoredBarkKey = isMaskedSecret(notifications?.bark?.device_key)

  const save = async () => {
    setSaving(true)
    setSaveError(null)
    setSaved(false)
    try {
      const ntfyToken = draft.ntfyToken.trim()
      const barkDeviceKey = draft.barkDeviceKey.trim()
      const configPatch = {
        notifications: {
          desktop: {
            // "auto" clears the override back to null (server picks
            // standalone-vs-sidecar default); "on"/"off" is explicit.
            enabled: draft.desktopMode === "auto" ? null : draft.desktopMode === "on",
          },
          ntfy: {
            enabled: draft.ntfyEnabled,
            base_url: draft.ntfyBaseUrl.trim() || DEFAULT_NTFY_BASE_URL,
            topic: draft.ntfyTopic.trim(),
            ...(ntfyToken ? { token: ntfyToken } : {}),
          },
          bark: {
            enabled: draft.barkEnabled,
            base_url: draft.barkBaseUrl.trim() || DEFAULT_BARK_BASE_URL,
            ...(barkDeviceKey ? { device_key: barkDeviceKey } : {}),
          },
        },
      }
      const savedCfg = await apiClient.post<BambooConfig>("bamboo/config", configPatch)
      setNotifications(savedCfg.notifications)
      setDraft(draftFromConfig(savedCfg.notifications))
      setSaved(true)
      setTimeout(() => setSaved(false), 2500)
    } catch (e) {
      setSaveError(getErrorMessage(e))
    } finally {
      setSaving(false)
    }
  }

  const sendTest = async () => {
    setTesting(true)
    setTestError(null)
    setAttempted(null)
    try {
      const res = await apiClient.post<{ attempted: string[] }>("notifications/test")
      setAttempted(res.attempted)
    } catch (e) {
      setTestError(getErrorMessage(e))
    } finally {
      setTesting(false)
    }
  }

  if (loading) {
    return (
      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("notification_channels_b2354ceb")}</div>
        <p className="text-xs text-muted-foreground">{uiText("loading_4927a53b")}</p>
      </section>
    )
  }

  if (loadError) {
    return (
      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("notification_channels_b2354ceb")}</div>
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-destructive">{loadError}</p>
          <Button size="sm" variant="secondary" className="shrink-0" onClick={() => void load()}>
            {uiText("retry_b8784c8d")}</Button>
        </div>
      </section>
    )
  }

  return (
    <section className="rounded-lg border p-3">
      <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("notification_channels_b2354ceb")}</div>
      <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
        {uiText("configure_backend_notification_delivery_desktop_ntfy_ba_d7494474")}</p>

      <div className="space-y-4">
        <div className="space-y-1.5">
          <div className="text-sm font-medium">{uiText("desktop_notifications_717084d9")}</div>
          <Select value={draft.desktopMode} onValueChange={(v) => patch({ desktopMode: v as DesktopMode })}>
            <SelectTrigger className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="auto">{uiText("auto_on_when_standalone_off_when_embedded_in_bodhi_abe65183")}</SelectItem>
              <SelectItem value="on">{uiText("on_8da97ddd")}</SelectItem>
              <SelectItem value="off">{uiText("close_3fd47edc")}</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">ntfy</div>
            <Switch
              checked={draft.ntfyEnabled}
              onCheckedChange={(v) => patch({ ntfyEnabled: v })}
              aria-label={uiText("enable_ntfy_22f70ff4")}
            />
          </div>
          <Field
            label="Base URL"
            value={draft.ntfyBaseUrl}
            onChange={(v) => patch({ ntfyBaseUrl: v })}
            placeholder={DEFAULT_NTFY_BASE_URL}
          />
          <Field
            label="Topic"
            value={draft.ntfyTopic}
            onChange={(v) => patch({ ntfyTopic: v })}
            placeholder="my-bamboo-topic"
          />
          <Field
            label={uiText("token_optional_self_hosted_397fbbe8")}
            value={draft.ntfyToken}
            onChange={(v) => patch({ ntfyToken: v })}
            type="password"
            placeholder={hasStoredNtfyToken ? uiText("configured_leave_blank_to_keep_f3805ede") : uiText("not_required_for_public_ntfy_sh_topics_fe732726")}
          />
        </div>

        <div className="space-y-2 border-t pt-3">
          <div className="flex items-center justify-between gap-3">
            <div className="text-sm font-medium">Bark</div>
            <Switch
              checked={draft.barkEnabled}
              onCheckedChange={(v) => patch({ barkEnabled: v })}
              aria-label={uiText("enable_bark_d60caf2b")}
            />
          </div>
          <Field
            label="Base URL"
            value={draft.barkBaseUrl}
            onChange={(v) => patch({ barkBaseUrl: v })}
            placeholder={DEFAULT_BARK_BASE_URL}
          />
          <Field
            label="Device Key"
            value={draft.barkDeviceKey}
            onChange={(v) => patch({ barkDeviceKey: v })}
            type="password"
            placeholder={hasStoredBarkKey ? uiText("configured_leave_blank_to_keep_f3805ede") : uiText("device_key_from_the_ios_bark_app_2d3b3e59")}
          />
        </div>

        {saveError ? <p className="text-xs text-destructive">{saveError}</p> : null}

        <div className="flex items-end justify-between gap-2 border-t pt-3">
          <div className="space-y-1">
            <Button size="sm" variant="secondary" onClick={() => void sendTest()} disabled={testing}>
              {testing ? uiText("sending_364970d8") : uiText("test_notification_channels_109fe0da")}
            </Button>
            {attempted ? (
              <p className="text-xs text-muted-foreground">
                {attempted.length > 0 ? uiText("attempted_0e32a3d3", { v0: attempted.join(", ") }) : uiText("no_channels_enabled_14d78be1")}
              </p>
            ) : null}
            {testError ? <p className="text-xs text-destructive">{testError}</p> : null}
          </div>
          <div className="flex items-center gap-2">
            {saved ? <span className="text-xs text-emerald-500">{uiText("saved_1bd91a7d")}</span> : null}
            <Button size="sm" onClick={() => void save()} disabled={saving}>
              {saving ? uiText("saving_ff509c9b") : uiText("save_channel_settings_e9951ba0")}
            </Button>
          </div>
        </div>
      </div>
    </section>
  )
}
