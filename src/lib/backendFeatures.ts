/**
 * Capabilities the running backend advertised, learned once from its sessions
 * response.
 *
 * A frontend released ahead of its backend must not probe for optional
 * endpoints: an unknown route answers 404, which clients and browser tests treat
 * as an error. Instead the backend advertises what it serves, and gated work
 * stays off until the capability is seen.
 *
 * `null` means "not learned yet"; an empty set means the backend predates the
 * field, which is treated exactly like a missing capability.
 */
let features: Set<string> | null = null
const listeners = new Set<() => void>()

export const setBackendFeatures = (advertised: readonly string[] | undefined): void => {
  features = new Set(advertised ?? [])
  for (const listener of listeners) listener()
}

export const backendSupports = (feature: string): boolean => features?.has(feature) ?? false

/** Subscribe to capability discovery so gated work can start once it is known. */
export const onBackendFeatures = (listener: () => void): (() => void) => {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** Test-only reset: capability state is process-wide. */
export const resetBackendFeatures = (): void => {
  features = null
  listeners.clear()
}
