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
  type ArtifactScenario,
  type RuntimeObservation,
} from "./support/artifactRuntime.js"

type Surface = Page | FrameLocator
type RuntimeHandle = { surface: Surface; observation: RuntimeObservation }
type RuntimeFixtures = {
  startRuntime(scenario: ArtifactScenario): Promise<RuntimeHandle>
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
    await activate(async (scenario) => {
      await page.addInitScript(() => {
        const browserGlobal = globalThis as unknown as {
          localStorage: { setItem(key: string, value: string): void }
        }
        browserGlobal.localStorage.setItem("bodhi_onboarded_v1", "1")
      })
      const observation = await installArtifactRuntime(page, scenario)
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

const pathname = (url: string): string => new URL(url).pathname

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
  expectedWebSocketProtocol: "ws:" | "wss:",
): Promise<void> => {
  await expect.poll(
    () => observation.apiUrls.some((url) => pathname(url) === "/api/v1/prompt-presets"),
    { message: "deferred bootstrap should settle through the canonical client" },
  ).toBe(true)
  await expect.poll(() => observation.webSocketUrls).toHaveLength(1)
  await expect.poll(
    () => observation.clientFrames.some((frame) => frameMatches(frame, { type: "hello" })),
  ).toBe(true)
  await expect.poll(
    () =>
      observation.clientFrames.some((frame) =>
        frameMatches(frame, { type: "subscribe", ch: "feed", since: 0 }),
      ),
  ).toBe(true)

  const bootstrapRequests = observation.apiUrls.filter(
    (url) => pathname(url) === "/api/v1/bootstrap",
  )
  expect(bootstrapRequests).toHaveLength(1)
  expect(observation.apiUrls.length).toBeGreaterThan(0)
  for (const url of observation.apiUrls) {
    expect(pathname(url)).toMatch(/^\/api\/v1(?:\/|$)/)
    expect(pathname(url)).not.toMatch(/^\/v1(?:\/|$)/)
  }

  const [webSocketUrl] = observation.webSocketUrls
  expect(new URL(webSocketUrl).protocol).toBe(expectedWebSocketProtocol)
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

  await expectCanonicalRuntime(observation, "ws:")
  await expectReadyShell(surface)
  expect(observation.staticUrls.some((url) => pathname(url).startsWith("/assets/"))).toBe(true)
})

test("secure remote artifact keeps HTTP and realtime transport encrypted", async ({
  startRuntime,
}) => {
  const { surface, observation } = await startRuntime(secureRemoteScenario)

  await expectCanonicalRuntime(observation, "wss:")
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

  await expectCanonicalRuntime(observation, "ws:")
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
