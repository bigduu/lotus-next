import {
  expect,
  test,
  type BrowserContext,
  type Locator,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { observePage, type PageObservation, type FrameObservation } from "./support/pageObservation.ts";
import { restartRealBamboo } from "./support/restartRealBamboo.ts";

type JsonRecord = Record<string, unknown>;

interface RuntimeContract {
  readonly baseUrl: URL;
  readonly sessionId: string;
  readonly providerObservationsPath: string;
  readonly userMarker: string;
  readonly assistantMarker: string;
  readonly bambooRevision: string;
}

interface FrameSummary {
  readonly malformed: boolean;
  readonly binary: boolean;
  readonly type?: string;
  readonly channel?: string;
  readonly sequence?: number;
  readonly controlType?: string;
  readonly eventType?: string;
  readonly nestedEventType?: string;
}

const requiredEnvironment = (name: string): string => {
  const value = process.env[name]?.trim();
  if (!value)
    throw new Error(
      `Missing required real-Bamboo environment variable: ${name}`,
    );
  return value;
};

const readRuntimeContract = (): RuntimeContract => {
  const contract = {
    baseUrl: new URL(requiredEnvironment("LOTUS_REAL_BAMBOO_BASE_URL")),
    sessionId: requiredEnvironment("LOTUS_REAL_BAMBOO_SESSION_ID"),
    providerObservationsPath: requiredEnvironment(
      "LOTUS_REAL_PROVIDER_OBSERVATIONS_PATH",
    ),
    userMarker: requiredEnvironment("LOTUS_REAL_USER_MARKER"),
    assistantMarker: requiredEnvironment("LOTUS_REAL_ASSISTANT_MARKER"),
    bambooRevision: requiredEnvironment("LOTUS_REAL_BAMBOO_REVISION"),
  };

  if (!/^https?:$/.test(contract.baseUrl.protocol)) {
    throw new Error(
      `LOTUS_REAL_BAMBOO_BASE_URL must use HTTP(S): ${contract.baseUrl.href}`,
    );
  }
  if (!path.isAbsolute(contract.providerObservationsPath)) {
    throw new Error("LOTUS_REAL_PROVIDER_OBSERVATIONS_PATH must be absolute");
  }
  if (!/^[0-9a-f]{40}$/i.test(contract.bambooRevision)) {
    throw new Error(
      `LOTUS_REAL_BAMBOO_REVISION must be a full Git commit: ${contract.bambooRevision}`,
    );
  }

  return contract;
};

const asRecord = (value: unknown): JsonRecord | null =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonRecord)
    : null;

const stringField = (
  record: JsonRecord | null,
  key: string,
): string | undefined => {
  const value = record?.[key];
  return typeof value === "string" ? value : undefined;
};

const numberField = (
  record: JsonRecord | null,
  key: string,
): number | undefined => {
  const value = record?.[key];
  return typeof value === "number" ? value : undefined;
};

const summarizeFrame = (frame: FrameObservation): FrameSummary => {
  const root = asRecord(frame.value);
  const control = asRecord(root?.control);
  const event = asRecord(root?.event);
  // Feed envelopes carry a ChangeEvent in `event`, whose domain event is one
  // level deeper at `event.event`. Agent envelopes use the first level. Keep
  // both so system keepalives cannot be mistaken for completion.
  const nestedEvent = asRecord(event?.event);

  return {
    malformed: frame.malformed,
    binary: frame.binary,
    type: stringField(root, "type"),
    channel: stringField(root, "ch"),
    sequence: numberField(root, "seq"),
    controlType: stringField(control, "type"),
    eventType: stringField(event, "type"),
    nestedEventType: stringField(nestedEvent, "type"),
  };
};

const isExactFrame = (frame: FrameObservation, type: string): boolean => {
  const root = asRecord(frame.value);
  return (
    !frame.malformed &&
    root !== null &&
    Object.keys(root).length === 1 &&
    root.type === type
  );
};

const installSessionEntry = async (
  context: BrowserContext,
  contract: Pick<RuntimeContract, "baseUrl" | "sessionId">,
): Promise<void> => {
  await context.addInitScript(
    ({ backendOrigin, selectedSessionId }) => {
      const browserGlobal = globalThis as unknown as {
        localStorage: {
          removeItem(key: string): void;
          setItem(key: string, value: string): void;
        };
      };
      browserGlobal.localStorage.setItem("bodhi_onboarded_v1", "1");
      // A developer build may contain a VITE_BACKEND_BASE_URL from the shell or
      // an ignored .env.local. Persist the supported runtime override before
      // application code runs, so this isolated lane cannot contact it even
      // transiently. Remove the legacy migration input for the same reason.
      browserGlobal.localStorage.removeItem("copilot_backend_base_url");
      browserGlobal.localStorage.setItem(
        "lotus_next_backend_endpoint_v1",
        backendOrigin,
      );
      // Lotus Next has one origin-root application route. Its supported deep
      // entry is the persisted last-session pointer consumed by useChat after
      // the authoritative session index loads.
      browserGlobal.localStorage.setItem(
        "lotus_next_last_session",
        selectedSessionId,
      );
    },
    {
      backendOrigin: contract.baseUrl.origin,
      selectedSessionId: contract.sessionId,
    },
  );
};

const JIANDU_SURFACES = [
  { label: "desktop", phone: false, viewport: { width: 1_440, height: 900 } },
  { label: "phone", phone: true, viewport: { width: 390, height: 844 } },
] as const;

const openSidebar = async (page: Page, phone: boolean): Promise<Locator> => {
  if (phone) {
    await page.getByRole("button", { name: "菜单", exact: true }).click();
  }
  const sidebar = page.locator("aside");
  await expect(sidebar).toBeVisible();
  return sidebar;
};

const selectRootSession = async (
  page: Page,
  phone: boolean,
  title: string,
): Promise<void> => {
  const sidebar = await openSidebar(page, phone);
  await sidebar.getByPlaceholder("搜索会话").fill(title);
  const session = sidebar.getByRole("button", { name: title, exact: true });
  await expect(session).toBeVisible();
  await session.click();
  await expect(
    page.locator("header").getByText(title, { exact: true }),
    `the ${title} root must be selected through the visible sidebar`,
  ).toBeVisible();
};

