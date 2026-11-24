import { initializeTrustedMermaid } from "@/lib/mermaid/strictConfig"
import { themeStore } from "@shared/store/themeState"

export const MERMAID_LOADING_SELECTOR = '[data-mermaid-loading="true"]'

export function initMermaidForExport(): void {
  initializeTrustedMermaid("export")
}

export function restoreMermaidAppConfig(): void {
  initializeTrustedMermaid("app", themeStore.getState().themeMode)
}
