import { ArrowLeft } from "@lucide/solid"
import { createUniqueId, onSettled } from "solid-js"
import type { JSX } from "@solidjs/web"
import { isCommandComposing } from "@/lib/commandComposition"
import { createUiText } from "./uiText"
import { Button } from "../ui/button"

export function SettingsFrame(props: { onClose: () => void; children: JSX.Element }) {
  const text = createUiText()
  const titleId = createUniqueId()
  let title: HTMLHeadingElement | undefined
  onSettled(() => { title?.focus({ preventScroll: true }) })

  return (
    <main class="motion-page-enter flex h-full min-h-0 w-full flex-1 flex-col bg-background"
      data-slot="settings-page" aria-labelledby={titleId}
      onKeyDown={(event) => {
        if (event.key !== "Escape" || event.defaultPrevented || isCommandComposing(event)) return
        if (event.target.closest('[role="dialog"], [role="alertdialog"], [role="combobox"], [role="listbox"], [role="menu"], [data-slot="popover-content"], select')) return
        event.preventDefault()
        props.onClose()
      }}>
      <header class="flex shrink-0 items-center gap-4 border-b p-4 sm:px-6"
        style={{ "border-bottom-color": "color-mix(in oklab, var(--border) 70%, transparent)" }}>
        <Button type="button" size="sm" variant="ghost" onClick={props.onClose}>
          <ArrowLeft aria-hidden="true" />
          {text("back_to_chat_5b8ac6b1")}
        </Button>
        <div class="h-5 w-px shrink-0 bg-border" aria-hidden="true" />
        <h1 id={titleId} ref={(element) => { title = element }} tabindex={-1}
          class="min-w-0 text-base font-semibold tracking-tight outline-none sm:text-lg">
          {text("system_settings_68ea5dd4")}
        </h1>
      </header>
      {props.children}
    </main>
  )
}