const openJianduSettings = async (
  page: Page,
  phone: boolean,
  sessionTitle: string,
): Promise<Locator> => {
  const sidebar = await openSidebar(page, phone);
  await sidebar.getByRole("button", { name: "系统设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "系统设置" });
  await expect(settings).toBeVisible();
  await settings
    .getByRole("button", { name: "Jiandu 记忆", exact: true })
    .click();
  await expect(
    settings.getByRole("heading", { name: "项目记忆", exact: true }),
  ).toBeVisible();
  await expect(settings.getByText(sessionTitle, { exact: true })).toBeVisible();
  return settings;
};

const selectJianduOption = async (
  page: Page,
  control: Locator,
  option: string,
): Promise<void> => {
  await control.click();
  await page.getByRole("option", { name: option, exact: true }).click();
};

const searchJiandu = async (
  page: Page,
  settings: Locator,
  query: string,
  status: "活跃" | "已归档",
): Promise<void> => {
  await settings
    .getByRole("textbox", { name: "搜索项目记忆", exact: true })
    .fill(query);
  await selectJianduOption(
    page,
    settings.getByRole("combobox", { name: "记忆状态", exact: true }),
    status,
  );
  await settings.getByRole("button", { name: "搜索", exact: true }).click();
};

const createJianduMemory = async (
  page: Page,
  settings: Locator,
  input: {
    readonly title: string;
    readonly type: "项目" | "参考";
    readonly body: string;
    readonly token: string;
  },
): Promise<void> => {
  await settings.getByRole("button", { name: "新建记忆", exact: true }).click();
  const create = page.getByRole("dialog", { name: "新建项目记忆" });
  await expect(create).toBeVisible();
  await create.getByLabel("记忆标题", { exact: true }).fill(input.title);
  await selectJianduOption(
    page,
    create.getByRole("combobox", { name: "记忆类型", exact: true }),
    input.type,
  );
  await create.getByLabel("记忆正文", { exact: true }).fill(input.body);
  await create
    .getByLabel("标签（逗号分隔）", { exact: true })
    .fill(`real-ui,${input.token}`);
  await create
    .getByLabel("关键词（逗号分隔）", { exact: true })
    .fill(input.token);
  await create.getByLabel("实体（逗号分隔）", { exact: true }).fill("Jiandu");
  await create
    .getByRole("button", { name: "查找相似记忆", exact: true })
    .click();
  await expect(
    create.getByText(/^(?:可能相关的记忆|未找到相似记忆)$/),
  ).toBeVisible();
  await create.getByRole("button", { name: "明确创建", exact: true }).click();
  await expect(create).toHaveCount(0);
  await expect(
    settings.getByText(`已创建“${input.title}”，并从项目权威数据刷新列表。`, {
      exact: true,
    }),
  ).toBeVisible();
};

const memoryRow = (settings: Locator, title: string): Locator =>
  settings.getByRole("listitem").filter({ hasText: title });

const closeSettings = async (settings: Locator): Promise<void> => {
  await settings.getByRole("button", { name: "关闭设置", exact: true }).click();
  await expect(settings).toHaveCount(0);
};

const webSocketHttpOrigin = (url: string): string => {
  const parsed = new URL(url);
  parsed.protocol = parsed.protocol === "wss:" ? "https:" : "http:";
  return parsed.origin;
};

const hasClientFrame = (
  observation: PageObservation,
  predicate: (frame: FrameSummary) => boolean,
): boolean =>
  observation.webSockets.some((socket) =>
    socket.sent.some((frame) => predicate(summarizeFrame(frame))),
  );

const hasTerminalFrame = (
  observation: PageObservation,
  sessionId: string,
): boolean =>
  observation.webSockets.some((socket) =>
    socket.received.some((frame) => {
      const summary = summarizeFrame(frame);
      return (
        summary.channel === `agent.${sessionId}` &&
        summary.controlType === "terminal"
      );
    }),
  );

const successfulResponse = (
  observation: PageObservation,
  method: string,
  pathname: string,
): boolean =>
  observation.responses.some((response) => {
    const url = new URL(response.url);
    return (
      response.method === method &&
      url.pathname === pathname &&
      response.status >= 200 &&
      response.status < 300
    );
  });

const assertBootstrap = async (observation: PageObservation): Promise<void> => {
  await expect
    .poll(() => observation.bootstrapDocuments.length, {
      message: `${observation.label}: the browser must consume Bamboo's real bootstrap`,
    })
    .toBeGreaterThan(0);

  const bootstrap = asRecord(observation.bootstrapDocuments.at(-1));
  const server = asRecord(bootstrap?.server);
  const api = asRecord(bootstrap?.api);
  const realtime = asRecord(bootstrap?.realtime);
  expect(numberField(bootstrap, "schema_version")).toBe(1);
  expect(stringField(server, "product")).toBe("bamboo");
  expect(stringField(api, "canonical_base_path")).toBe("/api/v1");
  expect(stringField(realtime, "path")).toBe("/v2/stream");
  const capabilities = Array.isArray(bootstrap?.capabilities)
    ? bootstrap.capabilities
    : [];
  expect(
    capabilities.filter(
      (capability) => capability === "auth.ws_hello_ack.v1",
    ),
    `${observation.label}: Bamboo must advertise the reliable WebSocket hello acknowledgement`,
  ).toHaveLength(1);
};

const assertWelcomeOrdering = (observation: PageObservation): void => {
  const [socket] = observation.webSockets;
  const helloFrames = socket.timeline.filter(
    ({ direction, frame }) =>
      direction === "client-to-server" &&
      summarizeFrame(frame).type === "hello",
  );
  const welcomeFrames = socket.timeline.filter(
    ({ direction, frame }) =>
      direction === "server-to-client" &&
      summarizeFrame(frame).type === "welcome",
  );
  const subscribeFrames = socket.timeline.filter(
    ({ direction, frame }) =>
      direction === "client-to-server" &&
      summarizeFrame(frame).type === "subscribe",
  );

  expect(
    helloFrames,
    `${observation.label}: one socket epoch must send exactly one hello`,
  ).toHaveLength(1);
  expect(
    isExactFrame(helloFrames[0].frame, "hello"),
    `${observation.label}: hello must use the exact tokenless shape`,
  ).toBe(true);
  expect(
    welcomeFrames,
    `${observation.label}: one socket epoch must receive exactly one welcome`,
  ).toHaveLength(1);
  expect(
    isExactFrame(welcomeFrames[0].frame, "welcome"),
    `${observation.label}: welcome must contain no extra fields or secret material`,
  ).toBe(true);
  expect(
    subscribeFrames.length,
    `${observation.label}: the ready socket must send at least one subscription`,
  ).toBeGreaterThan(0);
  expect(
    helloFrames[0].ordinal,
    `${observation.label}: hello must precede welcome`,
  ).toBeLessThan(welcomeFrames[0].ordinal);
  for (const subscription of subscribeFrames) {
    expect(
      subscription.ordinal,
      `${observation.label}: every subscription must follow exact welcome`,
    ).toBeGreaterThan(welcomeFrames[0].ordinal);
  }
};

const assertLiveSocket = async (
  observation: PageObservation,
  baseOrigin: string,
): Promise<void> => {
  await expect
    .poll(() => observation.webSockets.length, {
      message: `${observation.label}: one real WebSocket should own all live channels`,
    })
    .toBe(1);

  const [socket] = observation.webSockets;
  expect(webSocketHttpOrigin(socket.url)).toBe(baseOrigin);
  expect(new URL(socket.url).pathname).toBe("/v2/stream");
  await expect
    .poll(
      () =>
        socket.timeline.filter(
          ({ direction, frame }) =>
            direction === "server-to-client" && isExactFrame(frame, "welcome"),
        ).length,
      {
        message: `${observation.label}: Bamboo must acknowledge hello with exact welcome`,
      },
    )
    .toBe(1);
  await expect
    .poll(
      () =>
        hasClientFrame(
          observation,
          (frame) => frame.type === "subscribe" && frame.channel === "feed",
        ),
      {
        message: `${observation.label}: the client must subscribe to the account feed`,
      },
    )
    .toBe(true);
  assertWelcomeOrdering(observation);
};

const assertCleanPage = async (
  observation: PageObservation,
  baseOrigin: string,
): Promise<void> => {
  await observation.drain();
  const networkRequests = observation.requests.filter((request) =>
    /^https?:$/.test(new URL(request.url).protocol),
  );
  const externalRequests = networkRequests.filter(
    (request) => new URL(request.url).origin !== baseOrigin,
  );
  const legacyRequests = networkRequests.filter((request) =>
    /^\/v1(?:\/|$)/.test(new URL(request.url).pathname),
  );
  const retiredProviderRequests = networkRequests.filter((request) => {
    const pathname = new URL(request.url).pathname;
    return (
      ((request.method === "GET" || request.method === "POST") &&
        pathname === "/api/v1/bamboo/settings/provider") ||
      (request.method === "POST" &&
        pathname === "/api/v1/bamboo/settings/provider/models")
    );
  });
  const eventSourceRequests = networkRequests.filter(
    (request) =>
      request.resourceType === "eventsource" ||
      request.accept.toLowerCase().includes("text/event-stream"),
  );
  const errorResponses = observation.responses.filter(
    (response) => response.status >= 400,
  );
  const malformedFrames = observation.webSockets.flatMap((socket) =>
    [...socket.sent, ...socket.received].filter((frame) => frame.malformed),
  );
  const socketErrors = observation.webSockets.flatMap(
    (socket) => socket.errors,
  );

  expect(
    observation.webSockets,
    `${observation.label}: duplicate WebSockets`,
  ).toHaveLength(1);
  expect(
    externalRequests,
    `${observation.label}: unexpected external requests`,
  ).toEqual([]);
  expect(legacyRequests, `${observation.label}: legacy /v1 requests`).toEqual(
    [],
  );
  expect(
    retiredProviderRequests,
    `${observation.label}: retired provider configuration requests`,
  ).toEqual([]);
  expect(
    eventSourceRequests,
    `${observation.label}: SSE/EventSource fallback`,
  ).toEqual([]);
  expect(errorResponses, `${observation.label}: HTTP error responses`).toEqual(
    [],
  );
  expect(
    observation.failedRequests,
    `${observation.label}: failed requests`,
  ).toEqual([]);
  expect(observation.pageErrors, `${observation.label}: page errors`).toEqual(
    [],
  );
  expect(
    observation.consoleErrors,
    `${observation.label}: console errors`,
  ).toEqual([]);
  expect(
    malformedFrames,
    `${observation.label}: malformed JSON WebSocket frames`,
  ).toEqual([]);
  expect(socketErrors, `${observation.label}: WebSocket errors`).toEqual([]);
  assertWelcomeOrdering(observation);
};

const assertRealAssistantRenderer = async (
  page: Page,
  assistantMarker: string,
): Promise<void> => {
  await expect(
    page
      .locator(".assistant-streamdown")
      .getByText(assistantMarker, { exact: true }),
    "the production Streamdown renderer must own the assistant marker",
  ).toBeVisible();
  await expect(
    page
      .locator('[data-assistant-markdown-fallback="true"]')
      .filter({ hasText: assistantMarker }),
    "the assistant lazy-render fallback must leave the DOM",
  ).toHaveCount(0);
};

const assertSingleVisibleText = async (
  page: Page,
  text: string,
  message: string,
): Promise<void> => {
  const matches = page.getByText(text, { exact: true });
  await expect
    .poll(
      () =>
        matches.evaluateAll(
          (elements) =>
            elements.filter((element) => {
              const style =
                element.ownerDocument.defaultView?.getComputedStyle(element);
              const bounds = element.getBoundingClientRect();
              return (
                style !== undefined &&
                style.display !== "none" &&
                style.visibility !== "hidden" &&
                Number.parseFloat(style.opacity || "1") > 0 &&
                bounds.width > 0 &&
                bounds.height > 0
              );
            }).length,
        ),
      { message },
    )
    .toBe(1);
};

const fetchJson = async (url: URL): Promise<unknown> => {
  const response = await fetch(url, { signal: AbortSignal.timeout(5_000) });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`GET ${url.href} returned ${response.status}: ${body}`);
  }
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(`GET ${url.href} did not return JSON`);
  }
};

