import mermaid from "mermaid"
import { initializeTrustedMermaid, type MermaidTheme } from "../../lib/mermaid/strictConfig"

let sequence = 0
let renderQueue: Promise<unknown> = Promise.resolve()

/** Mermaid is a process-wide singleton. Pair theme initialization with its render. */
export function renderMermaid(source: string, theme: MermaidTheme, signal: AbortSignal): Promise<string> {
  const next = renderQueue.then(async () => {
    signal.throwIfAborted()
    initializeTrustedMermaid("app", theme)
    const { svg } = await mermaid.render(`solid-markdown-diagram-${++sequence}`, source)
    signal.throwIfAborted()
    return svg
  })
  renderQueue = next.catch(() => undefined)
  return next
}
