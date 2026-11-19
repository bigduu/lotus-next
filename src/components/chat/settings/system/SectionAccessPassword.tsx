import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { getErrorMessage } from "@services/api"
import { serviceFactory } from "@services/common/ServiceFactory"
import { ConfirmDialog } from "./ConfirmDialog"
import { StatusLine } from "./StatusLine"
import type { SectionMessage, SystemConfigApi } from "./useSystemConfig"

/** Manage the access password at the revision returned by the server. */
export function SectionAccessPassword({
  saveSection,
  configReady,
  onChange,
}: {
  saveSection: SystemConfigApi["saveSection"]
  /** Config loaded — required for the disable path (config patch). */
  configReady: boolean
  onChange?: () => void
}) {
  useUiLocale()
  const [statusLoading, setStatusLoading] = useState(true)
  const [statusError, setStatusError] = useState<string | null>(null)
  const [passwordEnabled, setPasswordEnabled] = useState(false)
  const [localBypass, setLocalBypass] = useState(false)
  const [revision, setRevision] = useState<number>()

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
      setRevision(status.revision)
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
      setMsg({ kind: "error", text: uiText("new_password_must_be_at_least_4_characters_94479073") })
      return
    }
    if (next !== confirmPassword.trim()) {
      setMsg({ kind: "error", text: uiText("the_passwords_do_not_match_58807745") })
      return
    }
    if (requiresCurrent && !currentPassword.trim()) {
      setMsg({ kind: "error", text: uiText("please_enter_the_current_password_f1790d33") })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      await serviceFactory.updateAccessPassword({
        expected_revision: revision,
        current_password: currentPassword.trim() || undefined,
        new_password: next,
      })
      setCurrentPassword("")
      setNewPassword("")
      setConfirmPassword("")
      setMsg({ kind: "ok", text: passwordEnabled ? uiText("password_updated_326400c7") : uiText("password_enabled_750d3be9") })
      onChange?.()
      await loadStatus()
    } catch (e) {
      setMsg({ kind: "error", text: getErrorMessage(e) })
      await loadStatus()
    } finally {
      setBusy(false)
    }
  }

  const disablePassword = async () => {
    setDisableBusy(true)
    setDisableError(null)
    try {
      if (revision === undefined) {
        await saveSection({ access_control: { password_enabled: false } })
      } else {
        await serviceFactory.updateAccessPassword({
          expected_revision: revision,
          action: "clear",
          current_password: currentPassword.trim() || undefined,
        })
      }
      setCurrentPassword("")
      setConfirmDisable(false)
      setMsg({ kind: "ok", text: uiText("access_password_disabled_44121148") })
      onChange?.()
      await loadStatus()
    } catch (e) {
      setDisableError(getErrorMessage(e))
      await loadStatus()
    } finally {
      setDisableBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">{uiText("access_password_f4f712d5")}</div>

      {statusLoading ? (
        <p className="text-xs text-muted-foreground">{uiText("loading_4927a53b")}</p>
      ) : statusError ? (
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-destructive">{uiText("could_not_load_status_8e9b5bd3")}{statusError}</p>
          <Button size="sm" variant="secondary" onClick={() => void loadStatus()}>
            {uiText("retry_b8784c8d")}</Button>
        </div>
      ) : (
        <p className="text-xs text-muted-foreground">
          {passwordEnabled
            ? localBypass
              ? uiText("enabled_password_entry_is_not_required_for_local_or_lan_3daa946f")
              : uiText("enabled_a_password_is_required_for_remote_access_65f39105")
            : uiText("access_password_off")}
        </p>
      )}

      <div className="space-y-2">
        {requiresCurrent ? (
          <div className="space-y-1">
            <div className="text-xs text-muted-foreground">{uiText("current_password_a114cfb6")}</div>
            <Input aria-label={uiText("current_password_a114cfb6")}
              type="password"
              autoComplete="current-password"
              value={currentPassword}
              onChange={(e) => setCurrentPassword(e.target.value)}
            />
          </div>
        ) : null}
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">
            {passwordEnabled ? uiText("new_password_at_least_4_characters_d91d6a45") : uiText("set_password_at_least_4_characters_51a6ae54")}
          </div>
          <Input aria-label={uiText(passwordEnabled ? "new_password_at_least_4_characters_d91d6a45" : "set_password_at_least_4_characters_51a6ae54")}
            type="password"
            autoComplete="new-password"
            value={newPassword}
            onChange={(e) => setNewPassword(e.target.value)}
          />
        </div>
        <div className="space-y-1">
          <div className="text-xs text-muted-foreground">{uiText("confirm_password_81b17bc0")}</div>
          <Input aria-label={uiText("confirm_password_81b17bc0")}
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
              disabled={statusLoading || !!statusError || (revision === undefined && !configReady)
                || busy || (requiresCurrent && !currentPassword.trim())}
              onClick={() => {
                setDisableError(null)
                setConfirmDisable(true)
              }}
            >
              {uiText("disable_password_a9e26288")}</Button>
          ) : null}
          <Button size="sm" onClick={submit} disabled={busy || statusLoading || !!statusError || !newPassword.trim()}>
            {busy ? uiText("saving_ff509c9b") : passwordEnabled ? uiText("update_password_82817084") : uiText("enable_password_fe979237")}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmDisable}
        onOpenChange={setConfirmDisable}
        title={uiText("disable_access_password_eaa845c9")}
        description={uiText("access_password_clear_tailscale")}
        confirmLabel={uiText("disable_password_a9e26288")}
        busy={disableBusy}
        error={disableError}
        onConfirm={() => void disablePassword()}
      />
    </section>
  )
}
