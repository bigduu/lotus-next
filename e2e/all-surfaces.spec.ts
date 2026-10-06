import {
  expect,
  test as base,
  type FrameLocator,
  type Page,
  type TestInfo,
} from "@playwright/test"
import {
  artifactFileForSource,
  embeddedScenario,
  installArtifactRuntime,
  secureRemoteScenario,
  standaloneScenario,
  type ArtifactRuntimeOptions,
  type ArtifactScenario,
  type RuntimeObservation,
} from "./support/artifactRuntime.js"

type Surface = Page | FrameLocator
type RuntimeHandle = { surface: Surface; observation: RuntimeObservation }

const selectSettingsCategory = async (surface: Surface, id: string, label: string) => {
  const categories = surface.locator("#settings-category")
  await categories.waitFor({ state: "attached" })
  if (await categories.isVisible()) await categories.selectOption(id)
  else await surface.getByRole("button", { name: label, exact: true }).click()
}
type RuntimeFixtures = {
  startRuntime(
    scenario: ArtifactScenario,
    options?: ArtifactRuntimeOptions,
  ): Promise<RuntimeHandle>
}

const attachObservations = async (
  testInfo: TestInfo,
  observations: RuntimeObservation[],
): Promise<void> => {
  await testInfo.attach("runtime-observations", {
    body: Buffer.from(`${JSON.stringify(observations, null, 2)}\n`),
    contentType: "application/json",
  })
}

const test = base.extend<RuntimeFixtures>({
  startRuntime: async ({ page }, activate, testInfo) => {
    const observations: RuntimeObservation[] = []
    await activate(async (scenario, options) => {
      await page.addInitScript(() => {
        const browserGlobal = globalThis as unknown as {
          localStorage: { setItem(key: string, value: string): void }
        }
        browserGlobal.localStorage.setItem("bodhi_onboarded_v1", "1")
      })
      const observation = await installArtifactRuntime(page, scenario, [], options)
      observations.push(observation)
      await page.goto(scenario.entryUrl, { waitUntil: "domcontentloaded" })
      const surface = scenario.embedded
        ? page.frameLocator('iframe[title="Lotus Next embedded surface"]')
        : page
      return { surface, observation }
    })
    await page.waitForLoadState("networkidle")
    await attachObservations(testInfo, observations)
    for (const observation of observations) {
      expect(observation.pageErrors, `${observation.scenario}: page errors`).toEqual([])
      expect(observation.consoleErrors, `${observation.scenario}: console errors`).toEqual([])
      expect(observation.failedRequests, `${observation.scenario}: failed requests`).toEqual([])
      expect(observation.errorResponses, `${observation.scenario}: HTTP errors`).toEqual([])
    }
  },
})

const frameMatches = (
  frame: unknown,
  expected: Readonly<Record<string, unknown>>,
): boolean =>
  typeof frame === "object" &&
  frame !== null &&
  Object.entries(expected).every(
    ([key, value]) => key in frame && (frame as Record<string, unknown>)[key] === value,
  )

const isExactFrame = (frame: unknown, type: string): boolean =>
  frameMatches(frame, { type }) && Object.keys(frame as Record<string, unknown>).length === 1

const pathname = (url: string): string => new URL(url).pathname

const isRetiredProviderRequest = (request: { method: string; url: string }): boolean => {
  const path = pathname(request.url)
  return (
    ((request.method === "GET" || request.method === "POST") &&
      path === "/api/v1/bamboo/settings/provider") ||
    (request.method === "POST" && path === "/api/v1/bamboo/settings/provider/models")
  )
}

const expectReadyShell = async (surface: Surface): Promise<void> => {
  const composer = surface.getByRole("textbox", { name: "消息", exact: true })
  await expect(composer).toBeVisible()
  await expect(
    surface.locator("header").getByText("All-surface acceptance", { exact: true }),
  ).toBeVisible()
  await composer.fill("all-surface viewport smoke")
  await expect(composer).toHaveValue("all-surface viewport smoke")
  await expect(
    surface.getByRole("button", { name: "发送消息", exact: true }),
  ).toBeEnabled()
  await composer.fill("")

  const overflow = await surface.locator("html").evaluate(
    (element) => element.scrollWidth - element.clientWidth,
  )
  expect(overflow, "the primary shell should not overflow its viewport horizontally").toBeLessThanOrEqual(1)
}

