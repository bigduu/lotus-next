import {
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
  readonly label: "desktop" | "tablet" | "phone";
  readonly viewport: { readonly width: number; readonly height: number };
  readonly mobile: boolean;
  readonly touch: boolean;
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
];

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

const assertCanonicalPage = async (
  observation: PageObservation,
  pageOrigin: string,
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
  expect(observation.failedRequests, `${observation.label}: failed requests`).toEqual([]);
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
  const context = await browser.newContext({
    viewport: definition.viewport,
    isMobile: definition.mobile,
    hasTouch: definition.touch,
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
    if (entryUrl.protocol === "https:") {
      const preflight = await navigateWithNetworkChangeRecovery(() =>
        page.goto(entryUrl.href, { waitUntil: "domcontentloaded" }),
      );
      assertSuccessfulDocumentNavigation(preflight, entryUrl, "preflight");
      observation = observePage(page, observationLabel, { nextDocument: true });
      const observed = await page.reload({ waitUntil: "domcontentloaded" });
      assertSuccessfulDocumentNavigation(observed, entryUrl, "observed");
    } else {
      observation = observePage(page, observationLabel);
      const observed = await page.goto(entryUrl.href, {
        waitUntil: "domcontentloaded",
      });
      assertSuccessfulDocumentNavigation(observed, entryUrl, "observed");
    }
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

    if (definition.mobile) {
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

    await assertCanonicalPage(observation, entryUrl.origin);
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
            artifact: JSON.parse(
              requiredEnvironment("LOTUS_REAL_ARTIFACT_IDENTITY"),
            ) as unknown,
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

test("published artifact browser surfaces: standalone local real Bamboo", async ({
  browser,
}, testInfo) => {
  test.skip(process.env.LOTUS_REAL_ACCEPTANCE_MODE !== "local");
  const entryUrl = new URL(requiredEnvironment("LOTUS_REAL_BAMBOO_BASE_URL"));
  expect(entryUrl.protocol).toBe("http:");
  expect(entryUrl.hostname).toBe("127.0.0.1");
  await exerciseSurface({
    browser,
    definition: surfaces[0],
    entryUrl,
    sessionId: requiredEnvironment("LOTUS_REAL_BAMBOO_SESSION_ID"),
    testInfo,
  });
});

test("published artifact browser surfaces: HTTPS/WSS desktop tablet and phone", async ({
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

test("published artifact browser surfaces: manual agent-browser host", async () => {
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