const readProviderObservations = async (filePath: string): Promise<unknown> => {
  const body = await readFile(filePath, "utf8");
  try {
    return JSON.parse(body) as unknown;
  } catch {
    throw new Error(
      "The private provider observation file did not contain JSON",
    );
  }
};

const persistedMarkerState = (
  historyDocument: unknown,
  userMarker: string,
  assistantMarker: string,
): { user: boolean; assistant: boolean; messageCount: number } => {
  const history = asRecord(historyDocument);
  const messages = Array.isArray(history?.messages) ? history.messages : [];
  return {
    user: messages.some((message) => {
      const record = asRecord(message);
      return (
        stringField(record, "role") === "user" &&
        stringField(record, "content") === userMarker
      );
    }),
    assistant: messages.some((message) => {
      const record = asRecord(message);
      return (
        stringField(record, "role") === "assistant" &&
        stringField(record, "content") === assistantMarker
      );
    }),
    messageCount: messages.length,
  };
};

const assertRehydratedHistory = async (
  observation: PageObservation,
  userMarker: string,
  assistantMarker: string,
): Promise<void> => {
  await expect
    .poll(() => observation.historyDocuments.length, {
      message: `${observation.label}: the production history response must be observed`,
    })
    .toBeGreaterThan(0);

  const state = persistedMarkerState(
    observation.historyDocuments.at(-1),
    userMarker,
    assistantMarker,
  );
  expect(
    state.user,
    `${observation.label}: history must contain the persisted user marker`,
  ).toBe(true);
  expect(
    state.assistant,
    `${observation.label}: history must contain the persisted assistant marker`,
  ).toBe(true);
};

const providerSawUserMarker = (document: unknown): boolean => {
  const observations = asRecord(document);
  const requests = Array.isArray(observations?.requests)
    ? observations.requests
    : [];
  return requests.some(
    (request) => asRecord(request)?.userMarkerPresent === true,
  );
};

const summarizeProviderObservations = (
  document: unknown,
): JsonRecord | null => {
  const observations = asRecord(document);
  if (!observations) return null;
  const requests = Array.isArray(observations.requests)
    ? observations.requests
    : [];
  return {
    schemaVersion: numberField(observations, "schemaVersion"),
    userMarker: stringField(observations, "userMarker"),
    assistantMarker: stringField(observations, "assistantMarker"),
    requestCount: numberField(observations, "requestCount"),
    requests: requests.map((request) => {
      const record = asRecord(request);
      return {
        sequence: numberField(record, "sequence"),
        method: stringField(record, "method"),
        path: stringField(record, "path"),
        model: record?.model === null ? null : stringField(record, "model"),
        stream: record?.stream === true,
        userMarkerPresent: record?.userMarkerPresent === true,
        smokeMarkerPresent: record?.smokeMarkerPresent === true,
      };
    }),
  };
};

const assertExactProviderRoundTrip = (
  document: unknown,
  contract: RuntimeContract,
): void => {
  const provider = asRecord(document);
  const providerRequests = Array.isArray(provider?.requests)
    ? provider.requests
    : [];
  const markerRequests = providerRequests.filter(
    (request) => asRecord(request)?.userMarkerPresent === true,
  );
  const smokeRequests = providerRequests.filter(
    (request) => asRecord(request)?.smokeMarkerPresent === true,
  );
  expect(numberField(provider, "schemaVersion")).toBe(1);
  expect(stringField(provider, "userMarker")).toBe(contract.userMarker);
  expect(stringField(provider, "assistantMarker")).toBe(
    contract.assistantMarker,
  );
  expect(numberField(provider, "requestCount")).toBe(providerRequests.length);
  expect(providerRequests).toHaveLength(3);
  expect(smokeRequests).toHaveLength(2);
  expect(markerRequests).toHaveLength(1);
  const successfulSmokeRequests = smokeRequests.filter(
    (request) => asRecord(request)?.model === "gpt-4o-mini",
  );
  const redactedRejectionRequests = smokeRequests.filter(
    (request) => asRecord(request)?.model === null,
  );
  expect(successfulSmokeRequests).toHaveLength(1);
  expect(redactedRejectionRequests).toHaveLength(1);
  for (const request of smokeRequests) {
    expect(asRecord(request)?.userMarkerPresent).toBe(false);
  }
  for (const request of markerRequests) {
    const record = asRecord(request);
    expect(stringField(record, "method")).toBe("POST");
    expect(stringField(record, "path")).toBe("/v1/chat/completions");
    expect(record?.stream).toBe(true);
  }
};

const evidenceFor = (
  contract: RuntimeContract,
  observations: PageObservation[],
  providerDocument: unknown,
  persisted: { user: boolean; assistant: boolean; messageCount: number } | null,
): JsonRecord => ({
  bambooRevision: contract.bambooRevision,
  baseOrigin: contract.baseUrl.origin,
  providerHostExposure: "none",
  persisted,
  provider: summarizeProviderObservations(providerDocument),
  pages: observations.map((observation) => ({
    label: observation.label,
    requests: observation.requests,
    responses: observation.responses,
    failedRequests: observation.failedRequests,
    consoleErrors: observation.consoleErrors,
    pageErrors: observation.pageErrors,
    bootstrap: observation.bootstrapDocuments.map((document) => {
      const root = asRecord(document);
      return {
        schemaVersion: numberField(root, "schema_version"),
        serverProduct: stringField(asRecord(root?.server), "product"),
        apiBasePath: stringField(asRecord(root?.api), "canonical_base_path"),
        realtimePath: stringField(asRecord(root?.realtime), "path"),
        helloAckCapability: Array.isArray(root?.capabilities)
          ? root.capabilities.filter(
              (capability) => capability === "auth.ws_hello_ack.v1",
            ).length === 1
          : false,
      };
    }),
    providerSnapshots: observation.providerDocuments.map((document) => {
      const root = asRecord(document);
      const defaults = asRecord(root?.defaults);
      const chat = asRecord(defaults?.chat);
      const instances = Array.isArray(root?.instances) ? root.instances : [];
      return {
        defaultInstanceId: stringField(root, "default_provider_instance_id"),
        chatProvider: stringField(chat, "provider"),
        chatModel: stringField(chat, "model"),
        instances: instances.map((instance) => {
          const record = asRecord(instance);
          return {
            id: stringField(record, "id"),
            type: stringField(record, "type"),
            label: stringField(record, "label"),
            enabled: record?.enabled === true,
          };
        }),
      };
    }),
    history: observation.historyDocuments.map((document) =>
      persistedMarkerState(
        document,
        contract.userMarker,
        contract.assistantMarker,
      ),
    ),
    webSockets: observation.webSockets.map((socket) => ({
      url: socket.url,
      sent: socket.sent.map(summarizeFrame),
      received: socket.received.map(summarizeFrame),
      timeline: socket.timeline.map(({ ordinal, direction, frame }) => ({
        ordinal,
        direction,
        ...summarizeFrame(frame),
        exactHello: isExactFrame(frame, "hello"),
        exactWelcome: isExactFrame(frame, "welcome"),
      })),
      errors: socket.errors,
    })),
  })),
});

const attachEvidence = async (
  testInfo: TestInfo,
  evidence: JsonRecord,
): Promise<void> => {
  await testInfo.attach("real-bamboo-browser-observations", {
    body: Buffer.from(`${JSON.stringify(evidence, null, 2)}\n`),
    contentType: "application/json",
  });
};

const assertRealProviderSnapshot = (observation: PageObservation): void => {
  expect(
    observation.providerDocuments.length,
    `${observation.label}: provider-instances response was not observed`,
  ).toBeGreaterThan(0);
  const document = asRecord(observation.providerDocuments.at(-1));
  const instances = document?.instances;
  const defaults = asRecord(document?.defaults);
  const chat = asRecord(defaults?.chat);

  expect(document?.default_provider_instance_id).toBe("e2e-openai");
  expect(chat).toMatchObject({
    provider: "e2e-openai",
    model: "gpt-4o-mini",
  });
  expect(Array.isArray(instances) ? instances : []).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        id: "e2e-openai",
        type: "openai",
        label: "Lotus real Bamboo E2E",
        enabled: true,
      }),
    ]),
  );
};