const expectCanonicalRuntime = async (
  observation: RuntimeObservation,
  scenario: ArtifactScenario,
): Promise<void> => {
  await expect.poll(
    () => observation.apiUrls.some((url) => pathname(url) === "/api/v1/prompt-presets"),
    { message: "deferred bootstrap should settle through the canonical client" },
  ).toBe(true)
  await expect.poll(() => observation.webSocketUrls).toHaveLength(1)
  await expect.poll(() => observation.bootstrapDocuments).toHaveLength(1)
  const bootstrap = observation.bootstrapDocuments[0] as { capabilities?: unknown }
  expect(
    Array.isArray(bootstrap.capabilities)
      ? bootstrap.capabilities.filter((capability) => capability === "auth.ws_hello_ack.v1")
      : [],
    "the default fixture must advertise the reliable WebSocket hello acknowledgement",
  ).toHaveLength(1)

  await expect.poll(
    () =>
      observation.webSocketTimeline.filter(
        ({ direction, frame }) =>
          direction === "server-to-client" && isExactFrame(frame, "welcome"),
      ),
  ).toHaveLength(1)
  await expect.poll(
    () =>
      observation.clientFrames.some((frame) =>
        frameMatches(frame, { type: "subscribe", ch: "feed", since: 0 }),
      ),
  ).toBe(true)

  const helloFrames = observation.webSocketTimeline.filter(
    ({ direction, frame }) =>
      direction === "client-to-server" && frameMatches(frame, { type: "hello" }),
  )
  const welcomeFrames = observation.webSocketTimeline.filter(
    ({ direction, frame }) =>
      direction === "server-to-client" && frameMatches(frame, { type: "welcome" }),
  )
  const subscribeFrames = observation.webSocketTimeline.filter(
    ({ direction, frame }) =>
      direction === "client-to-server" && frameMatches(frame, { type: "subscribe" }),
  )
  expect(helloFrames, "one socket epoch must send exactly one hello").toHaveLength(1)
  expect(isExactFrame(helloFrames[0]?.frame, "hello")).toBe(true)
  expect(welcomeFrames, "the fixture must return exactly one welcome").toHaveLength(1)
  expect(
    isExactFrame(welcomeFrames[0]?.frame, "welcome"),
    "welcome must contain no extra fields or secret material",
  ).toBe(true)
  expect(subscribeFrames.length).toBeGreaterThan(0)
  expect(helloFrames[0].ordinal).toBeLessThan(welcomeFrames[0].ordinal)
  for (const subscription of subscribeFrames) {
    expect(
      subscription.ordinal,
      "every subscription must be sent only after the exact welcome",
    ).toBeGreaterThan(welcomeFrames[0].ordinal)
  }
  expect(observation.protocolErrors, "fixture protocol-order violations").toEqual([])

  const bootstrapRequests = observation.apiUrls.filter(
    (url) => pathname(url) === "/api/v1/bootstrap",
  )
  expect(bootstrapRequests).toHaveLength(1)
  expect(observation.apiUrls.length).toBeGreaterThan(0)
  expect(
    observation.httpRequests.filter(isRetiredProviderRequest),
    "Lotus Next must never request retired provider configuration endpoints",
  ).toEqual([])
  for (const url of observation.apiUrls) {
    expect(new URL(url).origin).toBe(scenario.origin)
    expect(pathname(url)).toMatch(/^\/api\/v1(?:\/|$)/)
    expect(pathname(url)).not.toMatch(/^\/v1(?:\/|$)/)
  }

  const [webSocketUrl] = observation.webSocketUrls
  const pageOrigin = new URL(scenario.origin)
  const expectedWebSocketOrigin =
    `${pageOrigin.protocol === "https:" ? "wss:" : "ws:"}//${pageOrigin.host}`
  expect(new URL(webSocketUrl).origin).toBe(expectedWebSocketOrigin)
  expect(pathname(webSocketUrl)).toBe("/v2/stream")
  expect(observation.webSocketProtocols).toEqual([[]])
  expect(
    observation.clientFrames.every(
      (frame) =>
        typeof frame === "object" &&
        frame !== null &&
        !("binary" in frame) &&
        !("malformed" in frame),
    ),
    "the default JSON transport must not send binary or malformed frames",
  ).toBe(true)
}

test("standalone page-origin artifact reaches a usable canonical shell", async ({
  startRuntime,
}) => {
  const { surface, observation } = await startRuntime(standaloneScenario)

  await expectCanonicalRuntime(observation, standaloneScenario)
  await expectReadyShell(surface)
  expect(observation.staticUrls.some((url) => pathname(url).startsWith("/assets/"))).toBe(true)
})

