import { expect, test, type Page, type TestInfo } from "@playwright/test"
import { installArtifactRuntime, standaloneScenario } from "./support/artifactRuntime.js"
import { modelEffortPicker, selectEffort } from "./support/modelEffortPicker.js"
import { expectComposerText } from "./support/composer.js"

const mainId = "all-surface-session"
const sideId = "model-effort-side-root"
const alternateModel = "local-analysis-model-with-a-long-responsive-display-name"
const mainTitle = "Main model and effort"
const birth = "a".repeat(64)
const at = "2026-10-06T00:00:00.000Z"

function expectCloseBounds(actual: { x: number; y: number; width: number; height: number } | null,
  expected: { x: number; y: number; width: number; height: number } | null) {
  expect(actual).not.toBeNull()
  expect(expected).not.toBeNull()
  for (const key of ["x", "y", "width", "height"] as const) {
    // DOMRect frame sampling can differ by a few millionths of a CSS pixel.
    expect(actual![key]).toBeCloseTo(expected![key], 2)
  }
}

async function screenshot(page: Page, info: TestInfo, name: string) {
  const file = info.outputPath(`${name}.png`)
  await page.screenshot({ path: file, animations: "disabled" })
  await info.attach(name, { path: file, contentType: "image/png" })
  const detailNames: Record<string, string> = {
    "combined-picker-high": "model-effort-high-detail",
    "combined-picker-ultra": "ultra-detail",
    "combined-picker-model-list": "model-list-detail",
    "combined-picker-model-menu": "model-menu-detail",
  }
  const detailName = detailNames[name]
  if (info.project.name !== "desktop-chromium" || !detailName) return
  const panel = await page.locator('[data-slot="popover-content"]').boundingBox()
  const trigger = await modelEffortPicker(page).boundingBox()
  const viewport = page.viewportSize()
  if (!panel || !trigger || !viewport) throw new Error("Picker screenshot region is unavailable")
  const x = Math.max(0, Math.min(panel.x, trigger.x) - 12)
  const y = Math.max(0, Math.min(panel.y, trigger.y) - 12)
  const right = Math.min(viewport.width, Math.max(panel.x + panel.width, trigger.x + trigger.width) + 12)
  const bottom = Math.min(viewport.height, Math.max(panel.y + panel.height, trigger.y + trigger.height) + 12)
  const detailFile = info.outputPath(`${detailName}.png`)
  await page.screenshot({ path: detailFile, animations: "disabled", clip: { x, y, width: right - x, height: bottom - y } })
  await info.attach(detailName, { path: detailFile, contentType: "image/png" })
}

