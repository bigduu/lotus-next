import { apiClient } from "../api";
import {
  ApiError,
  NetworkRequestError,
  RequestCancelledError,
  RequestTimeoutError,
} from "../api/errors";

const BOOTSTRAP_RELATIVE_PATH = "bootstrap";
const PASSWORD_VERIFY_RELATIVE_PATH = "bamboo/access/verify";

const EXPECTED_SCHEMA_VERSION = 1;
const EXPECTED_SERVER_PRODUCT = "bamboo";
const EXPECTED_API_NAME = "bamboo.agent";
const EXPECTED_API_BASE_PATH = "/api/v1";
const SUPPORTED_API_VERSION = 1;
const EXPECTED_REALTIME_NAME = "bamboo.v2";
const EXPECTED_REALTIME_PATH = "/v2/stream";
const SUPPORTED_REALTIME_VERSION = 2;
const EXPECTED_JSON_SUBPROTOCOL = "bamboo.v2";
const EXPECTED_PASSWORD_VERIFY_PATH = "/api/v1/bamboo/access/verify";
const EXPECTED_DEVICE_PAIR_PATH = "/v2/pair";
const MAX_U32 = 0xffff_ffff;

const REQUIRED_REALTIME_CAPABILITIES = [
  "realtime.account_feed.v1",
  "realtime.agent_events.v1",
  "realtime.application_heartbeat.v1",
  "realtime.feed_cursor.v1",
  "realtime.feed_reset.v1",
  "realtime.stop_control.v1",
] as const;

const PASSWORD_CAPABILITY = "auth.password_cookie.v1";
const DEVICE_CAPABILITY = "auth.device_bearer.v1";

export type BootstrapAuthPolicy = "open" | "credential_required" | "repair_required";
export type BootstrapRequestState = "local_bypass" | "authenticated" | "unauthenticated";

export interface BootstrapDocument {
  readonly schema_version: number;
  readonly server: {
    readonly product: string;
    readonly version: string;
  };
  readonly api: {
    readonly name: string;
    readonly canonical_base_path: string;
    readonly min_version: number;
    readonly max_version: number;
  };
  readonly realtime: {
    readonly name: string;
    readonly path: string;
    readonly min_version: number;
    readonly max_version: number;
    readonly subprotocols: readonly {
      readonly name: string;
      readonly encoding: string;
    }[];
  };
  readonly capabilities: readonly string[];
  readonly auth: {
    readonly policy: BootstrapAuthPolicy;
    readonly request_state: BootstrapRequestState;
    readonly password_enabled: boolean;
    readonly device_auth_enabled: boolean;
    readonly verify_path: string;
    readonly pair_path: string;
  };
}

export type BootstrapInvalidReason =
  | "content-type"
  | "malformed-json"
  | "document-shape"
  | "auth-enum"
  | "invalid-range"
  | "duplicate-capability"
  | "duplicate-subprotocol"
  | "invalid-auth-combination";

export type BootstrapIncompatibleReason =
  | "http-status"
  | "schema-version"
  | "server-product"
  | "api-contract"
  | "realtime-contract"
  | "missing-capability"
  | "password-contract"
  | "device-contract";

export type BootstrapUnavailableReason = "network" | "timeout" | "http-status";

export type BootstrapOutcome =
  | { readonly kind: "ready" }
  | { readonly kind: "missing" }
  | { readonly kind: "invalid"; readonly reason: BootstrapInvalidReason }
  | {
      readonly kind: "incompatible";
      readonly reason: BootstrapIncompatibleReason;
      readonly status?: number;
    }
  | { readonly kind: "auth-required" }
  | { readonly kind: "auth-unsupported"; readonly mechanism: "device" }
  | { readonly kind: "repair" }
  | {
      readonly kind: "unavailable";
      readonly reason: BootstrapUnavailableReason;
      readonly status?: number;
    };

export type PasswordUnavailableReason = "network" | "timeout" | "http-status";
export type PasswordContractErrorReason = "http-status" | "invalid-response";

