import { afterEach, describe, expect, it, vi } from "vitest";

import { getRuntimeConfig } from "../../runtime/runtimeConfig";
import { agentApiClient, apiClient } from ".";
import { ApiClient } from "./client";
import {
  ApiError,
  NetworkRequestError,
  RequestCancelledError,
  RequestTimeoutError,
  getErrorMessage,
  isApiError,
  isRequestError,
} from "./errors";
import { HttpTransport, type FetchFunction } from "./transport";

afterEach(() => {
  vi.useRealTimers();
});

function createClient(
  fetchImplementation: FetchFunction,
  options: { logicalTimeoutMs?: number } = {},
): ApiClient {
  return new ApiClient({
    baseUrl: "https://api.example:9443/v1/",
    requestCredentials: "include",
    transport: new HttpTransport({
      fetchImplementation,
      logicalTimeoutMs: options.logicalTimeoutMs ?? 1_000,
      totalAttempts: 3,
      retryDelayMs: () => 0,
    }),
  });
}

async function flushMicrotasks(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("API runtime composition", () => {
  it("creates the standard and agent clients from the installed endpoint set", () => {
    const runtime = getRuntimeConfig();

    expect(apiClient.resolveUrl("models")).toBe(`${runtime.endpoints.standardApi}/models`);
    expect(agentApiClient.resolveUrl("sessions/session-1")).toBe(
      `${runtime.endpoints.agentApi}/sessions/session-1`,
    );
  });

  it("requires an explicit base URL and joins paths exactly once", () => {
    const client = createClient(vi.fn<FetchFunction>());

    expect(client.resolveUrl("///workspace/validate")).toBe(
      "https://api.example:9443/v1/workspace/validate",
    );
  });
});

describe("ApiClient request and response adaptation", () => {
  it("applies canonical URL, default headers, caller headers, and runtime credentials", async () => {
    const fetchImplementation = vi
      .fn<FetchFunction>()
      .mockResolvedValue(
        new Response(JSON.stringify({ ready: true }), {
          status: 200,
          headers: { "content-type": "application/json" },
        }),
      );
    const client = createClient(fetchImplementation);

    await expect(
      client.post<{ ready: boolean }>(
        "///workspace/validate",
        { path: "/workspace" },
        { headers: { "x-request-id": "request-1" } },
      ),
    ).resolves.toEqual({ ready: true });

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImplementation.mock.calls[0];
    expect(url).toBe("https://api.example:9443/v1/workspace/validate");
    expect(init?.method).toBe("POST");
    expect(init?.credentials).toBe("include");
    expect(init?.body).toBe(JSON.stringify({ path: "/workspace" }));
    const headers = new Headers(init?.headers);
    expect(headers.get("content-type")).toBe("application/json");
    expect(headers.get("x-request-id")).toBe("request-1");
  });

  it("parses JSON, text, and 204 responses", async () => {
    const fetchImplementation = vi
      .fn<FetchFunction>()
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ value: 42 }), {
          status: 200,
          headers: { "content-type": "application/json; charset=utf-8" },
        }),
      )
      .mockResolvedValueOnce(
        new Response("healthy", {
          status: 200,
          headers: { "content-type": "text/plain" },
        }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));
    const client = createClient(fetchImplementation);

    await expect(client.get<{ value: number }>("json")).resolves.toEqual({ value: 42 });
    await expect(client.get<string>("text")).resolves.toBe("healthy");
    await expect(client.delete<void>("empty")).resolves.toBeUndefined();
  });

  it("does not retry a response parsing failure", async () => {
    const fetchImplementation = vi.fn<FetchFunction>().mockResolvedValue(
      new Response("not-json", {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createClient(fetchImplementation);

    await expect(client.get("invalid-json")).rejects.toBeInstanceOf(SyntaxError);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});

describe("ApiError compatibility", () => {
  it.each([
    [JSON.stringify({ error: { message: "nested Bamboo error" } }), "nested Bamboo error"],
    [JSON.stringify({ error: "direct Bamboo error" }), "direct Bamboo error"],
    [JSON.stringify({ message: "message field" }), "message field"],
    [JSON.stringify({ detail: "detail field" }), "detail field"],
    ["raw backend error", "raw backend error"],
  ])("preserves nested, direct, and raw error-body parsing", async (body, expectedMessage) => {
    const fetchImplementation = vi.fn<FetchFunction>().mockResolvedValue(
      new Response(body, {
        status: 500,
        statusText: "Internal Server Error",
        headers: { "content-type": "application/json" },
      }),
    );
    const client = createClient(fetchImplementation);

    const failure = await client.post("mutate", {}).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      kind: "http",
      status: 500,
      statusText: "Internal Server Error",
      body,
      message: expectedMessage,
    });
    expect(isApiError(failure)).toBe(true);
    expect(isRequestError(failure)).toBe(true);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("keeps status-based user messages and server 5xx details", () => {
    expect(getErrorMessage(new ApiError("missing", 404, "Not Found"))).toBe(
      "The requested resource was not found.",
    );
    expect(getErrorMessage(new ApiError("backend detail", 503, "Unavailable"))).toBe(
      "backend detail",
    );
  });

  it("preserves caller cancellation while reading a non-2xx response body", async () => {
    const caller = new AbortController();
    const cancelBody = vi.fn();
    const fetchImplementation = vi.fn<FetchFunction>().mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
        status: 400,
        statusText: "Bad Request",
      }),
    );
    const client = createClient(fetchImplementation);

    const outcome = client
      .post("mutate", {}, { signal: caller.signal })
      .catch((error: unknown) => error);
    await flushMicrotasks();
    caller.abort(new DOMException("caller stopped", "AbortError"));

    await expect(outcome).resolves.toBeInstanceOf(RequestCancelledError);
    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("preserves a caller-owned timeout while reading a non-2xx response body", async () => {
    const cancelBody = vi.fn();
    const fetchImplementation = vi.fn<FetchFunction>().mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
        status: 400,
        statusText: "Bad Request",
      }),
    );
    const client = createClient(fetchImplementation);

    const failure = await client
      .post("mutate", {}, { signal: AbortSignal.timeout(5) })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(RequestTimeoutError);
    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("preserves the logical deadline while reading a non-2xx response body", async () => {
    vi.useFakeTimers();
    const cancelBody = vi.fn();
    const fetchImplementation = vi.fn<FetchFunction>().mockResolvedValue(
      new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
        status: 400,
        statusText: "Bad Request",
      }),
    );
    const client = createClient(fetchImplementation, { logicalTimeoutMs: 20 });

    const outcome = client.post("mutate", {}).catch((error: unknown) => error);
    await flushMicrotasks();
    await vi.advanceTimersByTimeAsync(20);

    await expect(outcome).resolves.toBeInstanceOf(RequestTimeoutError);
    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a network body failure after non-2xx response headers", async () => {
    const cause = new Error("socket closed while reading the error body");
    const fetchImplementation = vi.fn<FetchFunction>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(cause);
          },
        }),
        { status: 400, statusText: "Bad Request" },
      ),
    );
    const client = createClient(fetchImplementation);

    const failure = await client.post("mutate", {}).catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NetworkRequestError);
    if (!(failure instanceof NetworkRequestError)) throw failure;
    expect(failure.cause).toBe(cause);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });
});

