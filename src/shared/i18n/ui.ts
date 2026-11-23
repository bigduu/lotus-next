import { useCallback } from "react"
import { useTranslation } from "react-i18next"
import type { TOptions } from "i18next"
import i18n from "./index"
import type { uiEnUs } from "./resources/ui-en-US"

export { uiLanguage, uiList, uiText } from "./text"

/** Subscribe without remounting controls or interrupting an IME composition. */
export function useUiLocale(): string {
  const { i18n: current } = useTranslation()
  return current.resolvedLanguage ?? current.language
}

/** Locale-bound translator for memoized presentation values. */
export function useUiText() {
  const locale = useUiLocale()
  return useCallback((key: keyof typeof uiEnUs, values?: TOptions): string =>
    String(i18n.t(`ui.${key}`, { ...values, lng: locale })), [locale])
}