export type PasswordVerificationOutcome =
  | { readonly kind: "verified" }
  | { readonly kind: "rejected" }
  | { readonly kind: "rate-limited" }
  | {
      readonly kind: "unavailable";
      readonly reason: PasswordUnavailableReason;
      readonly status?: number;
    }
  | {
      readonly kind: "contract-error";
      readonly reason: PasswordContractErrorReason;
      readonly status?: number;
    };

type InvalidDocument = {
  readonly ok: false;
  readonly reason: BootstrapInvalidReason;
};

type ParsedDocument = {
  readonly ok: true;
  readonly document: BootstrapDocument;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0;

const isU32 = (value: number): boolean =>
  Number.isInteger(value) && value >= 0 && value <= MAX_U32;

const isAuthPolicy = (value: unknown): value is BootstrapAuthPolicy =>
  value === "open" || value === "credential_required" || value === "repair_required";

const isRequestState = (value: unknown): value is BootstrapRequestState =>
  value === "local_bypass" || value === "authenticated" || value === "unauthenticated";

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw new RequestCancelledError(signal.reason);
}

function parseDocument(value: unknown): ParsedDocument | InvalidDocument {
  if (!isRecord(value)) return { ok: false, reason: "document-shape" };

  const server = value.server;
  const api = value.api;
  const realtime = value.realtime;
  const auth = value.auth;
  const capabilities = value.capabilities;

  if (
    typeof value.schema_version !== "number" ||
    !isRecord(server) ||
    !isRecord(api) ||
    !isRecord(realtime) ||
    !isRecord(auth) ||
    !Array.isArray(capabilities) ||
    !isNonEmptyString(server.product) ||
    !isNonEmptyString(server.version) ||
    !isNonEmptyString(api.name) ||
    !isNonEmptyString(api.canonical_base_path) ||
    typeof api.min_version !== "number" ||
    typeof api.max_version !== "number" ||
    !isNonEmptyString(realtime.name) ||
    !isNonEmptyString(realtime.path) ||
    typeof realtime.min_version !== "number" ||
    typeof realtime.max_version !== "number" ||
    !Array.isArray(realtime.subprotocols) ||
    typeof auth.password_enabled !== "boolean" ||
    typeof auth.device_auth_enabled !== "boolean" ||
    !isNonEmptyString(auth.verify_path) ||
    !isNonEmptyString(auth.pair_path)
  ) {
    return { ok: false, reason: "document-shape" };
  }

  if (!isAuthPolicy(auth.policy) || !isRequestState(auth.request_state)) {
    return { ok: false, reason: "auth-enum" };
  }

  if (!capabilities.every(isNonEmptyString)) {
    return { ok: false, reason: "document-shape" };
  }

  const subprotocols: Array<{ name: string; encoding: string }> = [];
  for (const subprotocol of realtime.subprotocols) {
    if (
      !isRecord(subprotocol) ||
      !isNonEmptyString(subprotocol.name) ||
      !isNonEmptyString(subprotocol.encoding)
    ) {
      return { ok: false, reason: "document-shape" };
    }
    subprotocols.push({ name: subprotocol.name, encoding: subprotocol.encoding });
  }

  return {
    ok: true,
    document: {
      schema_version: value.schema_version,
      server: {
        product: server.product,
        version: server.version,
      },
      api: {
        name: api.name,
        canonical_base_path: api.canonical_base_path,
        min_version: api.min_version,
        max_version: api.max_version,
      },
      realtime: {
        name: realtime.name,
        path: realtime.path,
        min_version: realtime.min_version,
        max_version: realtime.max_version,
        subprotocols,
      },
      capabilities: [...capabilities],
      auth: {
        policy: auth.policy,
        request_state: auth.request_state,
        password_enabled: auth.password_enabled,
        device_auth_enabled: auth.device_auth_enabled,
        verify_path: auth.verify_path,
        pair_path: auth.pair_path,
      },
    },
  };
}

