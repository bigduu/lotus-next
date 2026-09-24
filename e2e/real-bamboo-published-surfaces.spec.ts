import {
  devices,
  expect,
  test,
  type Browser,
  type BrowserContext,
  type Response,
  type TestInfo,
} from "@playwright/test";
import { chmod, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  observePage,
  type FrameObservation,
  type PageObservation,
} from "./support/pageObservation.ts";
import { navigateWithNetworkChangeRecovery } from "./support/transientNavigation.ts";

type JsonRecord = Record<string, unknown>;

interface SurfaceDefinition {
  readonly label: "desktop" | "tablet" | "phone" | "phone-landscape";
  readonly viewport: { readonly width: number; readonly height: number };
  readonly mobile: boolean;
  readonly touch: boolean;
  readonly userAgent?: string;
}

const surfaces: readonly SurfaceDefinition[] = [
  {
    label: "desktop",
    viewport: { width: 1_440, height: 900 },
    mobile: false,
    touch: false,
  },
  {
    label: "tablet",
    viewport: { width: 820, height: 1_180 },
    mobile: false,
    touch: true,
  },
  {
    label: "phone",
    viewport: { width: 390, height: 844 },
    mobile: true,
    touch: true,
  },
  {
    label: "phone-landscape",
    viewport: { width: 915, height: 412 },
    mobile: true,
    touch: true,
    userAgent: devices["Pixel 7"].userAgent,
  },
];

const browserFixtureUrl = "http://127.0.0.1:18080/browser-tabs-fixture?tab=alpha";

const requiredEnvironment = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
};

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const exactFrame = (frame: FrameObservation, type: string): boolean => {
  const value = asRecord(frame.value);
  return (
    !frame.binary &&
    !frame.malformed &&
    value !== null &&
    Object.keys(value).length === 1 &&
    value.type === type
  );
};

const expectedSocketOrigin = (pageOrigin: string): string => {
  const url = new URL(pageOrigin);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  return url.origin;
};

const installPublishedArtifactEntry = async (
  context: BrowserContext,
  sessionId: string,
): Promise<void> => {
  await context.addInitScript((selectedSessionId) => {
    const storage = globalThis.localStorage;
    storage.setItem("bodhi_onboarded_v1", "1");
    storage.removeItem("copilot_backend_base_url");
    storage.removeItem("lotus_next_backend_endpoint_v1");
    storage.setItem("lotus_next_last_session", selectedSessionId);
  }, sessionId);
};

const assertSuccessfulDocumentNavigation = (
  response: Response | null,
  entryUrl: URL,
  phase: "preflight" | "observed",
): void => {
  if (!response) {
    throw new Error(`${phase} navigation returned no HTTP response`);
  }
  const responseUrl = new URL(response.url());
  if (responseUrl.origin !== entryUrl.origin) {
    throw new Error(
      `${phase} navigation left ${entryUrl.origin} for ${responseUrl.origin}`,
    );
  }
  if (!response.ok()) {
    throw new Error(
      `${phase} navigation returned HTTP ${response.status()} from ${responseUrl.href}`,
    );
  }
};

const preflightSecureSurface = async (
  browser: Browser,
  entryUrl: URL,
): Promise<void> => {
  const context = await browser.newContext({ ignoreHTTPSErrors: true });
  try {
    let page = await context.newPage();
    const response = await navigateWithNetworkChangeRecovery(
      () => page.goto(entryUrl.href, { waitUntil: "domcontentloaded" }),
      async () => {
        await page.close();
        page = await context.newPage();
      },
    );
    assertSuccessfulDocumentNavigation(response, entryUrl, "preflight");
  } finally {
    await context.close();
  }
};

