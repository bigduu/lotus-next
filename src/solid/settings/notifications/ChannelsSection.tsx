import { createSignal, onSettled, Show } from "solid-js"
import { isApiError } from "@services/api"
import {
  getNotificationChannelsConfig, getNotificationConfigErrorCode, getSafeNotificationErrorMessage,
  putNotificationChannelsConfig, testNotificationChannels,
  type CredentialChange, type NotificationConfigEnvelope,
} from "@services/notification/notificationChannelsApi"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Select } from "../../ui/select"
import { Switch } from "../../ui/switch"

type DesktopMode = "auto" | "on" | "off"
const DEFAULT_NTFY_BASE_URL = "https://ntfy.sh"
const DEFAULT_BARK_BASE_URL = "https://api.day.app"
interface Draft {
  desktopMode: DesktopMode
  ntfyEnabled: boolean
  ntfyBaseUrl: string
  ntfyTopic: string
  ntfyToken: string
  barkEnabled: boolean
  barkBaseUrl: string
  barkDeviceKey: string
}

function editFrom(authority: NotificationConfigEnvelope): Draft {
  const data = authority.data
  return {
    desktopMode: data.desktop.enabled === null ? "auto" : data.desktop.enabled ? "on" : "off",
    ntfyEnabled: data.ntfy.enabled, ntfyBaseUrl: data.ntfy.baseUrl, ntfyTopic: data.ntfy.topic, ntfyToken: "",
    barkEnabled: data.bark.enabled, barkBaseUrl: data.bark.baseUrl, barkDeviceKey: "",
  }
}

function credentialChange(raw: string): CredentialChange {
  const value = raw.trim()
  return value ? { action: "replace", value } : { action: "keep" }
}

function Field(props: {
  label: string; value: string; onChange: (value: string) => void; placeholder?: string; secret?: boolean
}) {
  return <label class="block">
    <span class="mb-1 block text-xs text-muted-foreground">{props.label}</span>
    <Input type={props.secret ? "password" : "text"} autocomplete={props.secret ? "new-password" : "off"}
      value={props.value} placeholder={props.placeholder} onInput={(event) => props.onChange(event.currentTarget.value)} />
  </label>
}

