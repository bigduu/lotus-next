import { expect, test, type Page } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "../support/artifactRuntime.js"

async function installSettingsFixture(page: Page, baseURL: string | undefined) {
  const entryUrl = new URL("/", baseURL).href
  await page.addInitScript(() => localStorage.setItem("bodhi_onboarded_v1", "1"))
  const observation = await installArtifactRuntime(page, {
    ...standaloneScenario, origin: new URL(entryUrl).origin, entryUrl,
  }, [], { serveStaticFromLocalServer: true })
  await page.route("**/api/v1/metrics/summary", (route) => route.fulfill({ json: { total_sessions: 3 } }))
  return { entryUrl, observation }
}

async function openSettings(page: Page, entryUrl: string, isMobile: boolean) {
  await page.goto(entryUrl)
  if (isMobile) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await page.getByRole("button", { name: "系统设置", exact: true }).click()
  return page.locator('[data-slot="settings-page"]')
}

test("Solid Lotus keeps appearance and owner settings in the real application shell", async ({ page, baseURL, isMobile }) => {
  const { entryUrl, observation } = await installSettingsFixture(page, baseURL)
  const settings = await openSettings(page, entryUrl, isMobile)
  await expect(settings.getByRole("heading", { name: "通用", exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "浅色", exact: true }).click()
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/)
  const root = page.locator("html")
  const defaultAccent = await root.evaluate((element) => element.style.getPropertyValue("--primary"))
  await settings.getByRole("button", { name: "蓝色", exact: true }).click()
  await expect.poll(() => root.evaluate((element) => element.style.getPropertyValue("--primary"))).not.toBe(defaultAccent)
  if (isMobile) await settings.getByRole("combobox", { name: "系统设置" }).selectOption("providers")
  else await settings.getByRole("button", { name: "提供方", exact: true }).click()
  await expect(settings.getByRole("heading", { name: "提供方", exact: true })).toBeVisible()
  await expect(settings.getByText("Fixture provider", { exact: true }).first()).toBeVisible()
  await settings.getByRole("button", { name: "返回聊天", exact: true }).click()
  await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  await expect(page.locator("html")).not.toHaveClass(/\bdark\b/)
  expect(observation.pageErrors).toEqual([])
})

test("Solid environment settings hide stored secret values and use the refreshed revision after a conflict", async ({ page, baseURL, isMobile }) => {
  const { entryUrl, observation } = await installSettingsFixture(page, baseURL)
  let revision = 7
  const revisions: number[] = []
  const initial = { name: "FIXTURE_EXISTING", secret: true, has_value: true, value: "fixture-stored-value" }
  await page.route("**/api/v1/bamboo/env-vars", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { revision, entries: [initial] } })
    const submitted = route.request().postDataJSON()
    revisions.push(submitted.expected_revision)
    if (revision === 7) {
      revision = 8
      return route.fulfill({ status: 409, json: { message: "fixture-conflict-detail" } })
    }
    expect(submitted).toEqual({ expected_revision: 8, name: "FIXTURE_NEW", value: "fixture-new-value", secret: true })
    return route.fulfill({ json: { revision: 9, entries: [initial, { ...initial, name: submitted.name, value: submitted.value }] } })
  })

  const settings = await openSettings(page, entryUrl, isMobile)
  if (isMobile) await settings.getByRole("combobox", { name: "系统设置" }).selectOption("env")
  else await settings.getByRole("button", { name: "环境变量", exact: true }).click()
  await expect(settings.getByText("FIXTURE_EXISTING", { exact: true })).toBeVisible()
  await expect(settings.getByText("fixture-stored-value", { exact: true })).toHaveCount(0)
  await settings.getByLabel("名称(如 OPENAI_API_KEY)").fill("FIXTURE_NEW")
  await settings.getByText("密钥(掩码)", { exact: true }).click()
  const value = settings.getByLabel("值", { exact: true })
  await expect(value).toHaveAttribute("type", "password")
  await value.fill("fixture-new-value")
  const add = settings.getByRole("button", { name: "添加", exact: true })
  await add.click()
  await expect(settings.getByRole("alert")).toContainText("已刷新实际列表")
  await expect(settings.getByText("fixture-conflict-detail", { exact: true })).toHaveCount(0)
  await expect(value).toHaveValue("fixture-new-value")
  await add.click()
  await expect(settings.getByText("FIXTURE_NEW", { exact: true })).toBeVisible()
  await expect(value).toHaveValue("")
  await expect(settings.getByText("fixture-new-value", { exact: true })).toHaveCount(0)
  expect(revisions).toEqual([7, 8])
  expect(observation.pageErrors).toEqual([])
})