const assertCanonicalPage = async (
  observation: PageObservation,
  pageOrigin: string,
  browserSessionId: string | null,
): Promise<void> => {
  await observation.drain();
  const httpRequests = observation.requests.filter((request) =>
    ["http:", "https:"].includes(new URL(request.url).protocol),
  );
  const errorResponses = observation.responses.filter(
    (response) => response.status >= 400,
  );
  const legacyRequests = httpRequests.filter((request) =>
    /^\/v1(?:\/|$)/u.test(new URL(request.url).pathname),
  );
  const eventSourceRequests = httpRequests.filter(
    (request) =>
      request.resourceType === "eventsource" ||
      request.accept.toLowerCase().includes("text/event-stream"),
  );

  expect(observation.bootstrapDocuments).toHaveLength(1);
  const bootstrap = asRecord(observation.bootstrapDocuments[0]);
  expect(asRecord(bootstrap?.server)?.product).toBe("bamboo");
  expect(asRecord(bootstrap?.api)?.canonical_base_path).toBe("/api/v1");
  expect(asRecord(bootstrap?.realtime)?.path).toBe("/v2/stream");
  expect(
    Array.isArray(bootstrap?.capabilities)
      ? bootstrap.capabilities.filter(
          (capability) => capability === "auth.ws_hello_ack.v1",
        )
      : [],
  ).toHaveLength(1);

  expect(observation.webSockets, `${observation.label}: WebSocket count`).toHaveLength(1);
  const [socket] = observation.webSockets;
  expect(new URL(socket.url).origin).toBe(expectedSocketOrigin(pageOrigin));
  expect(new URL(socket.url).pathname).toBe("/v2/stream");
  const hello = socket.timeline.filter(
    ({ direction, frame }) =>
      direction === "client-to-server" && exactFrame(frame, "hello"),
  );
  const welcome = socket.timeline.filter(
    ({ direction, frame }) =>
      direction === "server-to-client" && exactFrame(frame, "welcome"),
  );
  expect(hello).toHaveLength(1);
  expect(welcome).toHaveLength(1);
  expect(hello[0]?.ordinal).toBeLessThan(welcome[0]?.ordinal ?? 0);
  expect(
    socket.timeline
      .filter(
        ({ direction, frame }) =>
          direction === "client-to-server" &&
          asRecord(frame.value)?.type === "subscribe",
      )
      .every(({ ordinal }) => ordinal > (welcome[0]?.ordinal ?? 0)),
  ).toBe(true);

  expect(
    httpRequests.every((request) => new URL(request.url).origin === pageOrigin),
    `${observation.label}: every app/API request must stay on the page origin`,
  ).toBe(true);
  expect(legacyRequests, `${observation.label}: legacy API requests`).toEqual([]);
  expect(
    eventSourceRequests,
    `${observation.label}: alternate realtime fallback`,
  ).toEqual([]);
  expect(errorResponses, `${observation.label}: HTTP errors`).toEqual([]);
  expect(
    observation.failedRequests.filter(
      (failure) => !expectedBrowserReadCancellation(failure, pageOrigin, browserSessionId),
    ),
    `${observation.label}: failed requests`,
  ).toEqual([]);
  expect(observation.consoleErrors, `${observation.label}: console errors`).toEqual([]);
  expect(observation.pageErrors, `${observation.label}: page errors`).toEqual([]);
  expect(socket.errors, `${observation.label}: WebSocket errors`).toEqual([]);
  expect(
    [...socket.sent, ...socket.received].filter(
      (frame) => frame.binary || frame.malformed,
    ),
    `${observation.label}: malformed or binary frames`,
  ).toEqual([]);
};

// Scope changes can abort a stale frame long poll or DOM inspection. The
// rendered frame and final DOM snapshot are checked before failed requests.
const expectedBrowserReadCancellation = (
  failure: string,
  pageOrigin: string,
  browserSessionId: string | null,
): boolean =>
  browserSessionId !== null &&
  ["frame", "dom"].some(
    (read) =>
      failure ===
      `GET ${pageOrigin}/api/v1/browser/sessions/${browserSessionId}/${read} net::ERR_ABORTED`,
  );

test("browser read cancellation accepts only the selected session and aborted GET", () => {
  const origin = "http://127.0.0.1:18080";
  const path = `${origin}/api/v1/browser/sessions/selected`;
  expect(
    expectedBrowserReadCancellation(`GET ${path}/frame net::ERR_ABORTED`, origin, "selected"),
  ).toBe(true);
  expect(
    expectedBrowserReadCancellation(`GET ${path}/dom net::ERR_ABORTED`, origin, "selected"),
  ).toBe(true);
  expect(
    expectedBrowserReadCancellation(`GET ${path}/dom net::ERR_ABORTED`, origin, "other"),
  ).toBe(false);
  expect(
    expectedBrowserReadCancellation(`POST ${path}/dom net::ERR_ABORTED`, origin, "selected"),
  ).toBe(false);
  expect(
    expectedBrowserReadCancellation(`GET ${path}/screenshot net::ERR_ABORTED`, origin, "selected"),
  ).toBe(false);
  expect(
    expectedBrowserReadCancellation(`GET ${path}/dom net::ERR_CONNECTION_RESET`, origin, "selected"),
  ).toBe(false);
  expect(
    expectedBrowserReadCancellation(`GET ${path}/dom net::ERR_ABORTED`, origin, null),
  ).toBe(false);
});

