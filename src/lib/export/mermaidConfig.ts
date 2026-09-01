import { initializeTrustedMermaid } from "@/lib/mermaid/strictConfig"

export const MERMAID_LOADING_SELECTOR = '[data-mermaid-loading="true"]'

export function initMermaidForExport(): void {
  initializeTrustedMermaid("export")
}

export function restoreMermaidAppConfig(): void {
  initializeTrustedMermaid("app")
}
