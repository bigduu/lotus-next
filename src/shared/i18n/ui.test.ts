import { afterEach, describe, expect, it, vi } from "vitest"
import i18n, { changeLocale, i18nReady } from "./index"
import { APP_LOCALE_STORAGE_KEY, resolveInitialLocale } from "./types"
import { uiText } from "./ui"
import { uiEnUs } from "./resources/ui-en-US"
import { uiZhCn } from "./resources/ui-zh-CN"
import { groupChats } from "@/lib/groupChats"
import { describeRunFailure } from "@/lib/runFailureGuidance"
import { WEEKDAY_OPTIONS } from "@/components/chat/settings/schedules/scheduleModel"
import { TASK_TEMPLATES } from "@/lib/taskTemplates"

const placeholders = (value: string) => [...value.matchAll(/{{\s*([^},]+)[^}]*}}/g)].map((match) => match[1]).sort()

afterEach(() => vi.restoreAllMocks())

describe("English UI localization", () => {
  it("keeps every UI key and interpolation present in both base locales", () => {
    expect(Object.keys(uiEnUs).sort()).toEqual(Object.keys(uiZhCn).sort())
    for (const key of Object.keys(uiEnUs) as Array<keyof typeof uiEnUs>) {
      expect(uiEnUs[key].trim(), key).not.toBe("")
      expect(placeholders(uiEnUs[key]), key).toEqual(placeholders(uiZhCn[key]))
    }
  })

  it("uses saved preference before browser language and defaults to English", () => {
    const language = vi.spyOn(window.navigator, "language", "get")
    for (const [browser, expected] of [["en-GB", "en-US"], ["zh-Hans", "zh-CN"], ["zh-HK", "zh-TW"], ["de-DE", "en-US"]]) {
      language.mockReturnValue(browser)
      localStorage.removeItem(APP_LOCALE_STORAGE_KEY)
      expect(resolveInitialLocale()).toBe(expected)
    }
    localStorage.setItem(APP_LOCALE_STORAGE_KEY, "en-US")
    language.mockReturnValue("zh-CN")
    expect(resolveInitialLocale()).toBe("en-US")
    localStorage.setItem(APP_LOCALE_STORAGE_KEY, "invalid")
    expect(resolveInitialLocale()).toBe("zh-CN")
  })

  it("persists a selection for the next startup and updates document language", async () => {
    await changeLocale("en-US", { persist: true })
    expect(localStorage.getItem(APP_LOCALE_STORAGE_KEY)).toBe("en-US")
    expect(resolveInitialLocale()).toBe("en-US")
    expect(document.documentElement.lang).toBe("en-US")
    await changeLocale("zh-CN", { persist: true })
    expect(uiText("language_label")).toBe("语言")
    expect(resolveInitialLocale()).toBe("zh-CN")
    expect(document.documentElement.lang).toBe("zh-CN")
  })

  it("keeps switching usable when preference storage throws", async () => {
    vi.spyOn(window.localStorage, "setItem").mockImplementation(() => { throw new DOMException("Blocked") })
    await expect(changeLocale("en-US", { persist: true })).resolves.toBeUndefined()
    expect(uiText("language_label")).toBe("Language")
  })

  it("lets the latest lazy selection win", async () => {
    await Promise.all([changeLocale("fr-FR", { persist: true }), changeLocale("en-US", { persist: true })])
    expect(i18n.language).toBe("en-US")
    expect(localStorage.getItem(APP_LOCALE_STORAGE_KEY)).toBe("en-US")
  })

  it("falls back to English for a missing Chinese key", async () => {
    await i18nReady
    i18n.addResource("en-US", "translation", "localeTest.fallback", "English fallback")
    await changeLocale("zh-CN")
    expect(i18n.t("localeTest.fallback")).toBe("English fallback")
  })

  it("handles English plurals, interpolates names verbatim and formats calendar groups", async () => {
    await changeLocale("en-US")
    expect(uiText("project_sessions", { count: 1 })).toBe("1 session")
    expect(uiText("project_sessions", { count: 2 })).toBe("2 sessions")
    expect(uiText("tool_calls_bdfa142a", { v0: 1, count: 1 })).toBe("1 tool call")
    const title = "用户 <script>{{name}}</script>"
    expect(uiText("delete_session_description", { title })).toContain(title)
    const groups = groupChats([{ id: "date", createdAt: new Date("2026-07-06T12:00:00").getTime() }] as Parameters<typeof groupChats>[0], new Date("2026-07-10T12:00:00"))
    expect(groups[0].label).toBe("July 6")
    await changeLocale("zh-CN")
    expect(groups[0].key).toBe("2026-07-06")
    expect(groupChats([{ id: "date", createdAt: new Date("2026-07-06T12:00:00").getTime() }] as Parameters<typeof groupChats>[0], new Date("2026-07-10T12:00:00"))[0].label).toBe("7月6日")
  })

  it("updates shared labels without translating model prompts or backend diagnostics", async () => {
    const prompt = TASK_TEMPLATES.find((item) => item.taskPrompt)?.taskPrompt
    const diagnostic = "HTTP 429: 后端原始消息; request_id=abc"
    await changeLocale("en-US")
    expect(WEEKDAY_OPTIONS[0].label).toBe("Mon")
    expect(describeRunFailure(diagnostic)?.title).toBe("Model service rate limited")
    expect(diagnostic).toBe("HTTP 429: 后端原始消息; request_id=abc")
    await changeLocale("zh-CN")
    expect(WEEKDAY_OPTIONS[0].label).toBe("一")
    expect(TASK_TEMPLATES.find((item) => item.taskPrompt)?.taskPrompt).toBe(prompt)
  })
})
