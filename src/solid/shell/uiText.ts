import { createSignal, onSettled } from "solid-js"
import i18n from "@shared/i18n/runtime"
import { uiLanguage, uiText } from "@shared/i18n/text"

export function createUiLocale() {
  const [locale, setLocale] = createSignal(uiLanguage())
  onSettled(() => {
    const update = () => { setLocale(uiLanguage()) }
    i18n.on("languageChanged", update)
    update()
    return () => { i18n.off("languageChanged", update) }
  })
  return locale
}

/** Bind UI copy to locale changes while retaining the mounted Solid owner. */
export function createUiText() {
  const locale = createUiLocale()
  return (key: Parameters<typeof uiText>[0], values?: Parameters<typeof uiText>[1]) =>
    uiText(key, { ...values, lng: locale() })
}
