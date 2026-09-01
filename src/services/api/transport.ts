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

function requestMethod(input: RequestInfo | URL, init: RequestInit): string {
  if (init.method) return init.method.toUpperCase();
  if (typeof Request !== "undefined" && input instanceof Request) {
    return input.method.toUpperCase();
  }
  return "GET";
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

  request(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    return this.execute(input, init, this.totalAttempts);
  }

  /** Same cancellation/deadline kernel with an explicit zero-retry budget. */
  requestOnce(input: RequestInfo | URL, init: RequestInit = {}): Promise<Response> {
    return this.execute(input, init, 1);
  }

  private async execute(
    input: RequestInfo | URL,
    init: RequestInit,
    configuredAttempts: number,
  ): Promise<Response> {
    const method = requestMethod(input, init);
    const allowedAttempts = RETRYABLE_METHODS.has(method) ? configuredAttempts : 1;
    const context = createCancellationContext(init.signal, this.logicalTimeoutMs);
    const requestInit: RequestInit = { ...init, signal: context.signal };
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
