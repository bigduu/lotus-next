import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import type { TOptions } from "i18next"
import i18n from "./index"
import type { uiEnUs } from "./resources/ui-en-US"

/** Application-owned UI copy. Backend messages and user content stay verbatim. */
export const uiText = (key: keyof typeof uiEnUs, values?: TOptions): string =>
  String(i18n.t(`ui.${key}`, values))

/** Subscribe without remounting controls or interrupting an IME composition. */
export function useUiLocale(): string {
  const { i18n: current } = useTranslation()
  return current.resolvedLanguage ?? current.language
}

export const uiLanguage = (): string => i18n.resolvedLanguage ?? i18n.language ?? "en-US"

/** Locale-bound translator for memoized presentation values. */
export function useUiText() {
  const locale = useUiLocale()
  return useCallback((key: keyof typeof uiEnUs, values?: TOptions): string =>
    String(i18n.t(`ui.${key}`, { ...values, lng: locale })), [locale])
}
