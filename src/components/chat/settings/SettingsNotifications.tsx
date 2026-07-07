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

const EVENT_ROWS: {
  key: keyof Omit<NotificationPreferences, "enabled">
  label: string
}[] = [
  { key: "onClarification", label: "Agent 需要澄清时" },
  { key: "onToolApproval", label: "工具执行需要批准时" },
  { key: "onContextPressure", label: "上下文接近上限时" },
  { key: "onSubAgentComplete", label: "后台子任务完成时" },
]

export function SettingsNotifications() {
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
      setPrefsError(e instanceof Error ? e.message : "加载通知偏好失败")
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
        setSaveError(e instanceof Error ? e.message : "保存通知偏好失败")
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
        <div className="mb-2 text-xs font-medium text-muted-foreground">通知偏好(服务端)</div>
        <p className="mb-3 text-xs leading-relaxed text-muted-foreground">
          何时提醒由后端统一判定(分类、去重、偏好过滤)。以下设置保存在服务端,对所有设备生效。
        </p>
        {prefsLoading ? (
          <p className="text-xs text-muted-foreground">加载中…</p>
        ) : prefsError ? (
          <div className="flex items-center justify-between gap-2">
            <p className="text-xs text-destructive">{prefsError}</p>
            <Button size="sm" variant="secondary" className="shrink-0" onClick={() => void loadPrefs()}>
              重试
            </Button>
          </div>
        ) : prefs ? (
          <div className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div className="text-sm">启用通知(总开关)</div>
              <Switch
                checked={prefs.enabled}
                onCheckedChange={(v) => updatePref("enabled", v)}
                aria-label="启用通知"
              />
            </div>
            <div
              className={cn(
                "space-y-2.5 border-t pt-2.5",
                !prefs.enabled && "pointer-events-none opacity-50",
              )}
            >
              <div className="text-xs font-medium text-muted-foreground">在以下情况提醒:</div>
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
        <div className="mb-2 text-xs font-medium text-muted-foreground">浏览器通知(本设备)</div>
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">任务完成提醒</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              agent 任务在后台(标签页不可见或在看别的会话)完成时,通过浏览器通知提醒你。
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={() => void toggleBrowser()}
            aria-label="任务完成提醒"
            className="mt-0.5"
          />
        </div>
        {perm === "denied" ? (
          <p className="mt-2 text-xs text-destructive">浏览器已拒绝通知权限,请在浏览器站点设置里允许。</p>
        ) : perm === "unsupported" ? (
          <p className="mt-2 text-xs text-muted-foreground">当前环境不支持通知。</p>
        ) : null}
        {enabled && perm === "granted" ? (
          <Button
            size="sm"
            variant="secondary"
            className="mt-3"
            onClick={() => notify("Bodhi · 测试通知", "通知工作正常 ✓")}
          >
            发送测试通知
          </Button>
        ) : null}
      </section>
    </div>
  )
}
