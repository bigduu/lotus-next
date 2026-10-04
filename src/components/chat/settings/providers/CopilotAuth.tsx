import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useCallback, useEffect, useState } from "react"
import { Check, Copy, RefreshCw } from "lucide-react"
import { settingsService, type DeviceCodeInfo } from "@services/config/SettingsService"
import { getErrorMessage } from "@services/api"
import { Button } from "@/components/ui/button"
import { Badge } from "@/components/ui/badge"

type AuthStatus = "unknown" | "authenticated" | "not_authenticated"

function formatRemaining(seconds: number): string {
  const m = Math.floor(seconds / 60)
  const s = seconds % 60
  return `${m}:${String(s).padStart(2, "0")}`
}

/**
 * GitHub Copilot device-code OAuth card.
 *
 * - status check + manual refresh
 * - device-code flow with copy-user-code button and expiry countdown
 * - completeCopilotAuth long-polls the backend while the code is shown
 */
export function CopilotAuth() {
  useUiLocale()
  const [status, setStatus] = useState<AuthStatus>("unknown")
  const [checking, setChecking] = useState(false)
  const [device, setDevice] = useState<DeviceCodeInfo | null>(null)
  const [remaining, setRemaining] = useState(0)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const refreshStatus = useCallback(async () => {
    setChecking(true)
    try {
      const s = await settingsService.getCopilotAuthStatus()
      setStatus(s.authenticated ? "authenticated" : "not_authenticated")
      setError(null)
    } catch (e) {
      setStatus("unknown")
      setError(getErrorMessage(e))
    } finally {
      setChecking(false)
    }
  }, [])

  useEffect(() => {
    void refreshStatus()
  }, [refreshStatus])

  // Expiry countdown while a device code is pending.
  useEffect(() => {
    if (!device) return
    setRemaining(device.expires_in)
    const timer = setInterval(() => setRemaining((r) => (r > 0 ? r - 1 : 0)), 1000)
    return () => clearInterval(timer)
  }, [device])

  const login = async () => {
    setBusy(true)
    setError(null)
    try {
      const d = await settingsService.startCopilotAuth()
      setDevice(d)
      try {
        window.open(d.verification_uri, "_blank", "noopener")
      } catch {
        /* popup blocked — user can click the link */
      }
      // Backend long-polls GitHub until the user finishes authorization.
      await settingsService.completeCopilotAuth({
        device_code: d.device_code,
        interval: d.interval ?? 5,
        expires_in: d.expires_in,
      })
      setStatus("authenticated")
    } catch (e) {
      setError(getErrorMessage(e))
      void refreshStatus()
    } finally {
      setDevice(null)
      setBusy(false)
    }
  }

  const logout = async () => {
    setError(null)
    try {
      await settingsService.logoutCopilot()
      setStatus("not_authenticated")
    } catch (e) {
      setError(getErrorMessage(e))
    }
  }

  const copyCode = async () => {
    if (!device) return
    try {
      await navigator.clipboard.writeText(device.user_code)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      setError(uiText("could_not_copy_select_and_copy_the_code_manually_7c49600d"))
    }
  }

  return (
    <div className="space-y-2 rounded-md border bg-muted/30 p-2.5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-medium text-muted-foreground">{uiText("copilot_authorization_c3d9d8de")}</span>
        <div className="flex items-center gap-1.5">
          {status === "authenticated" ? (
            <Badge className="bg-emerald-500/15 text-emerald-600 dark:text-emerald-400" variant="secondary">
              {uiText("signed_in_0a01eee1")}</Badge>
          ) : status === "not_authenticated" ? (
            <Badge variant="secondary">{uiText("signed_out_c1f65837")}</Badge>
          ) : (
            <Badge variant="outline">{uiText("unknown_4d8c1c5b")}</Badge>
          )}
          <button
            type="button"
            onClick={() => void refreshStatus()}
            aria-label={uiText("refresh_status_802a407c")}
            className="rounded p-1 text-muted-foreground hover:text-foreground"
            disabled={checking}
          >
            <RefreshCw className={checking ? "size-3.5 animate-spin" : "size-3.5"} />
          </button>
        </div>
      </div>

      {device ? (
        <div className="space-y-1.5 text-sm">
          <p>
            {uiText("open_c771248e")}{" "}
            <a
              href={device.verification_uri}
              target="_blank"
              rel="noopener noreferrer"
              className="text-primary underline"
            >
              {device.verification_uri}
            </a>{" "}
            {uiText("and_enter_the_code_7aa88967")}</p>
          <div className="flex items-center gap-2">
            <span className="font-mono text-base font-semibold tracking-wider">{device.user_code}</span>
            <Button size="sm" variant="secondary" className="h-7 px-2" onClick={() => void copyCode()}>
              {copied ? <Check className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
              {copied ? uiText("copied_8f6f8d97") : uiText("copy_63d90d97")}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            {remaining > 0 ? uiText("code_expires_in_e5dcbf33", { v0: formatRemaining(remaining) }) : uiText("code_expired_sign_in_again_bc54f564")}
            {remaining > 0 ? uiText("this_completes_automatically_after_authorization_ec18f4d2") : ""}
          </p>
        </div>
      ) : status === "authenticated" ? (
        <div className="flex items-center justify-between text-sm">
          <span className="text-muted-foreground">{uiText("github_copilot_account_connected_b4129fa2")}</span>
          <Button size="sm" variant="secondary" onClick={() => void logout()}>
            {uiText("sign_out_498e1d59")}</Button>
        </div>
      ) : (
        <Button size="sm" onClick={() => void login()} disabled={busy}>
          {busy ? uiText("signing_in_3f06ed8f") : uiText("sign_in_to_github_copilot_be6015e8")}
        </Button>
      )}

      {error ? <p className="text-xs text-destructive">{error}</p> : null}
    </div>
  )
}
