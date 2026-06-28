import { useState } from "react"
import {
  isNotifyEnabled,
  setNotifyEnabled,
  requestNotifyPermission,
  notifyPermission,
  notify,
} from "@/lib/notify"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"

export function SettingsNotifications() {
  const [enabled, setEnabled] = useState(isNotifyEnabled())
  const [perm, setPerm] = useState(notifyPermission())

  const toggle = async () => {
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
        <div className="flex items-start justify-between gap-3">
          <div>
            <div className="text-sm font-medium">任务完成提醒</div>
            <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
              agent 任务在后台(标签页不可见或在看别的会话)完成时,通过浏览器通知提醒你。
            </p>
          </div>
          <Switch
            checked={enabled}
            onCheckedChange={() => void toggle()}
            aria-label="任务完成提醒"
            className="mt-0.5"
          />
        </div>
        {perm === "denied" ? (
          <p className="mt-2 text-xs text-destructive">浏览器已拒绝通知权限,请在浏览器站点设置里允许。</p>
        ) : perm === "unsupported" ? (
          <p className="mt-2 text-xs text-muted-foreground">当前环境不支持通知。</p>
        ) : null}
      </section>

      {enabled && perm === "granted" ? (
        <Button
          size="sm"
          variant="secondary"
          onClick={() => notify("Bodhi · 测试通知", "通知工作正常 ✓")}
        >
          发送测试通知
        </Button>
      ) : null}
    </div>
  )
}
