import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ApiError,
  NetworkRequestError,
  RequestCancelledError,
  RequestTimeoutError,
} from "../api/errors";

const apiMock = vi.hoisted(() => ({
  fetchRaw: vi.fn<(path: string, options?: RequestInit) => Promise<Response>>(),
  post: vi.fn<(path: string, data?: unknown, options?: RequestInit) => Promise<unknown>>(),
}));

vi.mock("../api", () => ({ apiClient: apiMock }));

import {
  classifyServerBootstrapDocument,
  requestServerBootstrap,
  verifyServerPassword,
} from "./serverBootstrap";

const exactFixture = () => ({
  schema_version: 1,
  server: {
    product: "bamboo",
    version: "0.0.0",
  },
  api: {
    name: "bamboo.agent",
    canonical_base_path: "/api/v1",
    min_version: 1,
    max_version: 1,
  },
  realtime: {
    name: "bamboo.v2",
    path: "/v2/stream",
    min_version: 2,
    max_version: 2,
    subprotocols: [
      { name: "bamboo.v2", encoding: "json" },
      { name: "bamboo.v2.msgpack", encoding: "messagepack" },
    ],
  },
  capabilities: [
    "auth.device_bearer.v1",
    "auth.password_cookie.v1",
    "auth.ws_device_hello.v1",
    "realtime.account_feed.v1",
    "realtime.agent_events.v1",
    "realtime.application_heartbeat.v1",
    "realtime.feed_cursor.v1",
    "realtime.feed_reset.v1",
    "realtime.stop_control.v1",
  ],
  auth: {
    policy: "open",
    request_state: "unauthenticated",
    password_enabled: false,
    device_auth_enabled: false,
    verify_path: "/api/v1/bamboo/access/verify",
    pair_path: "/v2/pair",
  },
});

type Fixture = ReturnType<typeof exactFixture>;

const jsonResponse = (value: unknown, contentType = "application/json; charset=utf-8") =>
  new Response(JSON.stringify(value), {
    status: 200,
    headers: { "Content-Type": contentType },
  });

const httpError = (status: number) => new ApiError("redacted", status, `HTTP ${status}`);

const withAuth = (
  policy: string,
  requestState: string,
  passwordEnabled: boolean,
  deviceAuthEnabled: boolean,
): Fixture => {
  const document = exactFixture();
  document.auth = {
    ...document.auth,
    policy,
    request_state: requestState,
    password_enabled: passwordEnabled,
    device_auth_enabled: deviceAuthEnabled,
  };
  return document;
};

beforeEach(() => {
  apiMock.fetchRaw.mockReset();
  apiMock.post.mockReset();
});

