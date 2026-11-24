import { Errored, lazy, Loading, omit } from "solid-js"
import type { ComponentProps } from "@solidjs/web"
import { createUiText } from "../shell/uiText"
import { Button } from "../ui/button"
import { ResponsiveDialog, ResponsiveDialogContent, ResponsiveDialogDescription, ResponsiveDialogTitle } from "../ui/responsive-dialog"
import type { ConversationClearDialogContent } from "./ConversationClearDialogContent"

type DialogProps = ComponentProps<typeof ConversationClearDialogContent>
type Module = { ConversationClearDialogContent: typeof ConversationClearDialogContent }
const load = () => import("./ConversationClearDialogContent")

function Pending(props: Pick<DialogProps, "onClose"> & { failed?: boolean }) {
  const text = createUiText()
  return <ResponsiveDialog open onOpenChange={(open) => { if (!open) props.onClose() }}>
    <ResponsiveDialogContent class="gap-3 p-4 sm:pb-4">
      <ResponsiveDialogTitle>{text("conversation_clear_title")}</ResponsiveDialogTitle>
      <ResponsiveDialogDescription>
        {text(props.failed ? "conversation_clear_load_failed" : "loading_4927a53b")}
      </ResponsiveDialogDescription>
      <Button variant="secondary" size="sm" onClick={props.onClose}>{text("cancel_2cd0f3be")}</Button>
    </ResponsiveDialogContent>
  </ResponsiveDialog>
}

export function ConversationClearDialog(props: DialogProps & { loadDialog?: () => Promise<Module> }) {
  const Content = lazy(props.loadDialog ?? load, { export: "ConversationClearDialogContent" })
  return <Errored fallback={() => <Pending failed onClose={props.onClose} />}>
    <Loading fallback={<Pending onClose={props.onClose} />}>
      <Content {...omit(props, "loadDialog")} />
    </Loading>
  </Errored>
}
