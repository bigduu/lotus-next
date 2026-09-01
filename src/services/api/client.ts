/**
 * Unified HTTP API Client
 *
 * Owns canonical URL composition, request defaults, and response parsing while
 * delegating cancellation, deadlines, typed transport failures, and retries to
 * one injected HTTP transport.
 */

import { ApiError } from "./errors";
import type { HttpTransport } from "./transport";

export { ApiError, isApiError } from "./errors";

// === DEV-ONLY API REQUEST INSTRUMENTATION ===
// Enable with: localStorage.setItem('lotus_debug_api_requests', '1')

const AGENT_ENDPOINT_PATTERNS = [
  /\/api\/v1\/respond\/[^/]+\/pending/,
  /\/api\/v1\/sessions\/?$/,
  /\/api\/v1\/events\/[^/]+/,
];

let debugInstrumentationEnabled = false;

function shouldLogApiRequest(): boolean {
  return (
    debugInstrumentationEnabled &&
    typeof localStorage !== "undefined" &&
    localStorage.getItem("lotus_debug_api_requests") === "1"
  );
}

function isAgentEndpoint(url: string): boolean {
  try {
    const pathname = new URL(
      url,
      typeof window !== "undefined" ? window.location.origin : "http://localhost",
    ).pathname;
    return AGENT_ENDPOINT_PATTERNS.some((pattern) => pattern.test(pathname));
  } catch {
    return false;
  }
}

let requestCounters: Record<string, number> = {};

function logApiRequest(method: string, url: string): void {
  if (!shouldLogApiRequest() || !isAgentEndpoint(url)) return;

  const pathname = new URL(
    url,
    typeof window !== "undefined" ? window.location.origin : "http://localhost",
  ).pathname;
  const key = `${method} ${pathname}`;
  requestCounters[key] = (requestCounters[key] || 0) + 1;

  console.debug(`[ApiClient] ${method} ${key} (total: ${requestCounters[key]})`);
}

/** Called only by the API composition module after runtime installation. */
export const configureApiDebugInstrumentation = (enabled: boolean): void => {
  debugInstrumentationEnabled = enabled;
  if (!enabled || typeof window === "undefined") return;

  (window as unknown as Record<string, unknown>).__lotusApiCounters = () => {
    console.table(requestCounters);
    return { ...requestCounters };
  };
  (window as unknown as Record<string, unknown>).__lotusResetApiCounters = () => {
    requestCounters = {};
  };
};

export interface ApiClientConfig {
  baseUrl: string;
  defaultHeaders?: Record<string, string>;
  requestCredentials: RequestCredentials;
  transport: HttpTransport;
}

interface JsonBody {
  readonly value: unknown;
}

export class ApiClient {
  private readonly baseUrl: string;
  private readonly defaultHeaders: Record<string, string>;
  private readonly requestCredentials: RequestCredentials;
  private readonly transport: HttpTransport;

  constructor(config: ApiClientConfig) {
    this.baseUrl = config.baseUrl.trim().replace(/\/+$/, "");
    this.defaultHeaders = config.defaultHeaders ?? {
      "Content-Type": "application/json",
    };
    this.requestCredentials = config.requestCredentials;
    this.transport = config.transport;
  }

  /** Resolve a relative route through this client's canonical API base. */
  resolveUrl(path: string): string {
    const cleanPath = path.replace(/^\/+/, "");
    return `${this.baseUrl}/${cleanPath}`;
  }

  private mergeHeaders(headers?: HeadersInit): Headers {
    const merged = new Headers(this.defaultHeaders);
    if (headers) {
      new Headers(headers).forEach((value, name) => merged.set(name, value));
    }
    return merged;
  }

  private createRequestInit(
    method: string,
    options: RequestInit | undefined,
    jsonBody?: JsonBody,
  ): RequestInit {
    return {
      ...options,
      method,
      headers: this.mergeHeaders(options?.headers),
      credentials: this.requestCredentials,
      ...(jsonBody
        ? { body: jsonBody.value ? JSON.stringify(jsonBody.value) : undefined }
        : {}),
    };
  }

  private async handleResponse<T>(response: Response): Promise<T> {
    if (!response.ok) {
      // The transport owns response-body cancellation and classification after
      // headers arrive. Let its typed cancellation, timeout, and network errors
      // cross this adapter boundary instead of relabelling them as HTTP errors.
      const body = await response.text();
      let errorMessage = response.statusText;

      if (body) {
        try {
          const errorData = JSON.parse(body) as {
            error?: string | { message?: unknown };
            message?: unknown;
            detail?: unknown;
          };
          const nestedMessage =
            typeof errorData.error === "object" ? errorData.error?.message : undefined;
          const directError = typeof errorData.error === "string" ? errorData.error : undefined;
          const directMessage =
            typeof errorData.message === "string" ? errorData.message : undefined;
          const detail = typeof errorData.detail === "string" ? errorData.detail : undefined;

          errorMessage =
            directError ||
            (typeof nestedMessage === "string" ? nestedMessage : undefined) ||
            directMessage ||
            detail ||
            response.statusText;
        } catch {
          errorMessage = body;
        }
      }

      throw new ApiError(errorMessage, response.status, response.statusText, body);
    }

    if (response.status === 204) {
      return undefined as T;
    }

    const contentType = response.headers?.get?.("content-type") || "";
    if (contentType.includes("application/json")) {
      return response.json();
    }
    if (typeof response.text === "function") {
      return (await response.text()) as T;
    }
    return response.json();
  }

  private async send<T>(
    method: string,
    path: string,
    options?: RequestInit,
    jsonBody?: JsonBody,
  ): Promise<T> {
    const url = this.resolveUrl(path);
    logApiRequest(method.toUpperCase(), url);
    const response = await this.transport.request(
      url,
      this.createRequestInit(method, options, jsonBody),
    );
    return this.handleResponse<T>(response);
  }

  async get<T>(path: string, options?: RequestInit): Promise<T> {
    return this.send<T>("GET", path, options);
  }

  async post<T>(path: string, data?: unknown, options?: RequestInit): Promise<T> {
    return this.send<T>("POST", path, options, { value: data });
  }

  async put<T>(path: string, data?: unknown, options?: RequestInit): Promise<T> {
    return this.send<T>("PUT", path, options, { value: data });
  }

  async patch<T>(path: string, data?: unknown, options?: RequestInit): Promise<T> {
    return this.send<T>("PATCH", path, options, { value: data });
  }

  async delete<T>(path: string, options?: RequestInit): Promise<T> {
    return this.send<T>("DELETE", path, options);
  }

  async request<T>(method: string, path: string, options?: RequestInit): Promise<T> {
    return this.send<T>(method, path, options);
  }

  /** Return a raw response through the shared cancellation/deadline kernel. */
  async fetchRaw(path: string, options?: RequestInit): Promise<Response> {
    const url = this.resolveUrl(path);
    logApiRequest(options?.method?.toUpperCase() ?? "GET", url);
    const response = await this.transport.requestOnce(url, {
      ...options,
      headers: this.mergeHeaders(options?.headers),
      credentials: this.requestCredentials,
    });

    if (!response.ok) {
      // The transport transfers caller/deadline cleanup to the returned body.
      // A rejected raw response has no consumer, so close that lifecycle before
      // preserving the existing ApiError contract. Cancellation failures must
      // not replace or delay the HTTP response failure.
      const cancellation = response.body?.cancel();
      if (cancellation) void cancellation.catch(() => undefined);
      throw new ApiError(
        `API request failed: ${response.statusText}`,
        response.status,
        response.statusText,
      );
    }

    return response;
  }
}
