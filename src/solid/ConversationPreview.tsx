import { ArrowUp } from "@lucide/solid"
import { createSignal } from "solid-js"
import { uiText } from "@shared/i18n/text"
import { ComposerEditor } from "./composer/ComposerEditor"
import { Button } from "./ui/button"
import { VirtualHistory } from "./history/VirtualHistory"
import { AssistantMarkdown } from "./markdown/AssistantMarkdown"

export function ConversationPreview(props: { theme: "light" | "dark" }) {
  const [draft, setDraft] = createSignal("")
  const [history, setHistory] = createSignal([{ key: "intro", content: "**Lotus Next**" }])
  let nextMessage = 0
  const submit = () => {
    const value = draft().trim()
    if (!value) return
    const key = String(++nextMessage)
    setHistory((entries) => [...entries, { key, content: value }])
    setDraft("")
  }

  return (
    <section class="grid min-w-0 gap-3">
      <VirtualHistory
        class="h-48 rounded-2xl border bg-card"
        entries={history()}
        estimateSize={() => 56}
        renderEntry={(entry) => (
          <div class="min-w-0 px-2 py-1">
            <AssistantMarkdown theme={props.theme} text={uiText}>{entry().content}</AssistantMarkdown>
          </div>
        )}
      />
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
          <Button
            type="button"
            size="icon"
            class="rounded-full"
            aria-label={uiText("send_message_00881483")}
            disabled={!draft().trim()}
            onClick={submit}
          ><ArrowUp aria-hidden="true" class="size-4" /></Button>
        </div>
      </div>
    </section>
  )
}
