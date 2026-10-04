import { uiText, useUiLocale } from "@shared/i18n/ui"
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
import { getRuntimeConfig } from "@/runtime/runtimeConfig"

// Release trains stamp the real version at publish; dev builds show 0.0.0.
const { artifact, publicMetadata } = getRuntimeConfig()

type PendingAction = "clear-storage" | "reset-app"

/** 应用 — 版本信息 + 图形兼容模式 + 本地缓存清理 + 完全重置(危险区). */
export function SectionApp() {
  useUiLocale()
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
    setMsg({ kind: "ok", text: uiText("local_storage_cleared_reloading_ec1328a5") })
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
      setMsg({ kind: "ok", text: uiText("reset_complete_reloading_12514457") })
      window.setTimeout(() => window.location.reload(), 1200)
    } catch (e) {
      setActionError(getErrorMessage(e))
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">{uiText("apply_63c73c47")}</div>

      <div className="flex items-center justify-between text-sm">
        <span className="text-muted-foreground">{uiText("frontend_version_1986e080")}</span>
        <span className="font-mono text-xs">
          v{artifact.version}
          {publicMetadata.development ? " (dev)" : ""}
        </span>
      </div>

      <div className="flex items-center justify-between gap-3 border-t pt-2">
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm">{uiText("graphics_compatibility_mode_49d20649")}</div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {uiText("disable_blur_and_glass_effects_for_virtual_desktops_vdi_26252605")}</p>
        </div>
        <Switch checked={vdiSafeMode} onCheckedChange={toggleVdiSafeMode} />
      </div>

      <div className="flex items-center justify-between gap-2 border-t pt-2">
        <div className="text-xs text-muted-foreground">{uiText("clear_browser_local_storage_and_reload_the_page_2a696421")}</div>
        <Button size="sm" variant="secondary" onClick={() => setPending("clear-storage")}>
          {uiText("clear_local_storage_4ee71bf2")}</Button>
      </div>

      <div className="space-y-1.5 border-t pt-2">
        <div className="flex items-center gap-1.5 text-xs font-medium text-destructive">
          <AlertTriangle className="size-3.5" />{uiText("danger_zone_d0baa11d")}</div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          {uiText("full_reset_delete_all_sessions_including_pinned_ones_re_d92ddf8e")}</p>
        <Button size="sm" variant="destructive" onClick={() => setPending("reset-app")}>
          {uiText("reset_application_23f30713")}</Button>
      </div>

      <StatusLine msg={msg} />

      <ConfirmDialog
        open={pending === "clear-storage"}
        onOpenChange={(o) => {
          if (!o) setPending(null)
        }}
        title={uiText("clear_local_storage_1b86d7c0")}
        description={uiText("this_clears_browser_localstorage_local_preferences_and__acf1cd5f")}
        confirmLabel={uiText("clear_and_reload_f19b6e32")}
        onConfirm={clearStorage}
      />

      <ConfirmDialog
        open={pending === "reset-app"}
        onOpenChange={(o) => {
          if (!o && !busy) setPending(null)
        }}
        title={uiText("reset_the_entire_app_60e36122")}
        description={uiText("delete_all_sessions_including_pinned_ones_reset_backend_b03a8b2a")}
        confirmLabel={uiText("confirm_reset_96f2cb4f")}
        busy={busy}
        error={actionError}
        onConfirm={() => void resetApp()}
      />
    </section>
  )
}