test("production UI completes and rehydrates one real Bamboo chat round trip", async ({
  browser,
  context,
  page,
}, testInfo) => {
  const contract = readRuntimeContract();
  const entryUrl = new URL("/", contract.baseUrl);
  const historyUrl = new URL(
    `/api/v1/sessions/${encodeURIComponent(contract.sessionId)}/history`,
    contract.baseUrl,
  );
  const clientHistoryPath = `/api/v1/history/${encodeURIComponent(contract.sessionId)}`;
  const executePath = `/api/v1/execute/${encodeURIComponent(contract.sessionId)}`;
  const pageObservations: PageObservation[] = [];
  let providerDocument: unknown = null;
  let persisted: {
    user: boolean;
    assistant: boolean;
    messageCount: number;
  } | null = null;

  testInfo.annotations.push({
    type: "bamboo-revision",
    description: contract.bambooRevision,
  });

  await installSessionEntry(context, contract);
  const first = observePage(page, "initial-page");
  pageObservations.push(first);

  try {
    await page.goto(entryUrl.href, { waitUntil: "domcontentloaded" });
    const composer = page.getByRole("textbox", { name: "消息", exact: true });
    await expect(composer).toBeVisible();
    await assertBootstrap(first);
    await assertLiveSocket(first, contract.baseUrl.origin);
    await expect
      .poll(() => first.providerDocuments.length, {
        message: "Lotus Next must load the authoritative provider-instances snapshot",
      })
      .toBeGreaterThan(0);
    assertRealProviderSnapshot(first);

    await page.getByRole("button", { name: "系统设置" }).click();
    await expect(page.getByRole("heading", { name: "系统设置" })).toBeVisible();
    await expect(page.getByText("gpt-4o-mini", { exact: true }).first()).toBeVisible();
    await page.getByRole("button", { name: "提供方", exact: true }).click();
    const providerRow = page.locator("li").filter({ hasText: "OpenAI · 默认" });
    await expect(providerRow.getByText("Lotus real Bamboo E2E", { exact: true })).toBeVisible();
    await expect(providerRow.getByText("OpenAI · 默认", { exact: true })).toBeVisible();
    await providerRow.getByRole("button", { name: "编辑", exact: true }).click();
    const maskedApiKeyInput = page.getByLabel("API Key", { exact: true });
    await expect(maskedApiKeyInput).toHaveValue("");
    await expect(maskedApiKeyInput).toHaveAttribute(
      "placeholder",
      "已配置，留空保持不变",
    );
    await page.getByRole("button", { name: "取消", exact: true }).click();
    await page.getByRole("button", { name: "关闭设置" }).click();
    await expect(composer).toBeVisible();

    await composer.fill(contract.userMarker);
    const send = page.getByRole("button", { name: "发送消息", exact: true });
    await expect(send).toBeEnabled();
    await send.click();

    await assertSingleVisibleText(
      page,
      contract.userMarker,
      "the submitted user marker must settle to one visible message",
    );
    await expect
      .poll(() => successfulResponse(first, "POST", "/api/v1/chat"), {
        message:
          "the visible composer must submit through Bamboo's canonical chat endpoint",
      })
      .toBe(true);
    await expect
      .poll(() => successfulResponse(first, "POST", executePath), {
        message: "the acknowledged session must execute through real Bamboo",
      })
      .toBe(true);
    await expect
      .poll(() => hasTerminalFrame(first, contract.sessionId), {
        message: "the real agent channel must deliver a terminal control frame",
      })
      .toBe(true);

    await expect
      .poll(
        async () => {
          const history = await fetchJson(historyUrl);
          persisted = persistedMarkerState(
            history,
            contract.userMarker,
            contract.assistantMarker,
          );
          return persisted.user && persisted.assistant;
        },
        {
          message:
            "Bamboo history must persist the exact user and assistant markers",
        },
      )
      .toBe(true);

    await expect
      .poll(
        async () => {
          providerDocument = await readProviderObservations(
            contract.providerObservationsPath,
          );
          return providerSawUserMarker(providerDocument);
        },
        {
          message:
            "the deterministic provider must observe the user marker through Bamboo",
        },
      )
      .toBe(true);

    assertExactProviderRoundTrip(providerDocument, contract);

    await page.waitForLoadState("networkidle");
    await assertCleanPage(first, contract.baseUrl.origin);
    await assertRealAssistantRenderer(page, contract.assistantMarker);

    // A new browser context has no React, IndexedDB, or localStorage state from
    // the first page. Supplying only the supported session-entry pointer proves
    // the assistant row is reconstructed from Bamboo history.
    const reopenedContext = await browser.newContext({
      colorScheme: "dark",
      locale: "zh-CN",
      viewport: { width: 1_440, height: 900 },
    });
    let reopenedForCleanup: PageObservation | undefined;
    try {
      await installSessionEntry(reopenedContext, contract);
      const reopenedPage = await reopenedContext.newPage();
      const reopened = observePage(reopenedPage, "reopened-page");
      reopenedForCleanup = reopened;
      pageObservations.push(reopened);
      await reopenedPage.goto(entryUrl.href, { waitUntil: "domcontentloaded" });
      await expect(
        reopenedPage.getByRole("textbox", { name: "消息", exact: true }),
      ).toBeVisible();
      await assertBootstrap(reopened);
      await assertLiveSocket(reopened, contract.baseUrl.origin);
      await expect
        .poll(() => successfulResponse(reopened, "GET", clientHistoryPath), {
          message:
            "the reopened page must hydrate through Lotus Next's production history endpoint",
        })
        .toBe(true);
      await assertRehydratedHistory(
        reopened,
        contract.userMarker,
        contract.assistantMarker,
      );
      await assertSingleVisibleText(
        reopenedPage,
        contract.userMarker,
        "the reopened page must show one persisted user message",
      );
      await reopenedPage.waitForLoadState("networkidle");
      await assertCleanPage(reopened, contract.baseUrl.origin);
      await assertRealAssistantRenderer(reopenedPage, contract.assistantMarker);

      const replayRequests = reopened.requests.filter((request) => {
        const pathname = new URL(request.url).pathname;
        return (
          request.method === "POST" &&
          (pathname === "/api/v1/chat" || pathname === executePath)
        );
      });
      expect(
        replayRequests,
        "rehydration must not submit or execute a second chat turn",
      ).toEqual([]);

      // Read again after the reopened page reaches network-idle. The one real
      // provider request must remain singular; otherwise a duplicate execute
      // could recreate the same marker and make the DOM-only assertion pass.
      providerDocument = await readProviderObservations(
        contract.providerObservationsPath,
      );
      assertExactProviderRoundTrip(providerDocument, contract);
      // Both pages remain live while the second client hydrates. Recheck the
      // accumulated observations at the end so a late reconnect, HTTP error,
      // or console failure cannot arrive after an earlier clean snapshot.
      await assertCleanPage(first, contract.baseUrl.origin);
      await assertCleanPage(reopened, contract.baseUrl.origin);
    } finally {
      await reopenedForCleanup?.stop();
      await reopenedContext.close();
    }
  } finally {
    await first.stop();
    if (persisted === null) {
      try {
        persisted = persistedMarkerState(
          await fetchJson(historyUrl),
          contract.userMarker,
          contract.assistantMarker,
        );
      } catch {
        // Preserve the primary failure; null remains explicit in the attachment.
      }
    }
    if (providerDocument === null) {
      try {
        providerDocument = await readProviderObservations(
          contract.providerObservationsPath,
        );
      } catch {
        // Preserve the primary failure; null remains explicit in the attachment.
      }
    }
    await attachEvidence(
      testInfo,
      evidenceFor(contract, pageObservations, providerDocument, persisted),
    );
  }
});

