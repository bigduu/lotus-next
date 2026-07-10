import { useEffect, useState } from "react"
import { AlertTriangle } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { agentClient } from "@services/chat/AgentService"
import { getErrorMessage } from "@services/api"
import { serviceFactory } from "@services/common/ServiceFactory"
import {
  isVdiSafeModeEnabled,
  onVdiSafeModeChange,
  setVdiSafeModeEnabled,
  VDI_SAFE_MODE_CHANGE_EVENT,
} from "@shared/utils/vdiSafeMode"
import { ConfirmDialog } from "./ConfirmDialog"
import { StatusLine } from "./StatusLine"
import type { SectionMessage } from "./useSystemConfig"

// Release trains stamp the real version at publish; dev builds show 0.0.0.
const APP_VERSION: string =
  (import.meta.env.VITE_APP_VERSION as string | undefined) ?? "0.0.0"

type PendingAction = "clear-storage" | "reset-app"

/** 应用 — 版本信息 + 图形兼容模式 + 本地缓存清理 + 完全重置(危险区). */
export function SectionApp() {
  const [pending, setPending] = useState<PendingAction | null>(null)
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)
  const [msg, setMsg] = useState<SectionMessage>(null)
  const [vdiSafeMode, setVdiSafeMode] = useState(isVdiSafeModeEnabled())

  // Keep the visible switch fresh when the flag changes elsewhere — another
  // tab (key-filtered `storage`) or another listener in this tab.
  useEffect(() => onVdiSafeModeChange(() => setVdiSafeMode(isVdiSafeModeEnabled())), [])

  const toggleVdiSafeMode = (checked: boolean) => {
    setVdiSafeMode(checked)
    setVdiSafeModeEnabled(checked)
    // `storage` events only reach OTHER tabs — this event lets the App.tsx
    // attribute sync apply the change immediately in this tab.
    window.dispatchEvent(new Event(VDI_SAFE_MODE_CHANGE_EVENT))
  }

  const clearStorage = () => {
    localStorage.clear()
    setPending(null)
    setMsg({ kind: "ok", text: "本地缓存已清除,即将刷新…" })
    window.setTimeout(() => window.location.reload(), 600)
  }

  const resetApp = async () => {
    setBusy(true)
    setActionError(null)
    try {
      // 1. Delete every session, including pinned ones.
      await agentClient.cleanupSessions("all", false)
      // 2. Force the setup flow on next launch.
      await serviceFactory.resetSetupStatus()
      // 3. Reset backend config.json.
      await serviceFactory.resetBambooConfig()
      // 4. Clear frontend local state, then reload.
      localStorage.clear()
      setPending(null)
      setMsg({ kind: "ok", text: "已重置,即将刷新…" })
      window.setTimeout(() => window.location.reload(), 1200)
    } catch (e) {
      setActionError(getErrorMessage(e))
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">应用</div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">前端版本</span>
        <span className="font-mono text-xs">
          v{APP_VERSION}
          {import.meta.env.DEV ? " (dev)" : ""}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 border-t pt-2">
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm">图形兼容模式</div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            禁用模糊与玻璃效果,适用于虚拟桌面(VDI)、远程或图形受限环境。
          </p>
        </div>
        <Switch checked={vdiSafeMode} onCheckedChange={toggleVdiSafeMode} />
      </div>

      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <div className="text-xs text-muted-foreground">清除浏览器本地缓存并刷新页面</div>
        <Button size="sm" variant="secondary" onClick={() => setPending("clear-storage")}>
          清除本地缓存
        </Button>
      </div>

      <div className="space-y-1.5 border-t pt-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
          <AlertTriangle className="size-3.5" /> 危险区
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          完全重置:删除全部会话(含置顶)、重置后端配置、清除本地缓存,并重新进入初始化流程。
        </p>
        <Button size="sm" variant="destructive" onClick={() => setPending("reset-app")}>
          重置应用
        </Button>
      </div>

      <StatusLine msg={msg} />

      <ConfirmDialog
        open={pending === "clear-storage"}
        onOpenChange={(o) => {
          if (!o) setPending(null)
        }}
        title="清除本地缓存?"
        description="将清空浏览器 localStorage(界面偏好等本地状态)并刷新页面,后端数据不受影响。"
        confirmLabel="清除并刷新"
        onConfirm={clearStorage}
      />

      <ConfirmDialog
        open={pending === "reset-app"}
        onOpenChange={(o) => {
          if (!o && !busy) setPending(null)
        }}
        title="重置整个应用?"
        description="将删除全部会话(包括已置顶)、重置后端 config.json、清除本地缓存,并在刷新后重新进入初始化流程。此操作不可撤销。"
        confirmLabel="确认重置"
        busy={busy}
        error={actionError}
        onConfirm={() => void resetApp()}
      />
    </section>
  )
}
