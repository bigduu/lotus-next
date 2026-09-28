import { useCallback, useSyncExternalStore } from "react"

export type RootModeFenceState = "clear" | "uncertain" | "storage-unavailable"

export type RootModeOperation = {
  version: 2
  operationId: string
  expectedEpoch: number
  birthToken: string
  enabled: boolean
}

export type RootModeFence =
  | { kind: "clear" }
  | { kind: "pending"; operations: RootModeOperation[] }
  | { kind: "legacy" | "invalid" | "storage-unavailable" }

const legacyKeyFor = (sessionId: string) => `lotus-next.root-mode-transition.v1.${sessionId}`
const operationPrefixFor = (sessionId: string) => `lotus-next.root-mode-operation.v2.${encodeURIComponent(sessionId)}.`
const changedEvent = "lotus-next:root-mode-transition-changed"

export function rootModeStorageKeyMatches(sessionId: string, key: string | null): boolean {
  return key === null || key === legacyKeyFor(sessionId) || key.startsWith(operationPrefixFor(sessionId))
}

function isOperation(value: unknown): value is RootModeOperation {
  if (typeof value !== "object" || value === null) return false
  const item = value as Partial<RootModeOperation>
  return item.version === 2 && typeof item.operationId === "string"
    && /^[0-9]+:[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(item.operationId)
    && Number.isSafeInteger(item.expectedEpoch) && (item.expectedEpoch ?? -1) >= 0
    && item.operationId.startsWith(`${item.expectedEpoch}:`)
    && typeof item.birthToken === "string" && item.birthToken.length > 0
    && typeof item.enabled === "boolean"
}

/** Every operation owns a separate key, so concurrent tabs cannot overwrite a pending identity. */
export function readRootModeFence(sessionId: string): RootModeFence {
  try {
    if (localStorage.getItem(legacyKeyFor(sessionId)) !== null) return { kind: "legacy" }
    const prefix = operationPrefixFor(sessionId)
    const operations: RootModeOperation[] = []
    // Snapshot keys before reads: deletion in another tab must not shift an
    // unvisited marker past a live Storage index and produce a false clear.
    const keys = Object.keys(localStorage).filter((key) => key.startsWith(prefix))
    for (const key of keys) {
      const raw = localStorage.getItem(key)
      if (raw === null) continue
      let value: unknown
      try { value = JSON.parse(raw) } catch { return { kind: "invalid" } }
      if (!isOperation(value) || key !== `${prefix}${value.operationId}`) return { kind: "invalid" }
      operations.push(value)
    }
    return operations.length ? { kind: "pending", operations } : { kind: "clear" }
  } catch {
    return { kind: "storage-unavailable" }
  }
}

export function getRootModeFenceState(sessionId: string): RootModeFenceState {
  const fence = readRootModeFence(sessionId)
  return fence.kind === "clear" ? "clear"
    : fence.kind === "storage-unavailable" ? "storage-unavailable" : "uncertain"
}

function notify(sessionId: string) {
  window.dispatchEvent(new CustomEvent(changedEvent, { detail: sessionId }))
}

/** Persist the complete recovery identity before the mode-only POST. */
export function beginRootModeOperation(
  sessionId: string, expectedEpoch: number, birthToken: string, enabled: boolean,
): RootModeOperation | null {
  if (readRootModeFence(sessionId).kind !== "clear"
    || !Number.isSafeInteger(expectedEpoch) || expectedEpoch < 0 || !birthToken) return null
  try {
    const operationId = `${expectedEpoch}:${crypto.randomUUID()}`
    const operation: RootModeOperation = { version: 2, operationId, expectedEpoch, birthToken, enabled }
    const key = `${operationPrefixFor(sessionId)}${operationId}`
    const raw = JSON.stringify(operation)
    localStorage.setItem(key, raw)
    if (localStorage.getItem(key) !== raw) return null
    notify(sessionId)
    return operation
  } catch {
    return null
  }
}

/** Only a terminal response for this exact operation can remove its safety marker. */
export function finishRootModeOperation(sessionId: string, operation: RootModeOperation): boolean {
  try {
    const key = `${operationPrefixFor(sessionId)}${operation.operationId}`
    const stored = localStorage.getItem(key)
    // Another tab may already have resolved this exact operation.
    if (stored === null) return true
    if (stored !== JSON.stringify(operation)) return false
    localStorage.removeItem(key)
    if (localStorage.getItem(key) !== null) return false
    notify(sessionId)
    return true
  } catch {
    return false
  }
}

export function useRootModeFenceState(sessionId: string | null): RootModeFenceState {
  const subscribe = useCallback((onChange: () => void) => {
    if (!sessionId) return () => {}
    const onLocalChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === sessionId) onChange()
    }
    const onStorageChange = (event: StorageEvent) => {
      if (rootModeStorageKeyMatches(sessionId, event.key)) onChange()
    }
    window.addEventListener(changedEvent, onLocalChange)
    window.addEventListener("storage", onStorageChange)
    return () => {
      window.removeEventListener(changedEvent, onLocalChange)
      window.removeEventListener("storage", onStorageChange)
    }
  }, [sessionId])
  const getSnapshot = useCallback(() => sessionId ? getRootModeFenceState(sessionId) : "clear", [sessionId])
  return useSyncExternalStore(subscribe, getSnapshot, () => "clear")
}
