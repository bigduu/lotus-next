import type { Page, Request, Response, ConsoleMessage, WebSocket, Frame } from "@playwright/test";

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

export interface FrameObservation {
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

export interface PageObservation {
  readonly label: string;
  /** Await owned requests and response body reads while continuing to observe. */
  drain(): Promise<void>;
  /** Drain and detach all owned listeners before retiring this document. */
  stop(): Promise<void>;
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

interface ObservationOptions {
  /**
   * Arm before the real-Bamboo fixture reload. Its app resources begin after
   * main-frame commit; this fixture does not serve 103 Early Hints preloads.
   */
  readonly nextDocument?: boolean;
  /** A drain failure is explicit; it never converts unfinished work to success. */
  readonly drainTimeoutMs?: number;
}

export const observePage = (page: Page, label: string, options: ObservationOptions = {}): PageObservation => {
  let webSocketFrameOrdinal = 0;
  const ownedRequests = new WeakSet<Request>();
  const pending = new Map<Promise<void>, string>();
  let documentActive = !options.nextDocument;
  let navigationObserved = false;
  const drainTimeoutMs = options.drainTimeoutMs ?? 10_000;
  const inFlight = new Set<Request>();
  const progressWaiters = new Set<() => void>();
  const progress = () => {
    for (const wake of progressWaiters) wake();
    progressWaiters.clear();
  };
  const pendingDescription = (values: string[]) =>
    `${values.length} [${values.slice(0, 5).map((value) => value.slice(0, 200)).join(", ")}]`;
  const waitForProgress = (deadline: number) => new Promise<void>((resolve, reject) => {
    const wake = () => { clearTimeout(timer); progressWaiters.delete(wake); resolve(); };
    const timer = setTimeout(() => {
      progressWaiters.delete(wake);
      reject(new Error(`${label}: observation drain exceeded ${drainTimeoutMs}ms; pending requests: ${
        pendingDescription([...inFlight].map((request) => `${request.method()} ${redactedUrl(request.url())}`))
      }; pending body reads: ${pendingDescription([...pending.values()])}`));
    }, Math.max(0, deadline - performance.now()));
    progressWaiters.add(wake);
  });
  const detach: Array<() => void> = [];
  const drain = async (): Promise<void> => {
    // Network-idle alone does not wait for response.json(). Requests arriving
    // while earlier work settles also belong to this document's observation.
    const deadline = performance.now() + drainTimeoutMs;
    while (inFlight.size || pending.size) await waitForProgress(deadline);
  };
  let retirement: Promise<void> | undefined;
  const stop = (): Promise<void> => retirement ??= (async () => {
    // Keep collecting owned HTTP failures until requests AND body reads settle.
    // No await between the final empty check and detachment. On failure, detach
    // too, but retain the rejected retirement promise and diagnostic evidence.
    const deadline = performance.now() + drainTimeoutMs;
    try {
      while (inFlight.size || pending.size) await waitForProgress(deadline);
    } finally {
      for (const removeListener of detach.splice(0)) removeListener();
    }
  })();
  const observation: PageObservation = {
    label,
    drain,
    stop,
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

  const onRequest = (request: Request) => {
    if (!documentActive) {
      // The reload call can dispatch old-document lazy imports before the new
      // main navigation even starts. Own the navigation HTTP exchange, but do
      // not admit app traffic until its main-frame commit.
      if (!request.isNavigationRequest() || request.frame() !== page.mainFrame()) return;
      navigationObserved = true;
    }
    ownedRequests.add(request);
    inFlight.add(request);
    const headers = request.headers();
    observation.requests.push({
      method: request.method(),
      url: redactedUrl(request.url()),
      resourceType: request.resourceType(),
      accept: headers.accept ?? "",
    });
  };
  const onRequestFailed = (request: Request) => {
    if (!ownedRequests.has(request)) return;
    observation.failedRequests.push(
      `${request.method()} ${redactedUrl(request.url())} ${request.failure()?.errorText ?? "unknown failure"}`,
    );
    inFlight.delete(request);
    progress();
  };
  const onRequestFinished = (request: Request) => {
    if (inFlight.delete(request)) progress();
  };
  const onResponse = (response: Response) => {
    const request = response.request();
    // Responses may arrive after a replacement observer attaches but belong
    // to requests from the previous document. Only inspect this epoch's work.
    if (!ownedRequests.has(request)) return;
    const pathname = new URL(response.url()).pathname;
    observation.responses.push({
      method: request.method(),
      url: redactedUrl(response.url()),
      status: response.status(),
    });

    const inspect = (documents: unknown[], description: string): void => {
      const task = Promise.resolve().then(() => response.json())
        .then((document: unknown) => { documents.push(document); })
        .catch((error: unknown) => {
          observation.pageErrors.push(`Could not inspect the Bamboo ${description} response: ${String(error)}`);
        })
        .finally(() => { pending.delete(task); progress(); });
      pending.set(task, `${request.method()} ${redactedUrl(response.url())}`);
    };
    if (pathname === "/api/v1/bootstrap" && response.ok()) {
      inspect(observation.bootstrapDocuments, "bootstrap");
    }
    if (request.method() === "GET" && pathname === "/api/v1/bamboo/settings/provider-instances" && response.ok()) {
      inspect(observation.providerDocuments, "provider-instances");
    }
    if (request.method() === "GET" && pathname.startsWith("/api/v1/history/") && response.ok()) {
      inspect(observation.historyDocuments, "history");
    }
  };
  const onFrameNavigated = (frame: Frame) => {
    if (navigationObserved && frame === page.mainFrame()) documentActive = true;
  };
  const onConsole = (message: ConsoleMessage) => {
    if (documentActive && message.type() === "error")
      observation.consoleErrors.push(message.text());
  };
  const onPageError = (error: Error) => { if (documentActive) observation.pageErrors.push(error.message); };
  const onWebSocket = (webSocket: WebSocket) => {
    if (!documentActive) return;
    const socket: WebSocketObservation = {
      url: redactedUrl(webSocket.url()),
      sent: [],
      received: [],
      timeline: [],
      errors: [],
    };
    observation.webSockets.push(socket);
    const onFrameSent = (event: { payload: string | Buffer }) => {
      const frame = decodeFrame(event.payload);
      socket.sent.push(frame);
      socket.timeline.push({
        ordinal: ++webSocketFrameOrdinal,
        direction: "client-to-server",
        frame,
      });
    };
    const onFrameReceived = (event: { payload: string | Buffer }) => {
      const frame = decodeFrame(event.payload);
      socket.received.push(frame);
      socket.timeline.push({
        ordinal: ++webSocketFrameOrdinal,
        direction: "server-to-client",
        frame,
      });
    };
    const onSocketError = (error: string) => { socket.errors.push(error); };
    webSocket.on("framesent", onFrameSent);
    webSocket.on("framereceived", onFrameReceived);
    webSocket.on("socketerror", onSocketError);
    detach.push(() => {
      webSocket.off("framesent", onFrameSent);
      webSocket.off("framereceived", onFrameReceived);
      webSocket.off("socketerror", onSocketError);
    });
  };
  page.on("request", onRequest);
  page.on("requestfailed", onRequestFailed);
  page.on("requestfinished", onRequestFinished);
  page.on("response", onResponse);
  page.on("console", onConsole);
  page.on("pageerror", onPageError);
  page.on("websocket", onWebSocket);
  page.on("framenavigated", onFrameNavigated);
  detach.push(() => {
    page.off("request", onRequest);
    page.off("requestfailed", onRequestFailed);
    page.off("requestfinished", onRequestFinished);
    page.off("response", onResponse);
    page.off("console", onConsole);
    page.off("pageerror", onPageError);
    page.off("websocket", onWebSocket);
    page.off("framenavigated", onFrameNavigated);
  });

  return observation;
};