async function setup(page: Page, beforeSessionRestoration?: () => Promise<void>, beforeModeCommit?: () => Promise<void>) {
  await page.addInitScript((id) => {
    localStorage.setItem("bodhi_onboarded_v1", "1")
    localStorage.setItem("lotus_next_last_session", id)
  }, mainId)
  const observation = await installArtifactRuntime(page, standaloneScenario, [], {
    providerInstancesResponse: {
      default_provider_instance_id: "fixture-provider",
      instances: [{ id: "fixture-provider", type: "openai", label: "Fixture provider", enabled: true,
        config: { model: "fixture-model", runtime_models: ["fixture-model", alternateModel] } }],
      defaults: { chat: { provider: "fixture-provider", model: "fixture-model" } },
      features: { provider_model_ref: true },
    },
  })
  const session = (id: string, title: string, effort: string) => ({
    id, title, kind: "root", title_version: 1, root_session_id: id,
    parent_session_id: null, spawn_depth: 0, root_orchestration_only: false,
    thinking_mode: "standard", root_mode_transition_epoch: 0, root_mode_birth_token: birth,
    model: "fixture-model", model_ref: { provider: "fixture-provider", model: "fixture-model" },
    reasoning_effort: effort as string | undefined,
    created_at: at, updated_at: at, last_activity_at: at, message_count: 0,
    has_attachments: false, is_running: false, last_run_status: "completed",
    permission_mode: "default", bypass_permissions: false,
  })
  const main = session(mainId, mainTitle, "medium")
  const side = session(sideId, "Side model and effort", "low")
  const sessions = [main, side]
  const patches: Array<{ id: string; body: Record<string, unknown> }> = []
  const operations: Array<Record<string, unknown>> = []
  const models = ["fixture-model", alternateModel].map((model) => ({
    reference: { provider: "fixture-provider", model }, display_name: model,
    provider_display_name: "Fixture provider",
    capabilities: { supports_tools: true, supports_vision: false, supports_reasoning: true },
  }))
  await page.route("**/api/v1/bamboo/provider-catalog/fetch-models", (route) =>
    route.fulfill({ json: { fetched: [{ provider: "fixture-provider", models }] } }))
  await page.route("**/api/v1/bamboo/provider-catalog", (route) =>
    route.fulfill({ json: { providers: [], models } }))
  let restorationReleased = false
  let restorationGate: Promise<void> | undefined
  await page.route("**/api/v1/sessions?*", async (route) => {
    const child = new URL(route.request().url()).searchParams.get("kind") === "child"
    if (!child && beforeSessionRestoration && !restorationReleased) {
      // Bootstrap and index sync can request roots concurrently. Hold their
      // initial responses together, then let subsequent refreshes through.
      restorationGate ??= beforeSessionRestoration()
      await restorationGate
      restorationReleased = true
    }
    const roots = child ? [] : sessions
    return route.fulfill({ json: { sessions: roots, total: roots.length, limit: 200, offset: 0 } })
  })
  for (const current of sessions) {
    await page.route(`**/api/v1/sessions/${current.id}`, (route) => {
      if (route.request().method() === "PATCH") {
        const body = route.request().postDataJSON() as Record<string, unknown>
        patches.push({ id: current.id, body })
        if (typeof body.model === "string") {
          current.model = body.model
          current.model_ref = { provider: "fixture-provider", model: body.model }
        }
        if (body.clear_reasoning_effort) current.reasoning_effort = undefined
        else if (typeof body.reasoning_effort === "string") current.reasoning_effort = body.reasoning_effort
      }
      return route.fulfill({ json: { session: current }, headers: { ETag: '"1"' } })
    })
    await page.route(`**/api/v1/history/${current.id}`, (route) =>
      route.fulfill({ json: { session_id: current.id, messages: [] } }))
    await page.route(`**/api/v1/task/${current.id}`, (route) =>
      route.fulfill({ json: { session_id: current.id, items: [] } }))
    await page.route(`**/api/v1/respond/${current.id}/pending`, (route) =>
      route.fulfill({ json: { has_pending_question: false } }))
    await page.route(`**/api/v1/sessions/${current.id}/root-mode-operations/*`, async (route) => {
      const body = route.request().postDataJSON() as Record<string, unknown>
      operations.push(body)
      await beforeModeCommit?.()
      expect(body.birth_token).toBe(birth)
      expect(body.expected_epoch).toBe(current.root_mode_transition_epoch)
      const expected = current.root_mode_transition_epoch++
      current.root_orchestration_only = body.enabled === true
      current.thinking_mode = current.root_orchestration_only ? "ultra" : "standard"
      const operationId = decodeURIComponent(new URL(route.request().url()).pathname.split("/").at(-1)!)
      return route.fulfill({ json: {
        status: "committed", operation_id: operationId, expected_epoch: expected,
        resulting_epoch: current.root_mode_transition_epoch,
        enabled_at_completion: current.root_orchestration_only,
        thinking_mode_at_completion: current.thinking_mode,
        root_tool_authority_revision: current.root_mode_transition_epoch,
      } })
    })
  }
  await page.goto(standaloneScenario.entryUrl)
  await expect(modelEffortPicker(page)).toBeVisible()
  // A visible picker can still belong to the new-session draft. Wait for the
  // saved session's identity and validated Root authority before editing it.
  await expect(page.getByRole("banner")).toContainText(main.title)
  await expect(modelEffortPicker(page)).toContainText("fixture-model")
  await expect(modelEffortPicker(page)).toContainText("中")
  await expect(page.getByRole("status").filter({ hasText: "服务器已确认普通模式" })).toHaveText("服务器已确认普通模式")
  return { observation, main, side, patches, operations }
}

test("saved-session restoration completes before the picker test edits its draft", async ({ page }) => {
  const draft = "Preserve this draft while changing model and effort"
  const input = page.getByRole("textbox", { name: "消息", exact: true })
  let restorationChecks = 0
  const { observation, patches } = await setup(page, async () => {
    restorationChecks += 1
    await expect(modelEffortPicker(page)).toBeVisible()
    await expect(page.getByRole("banner")).not.toContainText(mainTitle)
    await expect(page.getByRole("status").filter({ hasText: "下次创建时使用普通模式" })).toHaveText("下次创建时使用普通模式")
    await expectComposerText(input, "")
  })
  expect(restorationChecks).toBe(1)
  await input.fill(draft)
  await expectComposerText(input, draft)
  await selectEffort(page, "高")
  await expect(modelEffortPicker(page)).toContainText("高")
  await expectComposerText(input, draft)
  expect(patches).toEqual([{ id: mainId, body: { reasoning_effort: "high" } }])
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})