const exerciseSurface = async ({
  browser,
  definition,
  entryUrl,
  sessionId,
  testInfo,
}: {
  readonly browser: Browser;
  readonly definition: SurfaceDefinition;
  readonly entryUrl: URL;
  readonly sessionId: string;
  readonly testInfo: TestInfo;
}): Promise<void> => {
  const artifactIdentity = JSON.parse(
    requiredEnvironment("LOTUS_REAL_ARTIFACT_IDENTITY"),
  ) as unknown;
  const currentSourceArtifact = asRecord(artifactIdentity)?.registry === "local-pack";
  if (entryUrl.protocol === "https:") {
    // Chromium can report one browser-global network-change transition when
    // the secure fixture first comes online. Consume only that transition in
    // a throwaway page so the acceptance page keeps one clean, fully observed
    // document epoch (including StrictMode's cancellable bootstrap request).
    await preflightSecureSurface(browser, entryUrl);
  }
  const context = await browser.newContext({
    viewport: definition.viewport,
    isMobile: definition.mobile,
    hasTouch: definition.touch,
    userAgent: definition.userAgent,
    colorScheme: "dark",
    locale: "zh-CN",
    ignoreHTTPSErrors: entryUrl.protocol === "https:",
  });
  await installPublishedArtifactEntry(context, sessionId);
  const page = await context.newPage();
  const observationLabel =
    `published-${entryUrl.protocol.slice(0, -1)}-${definition.label}`;
  let observation: PageObservation | undefined;
  try {
    observation = observePage(page, observationLabel);
    const observed = await page.goto(entryUrl.href, {
      waitUntil: "domcontentloaded",
    });
    assertSuccessfulDocumentNavigation(observed, entryUrl, "observed");
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    await expect(composer).toBeVisible();
    await expect(
      page.locator("header").getByText("Lotus real Bamboo E2E", {
        exact: true,
      }),
    ).toBeVisible();
    await composer.fill(`published ${definition.label} acceptance`);
    await expect(composer).toHaveValue(`published ${definition.label} acceptance`);
    await expect(
      page.getByRole("button", { name: "发送消息", exact: true }),
    ).toBeEnabled();
    await composer.fill("");

    const horizontalOverflow = await page.locator("html").evaluate(
      (element) => element.scrollWidth - element.clientWidth,
    );
    expect(horizontalOverflow).toBeLessThanOrEqual(1);

    if (definition.viewport.width <= 768) {
      await page.getByRole("button", { name: "菜单", exact: true }).click();
    }
    const settingsButton = page.getByRole("button", {
      name: "系统设置",
      exact: true,
    });
    await expect(settingsButton).toBeVisible();
    await settingsButton.click();
    const settings = page.getByRole("dialog", { name: "系统设置" });
    await expect(settings).toBeVisible();
    await expect(
      settings.getByRole("heading", { name: "系统设置", exact: true }),
    ).toBeVisible();
    await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
    await expect(settings).toHaveCount(0);
    await composer.focus();
    await expect(composer).toBeFocused();

    if (currentSourceArtifact && definition.mobile) {
      await expect(page.getByRole("tab", { name: "浏览器" })).toHaveCount(0);
      await expect(
        page.getByRole("region", { name: "内置浏览器" }),
      ).toHaveCount(0);
    } else if (currentSourceArtifact) {
      await page.getByRole("button", { name: "打开侧边面板" }).click();
      const panel = page.getByRole("complementary", { name: "工作面板" });
      await panel.getByRole("tab", { name: "浏览器" }).click();
      const pane = panel.getByRole("region", { name: "内置浏览器" });
      const address = pane.getByRole("textbox", { name: "网页地址" });
      const navigateButton = pane.getByRole("button", { name: "访问网页" });
      await expect(navigateButton).toBeEnabled();
      await address.fill(browserFixtureUrl);
      await navigateButton.click();
      await expect(address).toHaveValue(browserFixtureUrl);
      // ResizeObserver can advance the shared page epoch after navigation.
      // Inspect only when Bamboo's viewport matches the rendered pane.
      await expect.poll(async () => {
        const rect = await pane.locator("[data-browser-viewport]").boundingBox();
        if (!rect) return false;
        const response = await context.request.get(
          new URL(`/api/v1/browser/sessions/${encodeURIComponent(sessionId)}`, entryUrl).href,
        );
        if (!response.ok()) return false;
        const state = asRecord(await response.json());
        const viewport = asRecord(state?.viewport);
        return (
          state?.url === browserFixtureUrl &&
          viewport?.width === Math.min(1_200, Math.max(320, Math.round(rect.width))) &&
          viewport?.height === Math.min(1_000, Math.max(240, Math.round(rect.height)))
        );
      }, { timeout: 15_000 }).toBe(true);
      await expect(pane.getByAltText("网页画面")).toBeVisible();
      await pane.getByRole("button", { name: "查看 DOM" }).click();
      await expect(pane.getByLabel("DOM 快照", { exact: true })).toContainText(
        "Alpha fixture",
      );
    }

    await assertCanonicalPage(
      observation,
      entryUrl.origin,
      currentSourceArtifact && !definition.mobile ? sessionId : null,
    );
    if (currentSourceArtifact && definition.mobile) {
      expect(
        observation.requests.filter((request) =>
          new URL(request.url).pathname.startsWith("/api/v1/browser/"),
        ),
      ).toEqual([]);
    }
    const screenshotPath = testInfo.outputPath(
      `${entryUrl.protocol.slice(0, -1)}-${definition.label}.png`,
    );
    await page.screenshot({ path: screenshotPath, fullPage: true });
    await testInfo.attach(`${definition.label} browser surface`, {
      path: screenshotPath,
      contentType: "image/png",
    });
    await testInfo.attach(`${definition.label} runtime observation`, {
      body: Buffer.from(
        `${JSON.stringify(
          {
            artifact: artifactIdentity,
            bambooRevision: requiredEnvironment("LOTUS_REAL_BAMBOO_REVISION"),
            pageOrigin: entryUrl.origin,
            viewport: definition.viewport,
            requests: observation.requests,
            responses: observation.responses,
            webSockets: observation.webSockets.map((socket) => ({
              url: socket.url,
              sentFrames: socket.sent.length,
              receivedFrames: socket.received.length,
              errors: socket.errors,
            })),
          },
          null,
          2,
        )}\n`,
      ),
      contentType: "application/json",
    });
  } finally {
    await observation?.stop().catch(() => undefined);
    await context.close();
  }
};

