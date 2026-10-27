import { apiClient } from "@services/api"

export type UpstreamRetrySelection = { mode: "until_cancelled" }
export type UpstreamRetryFeedback = "requesting" | "already_running" | "enabled" | "stopping" | "stop_requested" | "stop_unconfirmed" | "unavailable"

/** Capability only; never infer support from a package version or missing fields. */
export async function supportsContinuousUpstreamRetry(): Promise<boolean> {
  const value = await apiClient.get<unknown>("execute/defaults", { cache: "no-store" })
  if (!value || typeof value !== "object" || !("upstream_retry" in value)) return false
  const policy = value.upstream_retry
  if (!policy || typeof policy !== "object" || !("supported_modes" in policy)) return false
  return Array.isArray(policy.supported_modes) && policy.supported_modes.includes("until_cancelled")
}

/** Same bounded, graphic header identity accepted by the exact-run Stop route. */
export const isRetryRunId = (value: unknown): value is string =>
  typeof value === "string" && /^[!-~]{1,128}$/.test(value)