describe("ApiClient raw response compatibility", () => {
  it("routes fetchRaw through the injected transport with runtime credentials", async () => {
    const response = new Response("stream", { status: 200 });
    const fetchImplementation = vi.fn<FetchFunction>().mockResolvedValue(response);
    const client = createClient(fetchImplementation);

    const rawResponse = await client.fetchRaw("stream", {
      method: "HEAD",
      headers: { "x-stream": "1" },
    });
    await expect(rawResponse.text()).resolves.toBe("stream");

    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImplementation.mock.calls[0];
    expect(url).toBe("https://api.example:9443/v1/stream");
    expect(init?.method).toBe("HEAD");
    expect(init?.credentials).toBe("include");
    expect(new Headers(init?.headers).get("x-stream")).toBe("1");
  });

  it("honors pre-aborted caller cancellation with zero raw fetches", async () => {
    const caller = new AbortController();
    caller.abort();
    const fetchImplementation = vi.fn<FetchFunction>();
    const client = createClient(fetchImplementation);

    await expect(client.fetchRaw("stream", { signal: caller.signal })).rejects.toBeInstanceOf(
      RequestCancelledError,
    );
    expect(fetchImplementation).not.toHaveBeenCalled();
  });

  it("keeps caller cancellation attached after headers until the raw body closes", async () => {
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    const cancelBody = vi.fn();
    let transportSignal: AbortSignal | null | undefined;
    const fetchImplementation = vi.fn<FetchFunction>((_input, init) => {
      transportSignal = init?.signal;
      return Promise.resolve(
        new Response(
          new ReadableStream<Uint8Array>({
            cancel: cancelBody,
          }),
          { status: 200 },
        ),
      );
    });
    const client = createClient(fetchImplementation);

    const response = await client.fetchRaw("stream", { signal: caller.signal });
    const bodyRead = response.text();
    expect(transportSignal?.aborted).toBe(false);

    caller.abort();

    await expect(bodyRead).rejects.toBeInstanceOf(RequestCancelledError);
    expect(transportSignal?.aborted).toBe(true);
    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
  });

  it("classifies a raw body transport failure after headers without retrying", async () => {
    const cause = new Error("socket closed while reading");
    const fetchImplementation = vi.fn<FetchFunction>().mockResolvedValue(
      new Response(
        new ReadableStream<Uint8Array>({
          start(controller) {
            controller.error(cause);
          },
        }),
        { status: 200 },
      ),
    );
    const client = createClient(fetchImplementation);

    const response = await client.fetchRaw("stream");
    const failure = await response.text().catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(NetworkRequestError);
    if (!(failure instanceof NetworkRequestError)) throw failure;
    expect(failure.cause).toBe(cause);
    expect(isRequestError(failure)).toBe(true);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("cleans caller forwarding when a raw response consumer cancels the body", async () => {
    const caller = new AbortController();
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    const cancelBody = vi.fn();
    let transportSignal: AbortSignal | null | undefined;
    const fetchImplementation = vi.fn<FetchFunction>((_input, init) => {
      transportSignal = init?.signal;
      return Promise.resolve(
        new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
          status: 200,
        }),
      );
    });
    const client = createClient(fetchImplementation);

    const response = await client.fetchRaw("stream", { signal: caller.signal });
    await response.body?.cancel("consumer closed");

    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    caller.abort();
    expect(transportSignal?.aborted).toBe(false);
  });

  it("never retries a raw network failure", async () => {
    const fetchImplementation = vi
      .fn<FetchFunction>()
      .mockRejectedValue(new Error("stream disconnected"));
    const client = createClient(fetchImplementation);

    await expect(client.fetchRaw("stream")).rejects.toBeInstanceOf(NetworkRequestError);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("never retries a raw transient response and preserves compatible ApiError fields", async () => {
    vi.useFakeTimers();
    const caller = new AbortController();
    const addListener = vi.spyOn(caller.signal, "addEventListener");
    const removeListener = vi.spyOn(caller.signal, "removeEventListener");
    const cancelBody = vi.fn(() => new Promise<void>(() => undefined));
    let transportSignal: AbortSignal | null | undefined;
    const fetchImplementation = vi.fn<FetchFunction>((_input, init) => {
      transportSignal = init?.signal;
      return Promise.resolve(
        new Response(new ReadableStream<Uint8Array>({ cancel: cancelBody }), {
          status: 503,
          statusText: "Service Unavailable",
        }),
      );
    });
    const client = createClient(fetchImplementation);

    const failure = await client
      .fetchRaw("stream", { signal: caller.signal })
      .catch((error: unknown) => error);

    expect(failure).toBeInstanceOf(ApiError);
    expect(failure).toMatchObject({
      status: 503,
      statusText: "Service Unavailable",
      body: undefined,
      message: "API request failed: Service Unavailable",
    });
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
    expect(cancelBody).toHaveBeenCalledTimes(1);
    expect(addListener).toHaveBeenCalledWith("abort", expect.any(Function), { once: true });
    expect(removeListener).toHaveBeenCalledWith("abort", expect.any(Function));
    expect(vi.getTimerCount()).toBe(0);

    caller.abort();
    expect(transportSignal?.aborted).toBe(false);
  });
});

describe("request error messages", () => {
  it("returns stable actionable messages for timeout, cancellation, and network failure", () => {
    expect(getErrorMessage(new RequestTimeoutError())).toBe(
      "The request timed out. Please try again.",
    );
    expect(getErrorMessage(new RequestCancelledError())).toBe("The request was cancelled.");
    expect(getErrorMessage(new NetworkRequestError())).toBe(
      "A network error prevented the request. Check your connection and try again.",
    );
  });
});
