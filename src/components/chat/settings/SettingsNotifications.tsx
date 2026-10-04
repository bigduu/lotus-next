import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useState } from "react"
import {
  isNotifyEnabled,
  setNotifyEnabled,
  requestNotifyPermission,
  notifyPermission,
  notify,
} from "@/lib/notify"
import {
  getNotificationPreferences,
  setNotificationPreferences,
  type NotificationPreferences,
} from "@services/notification/notificationPreferencesApi"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"
import { ChannelsSection } from "@/components/chat/settings/notifications/ChannelsSection"

const EVENT_ROWS: {
  key: keyof Omit<NotificationPreferences, "enabled">
  label: string
}[] = [
  { key: "onClarification", get label() { return uiText("when_the_agent_needs_clarification_e088e7d7") } },
  { key: "onToolApproval", get label() { return uiText("when_a_tool_needs_approval_97b94cf2") } },
  { key: "onContextPressure", get label() { return uiText("when_context_approaches_its_limit_b54b0d2c") } },
  { key: "onSubAgentComplete", get label() { return uiText("when_a_background_subtask_completes_92a62146") } },
  { key: "onRunComplete", get label() { return uiText("when_a_task_run_completes_successfully_f1a64ada") } },
  { key: "onRunFailed", get label() { return uiText("when_a_task_run_fails_55780996") } },
]

export function SettingsNotifications() {
  useUiLocale()
  // Browser-local toggle: whether this tab surfaces browser notifications.
  const [enabled, setEnabled] = useState(isNotifyEnabled())
  const [perm, setPerm] = useState(notifyPermission())

  // Backend preferences: policy lives server-side (bamboo-notification).
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null)
  const [prefsLoading, setPrefsLoading] = useState(true)
  const [prefsError, setPrefsError] = useState<string | null>(null)
  const [saveError, setSaveError] = useState<string | null>(null)

  const loadPrefs = async () => {
    setPrefsLoading(true)
    setPrefsError(null)
    try {
      setPrefs(await getNotificationPreferences())
    } catch (e) {
      setPrefsError(e instanceof Error ? e.message : uiText("could_not_load_notification_preferences_c66b5a75"))
    } finally {
      setPrefsLoading(false)
    }
  }

  useEffect(() => {
    void loadPrefs()
  }, [])

  const updatePref = (key: keyof NotificationPreferences, value: boolean) => {
    if (!prefs) return
    const previous = prefs
    const next = { ...prefs, [key]: value }
    // Optimistic update; revert + surface error on failure.
    setPrefs(next)
    setSaveError(null)
    void setNotificationPreferences(next)
      .then((saved) => setPrefs(saved))
      .catch((e) => {
        setPrefs(previous)
        setSaveError(e instanceof Error ? e.message : uiText("could_not_save_notification_preferences_951b0058"))
      })
  }

  const toggleBrowser = async () => {
    if (!enabled) {
      const ok = await requestNotifyPermission()
      setPerm(notifyPermission())
      if (!ok) return
    }
    const next = !enabled
    setEnabled(next)
    setNotifyEnabled(next)
  }

  return (
    <div className="space-y-4">
      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("notification_preferences_server_fffc7e6d")}</div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          {uiText("the_backend_determines_notifications_centrally_includin_bb244be6")}</p>
        {prefsLoading ? (
          <p className="text-xs text-muted-foreground">{uiText("loading_4927a53b")}</p>
        ) : prefsError ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-destructive">{prefsError}</p>
            <Button size="sm" variant="secondary" className="shrink-0" onClick={() => void loadPrefs()}>
              {uiText("retry_b8784c8d")}</Button>
          </div>
        ) : prefs ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">{uiText("enable_notifications_master_switch_fef57a27")}</div>
              <Switch
                checked={prefs.enabled}
                onCheckedChange={(v) => updatePref("enabled", v)}
                aria-label={uiText("enable_notifications_73e369d5")}
              />
            </div>
            <div
              className={cn(
                "space-y-2.5 border-t pt-2.5",
                !prefs.enabled && "pointer-events-none opacity-50",
              )}
            >
              <div className="text-xs font-medium text-muted-foreground">{uiText("notify_me_in_these_situations_cbbff5c0")}</div>
              {EVENT_ROWS.map((row) => (
                <div key={row.key} className="flex items-center justify-between gap-3">
                  <div className="text-sm">{row.label}</div>
                  <Switch
                    checked={prefs[row.key]}
                    disabled={!prefs.enabled}
                    onCheckedChange={(v) => updatePref(row.key, v)}
                    aria-label={row.label}
                  />
                </div>
              ))}
            </div>
            {saveError ? <p className="text-xs text-destructive">{saveError}</p> : null}
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border p-3">
        <div className="mb-2 text-xs font-medium text-muted-foreground">{uiText("browser_notifications_this_device_ff712968")}</div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">{uiText("task_completion_alerts_90a30333")}</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {uiText("receive_a_browser_notification_when_an_agent_task_compl_c0524c35")}</p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={() => void toggleBrowser()}
            aria-label={uiText("task_completion_alerts_90a30333")}
            className="mt-0.5"
          />
        </div>
        {perm === "denied" ? (
          <p className="mt-2 text-xs text-destructive">{uiText("notifications_are_blocked_allow_them_in_your_browser_s__83cdc1ce")}</p>
        ) : perm === "unsupported" ? (
          <p className="mt-2 text-xs text-muted-foreground">{uiText("notifications_are_not_supported_in_this_environment_37a9c6ef")}</p>
        ) : null}
        {enabled && perm === "granted" ? (
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            onClick={() => notify(uiText("bodhi_test_notification_7de1d35e"), uiText("notifications_are_working_3a772497"))}
          >
            {uiText("send_test_notification_5e0022a1")}</Button>
        ) : null}
      </section>

      <ChannelsSection />
    </div>
  )
}
