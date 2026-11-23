import { createSignal, onCleanup, onSettled, Show } from "solid-js"
import { getErrorMessage } from "@services/api"
import { serviceFactory, type AccessStatusResponse } from "@services/common/ServiceFactory"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import type { SaveSystemSection } from "./createSystemConfig"
import { ConfirmSystemAction, StatusLine, SystemSection, type SectionMessage } from "./SystemFields"

export function AccessPasswordSettings(props: { configReady: boolean; saveSection: SaveSystemSection; onChange: () => void }) {
  const text = createUiText()
  const [status, setStatus] = createSignal<AccessStatusResponse | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [readError, setReadError] = createSignal<string | null>(null)
  const [current, setCurrent] = createSignal("")
  const [password, setPassword] = createSignal("")
  const [confirmation, setConfirmation] = createSignal("")
  const [busy, setBusy] = createSignal<"update" | "disable" | null>(null)
  const [confirmDisable, setConfirmDisable] = createSignal(false)
  const [message, setMessage] = createSignal<SectionMessage>(null)
  const [disableError, setDisableError] = createSignal<string | null>(null)
  let active = true
  let inFlight = false
  const needsCurrent = () => status()?.password_enabled && !status()?.local_bypass
  const cannotDisable = () => !status()?.password_enabled || loading() || !!busy()
    || (status()?.revision === undefined && !props.configReady) || (needsCurrent() && !current().trim())
  const passwordLabel = () => text(status()?.password_enabled ? "new_password_at_least_4_characters_d91d6a45" : "set_password_at_least_4_characters_51a6ae54")

  const load = async () => {
    if (!active) return
    setLoading(true)
    setReadError(null)
    try {
      const next = await serviceFactory.getAccessStatus()
      if (typeof next.password_enabled !== "boolean" || typeof next.local_bypass !== "boolean") throw new Error(text("operation_failed_0c3b4cf7"))
      if (active) setStatus(next)
    } catch (error) {
      if (active) { setStatus(null); setReadError(getErrorMessage(error)) }
    } finally {
      if (active) setLoading(false)
    }
  }
  onSettled(() => { void load() })
  onCleanup(() => { active = false })

  const apply = async (kind: "update" | "disable") => {
    const observed = status()
    if (!observed || loading() || inFlight || (needsCurrent() && !current().trim() && kind === "disable")) return
    const next = password().trim()
    if (kind === "update") {
      const invalid = next.length < 4 ? "new_password_must_be_at_least_4_characters_94479073"
        : next !== confirmation().trim() ? "the_passwords_do_not_match_58807745"
        : needsCurrent() && !current().trim() ? "please_enter_the_current_password_f1790d33" : null
      if (invalid) { setMessage({ kind: "error", text: text(invalid) }); return }
    } else if (!observed.password_enabled || (observed.revision === undefined && !props.configReady)) return
    inFlight = true
    setBusy(kind)
    setMessage(null)
    setDisableError(null)
    const currentPassword = current().trim() || undefined
    try {
      if (kind === "update") {
        await serviceFactory.updateAccessPassword({ expected_revision: observed.revision, current_password: currentPassword, new_password: next })
      } else if (observed.revision !== undefined) {
        await serviceFactory.updateAccessPassword({ expected_revision: observed.revision, action: "clear", current_password: currentPassword })
      } else {
        await props.saveSection({ access_control: { password_enabled: false } })
      }
      if (!active) return
      setCurrent("")
      setPassword("")
      setConfirmation("")
      setConfirmDisable(false)
      const key = kind === "disable" ? "access_password_disabled_44121148"
        : observed.password_enabled ? "password_updated_326400c7" : "password_enabled_750d3be9"
      setMessage({ kind: "ok", text: text(key) })
      props.onChange()
    } catch (error) {
      if (!active) return
      if (kind === "disable") setDisableError(getErrorMessage(error))
      else setMessage({ kind: "error", text: getErrorMessage(error) })
    } finally {
      if (active) { await load(); setBusy(null) }
      inFlight = false
    }
  }

  return (
    <SystemSection title={text("access_password_f4f712d5")}>
      <Show when={loading()}><p role="status" class="text-xs text-muted-foreground">{text("loading_4927a53b")}</p></Show>
      <Show when={readError()}><div class="flex items-center justify-between gap-2">
        <p role="alert" class="text-xs text-destructive">{text("could_not_load_status_8e9b5bd3")}{readError()}</p>
        <Button size="sm" variant="secondary" onClick={() => { void load() }}>{text("retry_b8784c8d")}</Button>
      </div></Show>
      <Show when={status()}>{(observed) => (
        <p class="text-xs text-muted-foreground">{text(!observed().password_enabled ? "access_password_off"
          : observed().local_bypass ? "enabled_password_entry_is_not_required_for_local_or_lan_3daa946f" : "enabled_a_password_is_required_for_remote_access_65f39105")}</p>
      )}</Show>
      <form class="space-y-2" onSubmit={(event) => { event.preventDefault(); void apply("update") }}>
        <Show when={needsCurrent()}>
          <label class="block space-y-1 text-xs text-muted-foreground">
            {text("current_password_a114cfb6")}
            <Input type="password" autocomplete="current-password" value={current()} disabled={!!busy()} onInput={(event) => setCurrent(event.currentTarget.value)} />
          </label>
        </Show>
        <label class="block space-y-1 text-xs text-muted-foreground">
          {passwordLabel()}
          <Input type="password" autocomplete="new-password" value={password()} disabled={!!busy()} onInput={(event) => setPassword(event.currentTarget.value)} />
        </label>
        <label class="block space-y-1 text-xs text-muted-foreground">
          {text("confirm_password_81b17bc0")}
          <Input type="password" autocomplete="new-password" value={confirmation()} disabled={!!busy()} onInput={(event) => setConfirmation(event.currentTarget.value)} />
        </label>
        <div class="flex items-center justify-between gap-2">
          <StatusLine message={message()} />
          <div class="ml-auto flex gap-2">
            <Show when={status()?.password_enabled}>
              <Button type="button" variant="secondary" size="sm" disabled={!!cannotDisable()} onClick={() => { setDisableError(null); setConfirmDisable(true) }}>
                {text("disable_password_a9e26288")}
              </Button>
            </Show>
            <Button type="submit" size="sm" disabled={!status() || loading() || !!busy() || !password().trim()}>
              {text(busy() === "update" ? "saving_ff509c9b" : status()?.password_enabled ? "update_password_82817084" : "enable_password_fe979237")}
            </Button>
          </div>
        </div>
      </form>
      <ConfirmSystemAction open={confirmDisable()} busy={busy() === "disable"} title={text("disable_access_password_eaa845c9")}
        description={text("access_password_clear_tailscale")} confirmLabel={text("disable_password_a9e26288")} error={disableError()}
        onClose={() => setConfirmDisable(false)} onConfirm={() => { void apply("disable") }} />
    </SystemSection>
  )
}
