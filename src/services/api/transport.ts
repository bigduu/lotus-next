import {
  NetworkRequestError,
  RequestCancelledError,
  RequestTimeoutError,
} from "./errors";

export type FetchFunction = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export interface HttpTransportConfig {
  fetchImplementation: FetchFunction;
  /** One logical deadline covering every attempt and retry delay. */
  logicalTimeoutMs?: number;
  /** Total attempts, including the initial request. */
  totalAttempts?: number;
  retryDelayMs?: (completedAttempts: number) => number;
  maxRetryDelayMs?: number;
}

type CancellationSource = "caller-cancelled" | "caller-timeout" | "logical-timeout";

interface CancellationContext {
  readonly signal: AbortSignal;
  readonly source: CancellationSource | undefined;
  readonly cause: unknown;
  cleanup(): void;
}

const RETRYABLE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"]);
const RETRYABLE_STATUSES = new Set([408, 429, 500, 502, 503, 504]);

const DEFAULT_LOGICAL_TIMEOUT_MS = 30_000;
const DEFAULT_TOTAL_ATTEMPTS = 3;
const DEFAULT_MAX_RETRY_DELAY_MS = 2_000;
const READABLE_STREAM_LOCKED_GETTER =
  typeof ReadableStream === "undefined"
    ? undefined
    : Object.getOwnPropertyDescriptor(ReadableStream.prototype, "locked")?.get;

function defaultRetryDelayMs(completedAttempts: number): number {
  return 250 * 2 ** Math.max(0, completedAttempts - 1);
}

function assertPositiveFinite(value: number, name: string): void {
  if (!Number.isFinite(value) || value <= 0) {
    throw new TypeError(`${name} must be a positive finite number.`);
  }
}

function createAbortReason(name: "AbortError" | "TimeoutError", message: string): Error {
  if (typeof DOMException !== "undefined") {
    return new DOMException(message, name);
  }
  const error = new Error(message);
  error.name = name;
  return error;
}

function isTimeoutAbortReason(reason: unknown): boolean {
  return (
    typeof reason === "object" &&
    reason !== null &&
    "name" in reason &&
    (reason as { name?: unknown }).name === "TimeoutError"
  );
}

function createCancellationContext(
  callerSignal: AbortSignal | null | undefined,
  logicalTimeoutMs: number,
): CancellationContext {
  const controller = new AbortController();
  let source: CancellationSource | undefined;
  let cause: unknown;
  let deadlineTimer: ReturnType<typeof setTimeout> | undefined;

  const abort = (nextSource: CancellationSource, nextCause: unknown): void => {
    if (source !== undefined) return;
    source = nextSource;
    cause = nextCause;
    controller.abort(nextCause);
  };

  const abortFromCaller = (): void => {
    const reason = callerSignal?.reason;
    abort(isTimeoutAbortReason(reason) ? "caller-timeout" : "caller-cancelled", reason);
  };

  if (callerSignal?.aborted) {
    abortFromCaller();
  } else {
    callerSignal?.addEventListener("abort", abortFromCaller, { once: true });
    deadlineTimer = setTimeout(() => {
      const reason = createAbortReason("TimeoutError", "The logical request deadline elapsed.");
      abort("logical-timeout", reason);
    }, logicalTimeoutMs);
  }

  return {
    signal: controller.signal,
    get source() {
      return source;
    },
    get cause() {
      return cause;
    },
    cleanup() {
      if (deadlineTimer !== undefined) clearTimeout(deadlineTimer);
      callerSignal?.removeEventListener("abort", abortFromCaller);
    },
  };
}

function cancellationError(
  context: CancellationContext,
  fallbackCause?: unknown,
): RequestTimeoutError | RequestCancelledError {
  const cause = context.cause ?? fallbackCause;
  if (context.source === "caller-timeout" || context.source === "logical-timeout") {
    return new RequestTimeoutError(cause);
  }
  return new RequestCancelledError(cause);
}

function raceWithSignal<T>(operation: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(signal.reason);

  return new Promise<T>((resolve, reject) => {
    const onAbort = (): void => {
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });

    operation.then(
      (value) => {
        signal.removeEventListener("abort", onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener("abort", onAbort);
        reject(error);
      },
    );
  });
}

function interruptibleDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);

  return new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    const onAbort = (): void => {
      clearTimeout(timer);
      signal.removeEventListener("abort", onAbort);
      reject(signal.reason);
    };
    signal.addEventListener("abort", onAbort, { once: true });
  });
}

interface RequestInitSnapshot {
  readonly requestInit: RequestInit;
  readonly method: unknown;
  readonly body: unknown;
  readonly callerSignal: AbortSignal | null | undefined;
}

function assertCanonicalInput(input: unknown): asserts input is string | URL {
  if (typeof input === "string") return;
  if (typeof URL !== "undefined") {
    try {
      // Use the platform brand check rather than `instanceof` so a URL from a
      // different browser realm remains valid without accepting a Request.
      URL.prototype.toString.call(input);
      return;
    } catch {
      // Fall through to the explicit unsupported-input error.
    }
  }
  throw new TypeError("HttpTransport input must be a string or URL; Request is unsupported.");
}

/** Read caller-controlled RequestInit properties once into a plain snapshot. */
function snapshotRequestInit(init: RequestInit): RequestInitSnapshot {
  if (
    init === null ||
    (typeof init !== "object" && typeof init !== "function")
  ) {
    throw new TypeError("RequestInit must be an object.");
  }

  const source = init as unknown as {
    method?: unknown;
    body?: unknown;
    signal?: AbortSignal | null;
  };
  const requestInit = Object.create(null) as RequestInit;
  let method: unknown;
  let body: unknown;
  let signal: AbortSignal | null | undefined;
  let copiedMethod = false;
  let copiedBody = false;
  let copiedSignal = false;

  // Object.entries materializes each own enumerable value once across the
  // supported Node/browser engines. Avoid object-rest here: Node 22 may invoke
  // excluded getters again while creating the rest object.
  for (const [key, value] of Object.entries(init as unknown as object)) {
    if (key === "method") {
      method = value;
      copiedMethod = true;
      continue;
    }
    if (key === "body") {
      body = value;
      copiedBody = true;
      continue;
    }
    if (key === "signal") {
      signal = value as AbortSignal | null | undefined;
      copiedSignal = true;
      continue;
    }
    Object.defineProperty(requestInit, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }
  if (!copiedMethod) method = source.method;
  if (!copiedBody) body = source.body;
  if (!copiedSignal) signal = source.signal;
  for (const [key, value] of [
    ["method", method],
    ["body", body],
  ] as const) {
    Object.defineProperty(requestInit, key, {
      configurable: true,
      enumerable: true,
      value,
      writable: true,
    });
  }

  return {
    method,
    body,
    callerSignal: signal,
    requestInit,
  };
}

function requestMethod(method: unknown): string | undefined {
  if (method === undefined) return "GET";
  if (typeof method !== "string") return undefined;
  // Fetch methods are byte strings. Restrict normalization to ASCII letters so
  // Unicode case folding cannot turn an invalid method into an allowlisted one.
  return method.replace(/[a-z]/g, (character) =>
    String.fromCharCode(character.charCodeAt(0) - 32),
  );
}

/**
 * Fetch can consume a ReadableStream body only once. First use the platform's
 * side-effect-free brand getter, then walk descriptors so streams originating
 * in another realm or implementation also fail closed without invoking a
 * caller-controlled `getReader` getter.
 */
function hasOneShotBody(body: unknown): boolean {
  if (typeof body !== "object" || body === null) return false;

  if (READABLE_STREAM_LOCKED_GETTER) {
    try {
      READABLE_STREAM_LOCKED_GETTER.call(body);
      return true;
    } catch {
      // Continue with a structural check for cross-realm/polyfilled streams.
    }
  }

  try {
    const seen = new Set<object>();
    let candidate: object | null = body;
    while (candidate !== null) {
      if (seen.has(candidate)) return true;
      seen.add(candidate);
      if (Object.getOwnPropertyDescriptor(candidate, "getReader") !== undefined) {
        return true;
      }
      candidate = Object.getPrototypeOf(candidate) as object | null;
    }
    return false;
  } catch {
    // An exotic body whose brand/prototype cannot be inspected must never
    // receive an automatic second send. Fetch remains responsible for deciding
    // whether the first attempt accepts it.
    return true;
  }
}

async function releaseResponseBody(response: Response, signal: AbortSignal): Promise<void> {
  try {
    const cancellation = response.body?.cancel();
    if (cancellation) await raceWithSignal(cancellation, signal);
  } catch (error) {
    if (signal.aborted) throw error;
    // This response is being discarded. A body implementation that is already
    // closed or refuses cancellation must not obscure the retry decision.
  }
}

/**
 * Keep the composed signal alive until the returned body is fully consumed or
 * cancelled. Fetch resolves after headers, but abort must continue to reach a
 * streaming body after that point.
 */
function manageResponseLifecycle(
  response: Response,
  context: CancellationContext,
): Response {
  if (!response.body) {
    context.cleanup();
    return response;
  }

  let reader: ReadableStreamDefaultReader<Uint8Array>;
  try {
    reader = response.body.getReader();
  } catch (error) {
    const failure = new NetworkRequestError(error);
    void response.body.cancel(error).catch(() => undefined);
    context.cleanup();
    throw failure;
  }

  let finished = false;
  let streamController: ReadableStreamDefaultController<Uint8Array> | undefined;

  const finish = (): boolean => {
    if (finished) return false;
    finished = true;
    context.signal.removeEventListener("abort", onAbort);
    context.cleanup();
    return true;
  };

  const onAbort = (): void => {
    const error = cancellationError(context, context.signal.reason);
    if (!finish()) return;
    void reader.cancel(context.signal.reason).catch(() => undefined);
    try {
      streamController?.error(error);
    } catch {
      // A simultaneous body close/cancel may already have settled the stream.
    }
  };

  let managedBody: ReadableStream<Uint8Array>;
  try {
    managedBody = new ReadableStream<Uint8Array>({
      start(controller) {
        streamController = controller;
        context.signal.addEventListener("abort", onAbort, { once: true });
        if (context.signal.aborted) onAbort();
      },
      async pull(controller) {
        try {
          const chunk = await reader.read();
          if (finished) return;
          if (chunk.done) {
            finish();
            try {
              controller.close();
            } catch {
              // A simultaneous consumer cancellation already closed it.
            }
          } else {
            controller.enqueue(chunk.value);
          }
        } catch (error) {
          if (!finish()) return;
          try {
            controller.error(
              context.signal.aborted
                ? cancellationError(context, error)
                : new NetworkRequestError(error),
            );
          } catch {
            // A simultaneous body close/cancel may already have settled it.
          }
        }
      },
      async cancel(reason) {
        // Release caller/deadline resources synchronously. The underlying
        // stream is allowed to acknowledge cancellation asynchronously (or
        // never settle) without extending the logical request lifecycle.
        finish();
        await reader.cancel(reason);
      },
    });
  } catch (error) {
    const failure = new NetworkRequestError(error);
    finish();
    reader.releaseLock();
    void response.body.cancel(error).catch(() => undefined);
    throw failure;
  }

  let managedResponse: Response;
  try {
    managedResponse = new Response(managedBody, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  } catch (error) {
    const failure = new NetworkRequestError(error);
    if (finish()) {
      void reader.cancel(error).catch(() => undefined);
      try {
        streamController?.error(failure);
      } catch {
        // Construction failure can settle the stream before this cleanup.
      }
    }
    throw failure;
  }

  // Response construction cannot carry these Fetch-owned metadata fields.
  // Preserve their observable values for raw-response callers.
  for (const [property, value] of [
    ["redirected", response.redirected],
    ["type", response.type],
    ["url", response.url],
  ] as const) {
    try {
      Object.defineProperty(managedResponse, property, {
        configurable: true,
        enumerable: true,
        value,
      });
    } catch {
      // The core Response contract remains usable if a WebView makes a
      // metadata property non-configurable.
    }
  }

  return managedResponse;
}

/**
 * Stateless shared HTTP transport. All controller, timer, attempt, and listener
 * state is allocated inside each request invocation.
 */
export class HttpTransport {
  private readonly fetchImplementation: FetchFunction;
  private readonly logicalTimeoutMs: number;
  private readonly totalAttempts: number;
  private readonly retryDelayMs: (completedAttempts: number) => number;
  private readonly maxRetryDelayMs: number;

  constructor(config: HttpTransportConfig) {
    const logicalTimeoutMs = config.logicalTimeoutMs ?? DEFAULT_LOGICAL_TIMEOUT_MS;
    const totalAttempts = config.totalAttempts ?? DEFAULT_TOTAL_ATTEMPTS;
    const maxRetryDelayMs = config.maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;

    assertPositiveFinite(logicalTimeoutMs, "logicalTimeoutMs");
    assertPositiveFinite(totalAttempts, "totalAttempts");
    assertPositiveFinite(maxRetryDelayMs, "maxRetryDelayMs");
    if (!Number.isInteger(totalAttempts)) {
      throw new TypeError("totalAttempts must be an integer.");
    }

    this.fetchImplementation = config.fetchImplementation;
    this.logicalTimeoutMs = logicalTimeoutMs;
    this.totalAttempts = totalAttempts;
    this.retryDelayMs = config.retryDelayMs ?? defaultRetryDelayMs;
    this.maxRetryDelayMs = maxRetryDelayMs;
  }

  request(input: string | URL, init: RequestInit = {}): Promise<Response> {
    return this.execute(input, init, this.totalAttempts);
  }

  /** Same cancellation/deadline kernel with an explicit zero-retry budget. */
  requestOnce(input: string | URL, init: RequestInit = {}): Promise<Response> {
    return this.execute(input, init, 1);
  }

  private async execute(
    input: string | URL,
    init: RequestInit,
    configuredAttempts: number,
  ): Promise<Response> {
    assertCanonicalInput(input);
    let snapshot: RequestInitSnapshot;
    try {
      snapshot = snapshotRequestInit(init);
    } catch (error) {
      throw new NetworkRequestError(error);
    }

    const method = requestMethod(snapshot.method);
    const allowedAttempts =
      method !== undefined &&
      RETRYABLE_METHODS.has(method) &&
      !hasOneShotBody(snapshot.body)
        ? configuredAttempts
        : 1;
    const context = createCancellationContext(snapshot.callerSignal, this.logicalTimeoutMs);
    const requestInit: RequestInit = Object.freeze({
      ...snapshot.requestInit,
      signal: context.signal,
    });
    let responseOwnsLifecycle = false;

    try {
      if (context.signal.aborted) throw cancellationError(context);

      for (let attempt = 1; attempt <= allowedAttempts; attempt += 1) {
        try {
          if (context.signal.aborted) throw cancellationError(context);

          const response = await raceWithSignal(
            Promise.resolve(this.fetchImplementation(input, requestInit)),
            context.signal,
          );

          const shouldRetryResponse =
            attempt < allowedAttempts && RETRYABLE_STATUSES.has(response.status);
          if (!shouldRetryResponse) {
            const managedResponse = manageResponseLifecycle(response, context);
            responseOwnsLifecycle = true;
            return managedResponse;
          }

          await releaseResponseBody(response, context.signal);
          await this.waitBeforeRetry(attempt, context.signal);
        } catch (error) {
          if (context.signal.aborted) throw cancellationError(context, error);
          if (
            error instanceof NetworkRequestError ||
            error instanceof RequestTimeoutError ||
            error instanceof RequestCancelledError
          ) {
            throw error;
          }
          if (attempt >= allowedAttempts) {
            throw new NetworkRequestError(error);
          }
          try {
            await this.waitBeforeRetry(attempt, context.signal);
          } catch (delayError) {
            if (context.signal.aborted) {
              throw cancellationError(context, delayError);
            }
            throw delayError;
          }
        }
      }

      throw new NetworkRequestError();
    } finally {
      if (!responseOwnsLifecycle) context.cleanup();
    }
  }

  private waitBeforeRetry(completedAttempts: number, signal: AbortSignal): Promise<void> {
    const requestedDelay = this.retryDelayMs(completedAttempts);
    const boundedDelay = Number.isFinite(requestedDelay)
      ? Math.min(this.maxRetryDelayMs, Math.max(0, requestedDelay))
      : this.maxRetryDelayMs;
    return interruptibleDelay(boundedDelay, signal);
  }
}

/** The only production owner of the platform Fetch function. */
export function createBrowserHttpTransport(): HttpTransport {
  return new HttpTransport({
    fetchImplementation: (input, init) => globalThis.fetch(input, init),
  });
}
