import { createSignal, For, onSettled, Show } from "solid-js"
import { isNotifyEnabled, notify, notifyPermission, requestNotifyPermission, setNotifyEnabled } from "@/lib/notify"
import {
  getNotificationPreferences, setNotificationPreferences, type NotificationPreferences,
} from "@services/notification/notificationPreferencesApi"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Switch } from "../../ui/switch"
import { ChannelsSection } from "./ChannelsSection"

const eventRows = [
  ["onClarification", "when_the_agent_needs_clarification_e088e7d7"],
  ["onToolApproval", "when_a_tool_needs_approval_97b94cf2"],
  ["onContextPressure", "when_context_approaches_its_limit_b54b0d2c"],
  ["onSubAgentComplete", "when_a_background_subtask_completes_92a62146"],
  ["onRunComplete", "when_a_task_run_completes_successfully_f1a64ada"],
  ["onRunFailed", "when_a_task_run_fails_55780996"],
] as const

function ServerPreferences() {
  const text = createUiText()
  const [prefs, setPrefs] = createSignal<NotificationPreferences | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [saving, setSaving] = createSignal(false)
  const [loadError, setLoadError] = createSignal<string | null>(null)
  const [saveError, setSaveError] = createSignal<string | null>(null)
  let active = true

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const result = await getNotificationPreferences()
      if (active) setPrefs(result)
    } catch (error) {
      if (active) setLoadError(error instanceof Error ? error.message : text("could_not_load_notification_preferences_c66b5a75"))
    } finally {
      if (active) setLoading(false)
    }
  }

  onSettled(() => {
    void load()
    return () => { active = false }
  })

  async function update(key: keyof NotificationPreferences, value: boolean) {
    const previous = prefs()
    if (!active || !previous || saving() || loading()) return
    const next = { ...previous, [key]: value }
    setSaving(true)
    setPrefs(next)
    setSaveError(null)
    try {
      const confirmed = await setNotificationPreferences(next)
      if (active) setPrefs(confirmed)
    } catch (error) {
      if (active) {
        setPrefs(previous)
        setSaveError(error instanceof Error ? error.message : text("could_not_save_notification_preferences_951b0058"))
      }
    } finally {
      if (active) setSaving(false)
    }
  }

  return <section class="rounded-lg border p-3" aria-label={text("notification_preferences_server_fffc7e6d")}>
    <div class="mb-2 text-xs font-medium text-muted-foreground">{text("notification_preferences_server_fffc7e6d")}</div>
    <p class="mb-3 text-xs leading-relaxed text-muted-foreground">{text("the_backend_determines_notifications_centrally_includin_bb244be6")}</p>
    <Show when={!loading()} fallback={<p role="status" class="text-xs text-muted-foreground">{text("loading_4927a53b")}</p>}>
      <Show when={!loadError()} fallback={
        <div class="flex items-center justify-between gap-2">
          <p role="alert" class="text-xs text-destructive">{loadError()}</p>
          <Button type="button" size="sm" variant="secondary" onClick={() => void load()}>{text("retry_b8784c8d")}</Button>
        </div>
      }>
        <Show when={prefs()}>{(preferences) =>
          <div class="space-y-3">
            <div class="flex items-center justify-between gap-3">
              <div class="text-sm">{text("enable_notifications_master_switch_fef57a27")}</div>
              <Switch checked={preferences().enabled} disabled={saving()} aria-label={text("enable_notifications_73e369d5")}
                onCheckedChange={(enabled) => void update("enabled", enabled)} />
            </div>
            <div class={["space-y-2.5 border-t pt-2.5", { "opacity-50": !preferences().enabled }]}>
              <div class="text-xs font-medium text-muted-foreground">{text("notify_me_in_these_situations_cbbff5c0")}</div>
              <For each={eventRows}>{([key, label]) =>
                <div class="flex items-center justify-between gap-3">
                  <div class="text-sm">{text(label)}</div>
                  <Switch checked={preferences()[key]} disabled={saving() || !preferences().enabled} aria-label={text(label)}
                    onCheckedChange={(enabled) => void update(key, enabled)} />
                </div>
              }</For>
            </div>
            <Show when={saveError()}><p role="alert" class="text-xs text-destructive">{saveError()}</p></Show>
          </div>
        }</Show>
      </Show>
    </Show>
  </section>
}

function BrowserPreferences() {
  const text = createUiText()
  const [enabled, setEnabled] = createSignal(isNotifyEnabled())
  const [permission, setPermission] = createSignal(notifyPermission())
  const [checking, setChecking] = createSignal(false)
  let active = true
  onSettled(() => () => { active = false })

  async function toggle(next: boolean) {
    if (checking()) return
    if (next) {
      setChecking(true)
      const granted = await requestNotifyPermission()
      if (!active) return
      setChecking(false)
      setPermission(notifyPermission())
      if (!granted) return
    }
    setNotifyEnabled(next)
    setEnabled(next)
  }

  return <section class="rounded-lg border p-3" aria-label={text("browser_notifications_this_device_ff712968")}>
    <div class="mb-2 text-xs font-medium text-muted-foreground">{text("browser_notifications_this_device_ff712968")}</div>
    <div class="flex items-start justify-between gap-3">
      <div>
        <div class="text-sm">{text("task_completion_alerts_90a30333")}</div>
        <p class="mt-1 text-xs leading-relaxed text-muted-foreground">{text("receive_a_browser_notification_when_an_agent_task_compl_c0524c35")}</p>
      </div>
      <Switch checked={enabled()} disabled={checking()} onCheckedChange={(value) => void toggle(value)}
        aria-label={text("task_completion_alerts_90a30333")} class="mt-0.5" />
    </div>
    <Show when={permission() === "denied"}>
      <p class="mt-2 text-xs text-destructive">{text("notifications_are_blocked_allow_them_in_your_browser_s__83cdc1ce")}</p>
    </Show>
    <Show when={permission() === "unsupported"}>
      <p class="mt-2 text-xs text-muted-foreground">{text("notifications_are_not_supported_in_this_environment_37a9c6ef")}</p>
    </Show>
    <Show when={enabled() && permission() === "granted"}>
      <Button type="button" size="sm" variant="secondary" class="mt-3" onClick={() =>
        notify(text("bodhi_test_notification_7de1d35e"), text("notifications_are_working_3a772497"))}>
        {text("send_test_notification_5e0022a1")}
      </Button>
    </Show>
  </section>
}

export function SettingsNotifications() {
  return <div class="space-y-4" data-settings-notifications="">
    <ServerPreferences />
    <BrowserPreferences />
    <ChannelsSection />
  </div>
}