test("system settings can disable generated summaries in favor of retrieval windows", async ({
  page,
  startRuntime,
}) => {
  const configPatches: unknown[] = []
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      new URL(request.url()).pathname === "/api/v1/bamboo/config"
    ) {
      configPatches.push(request.postDataJSON())
    }
  })

  const { surface } = await startRuntime(standaloneScenario)
  const settingsButton = surface.getByRole("button", { name: "系统设置", exact: true })
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await surface.getByRole("button", { name: "菜单" }).click()
  }
  await settingsButton.click()
  await selectSettingsCategory(surface, "system", "系统")

  const section = surface.locator("section").filter({ hasText: "上下文管理" })
  const summarySwitch = section.getByRole("switch", { name: "自动生成上下文摘要" })
  await expect(summarySwitch).toBeChecked()
  await expect(section.getByText(/从下一次执行开始生效/)).toBeVisible()

  await summarySwitch.click()
  await expect(summarySwitch).not.toBeChecked()
  await expect(section.getByText(/保存后请新建会话/)).toBeVisible()
  await section.getByRole("button", { name: "保存", exact: true }).click()

  await expect.poll(() => configPatches).toHaveLength(1)
  expect(configPatches[0]).toMatchObject({
    context_management: {
      strategy: "retrieval_window",
      retrieval_window: {
        history_tool_required: true,
        fallback_strategy: "none",
      },
    },
  })
  await expect(section.getByText("已保存", { exact: true })).toBeVisible()
  await expect(summarySwitch).not.toBeChecked()
})

test("settings page preserves the chat draft, workbench and keyboard return path", async ({
  page,
  startRuntime,
}, testInfo) => {
  const { surface } = await startRuntime(standaloneScenario)
  const composer = surface.getByRole("textbox", { name: "消息", exact: true })
  await expect(composer).toBeVisible()
  await composer.fill("draft retained across settings navigation")
  await composer.evaluate((element) => element.setAttribute("data-navigation-marker", "same-composer"))
  const launcher = surface.getByRole("button", { name: "打开侧边面板", exact: true })
  await launcher.click()
  const workbench = surface.getByRole("complementary", { name: "工作面板", exact: true })
  await expect(workbench).toBeVisible()

  await page.keyboard.press("Control+k")
  const paletteSearch = surface.getByPlaceholder("搜索会话或操作…")
  await paletteSearch.fill("系统设置")
  await paletteSearch.press("Enter")
  const settings = surface.locator('[data-slot="settings-page"]')
  const title = settings.getByRole("heading", { name: "系统设置", exact: true })
  await expect(title).toBeVisible()
  await expect(title).toBeFocused()
  await expect(composer).toBeHidden()
  await expect(workbench).toBeHidden()
  await expect(surface.locator('[data-slot="chat-shell"]')).toHaveAttribute("inert", "")
  const bounds = await settings.boundingBox()
  expect(bounds?.width).toBeGreaterThanOrEqual((page.viewportSize()?.width ?? 0) - 1)
  expect(bounds?.height).toBeGreaterThanOrEqual((page.viewportSize()?.height ?? 0) - 1)
  await expect(surface.getByRole("dialog")).toHaveCount(0)
  await expect(settings.getByRole("heading", { name: "通用", exact: true })).toBeVisible()
  await settings.getByRole("button", { name: "浅色", exact: true }).click()
  await expect(settings.getByRole("button", { name: "浅色", exact: true })).toHaveAttribute("aria-pressed", "true")
  await testInfo.attach(`settings-page-light-${testInfo.project.name}`, {
    body: await page.screenshot({ animations: "disabled" }), contentType: "image/png",
  })
  await settings.getByRole("button", { name: "深色", exact: true }).click()
  await testInfo.attach(`settings-page-dark-${testInfo.project.name}`, {
    body: await page.screenshot({ animations: "disabled" }), contentType: "image/png",
  })
  await page.emulateMedia({ reducedMotion: "reduce" })
  await selectSettingsCategory(surface, "providers", "提供方")
  await expect(settings.getByRole("heading", { name: "提供方", exact: true })).toBeVisible()
  const duration = await settings.getByRole("region", { name: "提供方", exact: true }).evaluate(
    (element) => element.ownerDocument.defaultView!.getComputedStyle(element).animationDuration,
  )
  expect(Number.parseFloat(duration)).toBeLessThanOrEqual(0.001)
  expect(await page.evaluate(() => {
    const browser = globalThis as unknown as { document: { documentElement: { scrollWidth: number; clientWidth: number } } }
    return browser.document.documentElement.scrollWidth - browser.document.documentElement.clientWidth
  })).toBeLessThanOrEqual(1)
  await settings.getByRole("button", { name: "返回聊天", exact: true }).click()
  await expect(settings).toBeHidden()
  await expect(workbench).toBeVisible()
  await expect(composer).toHaveValue("draft retained across settings navigation")
  await expect(composer).toHaveAttribute("data-navigation-marker", "same-composer")
  await expect(surface.getByRole("button", { name: "收起侧边面板", exact: true })).toBeFocused()

  await page.keyboard.press("Control+k")
  await paletteSearch.fill("系统设置")
  await paletteSearch.press("Enter")
  await expect(settings.getByRole("heading", { name: "提供方", exact: true })).toBeVisible()
  await expect(title).toBeFocused()
  await title.press("Escape")
  await expect(settings).toBeHidden()
  await expect(composer).toHaveValue("draft retained across settings navigation")
})

