import { lazy, Loading } from "solid-js"
import type { AssistantMarkdownProps } from "./AssistantMarkdown"

const Markdown = lazy(() => import("./AssistantMarkdown"), { export: "AssistantMarkdown" })

export function LazyAssistantMarkdown(props: AssistantMarkdownProps) {
  return (
    <Loading fallback={<div class="whitespace-pre-wrap break-words" data-assistant-markdown-fallback="true">{props.children}</div>}>
      <Markdown {...props} />
    </Loading>
  )
}
