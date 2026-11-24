import { createSignal, Show } from "solid-js"
import { ChevronDown, Copy, ExternalLink, Globe2 } from "@lucide/solid"
import { copyText } from "@shared/utils/clipboard"
import { openExternalLink } from "@shared/utils/openExternalLink"

import { createUiText } from "./uiText"
import { Button } from "../ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../ui/dropdown-menu"
import {
  ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle,
} from "../ui/responsive-dialog"

export function ExternalLinkDialog(props: {
  url: string
  onClose: () => void
  onOpenInApp?: (url: string) => void
}) {
  const text = createUiText()
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string>()
  let panel: HTMLDivElement | undefined
  const canOpenInApp = () => {
    if (!props.onOpenInApp) return false
    try {
      const url = new URL(props.url)
      return Boolean(url.hostname) && (url.protocol === "http:" || url.protocol === "https:")
    } catch {
      return false
    }
  }
  const perform = async (action: () => void | Promise<unknown>, failure: string) => {
    if (busy()) return
    setBusy(true)
    setError(undefined)
    try {
      await action()
      props.onClose()
    } catch {
      setError(failure)
    } finally {
      setBusy(false)
    }
  }
  return <ResponsiveDialog open onOpenChange={(open) => { if (!open && !busy()) props.onClose() }}>
    <ResponsiveDialogContent data-streamdown="link-safety-modal" class="p-5" dismissable={!busy()}
      ref={(node: HTMLDivElement) => { panel = node }} onOpenAutoFocus={(event: Event) => {
        const active = document.activeElement
        if (panel?.contains(active) && active !== panel) event.preventDefault()
      }}>
      <ResponsiveDialogTitle class="flex items-center gap-2"><ExternalLink class="size-4" />{text("open_external_link_fd407c70")}</ResponsiveDialogTitle>
      <ResponsiveDialogDescription class="mt-2">{text("you_are_about_to_visit_an_external_website_d5fdb530")}</ResponsiveDialogDescription>
      <p class="my-3 max-h-32 overflow-y-auto break-all rounded-md bg-muted p-3 font-mono text-sm">{props.url}</p>
      <Show when={error()}><p role="alert" class="mb-3 text-sm text-destructive">{error()}</p></Show>
      <div class="flex gap-2">
        <Button class="min-w-0 flex-1" variant="outline" disabled={busy()}
          onClick={() => { void perform(() => copyText(props.url), text("could_not_copy_link_please_try_again_c54af852")) }}>
          <Copy />{text("copy_link_8e86f9b1")}
        </Button>
        <DropdownMenu modal={false} placement="bottom-end">
          <DropdownMenuTrigger as={Button} class="min-w-0 flex-1" disabled={busy()}>{text("open_link_a2639495")} <ChevronDown /></DropdownMenuTrigger>
          <DropdownMenuContent class="min-w-48">
            <Show when={canOpenInApp()}>
              <DropdownMenuItem onSelect={() => { void perform(() => props.onOpenInApp?.(props.url), text("could_not_open_the_link_in_the_app_please_try_again_769b498f")) }}>
                <Globe2 />{text("open_in_app_af4b79db")}
              </DropdownMenuItem>
            </Show>
            <DropdownMenuItem onSelect={() => { void perform(() => openExternalLink(props.url), text("could_not_open_the_link_in_your_default_browser_please__14278433")) }}>
              <ExternalLink />{text("open_in_default_browser_a489338a")}
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}