test("message bubble presets and custom colors preview immediately and survive reload", async ({
  page,
  startRuntime,
}) => {
  const { surface } = await startRuntime(standaloneScenario)
  await expect(surface.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
  const openSettings = async () => {
    await expect(surface.getByRole("textbox", { name: "消息", exact: true })).toBeVisible()
    await page.keyboard.press("Control+k")
    const search = surface.getByPlaceholder("搜索会话或操作…")
    await search.fill("系统设置")
    await search.press("Enter")
    await expect(surface.locator("#app-language")).toBeVisible()
  }
  await openSettings()
  const settings = surface.locator('[data-slot="settings-page"]')
  await settings.getByRole("button", { name: "雾蓝", exact: true }).click()
  await expect(settings.getByRole("button", { name: "雾蓝", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect.poll(() => surface.locator("html").evaluate((element) => (element as unknown as { style: { getPropertyValue(name: string): string } }).style.getPropertyValue("--user-message-background"))).toBe("#293b4a")
  const color = settings.getByLabel("自定义气泡颜色", { exact: true })
  await color.evaluate((element) => {
    Object.getOwnPropertyDescriptor(Object.getPrototypeOf(element), "value")!.set!.call(element, "#777777")
    element.dispatchEvent(new element.ownerDocument.defaultView!.Event("input", { bubbles: true }))
    element.dispatchEvent(new element.ownerDocument.defaultView!.Event("change", { bubbles: true }))
  })
  await expect(settings.getByRole("button", { name: "自定义", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect.poll(() => surface.locator("html").evaluate((element) => (element as unknown as { style: { getPropertyValue(name: string): string } }).style.getPropertyValue("--user-message-background"))).toBe("#777777")
  await expect.poll(() => surface.locator("html").evaluate((element) => (element as unknown as { style: { getPropertyValue(name: string): string } }).style.getPropertyValue("--user-message-foreground"))).toBe("#000000")
  await expect(settings.getByText("这是一条你发送的消息。", { exact: true })).toHaveCSS("background-color", "rgb(119, 119, 119)")
  await page.reload()
  await openSettings()
  await expect(settings.getByRole("button", { name: "自定义", exact: true })).toHaveAttribute("aria-pressed", "true")
  await expect(color).toHaveValue("#777777")
  await expect(settings.getByText("这是一条你发送的消息。", { exact: true })).toHaveCSS("color", "rgb(0, 0, 0)")
  await settings.getByRole("button", { name: "玉石绿", exact: true }).click()
  await expect.poll(() => surface.locator("html").evaluate((element) => (element as unknown as { style: { getPropertyValue(name: string): string } }).style.getPropertyValue("--user-message-background"))).toBe("#263e34")
})

test("malformed provider snapshot is visibly incompatible without legacy fallback", async ({
  page,
  startRuntime,
}) => {
  const credentialCanary = "e2e-provider-secret-canary"
  const { surface, observation } = await startRuntime(standaloneScenario, {
    providerInstancesResponse: {
      instances: "invalid",
      api_key: "****...****",
      credentialCanary,
    },
  })

  await expectReadyShell(surface)
  const settingsButton = surface.getByRole("button", { name: "系统设置" })
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await surface.getByRole("button", { name: "菜单" }).click()
    await expect(settingsButton).toBeInViewport()
  }
  await settingsButton.click()
  await selectSettingsCategory(surface, "providers", "提供方")

  await expect(
    surface.getByRole("alert").filter({ hasText: "提供方配置格式与 Lotus Next 不兼容" }),
  ).toBeVisible()
  await expect(surface.getByText("Fixture provider", { exact: true })).toHaveCount(0)
  await expect(surface.getByText("GitHub Copilot", { exact: true })).toHaveCount(0)
  await expect(surface.locator("body")).not.toContainText(credentialCanary)
  await expect(surface.locator("body")).not.toContainText("****...****")
  expect(observation.httpRequests.filter(isRetiredProviderRequest)).toEqual([])
})

test("secure remote artifact keeps HTTP and realtime transport encrypted", async ({
  startRuntime,
}) => {
  const { surface, observation } = await startRuntime(secureRemoteScenario)

  await expectCanonicalRuntime(observation, secureRemoteScenario)
  await expectReadyShell(surface)
  expect(observation.apiUrls.every((url) => new URL(url).protocol === "https:")).toBe(true)
  expect(observation.webSocketUrls.every((url) => new URL(url).protocol === "wss:")).toBe(true)
})

test("embedded base path owns entry, assets, lazy settings, and return navigation", async ({
  page,
  startRuntime,
}) => {
  const { surface, observation } = await startRuntime(embeddedScenario)
  const settingsArtifact = await artifactFileForSource("src/components/chat/Settings.tsx")
  const settingsPath = `${embeddedScenario.appPath}${settingsArtifact}`

  await expectCanonicalRuntime(observation, embeddedScenario)
  await expectReadyShell(surface)
  expect(observation.staticUrls.some((url) => pathname(url) === settingsPath)).toBe(false)

  await surface.getByRole("textbox", { name: "消息", exact: true }).fill("all-surface viewport smoke")

  const settingsButton = surface.getByRole("button", { name: "系统设置" })
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await surface.getByRole("button", { name: "菜单" }).click()
    await expect(settingsButton).toBeInViewport()
  }
  await settingsButton.click()
  await expect(surface.getByRole("heading", { name: "系统设置" })).toBeVisible()
  await expect(surface.getByText("Bodhi · lotus-next")).toBeVisible()
  await expect(surface.getByRole("textbox", { name: "消息", exact: true })).toBeHidden()
  await selectSettingsCategory(surface, "providers", "提供方")
  const fixtureProviderRow = surface.locator("li").filter({ hasText: "Fixture provider" })
  await expect(fixtureProviderRow.getByText("Fixture provider", { exact: true })).toBeVisible()
  await expect(fixtureProviderRow.getByText("OpenAI", { exact: true })).toBeVisible()
  await expect(fixtureProviderRow.getByRole("button", { name: "设为默认" })).toHaveCount(0)
  await expect(surface.getByText("OpenAI · 默认", { exact: true })).toHaveCount(0)

  await surface.getByRole("button", { name: "新增", exact: true }).click()
  const providerType = surface.getByRole("combobox", { name: "提供方类型" })
  await providerType.click()
  const selectContent = surface.locator('[data-slot="select-content"]')
  await expect(selectContent).toBeVisible()
  await surface.getByRole("option", { name: "Anthropic", exact: true }).press("Escape")
  await expect(selectContent).toBeHidden()
  await expect(surface.getByRole("heading", { name: "系统设置" })).toBeVisible()

  await providerType.press("ArrowDown")
  await expect(selectContent).toBeVisible()
  await surface.getByRole("option", { name: "OpenAI", exact: true }).press("Enter")
  await expect(providerType).toContainText("OpenAI")
  await providerType.press("ArrowDown")
  await surface.getByRole("option", { name: "OpenAI", exact: true }).press("Escape")
  await expect(selectContent).toBeHidden()
  await expect(surface.getByRole("heading", { name: "系统设置" })).toBeVisible()
  await expect.poll(
    () => observation.staticUrls.some((url) => pathname(url) === settingsPath),
    { message: "the Settings feature should load from the embedded artifact base" },
  ).toBe(true)

  await surface.getByRole("button", { name: "返回聊天" }).click()
  await expect(
    surface.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible()
  await expect(surface.getByRole("textbox", { name: "消息", exact: true })).toHaveValue("all-surface viewport smoke")

  expect(
    observation.staticUrls.every((url) => pathname(url).startsWith(embeddedScenario.appPath)),
    "every production artifact request should stay below the embedded mount path",
  ).toBe(true)
  expect(
    observation.staticUrls.filter((url) => pathname(url) === embeddedScenario.appPath),
    "opening and closing Settings must not reload the embedded document",
  ).toHaveLength(1)
})
