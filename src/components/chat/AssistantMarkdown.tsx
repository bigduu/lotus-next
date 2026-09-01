import { LazyAssistantMarkdown as Markdown } from "./LazyAssistantMarkdown"
import { BuiltinToolBlock } from "./BuiltinToolBlock"

// Matches a provider "built-in tool" block the model narrates inline:
//   **🌐 Z.ai Built-in Tool: analyze_image**  ... **Output:** ...  (up to a blank line)
// Conservative: requires BOTH the "Built-in Tool: <name>" header and an
// "**Output:**" marker, so normal prose is never collapsed.
const BUILTIN_TOOL_RE =
  /(?:\*\*)?\s*🌐?\s*(?:Z\.ai\s+)?Built-in Tool[:：]\s*([A-Za-z0-9_]+)\s*(?:\*\*)?[\s\S]*?\*\*Output:\*\*[\s\S]*?(?=\n\n|$)/
const BUILTIN_TOOL_HEADER_RE =
  /(?:\*\*\s*🌐?\s*(?:Z\.ai\s+)?|🌐\s*(?:Z\.ai\s+)?|Z\.ai\s+)Built-in Tool[:：]\s*([A-Za-z0-9_]+)\s*(?:\*\*)?/
const DECORATED_PROVIDER_LINE_RE =
  /(?:^|\n)(?:\*\*\s*🌐?\s*(?:Z\.ai\s+)?|🌐\s*(?:Z\.ai\s+)?|Z\.ai\s+)([^\n]*)/g

function findPendingProviderBlock(text: string): { index: number; name?: string } | null {
  DECORATED_PROVIDER_LINE_RE.lastIndex = 0
  for (const candidate of text.matchAll(DECORATED_PROVIDER_LINE_RE)) {
    const line = candidate[1].trim().replace(/\*\*\s*$/, "").trimEnd()
    const normalizedLine = line.replace("：", ":").toLowerCase()
    const canonicalHeader = "built-in tool:"
    const isHeaderPrefix = canonicalHeader.startsWith(normalizedLine)
    const hasStartedName = /^built-in tool:\s*[a-z0-9_]*$/i.test(normalizedLine)
    if (!isHeaderPrefix && !hasStartedName) continue

    const index = (candidate.index ?? 0) + (candidate[0].startsWith("\n") ? 1 : 0)
    const header = text.slice(index).match(BUILTIN_TOOL_HEADER_RE)
    return {
      index,
      name: header?.index === 0 ? header[1] : undefined,
    }
  }
  return null
}

/**
 * Renders an assistant message as markdown, but folds any inline provider
 * built-in-tool blocks into a collapsible. Recurses so multiple blocks fold.
 */
export function AssistantMarkdown({
  children,
  isStreaming = false,
}: {
  children: string
  isStreaming?: boolean
}) {
  const text = children
  const m = text.match(BUILTIN_TOOL_RE)
  if (!m || m.index === undefined) {
    // Provider tool blocks arrive over several tokens. Once a decorated
    // provider header is present, keep its Input/partial Output out of Markdown
    // until BUILTIN_TOOL_RE can fold the complete block into the existing UI.
    const pending = isStreaming ? findPendingProviderBlock(text) : null
    if (pending) {
      const beforePending = text.slice(0, pending.index).trimEnd()
      const statusLabel = pending.name ? `内置工具 ${pending.name} 正在运行` : "内置工具正在启动"
      return (
        <>
          {beforePending ? <Markdown isStreaming={false}>{beforePending}</Markdown> : null}
          <div
            aria-label={statusLabel}
            className="my-1.5 inline-flex max-w-full items-center rounded-full bg-muted/60 px-2.5 py-1 text-xs text-muted-foreground"
            data-provider-tool-state="streaming"
            role="status"
          >
            <span className="truncate">
              {pending.name ? `内置工具 · ${pending.name}` : "内置工具 · 正在启动"}
            </span>
          </div>
        </>
      )
    }
    return <Markdown isStreaming={isStreaming}>{text}</Markdown>
  }

  const before = text.slice(0, m.index).trimEnd()
  const after = text.slice(m.index + m[0].length).replace(/^\n+/, "")
  return (
    <>
      {before ? <Markdown isStreaming={false}>{before}</Markdown> : null}
      <BuiltinToolBlock name={m[1]} body={m[0].trim()} />
      {after ? <AssistantMarkdown isStreaming={isStreaming}>{after}</AssistantMarkdown> : null}
    </>
  )
}
