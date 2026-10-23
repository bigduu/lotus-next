import type { BrowserProfileMode } from "./types"

export type BrowserProfileReport =
  | { kind: "reported"; mode: "shared"; storageShared: true }
  | { kind: "reported"; mode: "clean"; storageShared: false }
  | { kind: "unreported" }
  | { kind: "invalid" }

/** Missing fields are a legacy/unknown report, never evidence of shared storage. */
export function readBrowserProfileReport(
  state: { profile_mode?: unknown; storage_shared?: unknown } | null | undefined,
): BrowserProfileReport {
  if (!state || (state.profile_mode === undefined && state.storage_shared === undefined)) {
    return { kind: "unreported" }
  }
  if (state.profile_mode === "shared" && state.storage_shared === true) {
    return { kind: "reported", mode: "shared", storageShared: true }
  }
  if (state.profile_mode === "clean" && state.storage_shared === false) {
    return { kind: "reported", mode: "clean", storageShared: false }
  }
  return { kind: "invalid" }
}

/** Explicit open intent only. Automatic opens must continue omitting the mode. */
export function browserProfileOpenRequest(mode: BrowserProfileMode): { profile_mode: BrowserProfileMode } {
  if (mode !== "shared" && mode !== "clean") throw new TypeError("Invalid browser profile mode.")
  return { profile_mode: mode }
}
