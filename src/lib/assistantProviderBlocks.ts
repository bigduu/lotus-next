// Matches a provider "built-in tool" block the model narrates inline:
//   **🌐 Z.ai Built-in Tool: analyze_image**  ... **Output:** ...  (up to a blank line)
// Conservative: requires BOTH the "Built-in Tool: <name>" header and an
// "**Output:**" marker, so normal prose is never collapsed.
export const BUILTIN_TOOL_RE =
  /(?:\*\*)?\s*🌐?\s*(?:Z\.ai\s+)?Built-in Tool[:：]\s*([A-Za-z0-9_]+)\s*(?:\*\*)?[\s\S]*?\*\*Output:\*\*[\s\S]*?(?=\n\n|$)/
const BUILTIN_TOOL_HEADER_RE =
  /(?:\*\*\s*🌐?\s*(?:Z\.ai\s+)?|🌐\s*(?:Z\.ai\s+)?|Z\.ai\s+)Built-in Tool[:：]\s*([A-Za-z0-9_]+)\s*(?:\*\*)?/
const DECORATED_PROVIDER_LINE_RE =
  /(?:^|\n)(?:\*\*\s*🌐?\s*(?:Z\.ai\s+)?|🌐\s*(?:Z\.ai\s+)?|Z\.ai\s+)([^\n]*)/g

export function findPendingProviderBlock(text: string): { index: number; name?: string } | null {
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

export type AssistantProviderPart =
  | { kind: "prose"; source: string; streaming: boolean }
  | { kind: "tool"; name: string; source: string }
  | { kind: "pending"; name?: string }

export function splitAssistantProviderBlocks(source: string, streaming: boolean): AssistantProviderPart[] {
  const parts: AssistantProviderPart[] = []
  let remaining = source

  while (true) {
    const complete = remaining.includes("Built-in Tool") ? remaining.match(BUILTIN_TOOL_RE) : null
    if (!complete || complete.index === undefined) {
      const pending = streaming ? findPendingProviderBlock(remaining) : null
      if (pending) {
        const preceding = remaining.slice(0, pending.index).trimEnd()
        if (preceding) parts.push({ kind: "prose", source: preceding, streaming: false })
        parts.push({ kind: "pending", name: pending.name })
      } else if (remaining || !parts.length) {
        parts.push({ kind: "prose", source: remaining, streaming })
      }
      return parts
    }

    const before = remaining.slice(0, complete.index).trimEnd()
    if (before) parts.push({ kind: "prose", source: before, streaming: false })
    parts.push({ kind: "tool", name: complete[1]!, source: complete[0].trim() })
    remaining = remaining.slice(complete.index + complete[0].length).replace(/^\n+/, "")
  }
}
