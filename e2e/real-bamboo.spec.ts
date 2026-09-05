import {
  expect,
  test,
  type BrowserContext,
  type Page,
  type TestInfo,
} from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";

type JsonRecord = Record<string, unknown>;

interface RuntimeContract {
  readonly baseUrl: URL;
  readonly sessionId: string;
  readonly providerObservationsPath: string;
  readonly userMarker: string;
  readonly assistantMarker: string;
  readonly bambooRevision: string;
}

interface RequestObservation {
  readonly method: string;
  readonly url: string;
  readonly resourceType: string;
  readonly accept: string;
}

interface ResponseObservation {
  readonly method: string;
  readonly url: string;
  readonly status: number;
}

interface FrameObservation {
  readonly malformed: boolean;
  readonly binary: boolean;
  readonly value: unknown;
}

interface WebSocketTimelineEntry {
  readonly ordinal: number;
  readonly direction: "client-to-server" | "server-to-client";
  readonly frame: FrameObservation;
}

interface WebSocketObservation {
  readonly url: string;
  readonly sent: FrameObservation[];
  readonly received: FrameObservation[];
  readonly timeline: WebSocketTimelineEntry[];
  readonly errors: string[];
}

interface PageObservation {
  readonly label: string;
  readonly requests: RequestObservation[];
  readonly responses: ResponseObservation[];
  readonly failedRequests: string[];
  readonly consoleErrors: string[];
  readonly pageErrors: string[];
  readonly bootstrapDocuments: unknown[];
  readonly providerDocuments: unknown[];
  readonly historyDocuments: unknown[];
  readonly webSockets: WebSocketObservation[];
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

const decodeFrame = (payload: string | Buffer): FrameObservation => {
  const binary = typeof payload !== "string";
  const text = typeof payload === "string" ? payload : payload.toString("utf8");
  try {
    return { malformed: false, binary, value: JSON.parse(text) as unknown };
  } catch {
    return { malformed: true, binary, value: null };
  }
};

const redactedUrl = (value: string): string => {
  const parsed = new URL(value);
  if (!["http:", "https:", "ws:", "wss:"].includes(parsed.protocol)) {
    return `${parsed.protocol}<redacted>`;
  }
  parsed.username = "";
  parsed.password = "";
  parsed.search = "";
  parsed.hash = "";
  return parsed.href;
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

const observePage = (page: Page, label: string): PageObservation => {
  let webSocketFrameOrdinal = 0;
  const observation: PageObservation = {
    label,
    requests: [],
    responses: [],
    failedRequests: [],
    consoleErrors: [],
    pageErrors: [],
    bootstrapDocuments: [],
    providerDocuments: [],
    historyDocuments: [],
    webSockets: [],
  };

  page.on("request", (request) => {
    const headers = request.headers();
    observation.requests.push({
      method: request.method(),
      url: redactedUrl(request.url()),
      resourceType: request.resourceType(),
      accept: headers.accept ?? "",
    });
  });
  page.on("requestfailed", (request) => {
    observation.failedRequests.push(
      `${request.method()} ${redactedUrl(request.url())} ${request.failure()?.errorText ?? "unknown failure"}`,
    );
  });
  page.on("response", (response) => {
    const request = response.request();
    const pathname = new URL(response.url()).pathname;
    observation.responses.push({
      method: request.method(),
      url: redactedUrl(response.url()),
      status: response.status(),
    });

    if (pathname === "/api/v1/bootstrap" && response.ok()) {
      void response
        .json()
        .then((document: unknown) =>
          observation.bootstrapDocuments.push(document),
        )
        .catch((error: unknown) => {
          observation.pageErrors.push(
            `Could not inspect the Bamboo bootstrap response: ${String(error)}`,
          );
        });
    }
    if (
      request.method() === "GET" &&
      pathname === "/api/v1/bamboo/settings/provider-instances" &&
      response.ok()
    ) {
      void response
        .json()
        .then((document: unknown) =>
          observation.providerDocuments.push(document),
        )
        .catch((error: unknown) => {
          observation.pageErrors.push(
            `Could not inspect the Bamboo provider-instances response: ${String(error)}`,
          );
        });
    }
    if (
      request.method() === "GET" &&
      pathname.startsWith("/api/v1/history/") &&
      response.ok()
    ) {
      void response
        .json()
        .then((document: unknown) =>
          observation.historyDocuments.push(document),
        )
        .catch((error: unknown) => {
          observation.pageErrors.push(
            `Could not inspect the Bamboo history response: ${String(error)}`,
          );
        });
    }
  });
  page.on("console", (message) => {
    if (message.type() === "error")
      observation.consoleErrors.push(message.text());
  });
  page.on("pageerror", (error) => observation.pageErrors.push(error.message));
  page.on("websocket", (webSocket) => {
    const socket: WebSocketObservation = {
      url: redactedUrl(webSocket.url()),
      sent: [],
      received: [],
      timeline: [],
      errors: [],
    };
    observation.webSockets.push(socket);
    webSocket.on("framesent", (event) => {
      const frame = decodeFrame(event.payload);
      socket.sent.push(frame);
      socket.timeline.push({
        ordinal: ++webSocketFrameOrdinal,
        direction: "client-to-server",
        frame,
      });
    });
    webSocket.on("framereceived", (event) => {
      const frame = decodeFrame(event.payload);
      socket.received.push(frame);
      socket.timeline.push({
        ordinal: ++webSocketFrameOrdinal,
        direction: "server-to-client",
        frame,
      });
    });
    webSocket.on("socketerror", (error) => socket.errors.push(error));
  });

  return observation;
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

const requestCount = (
  observation: PageObservation,
  method: string,
  pathname: string,
): number =>
  observation.requests.filter(
    (request) =>
      request.method === method && new URL(request.url).pathname === pathname,
  ).length;

const notificationRevision = (document: unknown): number => {
  const revision = numberField(asRecord(document), "revision");
  if (revision === undefined || !Number.isSafeInteger(revision) || revision < 0) {
    throw new Error("Bamboo returned an invalid notification revision");
  }
  return revision;
};

type DirectCredentialAction =
  | { action: "keep" }
  | { action: "replace"; value: string };

const notificationMutationData = (
  document: unknown,
  topic: string,
  ntfyCredentialChange: DirectCredentialAction,
): JsonRecord => {
  const data = asRecord(asRecord(document)?.data);
  const desktop = asRecord(data?.desktop);
  const ntfy = asRecord(data?.ntfy);
  const bark = asRecord(data?.bark);
  if (!desktop || !ntfy || !bark) {
    throw new Error("Bamboo returned invalid notification channel data");
  }
  return {
    desktop: { enabled: desktop.enabled },
    ntfy: {
      enabled: ntfy.enabled,
      base_url: ntfy.base_url,
      topic,
      credential_change: ntfyCredentialChange,
    },
    bark: {
      enabled: bark.enabled,
      base_url: bark.base_url,
      credential_change: { action: "keep" },
    },
  };
};

const summarizeNotificationMutation = (value: unknown) => {
  const body = asRecord(value);
  const data = asRecord(body?.data);
  const action = (channel: "ntfy" | "bark") =>
    stringField(asRecord(asRecord(data?.[channel])?.credential_change), "action") ?? null;
  return {
    expectedRevision: numberField(body, "expected_revision") ?? null,
    ntfyCredentialAction: action("ntfy"),
    barkCredentialAction: action("bark"),
  };
};

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

const assertCleanPage = (
  observation: PageObservation,
  baseOrigin: string,
  expectedNotificationConflicts = 0,
): void => {
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
  const notificationConflicts = observation.responses.filter(
    (response) =>
      response.method === "PUT" &&
      new URL(response.url).pathname === "/api/v1/bamboo/config/notifications" &&
      response.status === 409,
  );
  const errorResponses = observation.responses.filter(
    (response) => response.status >= 400 && !notificationConflicts.includes(response),
  );
  const notificationConflictMessage =
    "Failed to load resource: the server responded with a status of 409 (Conflict)";
  const notificationConflictConsole = observation.consoleErrors.filter(
    (message) => message === notificationConflictMessage,
  );
  const consoleErrors = observation.consoleErrors.filter(
    (message) => message !== notificationConflictMessage,
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
    notificationConflicts,
    `${observation.label}: expected notification revision conflicts`,
  ).toHaveLength(expectedNotificationConflicts);
  expect(
    observation.failedRequests,
    `${observation.label}: failed requests`,
  ).toEqual([]);
  expect(observation.pageErrors, `${observation.label}: page errors`).toEqual(
    [],
  );
  expect(
    notificationConflictConsole,
    `${observation.label}: expected browser conflict diagnostics`,
  ).toHaveLength(expectedNotificationConflicts);
  expect(
    consoleErrors,
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

const putJson = async (url: URL, value: unknown): Promise<unknown> => {
  const response = await fetch(url, {
    method: "PUT",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(value),
    signal: AbortSignal.timeout(5_000),
  });
  if (!response.ok) {
    throw new Error(`PUT ${url.pathname} returned ${response.status}`);
  }
  try {
    return (await response.json()) as unknown;
  } catch {
    throw new Error(`PUT ${url.pathname} did not return JSON`);
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
  notificationCas: JsonRecord | null,
): JsonRecord => ({
  bambooRevision: contract.bambooRevision,
  baseOrigin: contract.baseUrl.origin,
  providerHostExposure: "none",
  persisted,
  notificationCas,
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
  const notificationPath = "/api/v1/bamboo/config/notifications";
  const notificationUrl = new URL(notificationPath, contract.baseUrl);
  const pageObservations: PageObservation[] = [];
  let providerDocument: unknown = null;
  let notificationCas: JsonRecord | null = null;
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

    const initialNotification = await fetchJson(notificationUrl);
    const initialNotificationRevision = notificationRevision(initialNotification);
    const notificationSecret = `lotus-notification-${randomUUID()}`;
    const seededNotification = await putJson(notificationUrl, {
      expected_revision: initialNotificationRevision,
      data: notificationMutationData(
        initialNotification,
        "real-bamboo-seeded-topic",
        { action: "replace", value: notificationSecret },
      ),
    });
    const seededNotificationRevision = notificationRevision(seededNotification);
    expect(
      JSON.stringify(seededNotification).includes(notificationSecret),
      "the real notification response must not return the configured credential",
    ).toBe(false);
    expect(
      asRecord(asRecord(asRecord(seededNotification)?.data)?.ntfy)?.credential,
    ).toMatchObject({ configured: true, state: "configured" });

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
    await page.waitForLoadState("networkidle");
    const rootConfigRequestsBefore = first.requests.filter(
      (request) =>
        new URL(request.url).pathname === "/api/v1/bamboo/config",
    ).length;
    expect(requestCount(first, "GET", notificationPath)).toBe(0);

    await page.getByRole("button", { name: "通知", exact: true }).click();
    const notificationToken = page.getByLabel(
      "Token(可选,自托管实例)",
      { exact: true },
    );
    const notificationTopic = page.getByRole("textbox", {
      name: "Topic",
      exact: true,
    });
    await expect(notificationToken).toHaveValue("");
    await expect(notificationToken).toHaveAttribute(
      "placeholder",
      "已配置，留空保持不变",
    );
    await expect(notificationTopic).toHaveValue("real-bamboo-seeded-topic");
    await expect
      .poll(() => requestCount(first, "GET", notificationPath))
      .toBe(1);

    const noOpPut = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        new URL(request.url()).pathname === notificationPath,
    );
    const noOpResponse = page.waitForResponse(
      (response) =>
        response.request().method() === "PUT" &&
        new URL(response.url()).pathname === notificationPath,
    );
    await page.getByRole("button", { name: "保存渠道设置" }).click();
    const noOpMutation = summarizeNotificationMutation(
      (await noOpPut).postDataJSON() as unknown,
    );
    const noOpHttpResponse = await noOpResponse;
    const noOpAuthority = (await noOpHttpResponse.json()) as unknown;
    expect(notificationRevision(noOpAuthority)).toBe(seededNotificationRevision);
    await expect(page.getByRole("status").filter({ hasText: "已保存" })).toBeVisible();
    expect(noOpMutation).toEqual({
      expectedRevision: seededNotificationRevision,
      ntfyCredentialAction: "keep",
      barkCredentialAction: "keep",
    });

    const draftTopic = "real-bamboo-preserved-draft";
    await notificationTopic.fill(draftTopic);
    const externalNotification = await putJson(notificationUrl, {
      expected_revision: seededNotificationRevision,
      data: notificationMutationData(
        seededNotification,
        "real-bamboo-external-topic",
        { action: "keep" },
      ),
    });
    const externalNotificationRevision = notificationRevision(externalNotification);

    const stalePut = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        new URL(request.url()).pathname === notificationPath,
    );
    await page.getByRole("button", { name: "保存渠道设置" }).click();
    const staleMutation = summarizeNotificationMutation(
      (await stalePut).postDataJSON() as unknown,
    );
    const conflictAlert = page
      .getByRole("alert")
      .filter({ hasText: "通知渠道配置已被其他客户端更新" });
    await expect(conflictAlert).toBeVisible();
    const retryNotification = page.getByRole("button", {
      name: "用当前修改重试",
      exact: true,
    });
    await expect(retryNotification).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "载入服务器版本", exact: true }),
    ).toBeFocused();
    await expect(notificationTopic).toHaveValue(draftTopic);
    await page.waitForTimeout(250);
    expect(staleMutation).toEqual({
      expectedRevision: seededNotificationRevision,
      ntfyCredentialAction: "keep",
      barkCredentialAction: "keep",
    });
    expect(requestCount(first, "PUT", notificationPath)).toBe(2);
    expect(requestCount(first, "GET", notificationPath)).toBe(2);

    const retryPut = page.waitForRequest(
      (request) =>
        request.method() === "PUT" &&
        new URL(request.url()).pathname === notificationPath,
    );
    await retryNotification.click();
    const retryMutation = summarizeNotificationMutation(
      (await retryPut).postDataJSON() as unknown,
    );
    await expect(page.getByText("已保存", { exact: true })).toBeVisible();
    expect(requestCount(first, "PUT", notificationPath)).toBe(3);
    expect(retryMutation).toEqual({
      expectedRevision: externalNotificationRevision,
      ntfyCredentialAction: "keep",
      barkCredentialAction: "keep",
    });
    const finalNotification = await fetchJson(notificationUrl);
    const finalNotificationRevision = notificationRevision(finalNotification);
    expect(finalNotificationRevision).toBe(externalNotificationRevision + 1);
    expect(
      stringField(
        asRecord(asRecord(asRecord(finalNotification)?.data)?.ntfy),
        "topic",
      ),
    ).toBe(draftTopic);
    expect(
      first.requests.filter(
        (request) =>
          new URL(request.url).pathname === "/api/v1/bamboo/config",
      ),
    ).toHaveLength(rootConfigRequestsBefore);
    notificationCas = {
      initialRevision: initialNotificationRevision,
      seededRevision: seededNotificationRevision,
      conflictRevision: externalNotificationRevision,
      finalRevision: finalNotificationRevision,
      configuredCredentialRedacted: true,
      rootConfigFallbackRequests: 0,
      semanticNoOpRevisionStable: true,
      pageMutations: [noOpMutation, staleMutation, retryMutation],
    };
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
    assertCleanPage(first, contract.baseUrl.origin, 1);
    await assertRealAssistantRenderer(page, contract.assistantMarker);

    // A new browser context has no React, IndexedDB, or localStorage state from
    // the first page. Supplying only the supported session-entry pointer proves
    // the assistant row is reconstructed from Bamboo history.
    const reopenedContext = await browser.newContext({
      colorScheme: "dark",
      locale: "zh-CN",
      viewport: { width: 1_440, height: 900 },
    });
    try {
      await installSessionEntry(reopenedContext, contract);
      const reopenedPage = await reopenedContext.newPage();
      const reopened = observePage(reopenedPage, "reopened-page");
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
      assertCleanPage(reopened, contract.baseUrl.origin);
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
      assertCleanPage(first, contract.baseUrl.origin, 1);
      assertCleanPage(reopened, contract.baseUrl.origin);
    } finally {
      await reopenedContext.close();
    }
  } finally {
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
      evidenceFor(
        contract,
        pageObservations,
        providerDocument,
        persisted,
        notificationCas,
      ),
    );
  }
});
