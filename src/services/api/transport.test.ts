import { afterEach, describe, expect, expectTypeOf, it, vi } from "vitest";

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

async function consumeBrandedStreamBody(init: RequestInit | undefined): Promise<string> {
  const reader = ReadableStream.prototype.getReader.call(
    init?.body as ReadableStream<Uint8Array>,
  ) as ReadableStreamDefaultReader<Uint8Array>;
  const decoder = new TextDecoder();
  let result = "";
  for (;;) {
    const chunk = await reader.read();
    if (chunk.done) return result + decoder.decode();
    result += decoder.decode(chunk.value, { stream: true });
  }
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

  it("snapshots a dynamic caller signal once before starting Fetch", async () => {
    const caller = new AbortController();
    const laterCaller = new AbortController();
    const readSignal = vi
      .fn<() => AbortSignal>()
      .mockReturnValueOnce(caller.signal)
      .mockReturnValue(laterCaller.signal);
    const init = Object.defineProperty({}, "signal", {
      enumerable: true,
      get: readSignal,
    }) as RequestInit;
    const fetchImplementation = vi.fn<FetchFunction>(() => new Promise<Response>(() => {}));
    const transport = transportWith(fetchImplementation);

    const request = transport.request("https://api.example/resource", init);
    await flushMicrotasks();
    caller.abort(new DOMException("caller stopped", "AbortError"));

    await expect(request).rejects.toBeInstanceOf(RequestCancelledError);
    expect(readSignal).toHaveBeenCalledTimes(1);
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
  it("exposes only the canonical URL input contract", () => {
    type RequestInput = Parameters<HttpTransport["request"]>[0];
    type RequestOnceInput = Parameters<HttpTransport["requestOnce"]>[0];

    expectTypeOf<RequestInput>().toEqualTypeOf<string | URL>();
    expectTypeOf<RequestOnceInput>().toEqualTypeOf<string | URL>();
  });

  it("rejects a runtime Request escape explicitly before Fetch", async () => {
    const fetchImplementation = vi.fn<FetchFunction>();
    const transport = transportWith(fetchImplementation);
    const escapedRequest = transport.request.bind(transport) as unknown as (
      input: unknown,
      init?: RequestInit,
    ) => Promise<Response>;

    await expect(
      escapedRequest(new Request("https://api.example/resource", { method: "PUT" })),
    ).rejects.toThrow(
      new TypeError("HttpTransport input must be a string or URL; Request is unsupported."),
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("keeps invalid runtime method values on the one-attempt path", async () => {
    const cause = new Error("fetch rejected invalid method");
    const fetchImplementation = vi.fn<FetchFunction>().mockRejectedValue(cause);
    const transport = transportWith(fetchImplementation);

    const failure = await transport
      .request("https://api.example/resource", {
        method: null,
      } as unknown as RequestInit)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NetworkRequestError);
    if (!(failure instanceof NetworkRequestError)) throw failure;
    expect(failure.cause).toBe(cause);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it.each(["OPTIONſ", "OPTıONS"])(
    "does not Unicode-fold invalid method %s into the retry allowlist",
    async (method) => {
      const fetchImplementation = vi.fn<FetchFunction>(async (input, init) => {
        new Request(input, init);
        return okResponse();
      });
      const transport = transportWith(fetchImplementation);

      const failure = await transport
        .request("https://api.example/resource", { method })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(NetworkRequestError);
      if (!(failure instanceof NetworkRequestError)) throw failure;
      expect(failure.cause).toBeInstanceOf(TypeError);
      expect(fetchImplementation).toHaveBeenCalledTimes(1);
      expect(fetchImplementation.mock.calls[0][1]?.method).toBe(method);
    },
  );

  it.each(["OPTIONſ", "OPTıONS"])(
    "returns a transient response once for invalid Unicode method %s",
    async (method) => {
      const fetchImplementation = vi.fn<FetchFunction>().mockResolvedValue(
        new Response("unavailable", { status: 503 }),
      );
      const transport = transportWith(fetchImplementation);

      const response = await transport.request("https://api.example/resource", { method });

      expect(response.status).toBe(503);
      await expect(response.text()).resolves.toBe("unavailable");
      expect(fetchImplementation).toHaveBeenCalledTimes(1);
      expect(fetchImplementation.mock.calls[0][1]?.method).toBe(method);
    },
  );

  it("normalizes ASCII lowercase methods only for retry classification", async () => {
    vi.useFakeTimers();
    const fetchImplementation = vi
      .fn<FetchFunction>()
      .mockRejectedValueOnce(new Error("network one"))
      .mockResolvedValueOnce(okResponse());
    const transport = transportWith(fetchImplementation);

    const request = transport.request("https://api.example/resource", { method: "put" });
    await vi.advanceTimersByTimeAsync(10);

    const response = await request;
    await expect(response.text()).resolves.toBe("ok");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    for (const [, actualInit] of fetchImplementation.mock.calls) {
      expect(actualInit?.method).toBe("put");
    }
  });

  it("freezes the sent snapshot so an injected Fetch cannot change the retry method", async () => {
    vi.useFakeTimers();
    const firstFailure = new Error("network one");
    const observedMethods: Array<string | undefined> = [];
    const fetchImplementation = vi.fn<FetchFunction>(async (_input, actualInit) => {
      observedMethods.push(actualInit?.method);
      expect(Object.isFrozen(actualInit)).toBe(true);
      if (observedMethods.length === 1) {
        expect(() => {
          if (actualInit) actualInit.method = "POST";
        }).toThrow(TypeError);
        expect(actualInit?.method).toBe("PUT");
        throw firstFailure;
      }
      return okResponse();
    });
    const transport = transportWith(fetchImplementation);

    const request = transport.request("https://api.example/resource", { method: "PUT" });
    await vi.advanceTimersByTimeAsync(10);

    const response = await request;
    await expect(response.text()).resolves.toBe("ok");
    expect(fetchImplementation).toHaveBeenCalledTimes(2);
    expect(observedMethods).toEqual(["PUT", "PUT"]);
  });

  it("snapshots a dynamic method once for both classification and Fetch", async () => {
    vi.useFakeTimers();
    const readMethod = vi
      .fn<() => string>()
      .mockReturnValueOnce("PUT")
      .mockReturnValue("POST");
    const init = Object.defineProperty(
      { body: JSON.stringify({ value: 42 }) },
      "method",
      { enumerable: true, get: readMethod },
    ) as RequestInit;
    const fetchImplementation = vi
      .fn<FetchFunction>()
      .mockRejectedValueOnce(new Error("network one"))
      .mockRejectedValueOnce(new Error("network two"))
      .mockResolvedValueOnce(okResponse());
    const transport = transportWith(fetchImplementation);

    const request = transport.request("https://api.example/resource", init);
    await vi.advanceTimersByTimeAsync(20);

    const response = await request;
    await expect(response.text()).resolves.toBe("ok");
    expect(readMethod).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    for (const [, actualInit] of fetchImplementation.mock.calls) {
      expect(actualInit?.method).toBe("PUT");
    }
  });

  it("snapshots a dynamic body once for both classification and Fetch", async () => {
    vi.useFakeTimers();
    const replayableBody = JSON.stringify({ value: 42 });
    const laterStream = new ReadableStream<Uint8Array>();
    const readBody = vi
      .fn<() => BodyInit>()
      .mockReturnValueOnce(replayableBody)
      .mockReturnValue(laterStream);
    const init = Object.defineProperty({ method: "PUT" }, "body", {
      enumerable: true,
      get: readBody,
    }) as RequestInit;
    const fetchImplementation = vi
      .fn<FetchFunction>()
      .mockRejectedValueOnce(new Error("network one"))
      .mockRejectedValueOnce(new Error("network two"))
      .mockResolvedValueOnce(okResponse());
    const transport = transportWith(fetchImplementation);

    const request = transport.request("https://api.example/resource", init);
    await vi.advanceTimersByTimeAsync(20);

    const response = await request;
    await expect(response.text()).resolves.toBe("ok");
    expect(readBody).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    for (const [, actualInit] of fetchImplementation.mock.calls) {
      expect(actualInit?.body).toBe(replayableBody);
    }
    expect(laterStream.locked).toBe(false);
  });

  it("classifies a snapshotted stream body before a later getter value can change it", async () => {
    const streamBody = new ReadableStream<Uint8Array>();
    const readBody = vi
      .fn<() => BodyInit>()
      .mockReturnValueOnce(streamBody)
      .mockReturnValue("later replayable body");
    const init = Object.defineProperty({ method: "PUT" }, "body", {
      enumerable: true,
      get: readBody,
    }) as RequestInit;
    const cause = new Error("connection failed after consuming the stream");
    const fetchImplementation = vi.fn<FetchFunction>().mockRejectedValue(cause);
    const transport = transportWith(fetchImplementation);

    const failure = await transport
      .request("https://api.example/resource", init)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NetworkRequestError);
    if (!(failure instanceof NetworkRequestError)) throw failure;
    expect(failure.cause).toBe(cause);
    expect(readBody).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(fetchImplementation.mock.calls[0][1]?.body).toBe(streamBody);
  });

  it("turns a throwing RequestInit getter into a typed zero-fetch failure", async () => {
    const cause = new Error("request init getter failed");
    const init = Object.defineProperty({}, "method", {
      enumerable: true,
      get() {
        throw cause;
      },
    }) as RequestInit;
    const fetchImplementation = vi.fn<FetchFunction>();
    const transport = transportWith(fetchImplementation);

    const failure = await transport
      .request("https://api.example/resource", init)
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NetworkRequestError);
    if (!(failure instanceof NetworkRequestError)) throw failure;
    expect(failure.cause).toBe(cause);
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

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

  it.each(["PUT", "DELETE"])(
    "sends a one-shot stream-body %s exactly once on a network failure",
    async (method) => {
      const cause = new Error("connection failed after consuming the body");
      const body = new ReadableStream<Uint8Array>();
      const fetchImplementation = vi.fn<FetchFunction>().mockRejectedValue(cause);
      const transport = transportWith(fetchImplementation);

      const failure = await transport
        .request("https://api.example/resource", { method, body })
        .catch((error: unknown) => error);

      expect(failure).toBeInstanceOf(NetworkRequestError);
      if (!(failure instanceof NetworkRequestError)) throw failure;
      expect(failure.cause).toBe(cause);
      expect(body.locked).toBe(false);
      expect(fetchImplementation).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["PUT", "DELETE"])(
    "returns a one-shot stream-body %s transient response without retrying",
    async (method) => {
      const body = new ReadableStream<Uint8Array>();
      const fetchImplementation = vi.fn<FetchFunction>().mockResolvedValue(
        new Response("unavailable", { status: 503 }),
      );
      const transport = transportWith(fetchImplementation);

      const response = await transport.request("https://api.example/resource", {
        method,
        body,
      });

      expect(response.status).toBe(503);
      await expect(response.text()).resolves.toBe("unavailable");
      expect(body.locked).toBe(false);
      expect(fetchImplementation).toHaveBeenCalledTimes(1);
    },
  );

  it("retains the retry budget for a replayable JSON PUT body", async () => {
    vi.useFakeTimers();
    const body = JSON.stringify({ value: 42 });
    const fetchImplementation = vi
      .fn<FetchFunction>()
      .mockRejectedValueOnce(new Error("network one"))
      .mockRejectedValueOnce(new Error("network two"))
      .mockResolvedValueOnce(okResponse());
    const transport = transportWith(fetchImplementation);

    const request = transport.request("https://api.example/resource", {
      method: "PUT",
      body,
    });
    await vi.advanceTimersByTimeAsync(20);

    const response = await request;
    await expect(response.text()).resolves.toBe("ok");
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchImplementation.mock.calls) {
      expect(init?.body).toBe(body);
    }
  });

  it("retries transient responses with a replayable JSON PUT body", async () => {
    vi.useFakeTimers();
    const body = JSON.stringify({ value: 42 });
    const fetchImplementation = vi
      .fn<FetchFunction>()
      .mockResolvedValueOnce(new Response("first", { status: 500 }))
      .mockResolvedValueOnce(new Response("second", { status: 502 }))
      .mockResolvedValueOnce(okResponse());
    const transport = transportWith(fetchImplementation);

    const request = transport.request("https://api.example/resource", {
      method: "PUT",
      body,
    });
    await vi.advanceTimersByTimeAsync(20);

    const response = await request;
    await expect(response.text()).resolves.toBe("ok");
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
    for (const [, init] of fetchImplementation.mock.calls) {
      expect(init?.body).toBe(body);
    }
  });

  it.each([
    ["Blob", () => new Blob(["body"])],
    ["FormData", () => new FormData()],
    ["URLSearchParams", () => new URLSearchParams({ value: "42" })],
    ["ArrayBuffer", () => new Uint8Array([1, 2, 3]).buffer],
    ["typed array", () => new Uint8Array([1, 2, 3])],
  ])("does not misclassify a replayable %s body as one-shot", async (_name, createBody) => {
    vi.useFakeTimers();
    const body = createBody();
    const fetchImplementation = vi
      .fn<FetchFunction>()
      .mockRejectedValueOnce(new Error("network one"))
      .mockRejectedValueOnce(new Error("network two"))
      .mockResolvedValueOnce(okResponse());
    const transport = transportWith(fetchImplementation);

    const request = transport.request("https://api.example/resource", {
      method: "PUT",
      body,
    });
    await vi.advanceTimersByTimeAsync(20);

    const response = await request;
    await expect(response.text()).resolves.toBe("ok");
    expect(fetchImplementation).toHaveBeenCalledTimes(3);
  });

  it("fails a body with an unreadable stream capability closed to one attempt", async () => {
    const inspect = vi.fn(() => {
      throw new Error("cross-realm body trap");
    });
    const body = Object.defineProperty({}, "getReader", { get: inspect }) as BodyInit;
    const fetchImplementation = vi.fn<FetchFunction>().mockResolvedValue(
      new Response("unavailable", { status: 503 }),
    );
    const transport = transportWith(fetchImplementation);

    const response = await transport.request("https://api.example/resource", {
      method: "PUT",
      body,
    });

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe("unavailable");
    expect(inspect).not.toHaveBeenCalled();
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("sends a real stream once when a static own property shadows getReader", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("one shot"));
        controller.close();
      },
    });
    Object.defineProperty(body, "getReader", {
      configurable: true,
      value: undefined,
    });
    const consumedBodies: string[] = [];
    const cause = new Error("network failure after consuming body");
    const fetchImplementation = vi.fn<FetchFunction>(async (_input, init) => {
      consumedBodies.push(await consumeBrandedStreamBody(init));
      throw cause;
    });
    const transport = transportWith(fetchImplementation);

    const failure = await transport
      .request("https://api.example/resource", { method: "PUT", body })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NetworkRequestError);
    if (!(failure instanceof NetworkRequestError)) throw failure;
    expect(failure.cause).toBe(cause);
    expect(consumedBodies).toEqual(["one shot"]);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("preserves the first failure after consuming a dynamically shadowed stream", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("one shot"));
        controller.close();
      },
    });
    const inheritedGetReader = ReadableStream.prototype.getReader;
    const inspect = vi
      .fn<() => typeof inheritedGetReader | undefined>()
      .mockReturnValueOnce(undefined)
      .mockReturnValue(inheritedGetReader);
    Object.defineProperty(body, "getReader", {
      configurable: true,
      get: inspect,
    });
    const consumedBodies: string[] = [];
    const cause = new Error("network failure after consuming body");
    const fetchImplementation = vi.fn<FetchFunction>(async (_input, init) => {
      expect(inspect).not.toHaveBeenCalled();
      consumedBodies.push(await consumeBrandedStreamBody(init));
      throw cause;
    });
    const transport = transportWith(fetchImplementation);

    const failure = await transport
      .request("https://api.example/resource", { method: "DELETE", body })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NetworkRequestError);
    if (!(failure instanceof NetworkRequestError)) throw failure;
    expect(failure.cause).toBe(cause);
    expect(consumedBodies).toEqual(["one shot"]);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("returns a transient response once after consuming a dynamically shadowed stream", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("one shot"));
        controller.close();
      },
    });
    const inheritedGetReader = ReadableStream.prototype.getReader;
    const inspect = vi
      .fn<() => typeof inheritedGetReader | undefined>()
      .mockReturnValueOnce(undefined)
      .mockReturnValue(inheritedGetReader);
    Object.defineProperty(body, "getReader", {
      configurable: true,
      get: inspect,
    });
    const consumedBodies: string[] = [];
    const fetchImplementation = vi.fn<FetchFunction>(async (_input, init) => {
      expect(inspect).not.toHaveBeenCalled();
      consumedBodies.push(await consumeBrandedStreamBody(init));
      return new Response("unavailable", { status: 503 });
    });
    const transport = transportWith(fetchImplementation);

    const response = await transport.request("https://api.example/resource", {
      method: "PUT",
      body,
    });

    expect(response.status).toBe(503);
    await expect(response.text()).resolves.toBe("unavailable");
    expect(consumedBodies).toEqual(["one shot"]);
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
  it("keeps caller cancellation typed during a one-shot stream-body attempt", async () => {
    const caller = new AbortController();
    const body = new ReadableStream<Uint8Array>();
    const fetchImplementation = vi.fn<FetchFunction>(() => new Promise<Response>(() => {}));
    const transport = transportWith(fetchImplementation);

    const request = transport.request("https://api.example/resource", {
      method: "PUT",
      body,
      signal: caller.signal,
    });
    await flushMicrotasks();
    caller.abort(new DOMException("caller stopped", "AbortError"));

    await expect(request).rejects.toBeInstanceOf(RequestCancelledError);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("keeps the deadline typed during a one-shot stream-body attempt", async () => {
    vi.useFakeTimers();
    const body = new ReadableStream<Uint8Array>();
    const fetchImplementation = vi.fn<FetchFunction>(() => new Promise<Response>(() => {}));
    const transport = transportWith(fetchImplementation, { logicalTimeoutMs: 20 });

    const request = transport.request("https://api.example/resource", {
      method: "DELETE",
      body,
    });
    const outcome = request.catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(20);

    await expect(outcome).resolves.toBeInstanceOf(RequestTimeoutError);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

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
