import { afterEach, describe, expect, it, vi } from "vitest";

import {
  NetworkRequestError,
  RequestCancelledError,
  RequestTimeoutError,
  getErrorMessage,
  isRequestError,
} from "./errors";
import { HttpTransport, type FetchFunction } from "./transport";

const okResponse = (): Response => new Response("ok", { status: 200 });

function transportWith(
  fetchImplementation: FetchFunction,
  options: {
    logicalTimeoutMs?: number;
    totalAttempts?: number;
    retryDelayMs?: (completedAttempts: number) => number;
    maxRetryDelayMs?: number;
  } = {},
): HttpTransport {
  return new HttpTransport({
    fetchImplementation,
    logicalTimeoutMs: options.logicalTimeoutMs ?? 30_000,
    totalAttempts: options.totalAttempts ?? 3,
    retryDelayMs: options.retryDelayMs ?? (() => 10),
    maxRetryDelayMs: options.maxRetryDelayMs ?? 2_000,
  });
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("HttpTransport cancellation and deadlines", () => {
  it("classifies a pre-aborted caller as cancellation and performs zero fetches", async () => {
    const caller = new AbortController();
    caller.abort();
    const fetchImplementation = vi.fn<FetchFunction>();
    const transport = transportWith(fetchImplementation);

    const failure = await transport
      .request("https://api.example/private?token=secret", { signal: caller.signal })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RequestCancelledError);
    expect(failure).toMatchObject({ kind: "cancelled" });
    if (!(failure instanceof RequestCancelledError)) throw failure;
    expect(failure.message).not.toContain("secret");
    expect(fetchImplementation).not.toHaveBeenCalled();
    expect(isRequestError(failure)).toBe(true);
  });

  it("interrupts an in-flight fetch on caller cancellation without retrying", async () => {
    const caller = new AbortController();
    const fetchImplementation = vi.fn<FetchFunction>(() => new Promise<Response>(() => {}));
    const transport = transportWith(fetchImplementation);

    const request = transport.request("https://api.example/resource", {
      signal: caller.signal,
    });
    await flushMicrotasks();
    caller.abort(new DOMException("caller stopped", "AbortError"));

    await expect(request).rejects.toMatchObject({ kind: "cancelled" });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("classifies AbortSignal.timeout as timeout without relying on fetch's exception", async () => {
    const fetchImplementation = vi.fn<FetchFunction>(() => new Promise<Response>(() => {}));
    const transport = transportWith(fetchImplementation, { logicalTimeoutMs: 5_000 });

    const request = transport.request("https://api.example/resource", {
      signal: AbortSignal.timeout(5),
    });

    await expect(request).rejects.toMatchObject({ kind: "timeout" });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("uses one internal logical deadline across the entire request", async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn<FetchFunction>(() => new Promise<Response>(() => {}));
    const transport = transportWith(fetchImplementation, { logicalTimeoutMs: 25 });

    const request = transport.request("https://api.example/resource");
    const outcome = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(25);

    await expect(outcome).resolves.toBeInstanceOf(RequestTimeoutError);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("interrupts retry backoff on caller cancellation and starts no next attempt", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const fetchImplementation = vi.fn<FetchFunction>().mockRejectedValue(new Error("offline"));
    const transport = transportWith(fetchImplementation, { retryDelayMs: () => 5_000 });

    const request = transport.request("https://api.example/resource", {
      signal: caller.signal,
    });
    await flushMicrotasks();
    expect(fetchImplementation).toHaveBeenCalledTimes(1);

    caller.abort();
    await expect(request).rejects.toBeInstanceOf(RequestCancelledError);
    await vi.runAllTimersAsync();
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets the logical deadline interrupt backoff and prevents another attempt", async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi.fn<FetchFunction>().mockRejectedValue(new Error("offline"));
    const transport = transportWith(fetchImplementation, {
      logicalTimeoutMs: 20,
      retryDelayMs: () => 5_000,
    });

    const request = transport.request("https://api.example/resource");
    const outcome = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20);

    await expect(outcome).resolves.toBeInstanceOf(RequestTimeoutError);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("lets the logical deadline interrupt a stalled response-body release", async () => {
    vi.useFakeTimers();
    const cancel = vi.fn(() => new Promise<void>(() => {}));
    const transient = { status: 503, body: { cancel } } as unknown as Response;
    const fetchImplementation = vi.fn<FetchFunction>().mockResolvedValue(transient);
    const transport = transportWith(fetchImplementation, { logicalTimeoutMs: 20 });

    const request = transport.request("https://api.example/resource");
    const outcome = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20);

    await expect(outcome).resolves.toBeInstanceOf(RequestTimeoutError);
    expect(cancel).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("keeps the logical deadline active until a returned response body settles", async () => {
    vi.useFakeTimers();
    const cancelBody = vi.fn();
    const fetchImplementation = vi.fn<FetchFunction>().mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
        status: 200,
      }),
    );
    const transport = transportWith(fetchImplementation, { logicalTimeoutMs: 20 });

    const response = await transport.request("https://api.example/resource");
    const bodyOutcome = response.text().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20);

    await expect(bodyOutcome).resolves.toBeInstanceOf(RequestTimeoutError);
    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("clears the deadline and caller listener after a successful request", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const addListener = vi.spyOn(caller.signal, "addEventListener");
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    const transport = transportWith(vi.fn<FetchFunction>().mockResolvedValue(okResponse()));

    const response = await transport.request("https://api.example/resource", {
      signal: caller.signal,
    });
    await expect(response.text()).resolves.toBe("ok");

    expect(addListener).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);
  });
});

describe("HttpTransport closed retry policy", () => {
  it.each(["GET", "HEAD", "OPTIONS", "PUT", "DELETE"])(
    "retries %s network failures within the three-total-attempt budget",
    async (method) => {
      vi.useFakeTimers();
      const terminal = okResponse();
      const fetchImplementation = vi
        .fn<FetchFunction>()
        .mockRejectedValueOnce(new Error("network one"))
        .mockRejectedValueOnce(new Error("network two"))
        .mockResolvedValueOnce(terminal);
      const transport = transportWith(fetchImplementation);

      const request = transport.request("https://api.example/resource", { method });
      await vi.advanceTimersByTimeAsync(20);

      const response = await request;
      await expect(response.text()).resolves.toBe("ok");
      expect(fetchImplementation).toHaveBeenCalledTimes(3);
    },
  );

  it.each([
    ["GET", 408],
    ["PUT", 429],
    ["DELETE", 503],
  ])("retries %s after transient HTTP %i and releases the discarded body", async (method, status) => {
    vi.useFakeTimers();
    const cancel = vi.fn().mockResolvedValue(undefined);
    const transient = { status, body: { cancel } } as unknown as Response;
    const terminal = okResponse();
    const fetchImplementation = vi
      .fn<FetchFunction>()
      .mockResolvedValueOnce(transient)
      .mockResolvedValueOnce(terminal);
    const transport = transportWith(fetchImplementation);

    const request = transport.request("https://api.example/resource", { method });
    await vi.advanceTimersByTimeAsync(10);

    const response = await request;
    await expect(response.text()).resolves.toBe("ok");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(cancel).toHaveBeenCalledTimes(1);
  });

  it.each(["POST", "PATCH", "CONNECT"])(
    "sends unsafe or unknown %s exactly once on a network failure",
    async (method) => {
      const original = new Error("socket failed");
      const fetchImplementation = vi.fn<FetchFunction>().mockRejectedValue(original);
      const transport = transportWith(fetchImplementation);

      const failure = await transport
        .request("https://api.example/resource", { method })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(NetworkRequestError);
      if (!(failure instanceof NetworkRequestError)) throw failure;
      expect(failure.cause).toBe(original);
      expect(fetchImplementation).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["POST", "PATCH", "CUSTOM"])(
    "sends unsafe or unknown %s exactly once on a transient response",
    async (method) => {
      const transient = new Response("unavailable", { status: 503 });
      const fetchImplementation = vi.fn<FetchFunction>().mockResolvedValue(transient);
      const transport = transportWith(fetchImplementation);

      const response = await transport.request("https://api.example/resource", { method });
      expect(response.status).toBe(503);
      await expect(response.text()).resolves.toBe("unavailable");
      expect(fetchImplementation).toHaveBeenCalledTimes(1);
    },
  );

  it.each([400, 404, 501])("does not retry non-retryable HTTP %i", async (status) => {
    const response = new Response("terminal", { status });
    const fetchImplementation = vi.fn<FetchFunction>().mockResolvedValue(response);
    const transport = transportWith(fetchImplementation);

    const result = await transport.request("https://api.example/resource");
    expect(result.status).toBe(status);
    await expect(result.text()).resolves.toBe("terminal");
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("returns the final transient response after exhausting the total attempt budget", async () => {
    vi.useFakeTimers();
    const responses = [500, 502, 504].map(
      (status) => new Response("unavailable", { status }),
    );
    const fetchImplementation = vi
      .fn<FetchFunction>()
      .mockResolvedValueOnce(responses[0])
      .mockResolvedValueOnce(responses[1])
      .mockResolvedValueOnce(responses[2]);
    const transport = transportWith(fetchImplementation);

    const request = transport.request("https://api.example/resource");
    await vi.advanceTimersByTimeAsync(20);

    const response = await request;
    expect(response.status).toBe(504);
    await expect(response.text()).resolves.toBe("unavailable");
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it("returns a typed network failure with the last cause after exhausted retries", async () => {
    vi.useFakeTimers();
    const errors = [new Error("one"), new Error("two"), new Error("three")];
    const fetchImplementation = vi
      .fn<FetchFunction>()
      .mockRejectedValueOnce(errors[0])
      .mockRejectedValueOnce(errors[1])
      .mockRejectedValueOnce(errors[2]);
    const transport = transportWith(fetchImplementation);

    const request = transport.request("https://api.example/resource");
    const outcome = request.catch((error: unknown) => error);
    await vi.runAllTimersAsync();
    const failure = await outcome;

    expect(failure).toBeInstanceOf(NetworkRequestError);
    if (!(failure instanceof NetworkRequestError)) throw failure;
    expect(failure).toMatchObject({ kind: "network", cause: errors[2] });
    expect(getErrorMessage(failure)).toBe(
      "A network error prevented the request. Check your connection and try again.",
    );
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it("uses a bounded deterministic retry delay", async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi
      .fn<FetchFunction>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(okResponse());
    const transport = transportWith(fetchImplementation, {
      retryDelayMs: () => 50_000,
      maxRetryDelayMs: 20,
    });

    const request = transport.request("https://api.example/resource");
    await flushMicrotasks();
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(19);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    const response = await request;
    await expect(response.text()).resolves.toBe("ok");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });
});

describe("HttpTransport isolation and one-shot path", () => {
  it("requestOnce never retries even for a safe method", async () => {
    const original = new Error("offline");
    const fetchImplementation = vi.fn<FetchFunction>().mockRejectedValue(original);
    const transport = transportWith(fetchImplementation);

    const failure = await transport
      .requestOnce("https://api.example/raw", { method: "GET" })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NetworkRequestError);
    if (!(failure instanceof NetworkRequestError)) throw failure;
    expect(failure.cause).toBe(original);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("fails typed and cleans up when a special response cannot be lifecycle-wrapped", async () => {
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    const cancelBody = vi.fn();
    const opaqueLikeResponse = {
      body: new ReadableStream<Uint8Array>({ cancel: cancelBody }),
      headers: new Headers(),
      redirected: false,
      status: 0,
      statusText: "",
      type: "opaque",
      url: "",
    } as unknown as Response;
    const fetchImplementation = vi
      .fn<FetchFunction>()
      .mockResolvedValue(opaqueLikeResponse);
    const transport = transportWith(fetchImplementation);

    const failure = await transport
      .requestOnce("https://api.example/opaque", { signal: caller.signal })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NetworkRequestError);
    if (!(failure instanceof NetworkRequestError)) throw failure;
    expect(failure.cause).toBeInstanceOf(RangeError);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("fails closed with a typed error when an injected response body is already locked", async () => {
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    const lockedResponse = new Response("locked", { status: 200 });
    const externalReader = lockedResponse.body?.getReader();
    const fetchImplementation = vi.fn<FetchFunction>().mockResolvedValue(lockedResponse);
    const transport = transportWith(fetchImplementation);

    const failure = await transport
      .requestOnce("https://api.example/locked", { signal: caller.signal })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NetworkRequestError);
    if (!(failure instanceof NetworkRequestError)) throw failure;
    expect(failure.cause).toBeInstanceOf(TypeError);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));

    await externalReader?.cancel();
    externalReader?.releaseLock();
  });

  it("keeps concurrent request cancellation state isolated", async () => {
    const firstCaller = new AbortController();
    let resolveSecond: ((response: Response) => void) | undefined;
    const fetchImplementation = vi.fn<FetchFunction>((input) => {
      if (String(input).endsWith("/first")) return new Promise<Response>(() => {});
      return new Promise<Response>((resolve) => {
        resolveSecond = resolve;
      });
    });
    const transport = transportWith(fetchImplementation);

    const first = transport.request("https://api.example/first", {
      signal: firstCaller.signal,
    });
    const second = transport.request("https://api.example/second");
    await flushMicrotasks();
    firstCaller.abort();

    await expect(first).rejects.toBeInstanceOf(RequestCancelledError);
    resolveSecond?.(okResponse());
    const secondResponse = await second;
    await expect(secondResponse.text()).resolves.toBe("ok");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
  });

  it("keeps concurrent logical deadlines isolated", async () => {
    vi.useFakeTimers();
    let resolveSecond: ((response: Response) => void) | undefined;
    const fetchImplementation = vi.fn<FetchFunction>((input) => {
      if (String(input).endsWith("/first")) return new Promise<Response>(() => {});
      return new Promise<Response>((resolve) => {
        resolveSecond = resolve;
      });
    });
    const transport = transportWith(fetchImplementation, { logicalTimeoutMs: 20 });

    const first = transport.request("https://api.example/first");
    const firstOutcome = first.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(10);
    const second = transport.request("https://api.example/second");
    await vi.advanceTimersByTimeAsync(10);

    await expect(firstOutcome).resolves.toBeInstanceOf(RequestTimeoutError);
    resolveSecond?.(okResponse());
    const secondResponse = await second;
    await expect(secondResponse.text()).resolves.toBe("ok");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(vi.getTimerCount()).toBe(0);
  });
});