function validateInternalSemantics(document: BootstrapDocument): BootstrapInvalidReason | null {
  const numbers = [
    document.schema_version,
    document.api.min_version,
    document.api.max_version,
    document.realtime.min_version,
    document.realtime.max_version,
  ];
  if (!numbers.every(isU32)) return "invalid-range";
  if (
    document.api.min_version > document.api.max_version ||
    document.realtime.min_version > document.realtime.max_version
  ) {
    return "invalid-range";
  }

  if (new Set(document.capabilities).size !== document.capabilities.length) {
    return "duplicate-capability";
  }
  const subprotocolNames = document.realtime.subprotocols.map(({ name }) => name);
  if (new Set(subprotocolNames).size !== subprotocolNames.length) {
    return "duplicate-subprotocol";
  }

  const { policy, request_state, password_enabled, device_auth_enabled } = document.auth;
  if (
    (policy === "open" &&
      (request_state === "authenticated" || password_enabled || device_auth_enabled)) ||
    (policy === "credential_required" && !password_enabled && !device_auth_enabled) ||
    (policy === "repair_required" && request_state === "authenticated")
  ) {
    return "invalid-auth-combination";
  }

  return null;
}

function rangeContains(minimum: number, maximum: number, supported: number): boolean {
  return minimum <= supported && supported <= maximum;
}

/** Classify an already decoded bootstrap value without trusting its shape. */
export function classifyServerBootstrapDocument(value: unknown): BootstrapOutcome {
  const parsed = parseDocument(value);
  if (!parsed.ok) return { kind: "invalid", reason: parsed.reason };

  const document = parsed.document;
  const invalidReason = validateInternalSemantics(document);
  if (invalidReason) return { kind: "invalid", reason: invalidReason };

  if (document.schema_version !== EXPECTED_SCHEMA_VERSION) {
    return { kind: "incompatible", reason: "schema-version" };
  }
  if (document.server.product !== EXPECTED_SERVER_PRODUCT) {
    return { kind: "incompatible", reason: "server-product" };
  }
  if (
    document.api.name !== EXPECTED_API_NAME ||
    document.api.canonical_base_path !== EXPECTED_API_BASE_PATH ||
    !rangeContains(document.api.min_version, document.api.max_version, SUPPORTED_API_VERSION)
  ) {
    return { kind: "incompatible", reason: "api-contract" };
  }
  if (
    document.realtime.name !== EXPECTED_REALTIME_NAME ||
    document.realtime.path !== EXPECTED_REALTIME_PATH ||
    !rangeContains(
      document.realtime.min_version,
      document.realtime.max_version,
      SUPPORTED_REALTIME_VERSION,
    ) ||
    !document.realtime.subprotocols.some(
      ({ name, encoding }) => name === EXPECTED_JSON_SUBPROTOCOL && encoding === "json",
    )
  ) {
    return { kind: "incompatible", reason: "realtime-contract" };
  }

  const capabilities = new Set(document.capabilities);
  if (REQUIRED_REALTIME_CAPABILITIES.some((capability) => !capabilities.has(capability))) {
    return { kind: "incompatible", reason: "missing-capability" };
  }
  if (
    document.auth.password_enabled &&
    (!capabilities.has(PASSWORD_CAPABILITY) ||
      document.auth.verify_path !== EXPECTED_PASSWORD_VERIFY_PATH)
  ) {
    return { kind: "incompatible", reason: "password-contract" };
  }
  if (
    document.auth.device_auth_enabled &&
    (!capabilities.has(DEVICE_CAPABILITY) || document.auth.pair_path !== EXPECTED_DEVICE_PAIR_PATH)
  ) {
    return { kind: "incompatible", reason: "device-contract" };
  }

  if (document.auth.policy === "repair_required") return { kind: "repair" };
  if (document.auth.request_state === "local_bypass") return { kind: "ready" };
  if (document.auth.policy === "open") return { kind: "ready" };
  if (!document.auth.password_enabled) {
    return { kind: "auth-unsupported", mechanism: "device" };
  }
  return document.auth.request_state === "authenticated"
    ? { kind: "ready" }
    : { kind: "auth-required" };
}

function isJsonContentType(value: string | null): boolean {
  if (!value) return false;
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase();
  return (
    mediaType === "application/json" ||
    Boolean(mediaType?.startsWith("application/") && mediaType.endsWith("+json"))
  );
}