test("verified artifact browser surfaces: standalone local real Bamboo", async ({
  browser,
}, testInfo) => {
  test.skip(process.env.LOTUS_REAL_ACCEPTANCE_MODE !== "local");
  const entryUrl = new URL(requiredEnvironment("LOTUS_REAL_BAMBOO_BASE_URL"));
  expect(entryUrl.protocol).toBe("http:");
  expect(entryUrl.hostname).toBe("127.0.0.1");
  const identity = JSON.parse(requiredEnvironment("LOTUS_REAL_ARTIFACT_IDENTITY")) as unknown;
  const definitions = asRecord(identity)?.registry === "local-pack" ? surfaces : [surfaces[0]];
  for (const definition of definitions) {
    await exerciseSurface({
      browser,
      definition,
      entryUrl,
      sessionId: requiredEnvironment("LOTUS_REAL_BAMBOO_SESSION_ID"),
      testInfo,
    });
  }
});

test("verified artifact browser surfaces: HTTPS/WSS desktop tablet and phone orientations", async ({
  browser,
}, testInfo) => {
  test.skip(process.env.LOTUS_REAL_ACCEPTANCE_MODE !== "remote");
  const entryUrl = new URL(requiredEnvironment("LOTUS_REAL_BAMBOO_REMOTE_URL"));
  expect(entryUrl.protocol).toBe("https:");
  expect(entryUrl.hostname).toBe("remote.lotus.test");
  const sessionId = requiredEnvironment("LOTUS_REAL_BAMBOO_SESSION_ID");
  for (const definition of surfaces) {
    await exerciseSurface({
      browser,
      definition,
      entryUrl,
      sessionId,
      testInfo,
    });
  }
});

test("verified artifact browser surfaces: manual agent-browser host", async () => {
  const contractPath = process.env.LOTUS_REAL_MANUAL_CONTRACT_PATH?.trim();
  const releasePath = process.env.LOTUS_REAL_MANUAL_RELEASE_PATH?.trim();
  test.skip(!contractPath && !releasePath);
  test.setTimeout(15 * 60_000);
  if (!contractPath || !releasePath) {
    throw new Error(
      "LOTUS_REAL_MANUAL_CONTRACT_PATH and LOTUS_REAL_MANUAL_RELEASE_PATH must be provided together",
    );
  }
  if (!path.isAbsolute(contractPath) || !path.isAbsolute(releasePath)) {
    throw new Error("Manual acceptance control paths must be absolute");
  }

  await writeFile(
    contractPath,
    `${JSON.stringify(
      {
        schemaVersion: 1,
        baseUrl: requiredEnvironment("LOTUS_REAL_BAMBOO_BASE_URL"),
        remoteUrl: requiredEnvironment("LOTUS_REAL_BAMBOO_REMOTE_URL"),
        sessionId: requiredEnvironment("LOTUS_REAL_BAMBOO_SESSION_ID"),
        bambooRevision: requiredEnvironment("LOTUS_REAL_BAMBOO_REVISION"),
        artifact: JSON.parse(
          requiredEnvironment("LOTUS_REAL_ARTIFACT_IDENTITY"),
        ) as unknown,
      },
      null,
      2,
    )}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  await chmod(contractPath, 0o600);
  await expect
    .poll(
      async () => {
        const metadata = await stat(releasePath).catch(() => undefined);
        return metadata?.isFile() ?? false;
      },
      {
        message: `waiting for manual acceptance release file ${releasePath}`,
        timeout: 14 * 60_000,
        intervals: [250, 500, 1_000],
      },
    )
    .toBe(true);
});
