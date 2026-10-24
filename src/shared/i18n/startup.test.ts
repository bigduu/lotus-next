import { afterEach, expect, it, vi } from "vitest"
import { APP_LOCALE_STORAGE_KEY } from "./types"

const previousPreference = localStorage.getItem(APP_LOCALE_STORAGE_KEY)
const useFreshI18n = () => {
  vi.resetModules()
  vi.doMock("i18next", async () => {
    const actual = await vi.importActual<typeof import("i18next")>("i18next")
    return { ...actual, default: actual.createInstance() }
  })
}

afterEach(() => {
  vi.doUnmock("i18next")
  vi.doUnmock("./resources")
  vi.doUnmock("./generated/frAutoOverrides")
  vi.doUnmock("./generated/hiAutoOverrides")
  vi.resetModules()
  if (previousPreference === null) localStorage.removeItem(APP_LOCALE_STORAGE_KEY)
  else localStorage.setItem(APP_LOCALE_STORAGE_KEY, previousPreference)
})

it.each(["fr-FR", "hi-IN"] as const)("loads only the selected %s overlay and reuses it on later switches", async (locale) => {
  useFreshI18n()
  const frenchLoaded = vi.fn()
  const hindiLoaded = vi.fn()
  vi.doMock("./generated/frAutoOverrides", async () => {
    frenchLoaded()
    return vi.importActual("./generated/frAutoOverrides")
  })
  vi.doMock("./generated/hiAutoOverrides", async () => {
    hindiLoaded()
    return vi.importActual("./generated/hiAutoOverrides")
  })
  localStorage.setItem(APP_LOCALE_STORAGE_KEY, "en-US")
  const application = await import("./index")
  await application.i18nReady
  expect(frenchLoaded).not.toHaveBeenCalled()
  expect(hindiLoaded).not.toHaveBeenCalled()

  await application.changeLocale(locale)
  const selectedLoaded = locale === "fr-FR" ? frenchLoaded : hindiLoaded
  const unusedLoaded = locale === "fr-FR" ? hindiLoaded : frenchLoaded
  expect(application.default.language).toBe(locale)
  expect(application.default.t("app.errorBoundary.title")).toBe(
    locale === "fr-FR" ? "Un problème est survenu" : "कुछ गलत हो गया",
  )
  expect(selectedLoaded).toHaveBeenCalledOnce()
  expect(unusedLoaded).not.toHaveBeenCalled()

  await application.changeLocale("en-US")
  await application.changeLocale(locale)
  expect(selectedLoaded).toHaveBeenCalledOnce()
})

it.each(["fr-FR", "hi-IN"] as const)("falls back without losing %s after its overlay fails and permits retry", async (locale) => {
  useFreshI18n()
  const unavailable = () => { throw new Error("Locale overlay unavailable") }
  if (locale === "fr-FR") vi.doMock("./generated/frAutoOverrides", unavailable)
  else vi.doMock("./generated/hiAutoOverrides", unavailable)
  localStorage.setItem(APP_LOCALE_STORAGE_KEY, locale)
  const application = await import("./index")
  await expect(application.i18nReady).resolves.toBeUndefined()
  expect(application.default.language).toBe("en-US")
  expect(application.default.hasResourceBundle(locale, "translation")).toBe(false)
  expect(localStorage.getItem(APP_LOCALE_STORAGE_KEY)).toBe(locale)

  vi.doUnmock("./generated/frAutoOverrides")
  vi.doUnmock("./generated/hiAutoOverrides")
  await application.changeLocale(locale)
  expect(application.default.language).toBe(locale)
  expect(application.default.t("app.errorBoundary.title")).toBe(
    locale === "fr-FR" ? "Un problème est survenu" : "कुछ गलत हो गया",
  )
})

it("keeps a later Hindi selection when an earlier French overlay finishes slowly", async () => {
  useFreshI18n()
  let finishFrench!: (value: typeof import("./generated/frAutoOverrides")) => void
  const frenchOverlay = new Promise<typeof import("./generated/frAutoOverrides")>((resolve) => { finishFrench = resolve })
  const frenchRequested = vi.fn()
  vi.doMock("./generated/frAutoOverrides", () => {
    frenchRequested()
    return frenchOverlay
  })
  localStorage.setItem(APP_LOCALE_STORAGE_KEY, "en-US")
  const application = await import("./index")
  await application.i18nReady
  const earlierChoice = application.changeLocale("fr-FR", { persist: true })
  await vi.waitFor(() => expect(frenchRequested).toHaveBeenCalledOnce())
  await application.changeLocale("hi-IN", { persist: true })
  finishFrench(await vi.importActual("./generated/frAutoOverrides"))
  await earlierChoice
  expect(application.default.language).toBe("hi-IN")
  expect(document.documentElement.lang).toBe("hi-IN")
  expect(localStorage.getItem(APP_LOCALE_STORAGE_KEY)).toBe("hi-IN")
})

it("starts in English after a selected Chinese bundle fails, preserving the saved choice for retry", async () => {
  const resources = await import("./resources")
  useFreshI18n()
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