describe("Bamboo bootstrap document admission", () => {
  it("accepts the exact Bamboo #1040 fixture without deriving support from version 0.0.0", () => {
    expect(classifyServerBootstrapDocument(exactFixture())).toEqual({ kind: "ready" });
  });

  it("tolerates additive fields, capabilities, and unique well-formed subprotocols", () => {
    const document = exactFixture();
    Reflect.set(document, "future_top_level", { enabled: true });
    Reflect.set(document.server, "future_server_field", "value");
    document.capabilities.push("future.capability.v9");
    document.realtime.subprotocols.push({ name: "bamboo.v3.cbor", encoding: "cbor" });

    expect(classifyServerBootstrapDocument(document)).toEqual({ kind: "ready" });
  });

  it.each([
    ["open remote", "open", "unauthenticated", false, false, { kind: "ready" }],
    ["open local", "open", "local_bypass", false, false, { kind: "ready" }],
    [
      "password remote unauthenticated",
      "credential_required",
      "unauthenticated",
      true,
      false,
      { kind: "auth-required" },
    ],
    [
      "password remote authenticated",
      "credential_required",
      "authenticated",
      true,
      false,
      { kind: "ready" },
    ],
    [
      "password local bypass",
      "credential_required",
      "local_bypass",
      true,
      false,
      { kind: "ready" },
    ],
    [
      "password and device remote unauthenticated",
      "credential_required",
      "unauthenticated",
      true,
      true,
      { kind: "auth-required" },
    ],
    [
      "password and device remote authenticated",
      "credential_required",
      "authenticated",
      true,
      true,
      { kind: "ready" },
    ],
    [
      "device-only remote unauthenticated",
      "credential_required",
      "unauthenticated",
      false,
      true,
      { kind: "auth-unsupported", mechanism: "device" },
    ],
    [
      "device-only remote authenticated",
      "credential_required",
      "authenticated",
      false,
      true,
      { kind: "auth-unsupported", mechanism: "device" },
    ],
    [
      "device-only local bypass",
      "credential_required",
      "local_bypass",
      false,
      true,
      { kind: "ready" },
    ],
    [
      "repair remote",
      "repair_required",
      "unauthenticated",
      true,
      true,
      { kind: "repair" },
    ],
    [
      "repair local bypass",
      "repair_required",
      "local_bypass",
      true,
      true,
      { kind: "repair" },
    ],
  ])(
    "classifies the %s auth matrix",
    (_name, policy, requestState, passwordEnabled, deviceAuthEnabled, outcome) => {
      expect(
        classifyServerBootstrapDocument(
          withAuth(policy, requestState, passwordEnabled, deviceAuthEnabled),
        ),
      ).toEqual(outcome);
    },
  );

  it.each<[string, (document: Fixture) => void]>([
    ["open authenticated", (document) => (document.auth.request_state = "authenticated")],
    ["open with password", (document) => (document.auth.password_enabled = true)],
    ["open with device auth", (document) => (document.auth.device_auth_enabled = true)],
    [
      "credential-required without a mechanism",
      (document) => (document.auth.policy = "credential_required"),
    ],
    [
      "repair authenticated",
      (document) => {
        document.auth.policy = "repair_required";
        document.auth.request_state = "authenticated";
      },
    ],
  ])("rejects the impossible auth combination %s before admission", (_name, mutate) => {
    const document = exactFixture();
    mutate(document);
    expect(classifyServerBootstrapDocument(document)).toEqual({
      kind: "invalid",
      reason: "invalid-auth-combination",
    });
  });

  it.each([
    ["policy", "future_policy"],
    ["request_state", "future_state"],
  ])("rejects an unknown auth %s enum", (field, value) => {
    const document = exactFixture();
    Reflect.set(document.auth, field, value);
    expect(classifyServerBootstrapDocument(document)).toEqual({
      kind: "invalid",
      reason: "auth-enum",
    });
  });

  it.each([
    null,
    [],
    "not-an-object",
    { schema_version: 1 },
  ])("rejects a non-document shape %#", (value) => {
    expect(classifyServerBootstrapDocument(value)).toEqual({
      kind: "invalid",
      reason: "document-shape",
    });
  });

  it.each<[string, (document: Fixture) => void]>([
    ["missing server product", (document) => void Reflect.deleteProperty(document.server, "product")],
    ["empty server version", (document) => (document.server.version = "")],
    ["string API range", (document) => void Reflect.set(document.api, "min_version", "1")],
    ["non-string capability", (document) => void document.capabilities.push(1 as never)],
    [
      "malformed subprotocol",
      (document) => void document.realtime.subprotocols.push({ name: "future" } as never),
    ],
    ["non-boolean auth flag", (document) => void Reflect.set(document.auth, "password_enabled", 1)],
  ])("rejects a structurally invalid document with %s", (_name, mutate) => {
    const document = exactFixture();
    mutate(document);
    expect(classifyServerBootstrapDocument(document)).toEqual({
      kind: "invalid",
      reason: "document-shape",
    });
  });

  it.each([-1, 1.5, 0x1_0000_0000, Number.POSITIVE_INFINITY, Number.NaN])(
    "rejects non-u32 range value %s",
    (value) => {
      const document = exactFixture();
      document.api.min_version = value;
      expect(classifyServerBootstrapDocument(document)).toEqual({
        kind: "invalid",
        reason: "invalid-range",
      });
    },
  );

  it("rejects a non-u32 schema version before treating it as a compatible-version mismatch", () => {
    const document = exactFixture();
    document.schema_version = -1;
    expect(classifyServerBootstrapDocument(document)).toEqual({
      kind: "invalid",
      reason: "invalid-range",
    });
  });

  it.each(["api", "realtime"])("rejects a reversed %s range", (range) => {
    const document = exactFixture();
    const target = range === "api" ? document.api : document.realtime;
    target.min_version = 3;
    target.max_version = 2;
    expect(classifyServerBootstrapDocument(document)).toEqual({
      kind: "invalid",
      reason: "invalid-range",
    });
  });

  it("rejects duplicate capabilities before checking whether required capabilities exist", () => {
    const document = exactFixture();
    document.capabilities.push(document.capabilities[0]);
    expect(classifyServerBootstrapDocument(document)).toEqual({
      kind: "invalid",
      reason: "duplicate-capability",
    });
  });

  it("rejects duplicate subprotocol names even when their encodings differ", () => {
    const document = exactFixture();
    document.realtime.subprotocols.push({ name: "bamboo.v2", encoding: "future" });
    expect(classifyServerBootstrapDocument(document)).toEqual({
      kind: "invalid",
      reason: "duplicate-subprotocol",
    });
  });

  it.each<[string, (document: Fixture) => void, string]>([
    ["schema version", (document) => (document.schema_version = 2), "schema-version"],
    ["server product", (document) => (document.server.product = "not-bamboo"), "server-product"],
    ["API identity", (document) => (document.api.name = "legacy"), "api-contract"],
    ["API path", (document) => (document.api.canonical_base_path = "/v1"), "api-contract"],
    [
      "API range",
      (document) => {
        document.api.min_version = 2;
        document.api.max_version = 3;
      },
      "api-contract",
    ],
    ["realtime identity", (document) => (document.realtime.name = "legacy"), "realtime-contract"],
    ["realtime path", (document) => (document.realtime.path = "/events"), "realtime-contract"],
    [
      "realtime range",
      (document) => {
        document.realtime.min_version = 3;
        document.realtime.max_version = 4;
      },
      "realtime-contract",
    ],
  ])("classifies a valid but unsupported %s as incompatible", (_name, mutate, reason) => {
    const document = exactFixture();
    mutate(document);
    expect(classifyServerBootstrapDocument(document)).toEqual({
      kind: "incompatible",
      reason,
    });
  });

  it.each([
    "realtime.account_feed.v1",
    "realtime.agent_events.v1",
    "realtime.application_heartbeat.v1",
    "realtime.feed_cursor.v1",
    "realtime.feed_reset.v1",
    "realtime.stop_control.v1",
  ])("rejects a contract missing required capability %s", (capability) => {
    const document = exactFixture();
    document.capabilities = document.capabilities.filter((item) => item !== capability);
    expect(classifyServerBootstrapDocument(document)).toEqual({
      kind: "incompatible",
      reason: "missing-capability",
    });
  });

  it.each(["missing", "wrong-encoding"])("rejects the %s required JSON subprotocol", (mode) => {
    const document = exactFixture();
    if (mode === "missing") {
      document.realtime.subprotocols = document.realtime.subprotocols.filter(
        ({ name }) => name !== "bamboo.v2",
      );
    } else {
      document.realtime.subprotocols[0].encoding = "messagepack";
    }
    expect(classifyServerBootstrapDocument(document)).toEqual({
      kind: "incompatible",
      reason: "realtime-contract",
    });
  });

  it.each<[string, (document: Fixture) => void]>([
    [
      "password capability",
      (document) => {
        document.capabilities = document.capabilities.filter(
          (item) => item !== "auth.password_cookie.v1",
        );
      },
    ],
    [
      "password verify path",
      (document) => {
        document.auth.verify_path = "/v1/bamboo/access/verify";
      },
    ],
  ])("rejects an enabled password mechanism with the wrong %s", (_name, mutate) => {
    const document = withAuth("credential_required", "unauthenticated", true, false);
    mutate(document);
    expect(classifyServerBootstrapDocument(document)).toEqual({
      kind: "incompatible",
      reason: "password-contract",
    });
  });

  it("does not require the password contract when the mechanism is disabled", () => {
    const document = exactFixture();
    document.capabilities = document.capabilities.filter(
      (item) => item !== "auth.password_cookie.v1",
    );
    document.auth.verify_path = "/future/verify";
    expect(classifyServerBootstrapDocument(document)).toEqual({ kind: "ready" });
  });

  it.each<[string, (document: Fixture) => void]>([
    [
      "device capability",
      (document) => {
        document.capabilities = document.capabilities.filter(
          (item) => item !== "auth.device_bearer.v1",
        );
      },
    ],
    [
      "device pair path",
      (document) => {
        document.auth.pair_path = "/future/pair";
      },
    ],
  ])("rejects an enabled device mechanism with the wrong %s", (_name, mutate) => {
    const document = withAuth("credential_required", "unauthenticated", false, true);
    mutate(document);
    expect(classifyServerBootstrapDocument(document)).toEqual({
      kind: "incompatible",
      reason: "device-contract",
    });
  });
});

