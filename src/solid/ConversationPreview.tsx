import { ArrowUp } from "@lucide/solid"
import { createSignal } from "solid-js"
import { uiText } from "@shared/i18n/text"
import { ComposerEditor } from "./composer/ComposerEditor"
import { AssistantMarkdown } from "./markdown/AssistantMarkdown"

export function ConversationPreview(props: { theme: "light" | "dark" }) {
  const [draft, setDraft] = createSignal("")
  const [content, setContent] = createSignal("**Lotus Next**")
  const submit = () => {
    const value = draft().trim()
    if (!value) return
    setContent(value)
    setDraft("")
  }

  return (
    <section class="grid min-w-0 gap-3">
      <div class="min-w-0 rounded-2xl border bg-card p-3">
        <AssistantMarkdown theme={props.theme} text={uiText}>{content()}</AssistantMarkdown>
      </div>
      <div class="grid min-w-0 gap-2 rounded-3xl border bg-background p-2">
        <ComposerEditor
          id="solid-preview-draft"
          value={draft()}
          busy={false}
          label={uiText("messages_4da199fa")}
          title={uiText("enter_to_send_shift_enter_for_a_new_line_b6153e81")}
          placeholder={uiText("send_a_message_ae2f86f0")}
          mentionsEnabled={false}
          onChange={(value) => { setDraft(value) }}
          onSubmit={submit}
          onAddFiles={() => {}}
          onSuggestionChange={() => {}}
        />
        <div class="flex justify-end">
          <button
            type="button"
            class="button-interaction inline-flex size-9 items-center justify-center rounded-full bg-primary text-primary-foreground disabled:opacity-50"
            aria-label={uiText("send_message_00881483")}
            disabled={!draft().trim()}
            onClick={submit}
          ><ArrowUp aria-hidden="true" class="size-4" /></button>
        </div>
      </div>
    </section>
  )
}
