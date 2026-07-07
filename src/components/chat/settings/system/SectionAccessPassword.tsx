import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getErrorMessage } from "@services/api"
import { serviceFactory } from "@services/common/ServiceFactory"
import { ConfirmDialog } from "./ConfirmDialog"
import { StatusLine } from "./StatusLine"
import type { SectionMessage, SystemConfigApi } from "./useSystemConfig"

/**
 * 访问密码 — set / change via `POST /v1/bamboo/access/password`
 * (`current_password` is enforced by the backend for a non-local change),
 * disable via a `access_control.password_enabled=false` config patch
 * (the backend has no dedicated clear route).
 */
export function SectionAccessPassword({
  saveSection,
  configReady,
}: {
  saveSection: SystemConfigApi["saveSection"]
  /** Config loaded — required for the disable path (config patch). */
  configReady: boolean
}) {
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [passwordEnabled, setPasswordEnabled] = useState(false)
  const [localBypass, setLocalBypass] = useState(false)

  const [currentPassword, setCurrentPassword] = useState("")
  const [newPassword, setNewPassword] = useState("")
  const [confirmPassword, setConfirmPassword] = useState("")
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<SectionMessage>(null)

  const [confirmDisable, setConfirmDisable] = useState(false)
  const [disableBusy, setDisableBusy] = useState(false)
  const [disableError, setDisableError] = useState<string | null>(null)

  const requiresCurrent = passwordEnabled && !localBypass

  const loadStatus = useCallback(async () => {
    setStatusLoading(true)
    setStatusError(null)
    try {
      const status = await serviceFactory.getAccessStatus()
      setPasswordEnabled(status.password_enabled)
      setLocalBypass(status.local_bypass)
    } catch (e) {
      setStatusError(getErrorMessage(e))
    } finally {
      setStatusLoading(false)
    }
  }, [])

  useEffect(() => {
    void loadStatus()
  }, [loadStatus])

  const submit = async () => {
    const next = newPassword.trim()
    if (next.length < 4) {
      setMsg({ kind: "error", text: "新密码至少 4 位" })
      return
    }
    if (next !== confirmPassword.trim()) {
      setMsg({ kind: "error", text: "两次输入的密码不一致" })
      return
    }
    if (requiresCurrent && !currentPassword.trim()) {
      setMsg({ kind: "error", text: "请输入当前密码" })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await serviceFactory.updateAccessPassword({
        current_password: currentPassword.trim() || undefined,
        new_password: next,
      })
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setMsg({ kind: "ok", text: passwordEnabled ? "密码已更新" : "密码已启用" })
      await loadStatus()
    } catch (e) {
      setMsg({ kind: "error", text: getErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  const disablePassword = async () => {
    setDisableBusy(true)
    setDisableError(null)
    try {
      await saveSection({ access_control: { password_enabled: false } })
      setConfirmDisable(false)
      setMsg({ kind: "ok", text: "访问密码已关闭" })
      await loadStatus()
    } catch (e) {
      setDisableError(getErrorMessage(e))
    } finally {
      setDisableBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">访问密码</div>

      {statusLoading ? (
        <p className="text-xs text-muted-foreground">加载中…</p>
      ) : statusError ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-destructive">状态加载失败:{statusError}</p>
          <Button size="sm" variant="secondary" onClick={() => void loadStatus()}>
            重试
          </Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {passwordEnabled
            ? localBypass
              ? "已启用。当前为本机/局域网访问,无需输入密码。"
              : "已启用。远程访问需要输入密码。"
            : "未启用。远程访问当前不需要密码,建议设置。"}
        </p>
      )}

      <div className="space-y-2">
        {requiresCurrent ? (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">当前密码</div>
            <Input
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
        ) : null}
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">
            {passwordEnabled ? "新密码(至少 4 位)" : "设置密码(至少 4 位)"}
          </div>
          <Input
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">确认密码</div>
          <Input
            type="password"
            autoComplete="new-password"
            value={confirmPassword}
            onChange={(e) => setConfirmPassword(e.target.value)}
          />
        </div>
      </div>

      <div className="flex items-center justify-between gap-2">
        <StatusLine msg={msg} />
        <div className="ml-auto flex gap-2">
          {passwordEnabled ? (
            <Button
              size="sm"
              variant="secondary"
              disabled={!configReady || busy}
              onClick={() => {
                setDisableError(null)
                setConfirmDisable(true)
              }}
            >
              关闭密码
            </Button>
          ) : null}
          <Button size="sm" onClick={submit} disabled={busy || !newPassword.trim()}>
            {busy ? "保存中…" : passwordEnabled ? "更新密码" : "启用密码"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDisable}
        onOpenChange={setConfirmDisable}
        title="关闭访问密码?"
        description="关闭后,远程访问将不再需要密码验证,立即生效。已配对设备的令牌不受影响。"
        confirmLabel="关闭密码"
        busy={disableBusy}
        error={disableError}
        onConfirm={() => void disablePassword()}
      />
    </section>
  )
}