describe("canonical bootstrap HTTP request", () => {
  it("uses one requestOnce-backed raw GET with the caller signal and no-store cache", async () => {
    const controller = new AbortController();
    apiMock.fetchRaw.mockResolvedValueOnce(jsonResponse(exactFixture()));

    await expect(requestServerBootstrap(controller.signal)).resolves.toEqual({ kind: "ready" });
    expect(apiMock.fetchRaw).toHaveBeenCalledTimes(1);
    expect(apiMock.fetchRaw).toHaveBeenCalledWith("bootstrap", {
      method: "GET",
      signal: controller.signal,
      cache: "no-store",
    });
  });

  it("accepts a structured-suffix JSON media type", async () => {
    apiMock.fetchRaw.mockResolvedValueOnce(
      jsonResponse(exactFixture(), "application/vnd.bamboo.bootstrap+json"),
    );
    await expect(requestServerBootstrap(new AbortController().signal)).resolves.toEqual({
      kind: "ready",
    });
  });

  it.each([null, "text/plain", "text/html; charset=utf-8"])(
    "rejects non-JSON content type %s without parsing",
    async (contentType) => {
      const headers = new Headers();
      if (contentType) headers.set("Content-Type", contentType);
      const response = new Response(contentType ? JSON.stringify(exactFixture()) : null, {
        status: 200,
        headers,
      });
      const json = vi.spyOn(response, "json");
      apiMock.fetchRaw.mockResolvedValueOnce(response);

      await expect(requestServerBootstrap(new AbortController().signal)).resolves.toEqual({
        kind: "invalid",
        reason: "content-type",
      });
      expect(json).not.toHaveBeenCalled();
    },
  );

  it("classifies malformed JSON as invalid", async () => {
    apiMock.fetchRaw.mockResolvedValueOnce(
      new Response("{not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      }),
    );
    await expect(requestServerBootstrap(new AbortController().signal)).resolves.toEqual({
      kind: "invalid",
      reason: "malformed-json",
    });
  });

  it.each([
    [404, { kind: "missing" }],
    [408, { kind: "unavailable", reason: "http-status", status: 408 }],
    [429, { kind: "unavailable", reason: "http-status", status: 429 }],
    [500, { kind: "unavailable", reason: "http-status", status: 500 }],
    [501, { kind: "unavailable", reason: "http-status", status: 501 }],
    [502, { kind: "unavailable", reason: "http-status", status: 502 }],
    [503, { kind: "unavailable", reason: "http-status", status: 503 }],
    [504, { kind: "unavailable", reason: "http-status", status: 504 }],
    [599, { kind: "unavailable", reason: "http-status", status: 599 }],
    [600, { kind: "incompatible", reason: "http-status", status: 600 }],
    [400, { kind: "incompatible", reason: "http-status", status: 400 }],
    [401, { kind: "incompatible", reason: "http-status", status: 401 }],
    [403, { kind: "incompatible", reason: "http-status", status: 403 }],
    [405, { kind: "incompatible", reason: "http-status", status: 405 }],
    [422, { kind: "incompatible", reason: "http-status", status: 422 }],
  ])("classifies HTTP %i without retrying", async (status, outcome) => {
    apiMock.fetchRaw.mockRejectedValueOnce(httpError(status));
    await expect(requestServerBootstrap(new AbortController().signal)).resolves.toEqual(outcome);
    expect(apiMock.fetchRaw).toHaveBeenCalledTimes(1);
  });

  it.each([
    [new NetworkRequestError(), { kind: "unavailable", reason: "network" }],
    [new RequestTimeoutError(), { kind: "unavailable", reason: "timeout" }],
  ])("classifies a typed transport failure without exposing it", async (error, outcome) => {
    apiMock.fetchRaw.mockRejectedValueOnce(error);
    await expect(requestServerBootstrap(new AbortController().signal)).resolves.toEqual(outcome);
  });

  it("keeps body-read transport timeouts retryable", async () => {
    apiMock.fetchRaw.mockResolvedValueOnce({
      headers: new Headers({ "Content-Type": "application/json" }),
      json: vi.fn().mockRejectedValue(new RequestTimeoutError()),
    } as unknown as Response);
    await expect(requestServerBootstrap(new AbortController().signal)).resolves.toEqual({
      kind: "unavailable",
      reason: "timeout",
    });
  });

  it("keeps body-read network failures retryable", async () => {
    apiMock.fetchRaw.mockResolvedValueOnce({
      headers: new Headers({ "Content-Type": "application/json" }),
      json: vi.fn().mockRejectedValue(new NetworkRequestError()),
    } as unknown as Response);
    await expect(requestServerBootstrap(new AbortController().signal)).resolves.toEqual({
      kind: "unavailable",
      reason: "network",
    });
  });

  it("rejects body-read cancellation instead of rendering it", async () => {
    const cancellation = new RequestCancelledError();
    apiMock.fetchRaw.mockResolvedValueOnce({
      headers: new Headers({ "Content-Type": "application/json" }),
      json: vi.fn().mockRejectedValue(cancellation),
    } as unknown as Response);
    await expect(requestServerBootstrap(new AbortController().signal)).rejects.toBe(cancellation);
  });

  it("rejects caller cancellation instead of producing a renderable outcome", async () => {
    const cancellation = new RequestCancelledError();
    apiMock.fetchRaw.mockRejectedValueOnce(cancellation);
    await expect(requestServerBootstrap(new AbortController().signal)).rejects.toBe(cancellation);
  });

  it("rejects cancellation after raw headers arrive before classifying content type", async () => {
    const controller = new AbortController();
    apiMock.fetchRaw.mockImplementationOnce(async () => {
      controller.abort(new DOMException("cancelled", "AbortError"));
      return new Response("not-json", {
        status: 200,
        headers: { "Content-Type": "text/plain" },
      });
    });

    await expect(requestServerBootstrap(controller.signal)).rejects.toBeInstanceOf(
      RequestCancelledError,
    );
  });

  it("rejects cancellation during JSON reading before classifying the decoded document", async () => {
    const controller = new AbortController();
    apiMock.fetchRaw.mockResolvedValueOnce({
      headers: new Headers({ "Content-Type": "application/json" }),
      json: vi.fn(async () => {
        controller.abort(new DOMException("cancelled", "AbortError"));
        return exactFixture();
      }),
    } as unknown as Response);

    await expect(requestServerBootstrap(controller.signal)).rejects.toBeInstanceOf(
      RequestCancelledError,
    );
  });

  it("normalizes an untyped abort failure to the stable cancellation error", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    apiMock.fetchRaw.mockRejectedValueOnce(controller.signal.reason);
    await expect(requestServerBootstrap(controller.signal)).rejects.toBeInstanceOf(
      RequestCancelledError,
    );
  });
});