test("Solid masking settings preserve existing rules after a failed read", async ({ page, baseURL, isMobile }) => {
  const { entryUrl, observation } = await installSettingsFixture(page, baseURL)
  const existing = { pattern: "fixture-existing", match_type: "exact", enabled: true }
  let allowRead = false
  const writes: unknown[] = []
  await page.route("**/api/v1/bamboo/keyword-masking", async (route) => {
    if (route.request().method() === "GET") {
      return allowRead
        ? route.fulfill({ json: { entries: [existing] } })
        : route.fulfill({ status: 403, json: { message: "fixture-read-unavailable" } })
    }
    const entries = route.request().postDataJSON()
    writes.push(entries)
    return route.fulfill({ json: { entries } })
  })

  const settings = await openSettings(page, entryUrl, isMobile)
  if (isMobile) await settings.getByRole("combobox", { name: "系统设置" }).selectOption("masking")
  else await settings.getByRole("button", { name: "关键词掩码", exact: true }).click()
  await expect(settings.getByRole("alert")).toBeVisible()
  const pattern = settings.getByLabel("要掩码的内容 / 模式")
  await pattern.fill("fixture-new")
  const add = settings.getByRole("button", { name: "新增规则" })
  await expect(add).toBeDisabled()
  await pattern.press("Enter")
  expect(writes).toEqual([])

  allowRead = true
  await settings.getByRole("button", { name: "重试", exact: true }).click()
  await expect(settings.getByText("fixture-existing", { exact: true })).toBeVisible()
  await add.click()
  await expect(settings.getByText("fixture-new", { exact: true })).toBeVisible()
  expect(writes).toEqual([[existing, { pattern: "fixture-new", match_type: "exact", enabled: true }]])
  await settings.getByLabel("输入一段文本,看看掩码后的效果…").fill("fixture-existing and fixture-new")
  await expect(settings.getByText("*** and ***", { exact: true })).toBeVisible()
  expect(observation.pageErrors).toEqual([])
})

test("Solid prompt settings save a custom preset and preserve built-in presets", async ({ page, baseURL, isMobile }) => {
  const { entryUrl, observation } = await installSettingsFixture(page, baseURL)
  const builtIn = { id: "fixture-default", name: "Fixture default", content: "Built-in contents", is_default: true }
  let presets = [builtIn]
  await page.route("**/api/v1/prompt-presets", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { prompts: presets } })
    const submitted = route.request().postDataJSON()
    expect(submitted).toMatchObject({ name: "Fixture custom preset", content: "Fixture instruction" })
    const prompt = { ...submitted, is_default: false }
    presets = [...presets, prompt]
    return route.fulfill({ status: 201, json: { prompt } })
  })

  const settings = await openSettings(page, entryUrl, isMobile)
  if (isMobile) await settings.getByRole("combobox", { name: "系统设置" }).selectOption("prompts")
  else await settings.getByRole("button", { name: "提示词", exact: true }).click()
  const builtInItem = settings.getByRole("listitem").filter({ hasText: "Fixture default" })
  await expect(builtInItem.getByText("默认", { exact: true })).toBeVisible()
  await expect(builtInItem.getByRole("button")).toHaveCount(0)

  await settings.getByRole("button", { name: "新增", exact: true }).click()
  const editor = page.getByRole("dialog", { name: "新增预设" })
  await editor.getByLabel("名称", { exact: true }).fill("Fixture custom preset")
  await editor.getByLabel("提示词内容", { exact: true }).fill("Fixture instruction")
  await editor.getByRole("button", { name: "保存", exact: true }).click()
  await expect(editor).toBeHidden()
  const customItem = settings.getByRole("listitem").filter({ hasText: "Fixture custom preset" })
  await expect(customItem.getByText("Fixture instruction", { exact: true })).toBeVisible()
  await expect(customItem.getByRole("button", { name: "编辑", exact: true })).toBeEnabled()

  const enhancement = settings.getByLabel("提示词增强", { exact: true })
  await enhancement.fill("Fixture enhancement")
  await settings.getByRole("button", { name: "保存", exact: true }).click()
  await expect(settings.getByRole("status")).toHaveText("已保存")
  await settings.getByRole("button", { name: "返回聊天", exact: true }).click()
  if (isMobile) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await page.getByRole("button", { name: "系统设置", exact: true }).click()
  await expect(enhancement).toHaveValue("Fixture enhancement")
  expect(observation.pageErrors).toEqual([])
})

