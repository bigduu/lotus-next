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
  await surface.getByRole("button", { name: "提供方", exact: true }).click()

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

  const settingsButton = surface.getByRole("button", { name: "系统设置" })
  if ((page.viewportSize()?.width ?? 0) < 768) {
    await surface.getByRole("button", { name: "菜单" }).click()
    await expect(settingsButton).toBeInViewport()
  }
  await settingsButton.click()
  await expect(surface.getByRole("heading", { name: "系统设置" })).toBeVisible()
  await expect(surface.getByText("Bodhi · lotus-next")).toBeVisible()
  await expect(surface.getByText("fixture-model", { exact: true }).first()).toBeVisible()
  await surface.getByRole("button", { name: "提供方", exact: true }).click()
  await expect(surface.getByText("Fixture provider", { exact: true }).first()).toBeVisible()
  await expect(surface.getByText("OpenAI · 默认", { exact: true })).toBeVisible()
  await expect.poll(
    () => observation.staticUrls.some((url) => pathname(url) === settingsPath),
    { message: "the Settings feature should load from the embedded artifact base" },
  ).toBe(true)

  await surface.getByRole("button", { name: "关闭设置" }).click()
  await expect(
    surface.getByRole("textbox", { name: "消息", exact: true }),
  ).toBeVisible()

  expect(
    observation.staticUrls.every((url) => pathname(url).startsWith(embeddedScenario.appPath)),
    "every production artifact request should stay below the embedded mount path",
  ).toBe(true)
  expect(
    observation.staticUrls.filter((url) => pathname(url) === embeddedScenario.appPath),
    "opening and closing Settings must not reload the embedded document",
  ).toHaveLength(1)
})
