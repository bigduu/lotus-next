import type { JSX } from "@solidjs/web"
import { createSignal, onCleanup, Show } from "solid-js"
import { getErrorMessage } from "@services/api"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Switch } from "../../ui/switch"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "../../ui/responsive-dialog"

export type SectionMessage = { kind: "ok" | "error"; text: string } | null

export function StatusLine(props: { message: SectionMessage }) {
  return <Show when={props.message}>{(message) => (
    <p role={message().kind === "error" ? "alert" : "status"}
      class={message().kind === "error" ? "text-xs text-destructive" : "text-xs text-muted-foreground"}>{message().text}</p>
  )}</Show>
}

export function createSystemAction() {
  const text = createUiText()
  const [busy, setBusy] = createSignal(false)
  const [message, setMessage] = createSignal<SectionMessage>(null)
  let active = true
  let inFlight = false
  onCleanup(() => { active = false })
  const run = async (commit: () => Promise<void>, success: Parameters<typeof text>[0] = "saved_1bd91a7d") => {
    if (inFlight) return
    inFlight = true
    setBusy(true)
    setMessage(null)
    try {
      await commit()
      if (active) setMessage({ kind: "ok", text: text(success) })
    } catch (error) {
      if (active) setMessage({ kind: "error", text: getErrorMessage(error) })
    } finally {
      inFlight = false
      if (active) setBusy(false)
    }
  }
  return { busy, message, setMessage, run }
}

export function SystemSection(props: { title: string; children: JSX.Element; class?: string }) {
  return (
    <section class={`space-y-2 rounded-lg border p-3 ${props.class ?? ""}`}>
      <h3 class="text-xs font-medium text-muted-foreground">{props.title}</h3>
      {props.children}
    </section>
  )
}

export function SettingToggle(props: {
  label: string; description?: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void
}) {
  return (
    <div class="flex items-center justify-between gap-2">
      <div class="min-w-0">
        <div class="text-sm">{props.label}</div>
        <Show when={props.description}><p class="text-xs text-muted-foreground">{props.description}</p></Show>
      </div>
      <Switch aria-label={props.label} checked={props.checked} disabled={props.disabled} onCheckedChange={props.onChange} />
    </div>
  )
}

export function SaveSection(props: { disabled?: boolean; action: ReturnType<typeof createSystemAction>; onSave: () => void }) {
  const text = createUiText()
  return (
    <div class="flex items-center justify-between gap-2">
      <StatusLine message={props.action.message()} />
      <Button size="sm" class="ml-auto" disabled={props.disabled || props.action.busy()} onClick={props.onSave}>
        {text(props.action.busy() ? "saving_ff509c9b" : "save_a3030bf8")}
      </Button>
    </div>
  )
}

export function ConfirmSystemAction(props: {
  open: boolean; title: string; description: JSX.Element; confirmLabel: string; busy?: boolean;
  error?: string | null; onClose: () => void; onConfirm: () => void;
}) {
  const text = createUiText()
  return (
    <ResponsiveDialog open={props.open} onOpenChange={(open) => { if (!open && !props.busy) props.onClose() }}>
      <ResponsiveDialogContent class="gap-0 p-4 sm:max-w-sm" dismissable={!props.busy}>
        <ResponsiveDialogTitle>{props.title}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription class="mt-2 leading-relaxed">{props.description}</ResponsiveDialogDescription>
        <Show when={props.error}><p role="alert" class="mt-2 text-xs text-destructive">{props.error}</p></Show>
        <div class="mt-4 flex justify-end gap-2">
          <Button size="sm" variant="secondary" disabled={props.busy} onClick={props.onClose}>{text("cancel_2cd0f3be")}</Button>
          <Button size="sm" variant="destructive" disabled={props.busy} onClick={props.onConfirm}>
            {props.busy ? text("processing_d3d21191") : props.confirmLabel}
          </Button>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  )
}
