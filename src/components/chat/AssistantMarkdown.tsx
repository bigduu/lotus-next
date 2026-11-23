import { uiText, useUiLocale } from "@shared/i18n/ui"
import { BUILTIN_TOOL_RE, findPendingProviderBlock } from "@/lib/assistantProviderBlocks"
import { LazyAssistantMarkdown as Markdown } from "./LazyAssistantMarkdown"
import { BuiltinToolBlock } from "./BuiltinToolBlock"

/**
 * Renders an assistant message as markdown, but folds any inline provider
 * built-in-tool blocks into a collapsible. Recurses so multiple blocks fold.
 */
export function AssistantMarkdown({
  children,
  isStreaming = false,
  onPreviewImage,
}: {
  children: string
  isStreaming?: boolean
  onPreviewImage?: (src: string) => void
}) {
  useUiLocale()
  const text = children
  const m = text.match(BUILTIN_TOOL_RE)
  if (!m || m.index === undefined) {
    // Provider tool blocks arrive over several tokens. Once a decorated
    // provider header is present, keep its Input/partial Output out of Markdown
    // until BUILTIN_TOOL_RE can fold the complete block into the existing UI.
    const pending = isStreaming ? findPendingProviderBlock(text) : null
    if (pending) {
      const beforePending = text.slice(0, pending.index).trimEnd()
      const statusLabel = pending.name ? uiText("built_in_tool_is_running_aa5c6389", { v0: pending.name }) : uiText("starting_built_in_tool_4b6a8d81")
      return (
        <>
          {beforePending ? <Markdown isStreaming={false} onPreviewImage={onPreviewImage}>{beforePending}</Markdown> : null}
          <div
            aria-label={statusLabel}
            className="my-1.5 inline-flex max-w-full items-center rounded-full bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground"
            data-provider-tool-state="streaming"
            role="status"
          >
            <span className="truncate">
              {pending.name ? uiText("built_in_tool_b3950b4c", { v0: pending.name }) : uiText("built_in_tool_starting_d9a432a6")}
            </span>
          </div>
        </>
      )
    }
    return <Markdown isStreaming={isStreaming} onPreviewImage={onPreviewImage}>{text}</Markdown>
  }

  const before = text.slice(0, m.index).trimEnd()
  const after = text.slice(m.index + m[0].length).replace(/^\n+/, "")
  return (
    <>
      {before ? <Markdown isStreaming={false} onPreviewImage={onPreviewImage}>{before}</Markdown> : null}
      <BuiltinToolBlock name={m[1]} body={m[0].trim()} />
      {after ? <AssistantMarkdown isStreaming={isStreaming} onPreviewImage={onPreviewImage}>{after}</AssistantMarkdown> : null}
    </>
  )
}
