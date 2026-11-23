import { ShieldAlert } from "@lucide/solid"
import { createEffect, createSignal, createUniqueId, onSettled, Show } from "solid-js"
import type { TOptions } from "i18next"
import i18n from "@shared/i18n/runtime"
import { appStore } from "@shared/store/appStore/state"
import { newSessionPermissionStore } from "@shared/store/newSessionPermissionState"
import { parseSessionPermissionMode, sessionPermissionRevision } from "@services/chat/AgentService"
import { composerControlClassName } from "@/components/chat/composerStyles"
import { cn } from "@/lib/utils"
import { createUiLocale } from "../../shell/uiText"
import { createStoreSelector } from "../../state/createStoreSelector"
import { Button } from "../../ui/button"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "../../ui/dialog"
import { Select } from "../../ui/select"

const options = [
  { value: "default", label: "Default" }, { value: "bypass", label: "Bypass" }, { value: "auto", label: "Auto" },
]
const controlClass = cn(composerControlClassName,
  "border-0 bg-transparent shadow-none dark:bg-transparent dark:hover:bg-accent [&>svg:last-child]:size-3")

function createPermissionText() {
  const locale = createUiLocale()
  return (key: string, values?: TOptions) => String(i18n.t(`chat.permissionMode.${key}`, { ...values, lng: locale() }))
}

export function NewSessionPermissionControl() {
  const text = createPermissionText()
  const mode = createStoreSelector(newSessionPermissionStore, (state) => state.mode)
  onSettled(() => { void newSessionPermissionStore.getState().refresh() })
  return (
    <div class="flex min-w-0 items-center" data-permission-scope="new-session" title={text(`help.${mode()}`)}>
      <ShieldAlert aria-hidden="true" class={cn("size-4 shrink-0", mode() === "auto" ? "text-amber-500" : "text-muted-foreground")} />
      <Select options={options} label={text("label")} value={mode()} size="sm" placement="top-start"
        class={cn(controlClass, mode() === "auto" && "text-amber-700 dark:text-amber-400")}
        onValueChange={(value) => {
          const mode = parseSessionPermissionMode(value)
          if (mode) newSessionPermissionStore.getState().setMode(mode)
        }} />
    </div>
  )
}

export function PermissionModeControl(props: { sessionId: string; title: string }) {
  const text = createPermissionText()
  const id = createUniqueId()
  const chat = createStoreSelector(appStore, (state) => state.chats.find((entry) => entry.id === props.sessionId))
  const request = createStoreSelector(appStore, (state) => state.permissionModeRequests[props.sessionId])
  const mode = () => parseSessionPermissionMode(chat()?.config.permissionMode)
  const etag = () => chat()?.config.permissionModeEtag
  const inherits = () => chat()?.config.supervisorDispatchInheritsPermissionMode === true
  const [confirmation, setConfirmation] = createSignal<{ etag: string; inherits: boolean } | null>(null)
  const canConfirm = () => {
    const pending = confirmation()
    return pending !== null && pending.etag === etag() && pending.inherits === inherits()
  }
  const refresh = () => appStore.getState().refreshSessionPermissionMode(props.sessionId)
  const valid = () => Boolean(mode() && sessionPermissionRevision(etag()) !== null)
  const ready = () => request()?.status === "ready" && valid()
  const saving = () => request()?.status === "saving"
  const busy = () => Boolean((chat() && !request()) || request()?.status === "loading" || saving())
  const confirmed = () => valid() && (ready() || saving())
  const inheritanceNote = () => inherits() ? ` ${text("inheritsForDispatches")}` : ""
  const help = () => confirmed() ? `${text(`help.${mode()}`)}${inheritanceNote()}` : text("readRequired")
  const error = () => request()?.error ? text(`errors.${request()?.error}`) : null
  let control!: HTMLElement
  let cancel!: HTMLButtonElement
  createEffect(() => Boolean(chat() && !request()), (read) => { if (read) void refresh() })
  createEffect(canConfirm, (valid) => { if (!valid && confirmation()) setConfirmation(null) })

  return (
    <section ref={(element) => { control = element }} data-variant="composer" aria-label={text("section")}
      title={[help(), error()].filter(Boolean).join(" ")} class="flex min-w-0 max-w-full flex-wrap items-center gap-1">
      <ShieldAlert aria-hidden="true" class={cn("size-4 shrink-0", confirmed() && mode() === "auto" ? "text-amber-500" : "text-muted-foreground")} />
      <Select options={options} label={text("label")} value={confirmed() ? mode() ?? "" : ""} size="sm" placement="top-start"
        placeholder={text(request()?.status === "unsupported" ? "unavailable" : busy() ? "loading" : "unconfirmed")}
        class={cn(controlClass, "disabled:opacity-70", confirmed() && mode() === "auto" && "text-amber-700 dark:text-amber-400")}
        describedBy={`${id}-permission-help${error() ? ` ${id}-permission-error` : ""}`}
        disabled={!ready()}
        onValueChange={(value) => {
          const next = parseSessionPermissionMode(value)
          const revision = etag()
          if (!ready() || !next || next === mode() || !revision) return
          if (next === "auto") setConfirmation({ etag: revision, inherits: inherits() })
          else void appStore.getState().changeSessionPermissionMode(props.sessionId, next, revision)
        }} />
      <span role="status" class="sr-only">{saving() ? text("saving") : busy() ? text("loading") : null}</span>
      <p id={`${id}-permission-help`} class="sr-only">{help()}</p>
      <Show when={error()}>
        <Button size="sm" variant="ghost" class="h-7 px-1.5 text-xs" disabled={busy()} onClick={() => void refresh()}>
          {text("refresh")}
        </Button>
        <p id={`${id}-permission-error`} role="alert" class="basis-full max-w-sm break-words text-xs text-destructive">{error()}</p>
      </Show>
      <Dialog open={canConfirm()} onOpenChange={(open) => { if (!open) setConfirmation(null) }}>
        <DialogContent
          onOpenAutoFocus={(event: Event) => { event.preventDefault(); cancel?.focus() }}
          onCloseAutoFocus={(event: Event) => { event.preventDefault(); control?.querySelector<HTMLElement>('[data-slot="select-trigger"]')?.focus() }}>
          <DialogTitle class="flex items-center gap-2">
            <ShieldAlert class="size-5 shrink-0 text-amber-500" />{text("confirmTitle")}
          </DialogTitle>
          <DialogDescription class="break-words">{text("confirmDescription", { title: props.title })}{inheritanceNote()}</DialogDescription>
          <Show when={!ready()}><p role="alert" class="text-sm text-destructive">{text("readRequired")}</p></Show>
          <div class="flex justify-end gap-2">
            <Button ref={(element) => { cancel = element }} variant="outline" onClick={() => setConfirmation(null)}>{text("cancel")}</Button>
            <Button variant="destructive" disabled={!ready()} onClick={() => {
              const pending = confirmation()
              if (!ready() || !pending || !canConfirm()) return
              setConfirmation(null)
              void appStore.getState().changeSessionPermissionMode(props.sessionId, "auto", pending.etag, pending.inherits)
            }}>{text("confirm")}</Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  )
}
