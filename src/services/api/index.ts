/**
 * Unified API Client
 *
 * Centralized HTTP client for all backend API communication.
 */
import { getRuntimeConfig } from "../../runtime/runtimeConfig";
import { ApiClient, configureApiDebugInstrumentation } from "./client";

const runtime = getRuntimeConfig();
configureApiDebugInstrumentation(runtime.publicMetadata.development);

export const apiClient = new ApiClient({
  baseUrl: runtime.endpoints.standardApi,
  requestCredentials: runtime.auth.requestCredentials,
});

export const agentApiClient = new ApiClient({
  baseUrl: runtime.endpoints.agentApi,
  requestCredentials: runtime.auth.requestCredentials,
});

export { ApiError, isApiError, getErrorMessage, withFallback } from "./errors";

export * from "./types";