export function ChannelsSection() {
  const text = createUiText()
  const [config, setConfig] = createSignal<NotificationConfigEnvelope | null>(null)
  const [draft, setDraft] = createSignal<Draft | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [busy, setBusy] = createSignal<"save" | "test" | null>(null)
  const [loadError, setLoadError] = createSignal<string | null>(null)
  const [saveError, setSaveError] = createSignal<string | null>(null)
  const [saved, setSaved] = createSignal(false)
  const [testError, setTestError] = createSignal<string | null>(null)
  const [attempted, setAttempted] = createSignal<string[] | null>(null)
  const lifetime = new AbortController()
  const alive = () => !lifetime.signal.aborted

  function apply(authority: NotificationConfigEnvelope) {
    setConfig(authority)
    setDraft(editFrom(authority))
  }

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const authority = await getNotificationChannelsConfig({ signal: lifetime.signal })
      if (alive()) apply(authority)
    } catch (error) {
      if (alive()) {
        setConfig(null)
        setDraft(null)
        setLoadError(getSafeNotificationErrorMessage(error))
      }
    } finally {
      if (alive()) setLoading(false)
    }
  }

  onSettled(() => {
    void load()
    return () => { lifetime.abort() }
  })

  function patch(values: Partial<Draft>) {
    if (busy()) return
    setSaved(false)
    setSaveError(null)
    setDraft((before) => before ? { ...before, ...values } : null)
  }

  async function save() {
    const before = config()
    const value = draft()
    if (!alive() || !before || !value || busy() || loading()) return
    setBusy("save")
    setSaved(false)
    setSaveError(null)
    try {
      const saved = await putNotificationChannelsConfig(before, {
        desktop: { enabled: value.desktopMode === "auto" ? null : value.desktopMode === "on" },
        ntfy: {
          enabled: value.ntfyEnabled, base_url: value.ntfyBaseUrl.trim() || DEFAULT_NTFY_BASE_URL, topic: value.ntfyTopic.trim(),
          credential_change: credentialChange(value.ntfyToken),
        },
        bark: {
          enabled: value.barkEnabled, base_url: value.barkBaseUrl.trim() || DEFAULT_BARK_BASE_URL,
          credential_change: credentialChange(value.barkDeviceKey),
        },
      })
      if (!alive()) return
      apply(saved)
      setSaved(true)
    } catch (error) {
      if (!alive()) return
      setSaveError(getSafeNotificationErrorMessage(error))
      const code = getNotificationConfigErrorCode(error)
      if (code === "config_revision_conflict" || !isApiError(error) || error.status >= 500 ||
        [401, 403, 408, 409].includes(error.status)) {
        // The observed revision may have changed. Refresh before another explicit save.
        setConfig(null)
        await load()
      }
    } finally {
      if (alive()) setBusy(null)
    }
  }

  async function sendTest() {
    if (!alive() || !config() || busy() || loading()) return
    setBusy("test")
    setTestError(null)
    setAttempted(null)
    try {
      const result = await testNotificationChannels()
      if (alive()) setAttempted(result.attempted)
    } catch (error) {
      if (alive()) setTestError(getSafeNotificationErrorMessage(error))
    } finally {
      if (alive()) setBusy(null)
    }
  }

  const modes = () => [
    { value: "auto", label: text("auto_on_when_standalone_off_when_embedded_in_bodhi_abe65183") },
    { value: "on", label: text("on_8da97ddd") }, { value: "off", label: text("notifications_off") },
  ]
  const configured = (target: "ntfy" | "bark") => config()?.data[target].credential.configured === true

  return <section class="rounded-lg border p-3" aria-label={text("notification_channels_b2354ceb")}>
    <div class="mb-2 text-xs font-medium text-muted-foreground">{text("notification_channels_b2354ceb")}</div>
    <Show when={!loading()} fallback={<p role="status" class="text-xs text-muted-foreground">{text("loading_4927a53b")}</p>}>
      <Show when={!loadError()} fallback={
        <div class="flex items-center justify-between gap-2">
          <p role="alert" class="text-xs text-destructive">{loadError()}</p>
          <Button type="button" size="sm" variant="secondary" disabled={!!busy()} onClick={() => void load()}>{text("retry_b8784c8d")}</Button>
        </div>
      }>
        <Show when={draft()}>{(values) => <>
          <p class="mb-3 text-xs leading-relaxed text-muted-foreground">{text("configure_backend_notification_delivery_desktop_ntfy_ba_d7494474")}</p>
          <fieldset disabled={!!busy()} class="min-w-0 space-y-4">
            <div class="space-y-1.5">
              <div class="text-sm font-medium">{text("desktop_notifications_717084d9")}</div>
              <Select class="w-full" label={text("desktop_notifications_717084d9")} disabled={!!busy()}
                options={modes()} value={values().desktopMode} onValueChange={(mode) => patch({ desktopMode: mode as DesktopMode })} />
            </div>
            <div class="space-y-2 border-t pt-3">
              <div class="flex items-center justify-between gap-3">
                <div class="text-sm font-medium">ntfy</div>
                <Switch checked={values().ntfyEnabled} disabled={!!busy()} aria-label={text("enable_ntfy_22f70ff4")}
                  onCheckedChange={(ntfyEnabled) => patch({ ntfyEnabled })} />
              </div>
              <Field label="Base URL" value={values().ntfyBaseUrl} placeholder={DEFAULT_NTFY_BASE_URL} onChange={(ntfyBaseUrl) => patch({ ntfyBaseUrl })} />
              <Field label="Topic" value={values().ntfyTopic} onChange={(ntfyTopic) => patch({ ntfyTopic })} placeholder="my-bamboo-topic" />
              <Field label={text("token_optional_self_hosted_397fbbe8")} value={values().ntfyToken} secret onChange={(ntfyToken) => patch({ ntfyToken })}
                placeholder={text(configured("ntfy") ? "configured_leave_blank_to_keep_f3805ede" : "not_required_for_public_ntfy_sh_topics_fe732726")} />
            </div>
            <div class="space-y-2 border-t pt-3">
              <div class="flex items-center justify-between gap-3">
                <div class="text-sm font-medium">Bark</div>
                <Switch checked={values().barkEnabled} disabled={!!busy()} aria-label={text("enable_bark_d60caf2b")}
                  onCheckedChange={(barkEnabled) => patch({ barkEnabled })} />
              </div>
              <Field label="Base URL" value={values().barkBaseUrl} placeholder={DEFAULT_BARK_BASE_URL} onChange={(barkBaseUrl) => patch({ barkBaseUrl })} />
              <Field label="Device Key" value={values().barkDeviceKey} secret onChange={(barkDeviceKey) => patch({ barkDeviceKey })}
                placeholder={text(configured("bark") ? "configured_leave_blank_to_keep_f3805ede" : "device_key_from_the_ios_bark_app_2d3b3e59")} />
            </div>
          </fieldset>
          <div class="mt-4 flex items-end justify-between gap-2 border-t pt-3">
            <div class="space-y-1">
              <Button type="button" size="sm" variant="secondary" disabled={!!busy() || !config()} onClick={() => void sendTest()}>
                {text(busy() === "test" ? "sending_364970d8" : "test_notification_channels_109fe0da")}
              </Button>
              <Show when={attempted()}>{(names) =>
                <p role="status" class="text-xs text-muted-foreground">{names().length
                  ? text("attempted_0e32a3d3", { v0: names().join(", ") }) : text("no_channels_enabled_14d78be1")}</p>
              }</Show>
              <Show when={testError()}><p role="alert" class="text-xs text-destructive">{testError()}</p></Show>
            </div>
            <div class="flex items-center gap-2">
              <Show when={saved()}><span role="status" class="text-xs text-emerald-500">{text("saved_1bd91a7d")}</span></Show>
              <Button type="button" size="sm" disabled={!!busy() || !config()} onClick={() => void save()}>{text(busy() === "save" ? "saving_ff509c9b" : "save_channel_settings_e9951ba0")}</Button>
            </div>
          </div>
        </>}</Show>
      </Show>
    </Show>
    <Show when={saveError()}><p role="alert" class="mt-2 text-xs text-destructive">{saveError()}</p></Show>
  </section>
}
