import { lazy, Loading } from "solid-js"
import { uiText } from "@shared/i18n/text"
import type { AssistantMarkdownProps } from "./AssistantMarkdown"
import { ProviderMarkdown } from "./ProviderMarkdown"
import type { MarkdownText } from "./text"

const Markdown = lazy(() => import("./AssistantMarkdown"), { export: "MarkdownProse" })

// The app initializes the fallback locale before mounting. Use that catalog
// through the locale runtime, keeping its deferred asset outside this wrapper.
const defaultText: MarkdownText = (key, values) => uiText(key, { ...values, lng: "en-US" })

function LazyProse(props: AssistantMarkdownProps) {
  return (
    <Loading fallback={<div class="whitespace-pre-wrap break-words" data-assistant-markdown-fallback="true">{props.children}</div>}>
      <Markdown {...props} />
    </Loading>
  )
}

export function LazyAssistantMarkdown(props: AssistantMarkdownProps) {
  return <ProviderMarkdown {...props} prose={LazyProse} text={props.text ?? defaultText} />
}
