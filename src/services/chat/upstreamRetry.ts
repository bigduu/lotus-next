import { apiClient } from "@services/api"
import { isApiError } from "@services/api/errors"

export type UpstreamRetrySelection = { mode: "until_cancelled" }
export type UpstreamRetryFeedback = "requesting" | "already_running" | "enabled" | "stopping" | "stop_requested" | "stop_unconfirmed" | "identity_unsaved" | "identity_unavailable" | "unavailable" | "not_started"

export type UpstreamRetryCapability = "supported" | "unsupported" | "unknown"

/** Distinguish an explicit old service from malformed or unavailable capability data. */
export async function readUpstreamRetryCapability(): Promise<UpstreamRetryCapability> {
  let value: unknown
  try { value = await apiClient.get<unknown>("execute/defaults", { cache: "no-store" }) }
  catch (error) { return isApiError(error) && error.status === 404 ? "unsupported" : "unknown" }
  if (!value || typeof value !== "object" || Array.isArray(value)) return "unknown"
  if (!("upstream_retry" in value)) {
    const legacy = value as Record<string, unknown>
    return (typeof legacy.system_prompt === "string" && typeof legacy.base_system_prompt === "string"
      && ["default", "auto", "bypass"].includes(legacy.default_session_permission_mode as string)
      && (legacy.model === null || typeof legacy.model === "string")) ? "unsupported" : "unknown"
  }
  const policy = value.upstream_retry
  if (!policy || typeof policy !== "object" || Array.isArray(policy) || !("supported_modes" in policy)
      || !Array.isArray(policy.supported_modes) || !policy.supported_modes.every((mode: unknown) => typeof mode === "string")) return "unknown"
  return policy.supported_modes.includes("until_cancelled") ? "supported" : "unsupported"
}

/** Capability only; never infer support from a package version. */
export async function supportsContinuousUpstreamRetry(): Promise<boolean> {
  return await readUpstreamRetryCapability() === "supported"
}

/** Same bounded, graphic header identity accepted by the exact-run Stop route. */
export const isRetryRunId = (value: unknown): value is string =>
  typeof value === "string" && /^[!-~]{1,128}$/.test(value)
