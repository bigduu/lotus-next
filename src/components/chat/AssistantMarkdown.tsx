import { LazyMarkdown as Markdown } from "./LazyMarkdown"
import { BuiltinToolBlock } from "./BuiltinToolBlock"

// Matches a provider "built-in tool" block the model narrates inline:
//   **🌐 Z.ai Built-in Tool: analyze_image**  ... **Output:** ...  (up to a blank line)
// Conservative: requires BOTH the "Built-in Tool: <name>" header and an
// "**Output:**" marker, so normal prose is never collapsed.
const BUILTIN_TOOL_RE =
  /(?:\*\*)?\s*🌐?\s*(?:Z\.ai\s+)?Built-in Tool[:：]\s*([A-Za-z0-9_]+)\s*(?:\*\*)?[\s\S]*?\*\*Output:\*\*[\s\S]*?(?=\n\n|$)/

/**
 * Renders an assistant message as markdown, but folds any inline provider
 * built-in-tool blocks into a collapsible. Recurses so multiple blocks fold.
 */
export function AssistantMarkdown({ children }: { children: string }) {
  const text = children
  const m = text.match(BUILTIN_TOOL_RE)
  if (!m || m.index === undefined) return <Markdown>{text}</Markdown>

  const before = text.slice(0, m.index).trimEnd()
  const after = text.slice(m.index + m[0].length).replace(/^\n+/, "")
  return (
    <>
      {before ? <Markdown>{before}</Markdown> : null}
      <BuiltinToolBlock name={m[1]} body={m[0].trim()} />
      {after ? <AssistantMarkdown>{after}</AssistantMarkdown> : null}
    </>
  )
}
