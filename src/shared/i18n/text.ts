import type { TOptions } from "i18next"
import i18n from "./runtime"
import type { uiEnUs } from "./resources/ui-en-US"

/** Application-owned UI copy. Backend messages and user content stay verbatim. */
export const uiText = (key: keyof typeof uiEnUs, values?: TOptions): string =>
  String(i18n.t(`ui.${key}`, values))

export const uiLanguage = (): string => i18n.resolvedLanguage ?? i18n.language ?? "en-US"

/** Locale punctuation for UI-owned lists; values remain verbatim. */
export const uiList = (values: string[]): string =>
  uiLanguage().startsWith("zh")
    ? values.join("、") // Keep the existing Chinese compact-list presentation.
    : new Intl.ListFormat(uiLanguage(), { style: "short", type: "unit" }).format(values)
