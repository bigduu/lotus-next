/**
 * Unified API Client
 *
 * Centralized HTTP client for all backend API communication.
 */
import { getRuntimeConfig } from "../../runtime/runtimeConfig";
import { ApiClient, configureApiDebugInstrumentation } from "./client";
import { createBrowserHttpTransport } from "./transport";

const runtime = getRuntimeConfig();
configureApiDebugInstrumentation(runtime.publicMetadata.development);
const httpTransport = createBrowserHttpTransport();

export const apiClient = new ApiClient({
  baseUrl: runtime.endpoints.standardApi,
  requestCredentials: runtime.auth.requestCredentials,
  transport: httpTransport,
});

export const agentApiClient = new ApiClient({
  baseUrl: runtime.endpoints.agentApi,
  requestCredentials: runtime.auth.requestCredentials,
  transport: httpTransport,
});

export {
  ApiError,
  NetworkRequestError,
  RequestCancelledError,
  RequestTimeoutError,
  getErrorMessage,
  isApiError,
  isRequestError,
  withFallback,
} from "./errors";
export type { RequestError, RequestErrorKind } from "./errors";

export * from "./types";
