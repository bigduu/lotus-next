import { lazy, Loading } from "solid-js"
import type { AssistantMarkdownProps } from "./AssistantMarkdown"
import { ProviderMarkdown } from "./ProviderMarkdown"

const Markdown = lazy(() => import("./AssistantMarkdown"), { export: "MarkdownProse" })

function LazyProse(props: AssistantMarkdownProps) {
  return (
    <Loading fallback={<div class="whitespace-pre-wrap break-words" data-assistant-markdown-fallback="true">{props.children}</div>}>
      <Markdown {...props} />
    </Loading>
  )
}

export function LazyAssistantMarkdown(props: AssistantMarkdownProps) {
  return <ProviderMarkdown {...props} prose={LazyProse} />
}
