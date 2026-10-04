import { afterEach, expect, it, vi } from "vitest"
import { APP_LOCALE_STORAGE_KEY } from "./types"

const previousPreference = localStorage.getItem(APP_LOCALE_STORAGE_KEY)
afterEach(() => {
  vi.doUnmock("i18next")
  vi.doUnmock("./resources")
  vi.resetModules()
  if (previousPreference === null) localStorage.removeItem(APP_LOCALE_STORAGE_KEY)
  else localStorage.setItem(APP_LOCALE_STORAGE_KEY, previousPreference)
})

it("starts in English after a selected Chinese bundle fails, preserving the saved choice for retry", async () => {
  const resources = await import("./resources")
  vi.resetModules()
  vi.doMock("i18next", async () => {
    const actual = await vi.importActual<typeof import("i18next")>("i18next")
    return { ...actual, default: actual.createInstance() }
  })
  let failChinese = true
  vi.doMock("./resources", () => ({
    ...resources,
    loadBaseResource: (locale: "en-US" | "zh-CN") => {
      if (locale === "zh-CN" && failChinese) return Promise.reject(new Error("Chinese bundle unavailable"))
      return resources.loadBaseResource(locale)
    },
  }))
  localStorage.setItem(APP_LOCALE_STORAGE_KEY, "zh-CN")
  const application = await import("./index")
  await expect(application.i18nReady).resolves.toBeUndefined()
  expect(application.default.language).toBe("en-US")
  expect(application.default.t("ui.language_label")).toBe("Language")
  expect(localStorage.getItem(APP_LOCALE_STORAGE_KEY)).toBe("zh-CN")
  failChinese = false
  await application.changeLocale("zh-CN")
  expect(application.default.t("ui.language_label")).toBe("语言")
})
