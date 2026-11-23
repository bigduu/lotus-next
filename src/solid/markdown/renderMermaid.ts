import mermaid from "mermaid"
import { themeStore } from "@shared/store/themeState"
import { initializeTrustedMermaid, type MermaidSurface, type MermaidTheme } from "../../lib/mermaid/strictConfig"

let sequence = 0
let renderQueue: Promise<unknown> = Promise.resolve()

/** Mermaid is a process-wide singleton. Pair trusted configuration with its render. */
function enqueueMermaid(source: string, surface: MermaidSurface, theme: MermaidTheme, signal: AbortSignal): Promise<string> {
  const next = renderQueue.then(async () => {
    signal.throwIfAborted()
    initializeTrustedMermaid(surface, theme)
    try {
      const { svg } = await mermaid.render(`solid-${surface}-diagram-${++sequence}`, source)
      signal.throwIfAborted()
      return svg
    } finally {
      if (surface === "export") initializeTrustedMermaid("app", themeStore.getState().themeMode)
    }
  })
  renderQueue = next.catch(() => undefined)
  return next
}

export function renderMermaid(source: string, theme: MermaidTheme, signal: AbortSignal): Promise<string> {
  return enqueueMermaid(source, "app", theme, signal)
}

export function renderExportMermaid(source: string, signal: AbortSignal): Promise<string> {
  return enqueueMermaid(source, "export", "light", signal)
}