test("production Jiandu settings manage and isolate real Project memory on desktop and phone", async ({
  browser,
}, testInfo) => {
  const contract = readRuntimeContract();
  const uiSessionId = requiredEnvironment("LOTUS_REAL_BAMBOO_UI_SESSION_ID");
  const otherSessionId = requiredEnvironment(
    "LOTUS_REAL_BAMBOO_OTHER_PROJECT_SESSION_ID",
  );
  const uiSessionTitle = "Lotus UI memory Project E2E";
  const otherSessionTitle = "Lotus other Project E2E";
  expect(new Set([contract.sessionId, uiSessionId, otherSessionId]).size).toBe(
    3,
  );

  for (const surface of JIANDU_SURFACES) {
    const idSuffix = `${surface.label}${uiSessionId.replaceAll("-", "")}`;
    const primaryToken = `uiprimary${idSuffix}`;
    const secondaryToken = `uisecondary${idSuffix}`;
    const primaryTitle = `UI ${surface.label} ${primaryToken}`;
    const secondaryTitle = `UI ${surface.label} ${secondaryToken}`;
    const primaryBody = `Only the UI Project can read ${primaryToken}.`;
    const secondaryBody = `Only the other Project can read ${secondaryToken}.`;
    const context = await browser.newContext({
      colorScheme: "dark",
      locale: "zh-CN",
      viewport: surface.viewport,
      isMobile: surface.phone,
      hasTouch: surface.phone,
    });
    await installSessionEntry(context, contract);
    const page = await context.newPage();
    const observation = observePage(page, `jiandu-${surface.label}`);

    try {
      await page.goto(new URL("/", contract.baseUrl).href, {
        waitUntil: "domcontentloaded",
      });
      await expect(
        page.getByRole("textbox", { name: "消息", exact: true }),
      ).toBeVisible();
      await assertBootstrap(observation);
      await assertLiveSocket(observation, contract.baseUrl.origin);

      await selectRootSession(page, surface.phone, uiSessionTitle);
      let settings = await openJianduSettings(
        page,
        surface.phone,
        uiSessionTitle,
      );
      if (surface.label === "desktop") {
        await expect(
          settings.getByText("没有匹配的项目记忆", { exact: true }),
          "the dedicated UI Project must begin without seeded memory",
        ).toBeVisible();
      }

      await createJianduMemory(page, settings, {
        title: primaryTitle,
        type: "参考",
        body: primaryBody,
        token: primaryToken,
      });
      await searchJiandu(page, settings, primaryToken, "活跃");
      let row = memoryRow(settings, primaryTitle);
      await expect(row).toHaveCount(1);
      await expect(row.getByText("活跃", { exact: true })).toBeVisible();
      await row
        .getByRole("button", { name: primaryTitle, exact: true })
        .click();
      let detail = page.getByRole("dialog", { name: primaryTitle });
      await expect(detail).toBeVisible();
      await expect(
        detail.getByText(primaryBody, { exact: true }),
      ).toBeVisible();
      await expect(detail.getByText("参考", { exact: true })).toBeVisible();
      await detail
        .getByRole("button", { name: "归档记忆", exact: true })
        .click();
      const archive = page.getByRole("dialog", {
        name: `归档“${primaryTitle}”？`,
      });
      await expect(archive).toBeVisible();
      await archive
        .getByRole("button", { name: "确认归档", exact: true })
        .click();
      await expect(archive).toHaveCount(0);
      await expect(detail).toHaveCount(0);
      await expect(
        settings.getByRole("button", { name: primaryTitle, exact: true }),
      ).toHaveCount(0);
      await expect(
        settings.getByText("没有匹配的项目记忆", { exact: true }),
      ).toBeVisible();

      await selectJianduOption(
        page,
        settings.getByRole("combobox", { name: "记忆状态", exact: true }),
        "已归档",
      );
      await expect(
        settings.getByRole("button", { name: primaryTitle, exact: true }),
        "changing the status draft must not query until Search is pressed",
      ).toHaveCount(0);
      await settings.getByRole("button", { name: "搜索", exact: true }).click();
      row = memoryRow(settings, primaryTitle);
      await expect(row).toHaveCount(1);
      await expect(row.getByText("已归档", { exact: true })).toBeVisible();
      await row
        .getByRole("button", { name: primaryTitle, exact: true })
        .click();
      detail = page.getByRole("dialog", { name: primaryTitle });
      await expect(
        detail.getByText(primaryBody, { exact: true }),
      ).toBeVisible();
      await expect(
        detail.getByRole("button", { name: "归档记忆", exact: true }),
      ).toHaveCount(0);
      await detail
        .getByRole("button", { name: "关闭详情", exact: true })
        .click();

      const screenshotPath = testInfo.outputPath(
        `jiandu-${surface.label}-archived.png`,
      );
      await page.screenshot({ path: screenshotPath, animations: "disabled" });
      await testInfo.attach(`Jiandu ${surface.label} archived Project memory`, {
        path: screenshotPath,
        contentType: "image/png",
      });

      await closeSettings(settings);
      await selectRootSession(page, surface.phone, otherSessionTitle);
      settings = await openJianduSettings(
        page,
        surface.phone,
        otherSessionTitle,
      );
      await createJianduMemory(page, settings, {
        title: secondaryTitle,
        type: "项目",
        body: secondaryBody,
        token: secondaryToken,
      });
      await searchJiandu(page, settings, secondaryToken, "活跃");
      row = memoryRow(settings, secondaryTitle);
      await expect(row).toHaveCount(1);
      await expect(row.getByText("活跃", { exact: true })).toBeVisible();
      await searchJiandu(page, settings, primaryToken, "已归档");
      await expect(
        settings.getByRole("button", { name: primaryTitle, exact: true }),
        "the other Project must not discover the UI Project token",
      ).toHaveCount(0);
      await expect(
        settings.getByText("没有匹配的项目记忆", { exact: true }),
      ).toBeVisible();

      await closeSettings(settings);
      await selectRootSession(page, surface.phone, uiSessionTitle);
      settings = await openJianduSettings(page, surface.phone, uiSessionTitle);
      await searchJiandu(page, settings, secondaryToken, "活跃");
      await expect(
        settings.getByRole("button", { name: secondaryTitle, exact: true }),
        "the UI Project must not discover the other Project token",
      ).toHaveCount(0);
      await expect(
        settings.getByText("没有匹配的项目记忆", { exact: true }),
      ).toBeVisible();
      await closeSettings(settings);

      await page.waitForLoadState("networkidle");
      expect(
        observation.responses.filter((response) => {
          const url = new URL(response.url);
          return (
            response.method === "POST" &&
            url.pathname === "/api/v1/tools/execute" &&
            response.status >= 200 &&
            response.status < 300
          );
        }).length,
        `${surface.label}: settings must complete native memory calls through Bamboo`,
      ).toBeGreaterThan(0);
      await assertCleanPage(observation, contract.baseUrl.origin);
    } finally {
      await observation.stop();
      await context.close();
    }
  }
});