test("the combined picker persists effort and model, supports keyboard, and fits the viewport", async ({ page }, info) => {
  const { observation, main, patches, operations } = await setup(page)
  const picker = modelEffortPicker(page)
  const input = page.getByRole("textbox", { name: "消息", exact: true })
  await input.fill("Preserve this draft while changing model and effort")
  await expect(picker).toContainText("fixture-model")
  await expect(picker).toContainText("中")

  if (info.project.name === "desktop-chromium") {
    await picker.click()
    const dragSlider = page.getByRole("slider", { name: "推理强度", exact: true })
    await expect(dragSlider).toBeEnabled()
    const bounds = await dragSlider.boundingBox()
    if (!bounds) throw new Error("Reasoning slider bounds are unavailable")
    const position = (index: number) => bounds.x + 10 + (bounds.width - 20) * index / 7
    const center = bounds.y + bounds.height / 2
    await page.mouse.move(position(3), center)
    await page.mouse.down()
    await page.mouse.move(position(6), center, { steps: 6 })
    await page.mouse.move(position(4), center, { steps: 4 })
    await page.mouse.move(position(4), bounds.y - 24, { steps: 3 })
    expect(patches).toEqual([])
    expect(operations).toEqual([])
    await page.mouse.up()
    await page.keyboard.press("Escape")
    await expect(dragSlider).not.toBeVisible()
  } else {
    await selectEffort(page, "高")
  }
  await expect(picker).toContainText("高")
  expect(patches).toEqual([{ id: mainId, body: { reasoning_effort: "high" } }])
  await picker.click()
  const slider = page.getByRole("slider", { name: "推理强度", exact: true })
  await expect(slider).toHaveValue("4")
  await screenshot(page, info, "combined-picker-high")
  const panelBeforeUltra = await page.locator(".model-effort-panel").boundingBox()
  const triggerBeforeUltra = await picker.boundingBox()
  const sliderBeforeUltra = await slider.boundingBox()
  const duringUltra = page.locator(".model-effort-panel").evaluate(async (panel) => {
    const view = panel.ownerDocument.defaultView!
    const samples: number[][] = []
    for (let frame = 0; frame < 24; frame++) {
      await new Promise<void>((resolve) => view.requestAnimationFrame(() => resolve()))
      const { x, y, width, height } = panel.getBoundingClientRect()
      samples.push([x, y, width, height])
    }
    return samples
  })
  const operationsBeforeUltra = operations.length
  await slider.focus()
  await slider.press("End")
  await expect(picker).toContainText("Ultra")
  await expect.poll(() => operations.length).toBe(operationsBeforeUltra + 1)
  expect(main.reasoning_effort).toBe("high")
  expect(patches).toHaveLength(1)
  for (const sample of await duringUltra) {
    const expected = [panelBeforeUltra!.x, panelBeforeUltra!.y, panelBeforeUltra!.width, panelBeforeUltra!.height]
    sample.forEach((value, index) => expect(value).toBeCloseTo(expected[index]!, 2))
  }
  expect(await page.locator(".model-effort-panel").boundingBox()).toEqual(panelBeforeUltra)
  expect(await picker.boundingBox()).toEqual(triggerBeforeUltra)
  expect(await slider.boundingBox()).toEqual(sliderBeforeUltra)
  await expect(page.locator(".effort-meteors i")).toHaveCount(3)
  await page.emulateMedia({ reducedMotion: "reduce" })
  await expect(page.locator(".effort-meteors i").first()).toHaveCSS("animation-name", "none")
  await page.emulateMedia({ reducedMotion: "no-preference" })
  await expect(page.locator(".effort-meteors i").first()).toHaveCSS("animation-name", "effort-meteor")
  await screenshot(page, info, "combined-picker-ultra")
  await page.keyboard.press("Escape")

  await selectEffort(page, "自动")
  await expect(picker).toContainText("自动")
  expect(main.thinking_mode).toBe("standard")
  expect(patches.at(-1)).toEqual({ id: mainId, body: { clear_reasoning_effort: true } })
  await expectComposerText(input, "Preserve this draft while changing model and effort")

  await picker.click()
  await page.getByTestId("model-picker-model").click()
  const search = page.getByRole("searchbox", { name: "搜索模型", exact: true })
  await expect(search).toBeFocused()
  await screenshot(page, info, "combined-picker-model-list")
  await search.fill("LOCAL-ANALYSIS")
  await expect(page.locator("[data-model-option]")).toHaveCount(1)
  await screenshot(page, info, "combined-picker-model-menu")
  await page.locator("[data-model-option]").click()
  await expect(picker).toContainText(alternateModel)
  expect(patches.at(-1)).toMatchObject({ id: mainId, body: {
    model: alternateModel, provider: "fixture-provider",
    model_ref: { provider: "fixture-provider", model: alternateModel },
  } })
  await expectComposerText(input, "Preserve this draft while changing model and effort")
  await page.reload()
  await expect(picker).toContainText(alternateModel)
  await expect(picker).toContainText("自动")
  expect(await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  await screenshot(page, info, "combined-picker-after-reload")
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})

test("the side composer updates only its own model and effort", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "desktop side composer acceptance")
  const { observation, main, side, patches } = await setup(page)
  await page.getByRole("button", { name: "打开侧边面板", exact: true }).click()
  const workbench = page.locator("#right-workbench")
  await workbench.getByRole("button", { name: "打开工作面板标签页" }).click()
  await page.getByRole("menuitem", { name: "并排会话", exact: true }).click()
  await workbench.getByRole("combobox").filter({ hasText: "选择会话并排" }).click()
  await page.getByRole("option", { name: "Side model and effort", exact: true }).click()
  const pickers = modelEffortPicker(page)
  await expect(pickers).toHaveCount(2)
  const sidePicker = workbench.getByTestId("model-effort-picker")
  await expect(sidePicker).toContainText("低")
  await selectEffort(page, "高", sidePicker)
  await expect(sidePicker).toContainText("高")
  expect(patches).toEqual([{ id: sideId, body: { reasoning_effort: "high" } }])
  expect(main.reasoning_effort).toBe("medium")
  await expect(pickers.nth(0)).toContainText("中")

  await sidePicker.click()
  await page.getByTestId("model-picker-model").click()
  await page.getByRole("searchbox", { name: "搜索模型", exact: true }).fill("local-analysis")
  await page.locator("[data-model-option]").click()
  await expect(sidePicker).toContainText(alternateModel)
  expect(side.model).toBe(alternateModel)
  expect(main.model).toBe("fixture-model")
  expect(patches.every((patch) => patch.id === sideId)).toBe(true)
  await screenshot(page, info, "combined-picker-side-composer")
  expect(observation.pageErrors).toEqual([])
  expect(observation.errorResponses).toEqual([])
})