describe("canonical password verification", () => {
  it("posts once to the canonical relative route and accepts only the exact success envelope", async () => {
    const controller = new AbortController();
    apiMock.post.mockResolvedValueOnce({ success: true });

    await expect(verifyServerPassword(" secret ", controller.signal)).resolves.toEqual({
      kind: "verified",
    });
    expect(apiMock.post).toHaveBeenCalledTimes(1);
    expect(apiMock.post).toHaveBeenCalledWith(
      "bamboo/access/verify",
      { password: " secret " },
      { signal: controller.signal },
    );
  });

  it.each([
    null,
    true,
    {},
    { success: false },
    { success: "true" },
    { success: true, future: true },
  ])("rejects invalid password success response %#", async (value) => {
    apiMock.post.mockResolvedValueOnce(value);
    await expect(verifyServerPassword("secret", new AbortController().signal)).resolves.toEqual({
      kind: "contract-error",
      reason: "invalid-response",
    });
  });

  it("classifies a real malformed 200 JSON decode rejection as an invalid response contract", async () => {
    apiMock.post.mockImplementationOnce(async () => {
      const response = new Response("{not-json", {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
      return response.json();
    });

    await expect(verifyServerPassword("secret", new AbortController().signal)).resolves.toEqual({
      kind: "contract-error",
      reason: "invalid-response",
    });
    expect(apiMock.post).toHaveBeenCalledTimes(1);
  });

  it("does not treat an unknown successful-response decode rejection as retryable", async () => {
    apiMock.post.mockRejectedValueOnce(new TypeError("invalid decoded response"));
    await expect(verifyServerPassword("secret", new AbortController().signal)).resolves.toEqual({
      kind: "contract-error",
      reason: "invalid-response",
    });
  });

  it.each([
    [401, { kind: "rejected" }],
    [429, { kind: "rate-limited" }],
    [500, { kind: "unavailable", reason: "http-status", status: 500 }],
    [501, { kind: "unavailable", reason: "http-status", status: 501 }],
    [599, { kind: "unavailable", reason: "http-status", status: 599 }],
    [600, { kind: "contract-error", reason: "http-status", status: 600 }],
    [400, { kind: "contract-error", reason: "http-status", status: 400 }],
    [403, { kind: "contract-error", reason: "http-status", status: 403 }],
    [408, { kind: "contract-error", reason: "http-status", status: 408 }],
    [422, { kind: "contract-error", reason: "http-status", status: 422 }],
  ])("classifies password HTTP %i without replaying the POST", async (status, outcome) => {
    apiMock.post.mockRejectedValueOnce(httpError(status));
    await expect(verifyServerPassword("secret", new AbortController().signal)).resolves.toEqual(
      outcome,
    );
    expect(apiMock.post).toHaveBeenCalledTimes(1);
  });

  it.each([
    [new NetworkRequestError(), { kind: "unavailable", reason: "network" }],
    [new RequestTimeoutError(), { kind: "unavailable", reason: "timeout" }],
  ])("classifies password transport failure without replaying", async (error, outcome) => {
    apiMock.post.mockRejectedValueOnce(error);
    await expect(verifyServerPassword("secret", new AbortController().signal)).resolves.toEqual(
      outcome,
    );
    expect(apiMock.post).toHaveBeenCalledTimes(1);
  });

  it("rejects password cancellation as lifecycle control", async () => {
    const cancellation = new RequestCancelledError();
    apiMock.post.mockRejectedValueOnce(cancellation);
    await expect(
      verifyServerPassword("secret", new AbortController().signal),
    ).rejects.toBe(cancellation);
    expect(apiMock.post).toHaveBeenCalledTimes(1);
  });

  it("normalizes an untyped password abort to the stable cancellation error", async () => {
    const controller = new AbortController();
    controller.abort(new DOMException("cancelled", "AbortError"));
    apiMock.post.mockRejectedValueOnce(controller.signal.reason);
    await expect(verifyServerPassword("secret", controller.signal)).rejects.toBeInstanceOf(
      RequestCancelledError,
    );
  });

  it("rejects cancellation that wins the race with a decoded password success", async () => {
    const controller = new AbortController();
    apiMock.post.mockImplementationOnce(async () => {
      controller.abort(new DOMException("cancelled", "AbortError"));
      return { success: true };
    });
    await expect(verifyServerPassword("secret", controller.signal)).rejects.toBeInstanceOf(
      RequestCancelledError,
    );
  });
});
