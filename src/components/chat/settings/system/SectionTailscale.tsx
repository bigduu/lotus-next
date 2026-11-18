import { useCallback, useEffect, useId, useRef, useState, type MouseEvent } from "react"
import { Button } from "@/components/ui/button"
import { isTauriEnvironment } from "@/utils/environment"
import { getErrorMessage, isApiError } from "@services/api"
import { settingsService, type TailscaleAccessAction, type TailscaleAccessStatus } from "@services/config/SettingsService"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { copyText } from "@shared/utils/clipboard"
import { openExternalLink } from "@shared/utils/openExternalLink"

const STATE_MESSAGE = {
  not_installed: "tailscale_not_installed",
  unavailable: "tailscale_unavailable",
  disconnected: "tailscale_disconnected",
  login_required: "tailscale_login_required",
  device_approval_required: "tailscale_device_approval",
  password_required: "tailscale_password_required",
  https_required: "tailscale_https_required",
  ready: "tailscale_ready",
  starting: "tailscale_starting",
  active: "tailscale_active",
  port_in_use: "tailscale_port_in_use",
  tailnet_changed: "tailscale_network_changed",
  serve_failed: "tailscale_serve_failed",
} as const satisfies Record<TailscaleAccessStatus["state"], string>

function trustedUrl(value: string | null | undefined, kind: "access" | "account"): string | undefined {
  if (!value) return
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password) return
    if (kind === "account" && url.hostname === "login.tailscale.com" && !url.port) return url.href
    if (kind === "access" && url.hostname.endsWith(".ts.net")
      && ["", "8443", "10000"].includes(url.port)
      && url.pathname === "/" && !url.search && !url.hash) return url.href
  } catch {
    return
  }
}

export function SectionTailscale({ passwordRevision }: { passwordRevision: number }) {
  useUiLocale()
  const heading = useId()
  const [status, setStatus] = useState<TailscaleAccessStatus | null>()
  const [error, setError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const request = useRef({ generation: 0, mutating: false })

  const load = useCallback(async (signal?: AbortSignal) => {
    if (request.current.mutating) return
    const generation = ++request.current.generation
    const isCurrent = () => !signal?.aborted && generation === request.current.generation
    try {
      const result = await settingsService.getTailscaleAccess(signal)
      if (isCurrent()) {
        setStatus((previous) => {
          // Tailscale can report the URL only when the login is first started.
          if (result.state === "login_required" && !result.action_url && previous?.state === "login_required") {
            return { ...result, action_url: previous.action_url }
          }
          return result
        })
        setError(undefined)
      }
    } catch (error) {
      if (!isCurrent()) return
      if (isApiError(error) && [403, 404].includes(error.status)) setStatus(null)
      else setError(getErrorMessage(error))
    }
  }, [])

  useEffect(() => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  }, [load, passwordRevision])

  useEffect(() => {
    if (busy || !status || (status.state !== "starting" && !status.action_url)) return
    const controller = new AbortController()
    const timer = window.setTimeout(() => void load(controller.signal), 2000)
    return () => { window.clearTimeout(timer); controller.abort() }
  }, [load, busy, status])

  const run = async (action?: TailscaleAccessAction) => {
    if (request.current.mutating) return
    setBusy(true)
    setCopied(false)
    setError(undefined)
    try {
      if (action) {
        request.current.generation += 1
        request.current.mutating = true
        setStatus(await settingsService.setTailscaleAccess(action))
      } else await load()
    } catch (error) {
      setError(getErrorMessage(error))
    } finally {
      if (action) request.current.mutating = false
      setBusy(false)
    }
  }

  if (status === null) return null

  const accessUrl = status?.state === "active" ? trustedUrl(status.url, "access") : undefined
  const actionUrl = trustedUrl(status?.action_url, "account")
  const connect = status?.state === "disconnected" || status?.state === "login_required"
  const enable = status?.state === "ready" || status?.state === "serve_failed"
  const copy = async () => {
    if (!accessUrl) return
    try {
      await copyText(accessUrl)
      setCopied(true)
    } catch {
      setError(uiText("tailscale_copy_failed"))
    }
  }
  const openOnDesktop = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!isTauriEnvironment()) return
    event.preventDefault()
    void openExternalLink(event.currentTarget.href).catch(() => {
      setError(uiText("could_not_open_the_link_in_your_default_browser_please__14278433"))
    })
  }

  return (
    <section aria-labelledby={heading} className="space-y-2 rounded-lg border p-3">
      <h3 id={heading} className="text-xs font-medium text-muted-foreground">{uiText("tailscale_title")}</h3>
      <p aria-live="polite" className="text-xs text-muted-foreground">
        {status ? uiText(STATE_MESSAGE[status.state]) : !error ? uiText("loading_4927a53b") : null}
      </p>
      {status?.tailnet && <p className="text-xs">{uiText("tailscale_network", { name: status.tailnet })}</p>}
      {accessUrl && (
        <div className="flex flex-wrap items-center gap-2">
          <a className="break-all text-xs text-primary underline" href={accessUrl} target="_blank" rel="noreferrer" onClick={openOnDesktop}>{accessUrl}</a>
          <Button size="sm" variant="secondary" onClick={() => void copy()}>
            {uiText(copied ? "tailscale_copied" : "tailscale_copy_url")}
          </Button>
        </div>
      )}
      {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
      <div className="flex flex-wrap items-center gap-2">
        {status?.state === "not_installed" && (
          <Button asChild size="sm" variant="secondary">
            <a href="https://tailscale.com/download" target="_blank" rel="noreferrer" onClick={openOnDesktop}>{uiText("tailscale_download")}</a>
          </Button>
        )}
        {actionUrl && (
          <Button asChild size="sm">
            <a href={actionUrl} target="_blank" rel="noreferrer" onClick={openOnDesktop}>
              {uiText(status?.state === "https_required" ? "tailscale_configure_https"
                : status?.state === "device_approval_required" ? "tailscale_open_devices" : "tailscale_sign_in")}
            </a>
          </Button>
        )}
        {connect && (
          <Button size="sm" variant={actionUrl ? "secondary" : "default"} disabled={busy} onClick={() => void run("connect")}>
            {uiText(actionUrl ? "tailscale_regenerate_login" : "tailscale_connect")}
          </Button>
        )}
        {enable && <Button size="sm" disabled={busy} onClick={() => void run("enable")}>{uiText("tailscale_enable")}</Button>}
        {status?.enabled && (
          <Button size="sm" variant="outline" disabled={busy} onClick={() => void run("disable")}>{uiText("tailscale_disable")}</Button>
        )}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void run()}>{uiText("refresh_aee88743")}</Button>
      </div>
    </section>
  )
}
