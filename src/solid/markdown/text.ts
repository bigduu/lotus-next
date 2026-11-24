import { uiEnUs } from "../../shared/i18n/resources/ui-en-US"

export type MarkdownText = (key: keyof typeof uiEnUs, values?: { v0: string }) => string

export const englishMarkdownText: MarkdownText = (key, values) =>
  values ? uiEnUs[key].replace("{{v0}}", () => values.v0) : uiEnUs[key]
