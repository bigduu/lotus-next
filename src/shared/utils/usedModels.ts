/**
 * Best-effort registry of models that have reached an acknowledged chat send.
 *
 * Keep the legacy Lotus key so existing desktop users carry their recently
 * used models into Lotus Next. This registry is discovery-only: Bamboo remains
 * authoritative for persisted model-limit overrides and runtime token budgets.
 */
const STORAGE_KEY = "zenith.usedModels.v1"

function readRaw(): string[] {
  if (typeof window === "undefined") return []
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as unknown
    if (!Array.isArray(parsed)) return []
    return parsed.filter(
      (model): model is string => typeof model === "string" && model.trim().length > 0,
    )
  } catch {
    return []
  }
}

/** Models the user has used, most-recently-used first. */
export function getUsedModels(): string[] {
  return readRaw()
}

/** Record an acknowledged model use and move an existing entry to the front. */
export function recordUsedModel(model: string | undefined | null): string[] {
  const normalized = typeof model === "string" ? model.trim() : ""
  if (!normalized || typeof window === "undefined") return readRaw()

  const next = [normalized, ...readRaw().filter((entry) => entry !== normalized)]
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Disabled/quota-limited storage must never block a chat submission.
  }
  return next
}

/** Remove a discovery entry without touching Bamboo's persisted overrides. */
export function removeUsedModel(model: string | undefined | null): string[] {
  const normalized = typeof model === "string" ? model.trim() : ""
  if (!normalized || typeof window === "undefined") return readRaw()

  const next = readRaw().filter((entry) => entry !== normalized)
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(next))
  } catch {
    // Discovery is best-effort.
  }
  return next
}

export function clearUsedModels(): void {
  if (typeof window === "undefined") return
  try {
    window.localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Discovery is best-effort.
  }
}
