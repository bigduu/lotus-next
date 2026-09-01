import mermaid from "mermaid"

export const MERMAID_LOADING_SELECTOR = '[data-mermaid-loading="true"]'

// Mirror src/components/chat/MermaidChart.tsx. Mermaid configuration is a
// global singleton, so PDF export temporarily selects a light theme and must
// restore the application theme afterwards.
const APP_MERMAID_CONFIG = {
  startOnLoad: false,
  theme: "dark",
  securityLevel: "strict",
  htmlLabels: false,
  flowchart: { htmlLabels: false },
} as const

export function initMermaidForExport(): void {
  mermaid.initialize({ ...APP_MERMAID_CONFIG, theme: "default" })
}

export function restoreMermaidAppConfig(): void {
  mermaid.initialize({ ...APP_MERMAID_CONFIG })
}
