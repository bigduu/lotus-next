import { createEffect, createSignal, createUniqueId, onCleanup, Show } from "solid-js"
import type { JSX } from "@solidjs/web"
import { getErrorMessage, isApiError } from "@services/api"
import { settingsService, type TailscaleAccessAction, type TailscaleAccessStatus } from "@services/config/SettingsService"
import { copyText } from "@shared/utils/clipboard"
import { openExternalLink } from "@shared/utils/openExternalLink"
import { isTauriEnvironment } from "@/utils/environment"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"

const stateText = {
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

function trustedUrl(value: string | null | undefined, type: "access" | "account") {
  if (!value) return undefined
  try {
    const url = new URL(value)
    if (url.protocol !== "https:" || url.username || url.password) return undefined
    if (type === "account" && url.hostname === "login.tailscale.com" && !url.port) return url.href
    if (type === "access" && url.hostname.endsWith(".ts.net") && ["", "8443", "10000"].includes(url.port)
      && url.pathname === "/" && !url.search && !url.hash) return url.href
  } catch { return undefined }
}

export function TailscaleSettings(props: { passwordRevision: number }) {
  const text = createUiText()
  const heading = createUniqueId()
  const [status, setStatus] = createSignal<TailscaleAccessStatus | null | undefined>()
  const [error, setError] = createSignal<string>()
  const [busy, setBusy] = createSignal(false)
  const [copied, setCopied] = createSignal(false)
  let writing = false
  let generation = 0
  let active = true
  onCleanup(() => { active = false })

  const load = async (signal?: AbortSignal) => {
    if (writing) return
    const visit = ++generation
    const current = () => active && !signal?.aborted && generation === visit
    try {
      const next = await settingsService.getTailscaleAccess(signal)
      if (current()) {
        setStatus((previous) => next.state === "login_required" && !next.action_url && previous?.state === "login_required"
          ? { ...next, action_url: previous.action_url } : next)
        setError(undefined)
      }
    } catch (failure) {
      if (!current()) return
      if (isApiError(failure) && [403, 404].includes(failure.status)) setStatus(null)
      else setError(getErrorMessage(failure))
    }
  }

  createEffect(() => props.passwordRevision, () => {
    const controller = new AbortController()
    void load(controller.signal)
    return () => controller.abort()
  })
  createEffect(() => ({ busy: busy(), status: status() }), (current) => {
    if (current.busy || !current.status || (current.status.state !== "starting" && !current.status.action_url)) return
    const controller = new AbortController()
    const timer = setTimeout(() => { void load(controller.signal) }, 2000)
    return () => { clearTimeout(timer); controller.abort() }
  })

  const run = async (action?: TailscaleAccessAction) => {
    if (busy()) return
    setBusy(true)
    setCopied(false)
    setError(undefined)
    try {
      if (action) {
        generation += 1
        writing = true
        const next = await settingsService.setTailscaleAccess(action)
        if (active) setStatus(next)
      } else await load()
    } catch (failure) {
      if (active) setError(getErrorMessage(failure))
    } finally {
      writing = false
      if (active) setBusy(false)
    }
  }

  const accessUrl = () => status()?.state === "active" ? trustedUrl(status()?.url, "access") : undefined
  const actionUrl = () => trustedUrl(status()?.action_url, "account")
  const copy = async (url: string) => {
    try { await copyText(url); if (active && accessUrl() === url) setCopied(true) }
    catch { if (active) setError(text("tailscale_copy_failed")) }
  }
  const openOnDesktop: JSX.EventHandler<HTMLAnchorElement, MouseEvent> = (event) => {
    if (!isTauriEnvironment()) return
    event.preventDefault()
    void openExternalLink(event.currentTarget.href).catch(() => {
      if (active) setError(text("could_not_open_the_link_in_your_default_browser_please__14278433"))
    })
  }

  return (
    <Show when={status() !== null}>
      <section aria-labelledby={heading} class="space-y-2 rounded-lg border p-3">
        <h3 id={heading} class="text-xs font-medium text-muted-foreground">{text("tailscale_title")}</h3>
        <p aria-live="polite" class="text-xs text-muted-foreground">
          {status() ? text(stateText[status()!.state]) : error() ? null : text("loading_4927a53b")}
        </p>
        <Show when={status()?.tailnet}>{(name) => <p class="text-xs">{text("tailscale_network", { name: name() })}</p>}</Show>
        <Show when={accessUrl()}>{(url) => (
          <div class="flex flex-wrap items-center gap-2">
            <a class="break-all text-xs text-primary underline" href={url()} target="_blank" rel="noreferrer" onClick={openOnDesktop}>{url()}</a>
            <Button size="sm" variant="secondary" onClick={() => { void copy(url()) }}>{text(copied() ? "tailscale_copied" : "tailscale_copy_url")}</Button>
          </div>
        )}</Show>
        <Show when={error()}><p role="alert" class="text-xs text-destructive">{error()}</p></Show>
        <div class="flex flex-wrap items-center gap-2">
          <Show when={status()?.state === "not_installed"}>
            <a href="https://tailscale.com/download" class="inline-flex h-8 items-center rounded-md bg-secondary px-3 text-sm text-secondary-foreground hover:bg-secondary/80"
              target="_blank" rel="noreferrer" onClick={openOnDesktop}>{text("tailscale_download")}</a>
          </Show>
          <Show when={actionUrl()}>{(url) => (
            <a href={url()} class="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm text-primary-foreground hover:bg-primary/90"
              target="_blank" rel="noreferrer" onClick={openOnDesktop}>
              {text(status()?.state === "https_required" ? "tailscale_configure_https" : status()?.state === "device_approval_required" ? "tailscale_open_devices" : "tailscale_sign_in")}
            </a>
          )}</Show>
          <Show when={status()?.state === "disconnected" || status()?.state === "login_required"}>
            <Button size="sm" variant={actionUrl() ? "secondary" : "default"} disabled={busy()} onClick={() => { void run("connect") }}>
              {text(actionUrl() ? "tailscale_regenerate_login" : "tailscale_connect")}
            </Button>
          </Show>
          <Show when={status()?.state === "ready" || status()?.state === "serve_failed"}>
            <Button size="sm" disabled={busy()} onClick={() => { void run("enable") }}>{text("tailscale_enable")}</Button>
          </Show>
          <Show when={status()?.enabled}>
            <Button size="sm" variant="outline" disabled={busy()} onClick={() => { void run("disable") }}>{text("tailscale_disable")}</Button>
          </Show>
          <Button size="sm" variant="ghost" disabled={busy()} onClick={() => { void run() }}>{text("refresh_aee88743")}</Button>
        </div>
      </section>
    </Show>
  )
}