for (const target of ["main", "side"] as const) {
  test(`a pending Ultra selection keeps the ${target} composer geometry stable`, async ({ page }, info) => {
    test.skip(target === "side" && info.project.name !== "desktop-chromium", "desktop side composer acceptance")
    let release!: () => void
    const confirmation = new Promise<void>((resolve) => { release = resolve })
    const { operations, observation } = await setup(page, undefined, () => confirmation)
    if (target === "side") {
      await page.getByRole("button", { name: "打开侧边面板", exact: true }).click()
      const workbench = page.locator("#right-workbench")
      await workbench.getByRole("button", { name: "打开工作面板标签页" }).click()
      await page.getByRole("menuitem", { name: "并排会话", exact: true }).click()
      await workbench.getByRole("combobox").filter({ hasText: "选择会话并排" }).click()
      await page.getByRole("option", { name: "Side model and effort", exact: true }).click()
      await expect(workbench.getByTestId("model-effort-picker")).toBeEnabled()
    }
    const picker = target === "side" ? page.locator("#right-workbench").getByTestId("model-effort-picker") : modelEffortPicker(page)
    const surfaces = page.locator("[data-composer-surface]")
    const before = await surfaces.evaluateAll((elements) => elements.map((element) => {
      const { x, y, width, height } = element.getBoundingClientRect()
      return { x, y, width, height }
    }))
    await picker.click()
    try {
      await page.getByRole("slider", { name: "推理强度", exact: true }).press("End")
      await expect.poll(() => operations.length).toBe(1)
      await expect(surfaces.getByRole("alert")).toHaveCount(0)
      await expect(surfaces.getByRole("status").filter({ hasText: "等待服务器确认" })).toHaveCount(1)
      const pendingSamples = await surfaces.evaluateAll(async (elements) => {
        const view = elements[0]!.ownerDocument.defaultView!
        const samples = []
        for (let frame = 0; frame < 24; frame++) {
          await new Promise<void>((resolve) => view.requestAnimationFrame(() => resolve()))
          samples.push(elements.map((element) => {
            const { x, y, width, height } = element.getBoundingClientRect()
            return { x, y, width, height }
          }))
        }
        return samples
      })
      for (const sample of pendingSamples) {
        sample.forEach((bounds, index) => expectCloseBounds(bounds, before[index]!))
      }
    } finally {
      release()
    }
    await expect(picker).toContainText("Ultra")
    await expect(surfaces.getByRole("alert")).toHaveCount(0)
    for (let index = 0; index < before.length; index++) {
      expect(await surfaces.nth(index).boundingBox()).toEqual(before[index]!)
    }
    expect(observation.pageErrors).toEqual([])
  })
}

