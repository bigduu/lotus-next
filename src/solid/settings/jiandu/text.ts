import type { TOptions } from "i18next"
import i18n from "@shared/i18n/runtime"
import { createUiLocale } from "../../shell/uiText"

export function createJianduText() {
  const locale = createUiLocale()
  return {
    locale,
    t: (key: string, options?: TOptions) => String(i18n.t("settings.jiandu." + key, { ...options, lng: locale() })),
  }
}
