import { afterEach, describe, expect, it, vi } from "vitest"
import i18n, { changeLocale, i18nReady } from "./runtime"
import { APP_LOCALE_STORAGE_KEY, resolveInitialLocale } from "./types"
import { uiText, uiList } from "./text"
import { uiEnUs } from "./resources/ui-en-US"
import { uiZhCn } from "./resources/ui-zh-CN"
import { groupChats } from "@/lib/groupChats"
import { describeRunFailure } from "@/lib/runFailureGuidance"
import { WEEKDAY_OPTIONS } from "@/lib/settings/scheduleModel"
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
    expect(uiText("enable_action")).toBe("Enable")
    expect(uiText("enabled_f4f0ead1")).toBe("Enabled")
    expect(uiText("root_session_label")).toBe("Root session")
    expect(uiText("pinned_section")).toBe("Pinned")
    expect(uiText("pin_173f88d2")).toBe("Pin")
    expect(groupChats([{ id: "pinned", pinned: true, createdAt: 1 }] as Parameters<typeof groupChats>[0], new Date())[0].label).toBe("Pinned")
    expect(uiText("goal_set_action")).toBe("Set")
    expect(uiList(["Bash", "write_file"])).toBe("Bash, write_file")
    expect(uiText("sessions_4e5cc041", { count: 1, v0: "1" })).toBe("1 session")
    expect(uiText("sessions_4e5cc041", { count: 2, v0: "2" })).toBe("2 sessions")
    expect(uiText("approval_rule_example")).not.toMatch(/[、。]/)
    expect(uiText("reasoning_none")).toBe("None")
    expect(uiText("close_3fd47edc")).toBe("Close")
    expect(uiText("apply_63c73c47")).toBe("Application")
    expect(uiText("delete_schedule_confirmation", { name: "Nightly 用户 build" })).toBe("Delete “Nightly 用户 build”?")
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

  it.each([
    ["LLM error: API error: HTTP 400 Bad Request: bad tool schema", "模型服务拒绝了请求", "确认服务商支持所选模型和请求设置后再试。"],
    ["LLM error: API error: Anthropic API error: HTTP 400 Bad Request: unsupported parameter", "模型服务拒绝了请求", "确认服务商支持所选模型和请求设置后再试。"],
    ["LLM error: API error: HTTP 401 Unauthorized: invalid credentials", "模型服务拒绝了访问", "检查服务商凭据和模型访问权限后再试。"],
    ["LLM error: Authentication error: Gemini authentication failed", "模型服务拒绝了访问", "检查服务商凭据和模型访问权限后再试。"],
    ["LLM error: API error: Bodhi/OpenAI proxy HTTP 401 Unauthorized: invalid credentials", "模型服务拒绝了访问", "检查服务商凭据和模型访问权限后再试。"],
    ["LLM error: API error: Bodhi/Gemini proxy HTTP 400 Bad Request: invalid parameter", "模型服务拒绝了请求", "确认服务商支持所选模型和请求设置后再试。"],
    ["LLM error: API error: Bodhi/Anthropic proxy HTTP 403 Forbidden: access denied", "模型服务拒绝了访问", "检查服务商凭据和模型访问权限后再试。"],
    ["LLM error: Anthropic upstream request failed (HTTP 401): error body timed out", "模型服务拒绝了访问", "检查服务商凭据和模型访问权限后再试。"],
    ["Empty assistant response from LLM (response_id=None)", "模型返回了空响应", "检查服务商运行状态，或换用可用的模型后再试。"],
    ["Stream timed out: phase=semantic_idle, deadline_ms=10000", "模型响应超时", "检查服务商连接，并在重试前查看已生成的内容。"],
  ])("localizes recovery guidance for %s", async (detail, title, action) => {
    await changeLocale("zh-CN")
    expect(describeRunFailure(detail)).toEqual({ title, action })
  })

  it("does not take an HTTP status mentioned in an upstream error body as the request status", async () => {
    await changeLocale("en-US")
    expect(describeRunFailure("LLM error: API error: HTTP 500: upstream also mentioned HTTP 401")).toBeNull()
    expect(describeRunFailure("LLM error: API error: HTTP 401: upstream also mentioned HTTP 429")?.title)
      .toBe("Model service rejected access")
  })

  it.each([
    "The model returned no summary. Lower the reasoning effort for the model used for context compression, then try again.",
    "Context compression could not finish. Your conversation history was preserved.",
  ])("localizes an interrupted reply after compression fails: %s", async (detail) => {
    await changeLocale("zh-CN")
    expect(describeRunFailure(`Turn 1 failed terminally: ${detail}`)).toEqual({
      title: "回复因上下文压缩中断",
      action: "你的消息和聊天记录已保留。",
    })
  })
})