test("model failures remain readable with keyboard details and dismissal", async ({ page }, info) => {
  const { observation } = await setup(page)
  await page.emulateMedia({ reducedMotion: "reduce" })
  const input = page.getByRole("textbox", { name: "消息", exact: true })
  const before = await input.boundingBox()
  const diagnostic = `Fixture diagnostic: ${"long-unbroken-diagnostic-".repeat(80)}`
  await page.route(`**/api/v1/sessions/${mainId}`, async (route) => {
    if (route.request().method() === "PATCH") {
      return route.fulfill({ status: 500, json: { message: diagnostic } })
    }
    return route.fallback()
  })
  await modelEffortPicker(page).click()
  await page.getByTestId("model-picker-model").click()
  await page.getByRole("searchbox", { name: "搜索模型", exact: true }).fill("LOCAL-ANALYSIS")
  await page.locator("[data-model-option]").click()
  const alert = page.getByRole("alert").filter({ hasText: "模型保存失败" })
  await expect(alert).toBeVisible()
  await expect(alert.locator("strong")).toHaveText("操作失败")
  const card = alert.locator("../..")
  await expect(card).toHaveCSS("animation-name", "none")
  // Past both the old 2.5s timeout and the new informational timeout.
  await page.waitForTimeout(5500)
  await expect(alert).toBeVisible()
  const summary = card.locator("summary")
  await input.focus()
  await summary.focus()
  await summary.press("Enter")
  await expect(card.locator("details")).toHaveAttribute("open", "")
  await expect(card).toContainText(diagnostic)
  expect(await input.boundingBox()).toEqual(before)
  expect(await page.locator("html").evaluate((element) => element.scrollWidth - element.clientWidth)).toBeLessThanOrEqual(1)
  const box = await card.boundingBox()
  expect(box!.x).toBeGreaterThanOrEqual(0)
  expect(box!.y).toBeGreaterThanOrEqual(0)
  await screenshot(page, info, "persistent-model-error-details")
  await card.getByRole("button", { name: "关闭", exact: true }).focus()
  await page.keyboard.press("Enter")
  await expect(alert).toHaveCount(0)
  await expect(input).toBeFocused()
  expect(observation.pageErrors).toEqual([])
})