// Keep this after the original chat test: its provider request count is an
// exact protocol assertion, while this scenario deliberately adds tool rounds.
test("production session modes keep Bypass confirmation distinct from Auto execution", async ({
  browser,
}, testInfo) => {
  const contract = readRuntimeContract();
  const toolMarker = "LOTUS_PERMISSION_TOOL_EXECUTED";
  const command = `printf '${toolMarker}'`;
  const toolCallId = "call_lotus_permission_e2e";
  const userMarker = `${contract.userMarker}:permission`;
  const assistantMarker = `${contract.assistantMarker}:permission`;
  const ruleId = `lotus-permission-${contract.sessionId}`;
  const sessions: { id: string; title: string; mode: "bypass" | "auto" }[] = [];
  let ruleCreated = false;

  const apiUrl = (pathname: string): URL => new URL(pathname, contract.baseUrl);
  const sessionUrl = (id: string, suffix = ""): URL =>
    apiUrl(`/api/v1/sessions/${encodeURIComponent(id)}${suffix}`);
  const mutate = async (
    url: URL,
    method: "POST" | "DELETE",
    body?: unknown,
  ): Promise<unknown> => {
    const response = await fetch(url, {
      method,
      ...(body === undefined
        ? {}
        : {
            headers: { "content-type": "application/json" },
            body: JSON.stringify(body),
          }),
      signal: AbortSignal.timeout(10_000),
    });
    expect(response.ok, `${method} ${url.pathname}: ${response.status}`).toBe(true);
    const text = await response.text();
    return text ? (JSON.parse(text) as unknown) : null;
  };
  const currentMode = async (id: string): Promise<unknown> => {
    const document = asRecord(await fetchJson(sessionUrl(id)));
    return asRecord(document?.session)?.permission_mode;
  };
  const historyMessages = async (id: string): Promise<JsonRecord[]> => {
    const document = asRecord(await fetchJson(sessionUrl(id, "/history")));
    return (Array.isArray(document?.messages) ? document.messages : [])
      .map(asRecord)
      .filter((message): message is JsonRecord => message !== null);
  };
  const toolPayload = (message: JsonRecord): JsonRecord | null => {
    if (message.role !== "tool" || message.tool_call_id !== toolCallId ||
      message.tool_success !== true || typeof message.content !== "string") return null;
    try {
      return asRecord(JSON.parse(message.content) as unknown);
    } catch {
      // A recorded denial is plain text, not an executed Bash result.
      return null;
    }
  };
  const executedSafeCommand = (message: JsonRecord): boolean => {
    const payload = toolPayload(message);
    // A successful permission-placeholder message also contains the command
    // text. Only real stdout plus a zero exit code proves Bash executed it.
    return payload?.command === command && payload.exit_code === 0 &&
      payload.timed_out === false &&
      typeof payload.stdout === "string" && payload.stdout.trim() === toolMarker;
  };
  const permissionPromptSeen = (observation: PageObservation, id: string): boolean =>
    observation.webSockets.some((socket) =>
      socket.received.some((frame) => {
        const summary = summarizeFrame(frame);
        return (
          summary.channel === `agent.${id}` &&
          (summary.eventType === "need_clarification" ||
            summary.nestedEventType === "need_clarification")
        );
      }),
    );

  try {
    const memorySessionId = requiredEnvironment("LOTUS_REAL_BAMBOO_MEMORY_SESSION_ID");
    const projectSession = asRecord(await fetchJson(sessionUrl(memorySessionId)));
    const projectId = asRecord(projectSession?.session)?.project_id;
    expect(typeof projectId).toBe("string");
    for (const mode of ["bypass", "auto"] as const) {
      const title = `Lotus ${mode} permission E2E`;
      const document = asRecord(await mutate(apiUrl("/api/v1/sessions"), "POST", {
        title,
        title_generated: true,
        project_id: projectId,
        model: "gpt-4o-mini",
        model_ref: { provider: "e2e-openai", model: "gpt-4o-mini" },
      }));
      const session = asRecord(document?.session);
      const id = stringField(session, "id");
      expect(id).toBeTruthy();
      if (!id) throw new Error("The permission fixture needs a real session ID");
      sessions.push({ id, title, mode });
      expect(session).toMatchObject({ permission_mode: "default", project_id: projectId });
    }

    const policy = asRecord(await fetchJson(apiUrl("/api/v1/bamboo/permission/policy")));
    expect(Number.isSafeInteger(policy?.revision)).toBe(true);
    await mutate(apiUrl("/api/v1/bamboo/permission/rules"), "POST", {
      expected_revision: policy?.revision,
      rule: {
        id: ruleId,
        permission_type: "execute_command",
        effect: "always_ask",
        scope: "global",
        matcher: { id: ruleId, kind: "exact_resource", value: command },
        source: "user",
      },
    });
    ruleCreated = true;

    for (const surface of JIANDU_SURFACES) {
      const context = await browser.newContext({
        colorScheme: "dark",
        locale: "zh-CN",
        viewport: surface.viewport,
        isMobile: surface.phone,
        hasTouch: surface.phone,
      });
      await installSessionEntry(context, { ...contract, sessionId: sessions[0]!.id });
      const page = await context.newPage();
      let observation = observePage(page, `permission-${surface.label}`);
      let permissionFailure: unknown;
      const finishPermissionObservation = async () => {
        try {
          await observation.stop();
        } catch (cleanupError) {
          if (permissionFailure !== undefined && permissionFailure !== cleanupError) {
            throw new AggregateError([permissionFailure, cleanupError], "Permission acceptance and observer cleanup both failed");
          }
          throw cleanupError;
        } finally {
          await context.close();
        }
      };
      const modeControl = page.getByRole("combobox", { name: "权限模式", exact: true });
      const reloadPermissionPage = async (label: string): Promise<void> => {
        await page.waitForLoadState("networkidle");
        // The existing transport gate requires one socket per document, not
        // one across deliberate reloads. Verify each document before moving on.
        await observation.stop();
        await assertCleanPage(observation, contract.baseUrl.origin);
        observation = observePage(page, `permission-${surface.label}-${label}`, { nextDocument: true });
        await page.reload({ waitUntil: "domcontentloaded" });
        await assertBootstrap(observation);
        await assertLiveSocket(observation, contract.baseUrl.origin);
      };
      try {
        await page.goto(apiUrl("/").href, { waitUntil: "domcontentloaded" });
        await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible();
        await assertBootstrap(observation);
        await assertLiveSocket(observation, contract.baseUrl.origin);

        for (const session of sessions) {
          await selectRootSession(page, surface.phone, session.title);
          // Entry also synchronizes model metadata. Its completed write must
          // be reflected in the permission revision before a settled UI edit.
          await page.waitForLoadState("networkidle");
          await expect(modeControl).toBeEnabled();
          const modeLabel = session.mode === "auto" ? "Auto" : "Bypass";
          if (surface.label === "desktop") {
            await expect(modeControl).toHaveValue("default");
            const detailResponse = await fetch(sessionUrl(session.id), {
              signal: AbortSignal.timeout(5_000),
            });
            expect(detailResponse.ok).toBe(true);
            const expectedEtag = detailResponse.headers.get("etag");
            expect(expectedEtag).toMatch(/^"\d+"$/);
            const patched = page.waitForResponse((response) =>
              response.request().method() === "PATCH" &&
              new URL(response.url()).pathname === sessionUrl(session.id).pathname &&
              asRecord(response.request().postDataJSON())?.permission_mode === session.mode,
            );
            await modeControl.selectOption(session.mode);
            if (session.mode === "auto") {
              const confirmation = page.getByRole("dialog", { name: "为当前会话启用 Auto？", exact: true });
              await expect(confirmation).toBeVisible();
              expect(await currentMode(session.id)).toBe("default");
              await expect(confirmation.getByRole("button", { name: "取消", exact: true })).toBeFocused();
              await confirmation.getByRole("button", { name: "启用 Auto", exact: true }).click();
            }
            const patchResponse = await patched;
            expect(patchResponse.ok(), `permission PATCH returned ${patchResponse.status()}`).toBe(true);
            expect(patchResponse.request().postDataJSON()).toEqual({ permission_mode: session.mode });
            expect(patchResponse.request().headers()["if-match"]).toBe(expectedEtag);
          }
          await expect(modeControl).toHaveValue(session.mode);
          expect(await currentMode(session.id)).toBe(session.mode);

          if (surface.phone && session.mode === "auto") {
            await modeControl.selectOption("default");
            await expect.poll(() => currentMode(session.id)).toBe("default");
            await expect(modeControl).toBeEnabled();
            await modeControl.selectOption("auto");
            let confirmation = page.getByRole("dialog", { name: "为当前会话启用 Auto？", exact: true });
            await expect(confirmation).toBeVisible();
            await confirmation.getByRole("button", { name: "取消", exact: true }).press("Enter");
            await expect(confirmation).toHaveCount(0);
            await expect(modeControl).toHaveValue("default");
            expect(await currentMode(session.id)).toBe("default");
            await modeControl.selectOption("auto");
            confirmation = page.getByRole("dialog", { name: "为当前会话启用 Auto？", exact: true });
            await confirmation.getByRole("button", { name: "启用 Auto", exact: true }).click();
            await expect(modeControl).toHaveValue("auto");
            await expect.poll(() => currentMode(session.id)).toBe("auto");
          }

          if (surface.label === "desktop") {
            await page.getByRole("textbox", { name: "消息", exact: true }).fill(userMarker);
            await page.getByRole("button", { name: "发送消息", exact: true }).click();
            if (session.mode === "bypass") {
              const pendingUrl = sessionUrl(session.id, "/respond/pending");
              await expect.poll(async () =>
                asRecord(await fetchJson(pendingUrl))?.has_pending_question,
              ).toBe(true);
              const pending = asRecord(await fetchJson(pendingUrl));
              expect(pending).toMatchObject({
                has_pending_question: true,
                interaction_kind: "permission",
                tool_name: "Bash",
                permission_request: {
                  reason_code: "configured_always_ask",
                  bypass_requested: true,
                  auto_approve_requested: false,
                  resource: command,
                  matched_rule: { id: ruleId, effect: "always_ask" },
                },
              });
              await expect.poll(() => permissionPromptSeen(observation, session.id)).toBe(true);
              const messages = await historyMessages(session.id);
              expect(messages.some(executedSafeCommand)).toBe(false);
              const placeholder = messages.map(toolPayload).find((payload) => payload !== null);
              expect(placeholder).toMatchObject({
                status: "awaiting_permission_approval",
                resource: command,
                permission_request: { reason_code: "configured_always_ask" },
              });
              expect(placeholder?.stdout).toBeUndefined();
              expect(placeholder?.exit_code).toBeUndefined();
              expect(messages.some((message) => message.content === assistantMarker)).toBe(false);
            } else {
              await expect.poll(async () => {
                const messages = await historyMessages(session.id);
                return messages.some(executedSafeCommand) && messages.some((message) =>
                  message.role === "assistant" && message.content === assistantMarker,
                );
              }).toBe(true);
              await expect.poll(() => hasTerminalFrame(observation, session.id)).toBe(true);
              expect(asRecord(await fetchJson(sessionUrl(session.id, "/respond/pending"))))
                .toMatchObject({ has_pending_question: false });
              expect(permissionPromptSeen(observation, session.id)).toBe(false);
              await expect(page.getByText(assistantMarker, { exact: true })).toBeVisible();
            }
          }

          const screenshotPath = testInfo.outputPath(`permission-${surface.label}-${session.mode}.png`);
          await page.screenshot({ path: screenshotPath, animations: "disabled" });
          await testInfo.attach(`${surface.label} ${modeLabel} authoritative mode`, {
            path: screenshotPath,
            contentType: "image/png",
          });
          if (surface.label === "desktop" && session.mode === "bypass") {
            // The existing forced-confirmation dialog intentionally blocks
            // navigation. After proving and capturing the wait, deny only this
            // fixture's exact request through the canonical endpoint. Approval
            // card response routing is a separate migration slice.
            const pending = asRecord(await fetchJson(sessionUrl(session.id, "/respond/pending")));
            const request = asRecord(pending?.permission_request);
            expect(request?.request_id).toBe(toolCallId);
            expect(typeof request?.request_generation).toBe("string");
            await mutate(sessionUrl(session.id, "/permission-decisions"), "POST", {
              request_id: request?.request_id,
              request_generation: request?.request_generation,
              decision: "deny_once",
            });
            await expect.poll(async () =>
              asRecord(await fetchJson(sessionUrl(session.id, "/respond/pending")))?.has_pending_question,
            ).toBe(false);
            expect((await historyMessages(session.id)).some(executedSafeCommand)).toBe(false);
            await reloadPermissionPage("after-fixture-denial");
            await expect(modeControl).toHaveValue("bypass");
            await expect(page.getByRole("dialog", { name: "需要你确认", exact: true })).toHaveCount(0);
          }
        }

        await reloadPermissionPage("persisted-modes");
        // Select each persisted session through the visible UI after reload;
        // session restoration itself is a separate contract. Each mode must
        // still match authoritative detail, never browser-persisted mode data.
        await selectRootSession(page, surface.phone, sessions[1]!.title);
        await expect(modeControl).toHaveValue("auto");
        await selectRootSession(page, surface.phone, sessions[0]!.title);
        await expect(modeControl).toHaveValue("bypass");
        expect(await currentMode(sessions[0]!.id)).toBe("bypass");
        expect(await currentMode(sessions[1]!.id)).toBe("auto");
        await page.waitForLoadState("networkidle");
        await assertCleanPage(observation, contract.baseUrl.origin);
      } catch (error) {
        permissionFailure = error;
        const screenshotPath = testInfo.outputPath(`permission-${surface.label}-failure.png`);
        await page.screenshot({ path: screenshotPath, animations: "disabled" });
        await testInfo.attach(`${surface.label} permission failure`, {
          path: screenshotPath,
          contentType: "image/png",
        });
        throw error;
      } finally {
        await finishPermissionObservation();
      }
    }
  } finally {
    // These IDs were created by this test inside the harness's private data
    // root. Stop the waiting fixture without exercising unrelated card routing.
    for (const session of sessions) {
      const stop = await fetch(sessionUrl(session.id, "/stop"), {
        method: "POST",
        signal: AbortSignal.timeout(10_000),
      });
      // Completed or suspended runners may no longer have a cancel token.
      expect([200, 404]).toContain(stop.status);
      await mutate(sessionUrl(session.id), "DELETE");
    }
    if (ruleCreated) {
      const policy = asRecord(await fetchJson(apiUrl("/api/v1/bamboo/permission/policy")));
      const deleteUrl = apiUrl(`/api/v1/bamboo/permission/rules/${encodeURIComponent(ruleId)}`);
      deleteUrl.searchParams.set("expected_revision", String(policy?.revision));
      await mutate(deleteUrl, "DELETE");
    }
  }
});

