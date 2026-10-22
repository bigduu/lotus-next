import { lazy, Suspense, useState, type ComponentProps } from "react"
import { useUiText } from "@shared/i18n/ui"
import { ErrorBoundary } from "@/components/app/ErrorBoundary"
import { Button } from "@/components/ui/button"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "@/components/ui/responsive-dialog"
import type { ConversationClearDialogContent } from "./ConversationClearDialogContent"

type Module = { ConversationClearDialogContent: typeof ConversationClearDialogContent }
const load = () => import("./ConversationClearDialogContent")
type Props = ComponentProps<typeof ConversationClearDialogContent>

function Pending({ onClose, failed = false }: Pick<Props, "onClose"> & { failed?: boolean }) {
  const t = useUiText()
  return <ResponsiveDialog open onOpenChange={(open) => { if (!open) onClose() }}>
    <ResponsiveDialogContent className="gap-3 p-4 sm:pb-4">
      <ResponsiveDialogTitle>{t("conversation_clear_title")}</ResponsiveDialogTitle>
      <ResponsiveDialogDescription>{t(failed ? "conversation_clear_load_failed" : "loading_4927a53b")}</ResponsiveDialogDescription>
      <Button variant="secondary" size="sm" onClick={onClose}>{t("cancel_2cd0f3be")}</Button>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}

/** Load the optional confirmation when requested, with a cancellable fallback. */
export function ConversationClearDialog({ loadDialog = load, ...props }: Props & {
  /** Synthetic loader seam; production always loads the canonical dialog. */
  loadDialog?: () => Promise<Module>
}) {
  const [Content] = useState(() => lazy(async () => ({ default: (await loadDialog()).ConversationClearDialogContent })))
  return <ErrorBoundary name="Conversation clear" fallback={() => <Pending failed onClose={props.onClose} />}>
    <Suspense fallback={<Pending onClose={props.onClose} />}><Content {...props} /></Suspense>
  </ErrorBoundary>
}