function bootstrapFailure(error: unknown, signal: AbortSignal): BootstrapOutcome {
  if (error instanceof RequestCancelledError) throw error;
  if (error instanceof RequestTimeoutError) return { kind: "unavailable", reason: "timeout" };
  if (signal.aborted) throw new RequestCancelledError(signal.reason ?? error);
  if (error instanceof NetworkRequestError) return { kind: "unavailable", reason: "network" };
  if (error instanceof ApiError) {
    if (error.status === 404) return { kind: "missing" };
    if (
      error.status === 408 ||
      error.status === 429 ||
      (error.status >= 500 && error.status <= 599)
    ) {
      return { kind: "unavailable", reason: "http-status", status: error.status };
    }
    return { kind: "incompatible", reason: "http-status", status: error.status };
  }
  return { kind: "unavailable", reason: "network" };
}

/** Perform exactly one canonical bootstrap request. Root owns all retry policy. */
export async function requestServerBootstrap(signal: AbortSignal): Promise<BootstrapOutcome> {
  throwIfCancelled(signal);

  let response: Response;
  try {
    response = await apiClient.fetchRaw(BOOTSTRAP_RELATIVE_PATH, {
      method: "GET",
      signal,
      cache: "no-store",
    });
  } catch (error) {
    return bootstrapFailure(error, signal);
  }

  throwIfCancelled(signal);
  if (!isJsonContentType(response.headers.get("content-type"))) {
    const cancellation = response.body?.cancel();
    if (cancellation) void cancellation.catch(() => undefined);
    return { kind: "invalid", reason: "content-type" };
  }

  let value: unknown;
  try {
    value = await response.json();
  } catch (error) {
    if (
      error instanceof RequestCancelledError ||
      error instanceof RequestTimeoutError ||
      error instanceof NetworkRequestError ||
      signal.aborted
    ) {
      return bootstrapFailure(error, signal);
    }
    return { kind: "invalid", reason: "malformed-json" };
  }

  throwIfCancelled(signal);
  return classifyServerBootstrapDocument(value);
}

function passwordFailure(error: unknown, signal: AbortSignal): PasswordVerificationOutcome {
  if (error instanceof RequestCancelledError) throw error;
  if (error instanceof RequestTimeoutError) return { kind: "unavailable", reason: "timeout" };
  if (signal.aborted) throw new RequestCancelledError(signal.reason ?? error);
  if (error instanceof NetworkRequestError) return { kind: "unavailable", reason: "network" };
  if (error instanceof ApiError) {
    if (error.status === 401) return { kind: "rejected" };
    if (error.status === 429) return { kind: "rate-limited" };
    if (error.status >= 500 && error.status <= 599) {
      return { kind: "unavailable", reason: "http-status", status: error.status };
    }
    return { kind: "contract-error", reason: "http-status", status: error.status };
  }
  // HttpTransport normalizes network, timeout, and cancellation failures before
  // ApiClient parses a successful response. Any remaining rejection therefore
  // represents an invalid 2xx response/decode contract, not a retryable network
  // failure (for example, JSON.parse's SyntaxError on malformed JSON).
  return { kind: "contract-error", reason: "invalid-response" };
}

/** Verify once; a successful password still requires a fresh bootstrap request. */
export async function verifyServerPassword(
  password: string,
  signal: AbortSignal,
): Promise<PasswordVerificationOutcome> {
  throwIfCancelled(signal);

  let value: unknown;
  try {
    value = await apiClient.post<unknown>(
      PASSWORD_VERIFY_RELATIVE_PATH,
      { password },
      { signal },
    );
  } catch (error) {
    return passwordFailure(error, signal);
  }

  throwIfCancelled(signal);
  if (
    !isRecord(value) ||
    value.success !== true ||
    Object.keys(value).length !== 1 ||
    !Object.hasOwn(value, "success")
  ) {
    return { kind: "contract-error", reason: "invalid-response" };
  }
  return { kind: "verified" };
}