// Keep this last: it restarts the lane's disposable Bamboo process and Docker
// may assign a new host port. Earlier real-provider evidence is already checked.
test("MCP JSON import merges, replaces, rolls back and survives a real restart", async ({ browser }, testInfo) => {
  const contract = readRuntimeContract();
  const importPath = "/api/v1/mcp/servers/import";
  const secret = "synthetic-lotus-mcp-credential-never-persist-in-browser";
  const stdio = (key: string): JsonRecord => ({
    command: "python3",
    args: ["/usr/local/libexec/lotus-real-bamboo-provider.py", "--mcp-stdio"],
    env: { [key]: secret },
  });
  const initial = { mcpServers: {
    "lotus-import-keep": stdio("KEEP_TOKEN"),
    "lotus-import-update": { ...stdio("OLD_TOKEN"), enabled: false },
  } };
  const merged = { mcpServers: {
    "lotus-import-update": { ...stdio("NEW_TOKEN"), enabled: false },
    "lotus-import-sse": {
      url: "http://127.0.0.1:1/sse", disabled: true,
      headers: { Authorization: `Bearer ${secret}` },
    },
    "lotus-import-http": {
      url: "http://127.0.0.1:1/mcp", transport_kind: "streamable_http", enabled: false,
      headers: [{ name: "Authorization", value: `Bearer ${secret}` }],
    },
  } };
  const final = { mcpServers: { "lotus-import-final": stdio("PERSISTED_TOKEN") } };
  const fetchDocument = async (origin: string, pathname: string): Promise<JsonRecord> => {
    const response = await fetch(new URL(pathname, origin), { signal: AbortSignal.timeout(10_000) });
    expect(response.ok, `MCP read returned ${response.status}`).toBe(true);
    const document = asRecord(await response.json());
    expect(document).not.toBeNull();
    return document!;
  };
  const readServers = async (origin: string): Promise<JsonRecord[]> => {
    const document = await fetchDocument(origin, "/api/v1/mcp/servers");
    expect(Array.isArray(document.servers)).toBe(true);
    return (document.servers as unknown[]).map((entry) => {
      const record = asRecord(entry);
      expect(record).not.toBeNull();
      return record!;
    }).sort((a, b) => String(a.id).localeCompare(String(b.id)));
  };
  const openMcp = async (page: Page, phone: boolean): Promise<Locator> => {
    const sidebar = await openSidebar(page, phone);
    await sidebar.getByRole("button", { name: "系统设置", exact: true }).click();
    const settings = page.getByRole("dialog", { name: "系统设置", exact: true });
    await settings.getByRole("button", { name: "MCP", exact: true }).click();
    await expect(settings.getByRole("button", { name: "导入 JSON", exact: true })).toBeEnabled();
    return settings;
  };
  const importDialog = (page: Page): Locator => page.getByRole("dialog", { name: "导入 MCP JSON", exact: true });
  const openImport = async (page: Page, settings: Locator): Promise<Locator> => {
    await settings.getByRole("button", { name: "导入 JSON", exact: true }).click();
    const dialog = importDialog(page);
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("radio", { name: "Merge（按 ID 合并）", exact: true })).toBeChecked();
    return dialog;
  };
  const row = (page: Page, settings: Locator, id: string): Locator => settings.locator("li").filter({
    has: page.getByText(id, { exact: true }),
  });
  const capture = async (page: Page, name: string): Promise<void> => {
    const screenshotPath = testInfo.outputPath(`mcp-${name}.png`);
    await page.screenshot({ path: screenshotPath, animations: "disabled" });
    await testInfo.attach(`MCP ${name}`, { path: screenshotPath, contentType: "image/png" });
  };
  const assertNoBrowserSecrets = async (page: Page): Promise<void> => {
    const storage = await page.evaluate(() => {
      const state = globalThis as unknown as {
        localStorage: Record<string, string>;
        sessionStorage: Record<string, string>;
      };
      return JSON.stringify([Object.entries(state.localStorage), Object.entries(state.sessionStorage)]);
    });
    expect(storage).not.toContain(secret);
    expect(storage).not.toContain("mcpServers");
  };
  const submit = async (page: Page, document: { mcpServers: JsonRecord }, mode: "merge" | "replace", status = 200): Promise<JsonRecord> => {
    const responsePromise = page.waitForResponse((response) =>
      new URL(response.url()).pathname === importPath && response.request().method() === "POST",
    );
    await importDialog(page).getByRole("button", { name: "导入", exact: true }).click();
    const response = await responsePromise;
    expect(response.status()).toBe(status);
    expect(response.request().postDataJSON()).toEqual({ ...document, mode });
    const result = asRecord(await response.json());
    expect(result).not.toBeNull();
    if (status === 200) {
      const dialog = importDialog(page);
      await expect(dialog.getByText("导入已完成", { exact: true })).toBeVisible();
      await expect(dialog.getByText(`新增 ${result!.added} · 更新 ${result!.updated} · 删除 ${result!.removed}`, { exact: true })).toBeVisible();
      await dialog.getByRole("button", { name: "完成", exact: true }).click();
      await expect(dialog).toHaveCount(0);
    }
    return result!;
  };
  const readyWithTool = async (page: Page, settings: Locator, origin: string, id: string): Promise<void> => {
    await expect.poll(async () => (await readServers(origin)).find((server) => server.id === id)?.status).toBe("ready");
    const serverRow = row(page, settings, id);
    await expect(serverRow.getByText("已连接 · 1 工具", { exact: true })).toBeVisible();
    await serverRow.getByRole("button", { name: "展开工具列表", exact: true }).click();
    await expect(serverRow.getByText("import_probe", { exact: true })).toBeVisible();
    const tools = await fetchDocument(origin, `/api/v1/mcp/servers/${id}/tools`);
    expect(tools.tools).toEqual([expect.objectContaining({ server_id: id, original_name: "import_probe" })]);
    await assertNoBrowserSecrets(page);
  };

  expect(await readServers(contract.baseUrl.origin)).toEqual([]);
  const context = await browser.newContext({ viewport: { width: 1_440, height: 900 }, locale: "zh-CN", colorScheme: "dark" });
  await installSessionEntry(context, contract);
  const page = await context.newPage();
  const observation = observePage(page, "mcp-desktop-before-restart");
  const postCount = (): number => observation.requests.filter((request) =>
    request.method === "POST" && new URL(request.url).pathname === importPath,
  ).length;
  try {
    await page.goto(contract.baseUrl.href);
    await expect(page.getByRole("textbox", { name: "消息", exact: true })).toBeVisible();
    await assertBootstrap(observation);
    await assertLiveSocket(observation, contract.baseUrl.origin);
    const settings = await openMcp(page, false);
    let dialog = await openImport(page, settings);
    await expect(dialog.getByRole("alert")).toHaveCount(0);
    for (const [name, buffer] of [["empty.json", Buffer.alloc(0)], ["whitespace.json", Buffer.from(" \n\t")]] as const) {
      await dialog.getByLabel("选择 JSON 文件", { exact: true }).setInputFiles({ name, mimeType: "application/json", buffer });
      await expect(dialog.getByRole("alert")).toContainText("完整 JSON 配置");
      await expect(dialog.getByRole("button", { name: "导入", exact: true })).toBeDisabled();
      expect(postCount()).toBe(0);
    }
    for (const id of ["scope/server", "x?y", "x#y", "..", "../../sessions/session-fixture", "encoded%2Fid"]) {
      await dialog.getByRole("textbox", { name: "MCP JSON 配置", exact: true }).fill(JSON.stringify({
        mcpServers: { [id]: { ...stdio("INVALID_ID_TOKEN"), enabled: false } },
      }));
      await expect(dialog.getByRole("alert")).toContainText("服务器 ID");
      await expect(dialog.getByRole("alert")).not.toContainText(secret);
      await expect(dialog.getByRole("button", { name: "导入", exact: true })).toBeDisabled();
      expect(postCount()).toBe(0);
    }
    expect(await readServers(contract.baseUrl.origin)).toEqual([]);
    await dialog.getByRole("textbox", { name: "MCP JSON 配置", exact: true }).fill(JSON.stringify(initial, null, 2));
    await expect(dialog.getByText("lotus-import-keep", { exact: true })).toBeVisible();
    expect(await submit(page, initial, "merge")).toMatchObject({ mode: "merge", added: 2, updated: 0, removed: 0 });
    await readyWithTool(page, settings, contract.baseUrl.origin, "lotus-import-keep");

    dialog = await openImport(page, settings);
    await dialog.getByLabel("选择 JSON 文件", { exact: true }).setInputFiles({
      name: "mcp-import.json", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(merged)),
    });
    await expect(dialog.getByText("lotus-import-http", { exact: true })).toBeVisible();
    await capture(page, "desktop-file-merge-preview");
    expect(await submit(page, merged, "merge")).toMatchObject({ mode: "merge", added: 2, updated: 1, removed: 0 });
    const afterMerge = await readServers(contract.baseUrl.origin);
    expect(afterMerge.map((server) => server.id)).toEqual(["lotus-import-http", "lotus-import-keep", "lotus-import-sse", "lotus-import-update"]);
    const updated = asRecord(afterMerge.find((server) => server.id === "lotus-import-update")?.config);
    expect(asRecord(updated?.transport)?.env).toEqual({ NEW_TOKEN: "****...****" });
    for (const [id, transport] of [["lotus-import-sse", "sse"], ["lotus-import-http", "streamablehttp"]]) {
      const server = afterMerge.find((entry) => entry.id === id)!;
      expect(server.enabled).toBe(false);
      expect(asRecord(asRecord(server.config)?.transport)).toMatchObject({
        type: transport, headers: [{ name: "Authorization", value: "****...****" }],
      });
    }
    await expect(row(page, settings, "lotus-import-http").getByText(/Streamable HTTP/)).toBeVisible();
    await capture(page, "desktop-merged-runtime");
    expect(postCount()).toBe(2);

    dialog = await openImport(page, settings);
    const input = dialog.getByRole("textbox", { name: "MCP JSON 配置", exact: true });
    await input.fill(`{"mcpServers": invalid-${secret}}`);
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByRole("button", { name: "导入", exact: true })).toBeDisabled();
    expect(postCount()).toBe(2);
    const rejected = { mcpServers: { "lotus-import-broken": {
      ...stdio("REJECTED_TOKEN"), command: "/lotus-mcp-intentionally-missing",
    } } };
    await input.fill(JSON.stringify(rejected));
    await dialog.getByRole("radio", { name: "Replace（替换全部）", exact: true }).check();
    const confirmation = dialog.getByRole("checkbox", { name: "我确认使用当前配置替换，并删除以上服务器", exact: true });
    for (const server of afterMerge) await expect(dialog.getByText(String(server.id), { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "导入", exact: true })).toBeDisabled();
    await confirmation.check();
    await input.fill(`${JSON.stringify(rejected)} `);
    await expect(confirmation).not.toBeChecked();
    await expect(dialog.getByRole("button", { name: "导入", exact: true })).toBeDisabled();
    await confirmation.check();
    // This pinned Bamboo maps failed pre-commit runtime staging to HTTP 500.
    // The UI must conservatively show an uncertain outcome, then permit only
    // read verification until the user provides a new import intent.
    const rejection = await submit(page, rejected, "replace", 500);
    expect(asRecord(rejection.error)?.message).toContain("MCP runtime initialization failed before commit; retaining last-known-good generation");
    await expect(dialog.getByRole("alert")).toBeVisible();
    await expect(dialog.getByRole("alert")).toContainText("导入结果尚未确认");
    await expect(dialog.getByRole("alert")).not.toContainText(secret);
    await expect(dialog.getByRole("button", { name: "导入", exact: true })).toBeDisabled();
    expect((await readServers(contract.baseUrl.origin)).map((server) => server.config)).toEqual(afterMerge.map((server) => server.config));
    expect((await readServers(contract.baseUrl.origin)).find((server) => server.id === "lotus-import-keep")?.status).toBe("ready");
    expect(postCount()).toBe(3);
    await capture(page, "desktop-rejected-import-preserves-config");

    await input.fill(JSON.stringify(final));
    await expect(confirmation).not.toBeChecked();
    await confirmation.check();
    expect(await submit(page, final, "replace")).toMatchObject({ mode: "replace", added: 1, updated: 0, removed: 4 });
    await readyWithTool(page, settings, contract.baseUrl.origin, "lotus-import-final");
    expect((await readServers(contract.baseUrl.origin)).map((server) => server.id)).toEqual(["lotus-import-final"]);
    expect(postCount()).toBe(4);
    await capture(page, "desktop-replaced-runtime");
    await page.waitForLoadState("networkidle");
    const expectedError = { method: "POST", url: new URL(importPath, contract.baseUrl).href, status: 500 };
    expect(observation.responses.filter((response) => response.status >= 400)).toEqual([expectedError]);
    expect(observation.consoleErrors).toEqual(["Failed to load resource: the server responded with a status of 500 (Internal Server Error)"]);
    // Assert the one intentional rejection first; all existing network, origin,
    // page-error and one-WebSocket guards remain strict for everything else.
    await assertCleanPage({ ...observation, responses: observation.responses.filter((response) => response.status < 400), consoleErrors: [] }, contract.baseUrl.origin);
  } catch (error) {
    await capture(page, "desktop-failure");
    throw error;
  } finally {
    await observation.stop();
    await context.close();
  }

  const restart = await restartRealBamboo(contract.baseUrl.origin);
  await expect.poll(async () => {
    try { return (await fetch(new URL("/readyz", restart.baseUrl), { signal: AbortSignal.timeout(2_000) })).ok; }
    catch { return false; }
  }).toBe(true);
  await testInfo.attach("MCP real restart evidence", {
    body: JSON.stringify({ startedBefore: restart.startedBefore, startedAfter: restart.startedAfter, loopbackOnly: true }),
    contentType: "application/json",
  });
  const restartedServers = await readServers(restart.baseUrl.origin);
  expect(restartedServers.map((server) => server.id)).toEqual(["lotus-import-final"]);
  expect(asRecord(asRecord(restartedServers[0]!.config)?.transport)).toMatchObject({
    type: "stdio", env: { PERSISTED_TOKEN: "****...****" },
  });
  const phoneContext = await browser.newContext({ viewport: { width: 390, height: 844 }, locale: "zh-CN", colorScheme: "dark" });
  const restartedContract = { ...contract, baseUrl: restart.baseUrl };
  await installSessionEntry(phoneContext, restartedContract);
  const phone = await phoneContext.newPage();
  const phoneObservation = observePage(phone, "mcp-phone-after-restart");
  try {
    await phone.goto(restart.baseUrl.href);
    await expect(phone.getByRole("textbox", { name: "消息", exact: true })).toBeVisible();
    await assertBootstrap(phoneObservation);
    await assertLiveSocket(phoneObservation, restart.baseUrl.origin);
    const settings = await openMcp(phone, true);
    await readyWithTool(phone, settings, restart.baseUrl.origin, "lotus-import-final");
    await capture(phone, "phone-persisted-runtime-after-restart");
    const dialog = await openImport(phone, settings);
    await dialog.getByRole("textbox", { name: "MCP JSON 配置", exact: true }).fill(JSON.stringify(initial, null, 2));
    await dialog.getByRole("radio", { name: "Replace（替换全部）", exact: true }).check();
    await expect(dialog.getByText("lotus-import-final", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("button", { name: "导入", exact: true })).toBeDisabled();
    await capture(phone, "phone-replace-confirmation");
    await dialog.getByRole("button", { name: "取消", exact: true }).press("Enter");
    await expect(dialog).toHaveCount(0);
    await expect(settings.getByRole("button", { name: "导入 JSON", exact: true })).toBeFocused();
    expect(phoneObservation.requests.filter((request) => request.method === "POST" && new URL(request.url).pathname === importPath)).toEqual([]);
    await assertNoBrowserSecrets(phone);
    await phone.waitForLoadState("networkidle");
    await assertCleanPage(phoneObservation, restart.baseUrl.origin);
  } catch (error) {
    await capture(phone, "phone-failure");
    throw error;
  } finally {
    await phoneObservation.stop();
    await phoneContext.close();
  }
});
