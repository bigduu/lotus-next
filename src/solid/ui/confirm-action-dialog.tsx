import { Show } from "solid-js"
import type { JSX } from "@solidjs/web"
import { createUiText } from "../shell/uiText"
import { Button } from "./button"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "./responsive-dialog"

export function ConfirmActionDialog(props: {
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