test("Solid system settings preserve current model limits and require explicit strategy readback", async ({ page, baseURL, isMobile }) => {
  const { entryUrl, observation } = await installSettingsFixture(page, baseURL)
  const originalLimits = [{ model_pattern: "fixture-model", max_context_tokens: 80_000 }]
  const currentLimits = [{ model_pattern: "fixture-model", max_context_tokens: 96_000 }]
  let limits = originalLimits
  const config = { proxy_auth_mode: "auto", features: { ticket_mutation: true, ticket_dispatch: false } }
  const writes: unknown[] = []
  await page.route("**/api/v1/bamboo/config", async (route) => {
    if (route.request().method() === "GET") return route.fulfill({ json: { ...config, model_limits: limits } })
    const patch = route.request().postDataJSON()
    writes.push(patch)
    return route.fulfill({ json: { ...config, model_limits: limits, ...(writes.length > 1 ? patch : {}) } })
  })

  const settings = await openSettings(page, entryUrl, isMobile)
  if (isMobile) await settings.getByRole("combobox", { name: "系统设置" }).selectOption("system")
  else await settings.getByRole("button", { name: "系统", exact: true }).click()
  await expect(settings.getByRole("heading", { name: "Supervisor", exact: true })).toBeVisible()
  const context = settings.locator("section").filter({ has: page.getByRole("radiogroup", { name: "上下文管理", exact: true }) })
  const strategy = context.getByRole("radio", { name: "原文检索窗口", exact: true })
  await strategy.check()
  limits = currentLimits
  const save = context.getByRole("button", { name: "保存", exact: true })
  await save.click()
  await expect(context.getByRole("alert")).toBeVisible()
  await expect(strategy).toBeChecked()
  await save.click()
  await expect(context.getByRole("status")).toHaveText("策略已保存，将在下次压缩时使用。")
  const expected = {
    context_management: { strategy: "retrieval_window", retrieval_window: { history_tool_required: true, fallback_strategy: "none" } },
    model_limits: currentLimits,
  }
  expect(writes).toEqual([expected, expected])

  const compatibility = settings.getByRole("switch", { name: "图形兼容模式" })
  await compatibility.press("Space")
  await expect(page.locator("body")).toHaveAttribute("data-vdi-safe", "true")
  await compatibility.press("Space")
  await expect(page.locator("body")).toHaveAttribute("data-vdi-safe", "false")
  expect(observation.pageErrors).toEqual([])
})

test("Solid session maintenance only reads back after an unconfirmed conversation clear", async ({ page, baseURL, isMobile }) => {
  const { entryUrl, observation } = await installSettingsFixture(page, baseURL)
  let requested = 0
  await page.route("**/api/v1/sessions/all-surface-session/clear", async (route) => {
    expect(route.request().method()).toBe("POST")
    requested += 1
    return route.fulfill({ json: { success: true, session_id: "incorrect-receipt" } })
  })
  await page.goto(entryUrl)
  if (isMobile) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await page.getByRole("button", { name: "All-surface acceptance", exact: true }).click()
  if (isMobile) await page.getByRole("button", { name: "菜单", exact: true }).click()
  await page.getByRole("button", { name: "系统设置", exact: true }).click()
  const settings = page.locator('[data-slot="settings-page"]')
  if (isMobile) await settings.getByRole("combobox", { name: "系统设置" }).selectOption("system")
  else await settings.getByRole("button", { name: "系统", exact: true }).click()
  await settings.getByRole("button", { name: "清除会话消息", exact: true }).click()
  const dialog = page.getByRole("dialog", { name: "清除这个会话的消息？", exact: true })
  await expect(dialog).toContainText("all-surface-session")
  await dialog.getByRole("button", { name: "清除会话消息", exact: true }).click()
  await expect(dialog.getByRole("alert")).toContainText("结果未知")
  await expect(dialog.getByRole("button", { name: "清除会话消息", exact: true })).toHaveCount(0)
  await dialog.getByRole("button", { name: "刷新存储状态", exact: true }).click()
  await expect(dialog.getByRole("status")).toContainText("未发送新的清理请求")
  expect(requested).toBe(1)
  expect(observation.pageErrors).toEqual([])
})
