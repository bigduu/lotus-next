import { lazy, Suspense, useRef, type ComponentProps } from "react"
import * as DialogPrimitive from "@radix-ui/react-dialog"
import { Dialog } from "@/components/ui/dialog"
import { isCommandComposing } from "@/lib/commandComposition"
import { restoreCommandFocus } from "@/lib/commandFocusReturn"
import { useUiText } from "@shared/i18n/ui"
import type { CommandPalette as PaletteComponent } from "./CommandPalette"

type Props = ComponentProps<typeof PaletteComponent>
const Palette = lazy(() => import("./CommandPalette").then((module) => ({ default: module.CommandPalette })))

/** Keep dismissal and focus ownership available while search navigation loads. */
function PaletteLoading({ onClose, getReturnFocusTarget }: Props) {
  const uiText = useUiText()
  const opener = useRef(document.activeElement instanceof HTMLElement ? document.activeElement : null)
  return <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <DialogPrimitive.Overlay className="fixed inset-0 z-[130] flex items-start justify-center bg-black/50 p-4 pt-[12vh]">
      <DialogPrimitive.Content data-command-palette="" aria-describedby={undefined}
        className="w-full max-w-lg overflow-hidden rounded-2xl border bg-popover shadow-2xl"
        onEscapeKeyDown={(event) => { if (isCommandComposing(event)) event.preventDefault() }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          queueMicrotask(() => {
            // The loaded dialog owns autofocus when it replaces this shell.
            if (!document.querySelector("[data-command-palette]")) {
              restoreCommandFocus(getReturnFocusTarget ? getReturnFocusTarget() : opener.current)
            }
          })
        }}>
        <DialogPrimitive.Title className="sr-only">{uiText("search_sessions_or_actions_b2a0f9e8")}</DialogPrimitive.Title>
        <p role="status" className="px-3 py-6 text-center text-sm text-muted-foreground">{uiText("loading_4927a53b")}</p>
      </DialogPrimitive.Content>
    </DialogPrimitive.Overlay>
  </Dialog>
}

export function LazyCommandPalette(props: Props) {
  if (!props.open) return null
  return <Suspense fallback={<PaletteLoading {...props} />}><Palette {...props} /></Suspense>
}