test("narrow workbench survives repeated Tab and keeps nested model popovers usable across resizing", async ({ page }, info) => {
  test.skip(info.project.name !== "desktop-chromium", "Explicit narrow and wide breakpoint acceptance")
  await page.setViewportSize({ width: 1024, height: 900 })
  const { observation } = await setup(page)
  const launcher = page.getByRole("button", { name: "打开侧边面板", exact: true })
  await launcher.click()
  const workbench = page.locator("#right-workbench")
  await expect(workbench).toHaveAttribute("aria-modal", "true")
  const close = workbench.getByRole("button", { name: "收起工作面板", exact: true })
  await close.focus()
  for (const key of ["Tab", "Shift+Tab"]) {
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press(key)
      expect(observation.pageErrors).toEqual([])
      await expect(workbench).toBeVisible()
      expect(await workbench.evaluate((node) => node.contains(node.ownerDocument.activeElement))).toBe(true)
    }
  }
  await workbench.getByRole("button", { name: "打开工作面板标签页" }).click()
  await page.getByRole("menuitem", { name: "并排会话", exact: true }).click()
  await workbench.getByRole("combobox").filter({ hasText: "选择会话并排" }).click()
  await page.getByRole("option", { name: "Side model and effort", exact: true }).click()
  const sidePicker = workbench.getByTestId("model-effort-picker")
  const popover = page.locator('[data-slot="popover-content"]')
  await sidePicker.click()
  await expect(popover).toBeVisible()
  await page.setViewportSize({ width: 1440, height: 900 })
  await expect(popover).toBeVisible()
  await page.setViewportSize({ width: 1024, height: 900 })
  await expect(popover).toBeVisible()
  await page.getByTestId("model-picker-model").click()
  const search = page.getByRole("searchbox", { name: "搜索模型", exact: true })
  await search.fill("local-analysis")
  await expect(search).toHaveValue("local-analysis")
  await page.keyboard.press("Escape")
  await expect(popover).not.toBeVisible()
  await expect(workbench).toBeVisible()
  await expect(sidePicker).toBeFocused()
  await page.keyboard.press("Escape")
  await expect(workbench).not.toBeVisible()
  await expect(launcher).toBeFocused()
  expect(observation.pageErrors).toEqual([])
  await screenshot(page, info, "workbench-modal-focus-return")
})

for (const width of [1024, 390]) {
  test(`global command search owns keyboard focus over a ${width}px workbench`, async ({ page }, info) => {
    test.skip(info.project.name !== "desktop-chromium", "Explicit tablet and phone viewport acceptance")
    await page.setViewportSize({ width, height: 900 })
    const { observation } = await setup(page)
    await page.getByRole("button", { name: "打开侧边面板", exact: true }).click()
    const workbench = page.locator("#right-workbench")
    await workbench.getByRole("button", { name: "打开工作面板标签页" }).click()
    await page.getByRole("menuitem", { name: "并排会话", exact: true }).click()
    await workbench.getByRole("combobox").filter({ hasText: "选择会话并排" }).click()
    await page.getByRole("option", { name: "Side model and effort", exact: true }).click()
    const sideEditor = workbench.locator('[contenteditable="true"][role="textbox"]')
    await sideEditor.click()
    await page.keyboard.type("Retained side draft")
    await page.keyboard.press("Control+k")
    const search = page.getByPlaceholder("搜索会话或操作…")
    await expect(search).toBeFocused()
    await page.keyboard.type("系统设置")
    await expect(search).toHaveValue("系统设置")
    await expectComposerText(sideEditor, "Retained side draft")
    await page.keyboard.press("Escape")
    await expect(search).toBeHidden()
    await expect(sideEditor).toBeFocused()
    await page.keyboard.press("Control+k")
    await expect(search).toBeFocused()
    await page.keyboard.type("系统设置")
    await page.keyboard.press("Enter")
    const settings = page.locator('[data-slot="settings-page"]')
    await expect(settings.getByRole("heading", { name: "系统设置", exact: true })).toBeFocused()
    await expectComposerText(sideEditor, "Retained side draft")
    await settings.getByRole("button", { name: "返回聊天", exact: true }).click()
    await expect(sideEditor).toBeFocused()
    await expectComposerText(sideEditor, "Retained side draft")
    const handle = workbench.locator("button[aria-keyshortcuts]").first()
    const tabOrder = await workbench.getByRole("tab").allTextContents()
    await handle.focus()
    await handle.press("Space")
    await expect(handle.locator("..")).toHaveCSS("opacity", "0.6")
    await page.keyboard.press("Control+k")
    await expect(search).toBeFocused()
    await page.keyboard.type("Alpha movable")
    await expect(search).toHaveValue("Alpha movable")
    await expectComposerText(sideEditor, "Retained side draft")
    await page.keyboard.press("Escape")
    await expect(handle).toBeFocused()
    await expect(workbench.getByRole("tab")).toHaveText(tabOrder)
    await handle.press("Space")
    await expect(handle.locator("..")).toHaveCSS("opacity", "0.6")
    await handle.press("Escape")
    await expect(workbench).toBeVisible()
    await expect(workbench.getByRole("tab")).toHaveText(tabOrder)
    await workbench.getByTestId("model-effort-picker").click()
    await expect(page.locator('[data-slot="popover-content"]')).toBeVisible()
    await page.keyboard.press("Escape")
    await expect(page.locator('[data-slot="popover-content"]')).toBeHidden()
    await expect(workbench).toBeVisible()
    expect(observation.pageErrors).toEqual([])
  })
}
