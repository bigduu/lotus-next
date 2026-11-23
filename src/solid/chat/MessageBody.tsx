import { For, Show } from "solid-js"
import type { Message, MessageImage } from "@shared/types/chatMessages"
import { readLocalImage } from "@shared/services/FileOperationsService"
import { AssistantMarkdown } from "../markdown/AssistantMarkdown"
import { createUiText } from "../shell/uiText"

function Images(props: { images?: MessageImage[]; onPreview: (src: string) => void }) {
  return <Show when={props.images?.length}>
    <div class="mt-2 flex flex-wrap gap-2">
      <For each={props.images} keyed={(image) => image.id}>{(entry) => {
        const src = () => {
          const image = entry()
          if (image.url) return image.url
          if (!image.base64) return undefined
          return image.base64.startsWith("data:") ? image.base64 : `data:${image.type || "image/png"};base64,${image.base64}`
        }
        return <Show when={src()}>
          {(value) => (
            <button type="button" class="overflow-hidden rounded-md border" onClick={() => props.onPreview(value())}>
              <img class="max-h-48 max-w-48 object-contain" src={value()} alt={entry().name} loading="lazy" />
            </button>
          )}
        </Show>
      }}</For>
    </div>
  </Show>
}

export function MessageBody(props: {
  message: Message
  theme: "light" | "dark"
  onOpenLink: (url: string) => void
  onPreviewImage: (src: string) => void
}) {
  const text = createUiText()
  const assistantText = () => {
    const message = props.message
    return message.role === "assistant" && (message.type === "text" || message.type === "workflow_result")
      ? message.content : undefined
  }
  const user = () => props.message.role === "user" ? props.message : undefined
  const toolResult = () => {
    const message = props.message
    return message.role === "assistant" && message.type === "tool_result" ? message : undefined
  }
  const toolCalls = () => {
    const message = props.message
    return message.role === "assistant" && message.type === "tool_call" ? message.toolCalls : []
  }

  return (
    <article data-message-role={props.message.role} class="min-w-0 py-2">
      <Show when={user()}>{(entry) => {
        const fileReference = () => "paths" in entry()
        const content = () => {
          const message = entry()
          return "paths" in message ? message.displayText : message.content
        }
        const reference = () => {
          const message = entry()
          return "inReplyTo" in message ? message.inReplyTo : null
        }
        const images = () => {
          const message = entry()
          return "images" in message ? message.images : undefined
        }
        return (
          <div class="ml-auto w-fit max-w-[min(100%,48rem)] rounded-2xl px-4 py-2.5"
            style={{ background: "var(--user-message-background)", color: "var(--user-message-foreground)" }}>
            <Show when={reference()}>
              <div class="mb-1 text-xs" data-testid="message-request-reference">{text("ticket_referenced_request__7209ca36")}{reference()}</div>
            </Show>
            <div class="whitespace-pre-wrap break-words" data-user-file-reference={fileReference() ? "" : undefined}>
              {content()}
            </div>
            <Images images={images()} onPreview={props.onPreviewImage} />
          </div>
        )
      }}</Show>
      <Show when={assistantText()}>
        {(content) => (
          <AssistantMarkdown theme={props.theme} text={text} onOpenLink={props.onOpenLink}
            onPreviewImage={props.onPreviewImage} readImage={readLocalImage}>
            {content()}
          </AssistantMarkdown>
        )}
      </Show>
      <For each={toolCalls()} keyed={(call) => call.toolCallId}>{(call) => (
        <details class="mb-1 rounded-lg border px-2 py-1.5 text-sm text-muted-foreground">
          <summary class="cursor-pointer">{call().toolName}</summary>
          <pre class="overflow-auto whitespace-pre-wrap text-xs">{call().streamingOutput || JSON.stringify(call().parameters, null, 2)}</pre>
        </details>
      )}</For>
      <Show when={toolResult()}>
        {(result) => (
          <Show when={result().result.display_preference !== "Hidden"}>
            <details open={result().result.display_preference === "Default"} class="rounded-lg border px-2 py-1.5 text-sm text-muted-foreground">
              <summary class="cursor-pointer">{result().toolName}</summary>
              <pre class="max-h-72 overflow-auto whitespace-pre-wrap text-xs">{result().result.result}</pre>
              <Images images={result().images} onPreview={props.onPreviewImage} />
            </details>
          </Show>
        )}
      </Show>
    </article>
  )
}
