import { useCallback, useSyncExternalStore } from "react"

export type RootModeFenceState = "clear" | "uncertain" | "storage-unavailable"

const keyFor = (sessionId: string) => `lotus-next.root-mode-transition.v1.${sessionId}`
const changedEvent = "lotus-next:root-mode-transition-changed"

export function getRootModeFenceState(sessionId: string): RootModeFenceState {
  try {
    return localStorage.getItem(keyFor(sessionId)) === null ? "clear" : "uncertain"
  } catch {
    // A client that cannot read its durable fence cannot prove this session is safe to send.
    return "storage-unavailable"
  }
}

function notify(sessionId: string) {
  window.dispatchEvent(new CustomEvent(changedEvent, { detail: sessionId }))
}

/**
 * Write before the POST. A failed write/readback prevents that mode switch.
 * This recovery fence is not a cross-tab CAS; only Bamboo can order concurrent
 * requests and report the terminal authority revision.
 */
export function beginRootModeTransition(sessionId: string, requested: boolean): string | null {
  try {
    const key = keyFor(sessionId)
    if (localStorage.getItem(key) !== null) return null
    const token = JSON.stringify({ id: crypto.randomUUID(), requested })
    localStorage.setItem(key, token)
    if (localStorage.getItem(key) !== token) return null
    notify(sessionId)
    return token
  } catch {
    return null
  }
}

/** Only the matching POST's definite ACK or typed rejection can release its fence. */
export function finishRootModeTransition(sessionId: string, token: string) {
  try {
    const key = keyFor(sessionId)
    if (localStorage.getItem(key) !== token) return
    localStorage.removeItem(key)
    notify(sessionId)
  } catch {
    // A failed removal keeps the session blocked on the next render/reload.
  }
}

export function useRootModeFenceState(sessionId: string | null): RootModeFenceState {
  const subscribe = useCallback((onChange: () => void) => {
    if (!sessionId) return () => {}
    const onLocalChange = (event: Event) => {
      if ((event as CustomEvent<string>).detail === sessionId) onChange()
    }
    const onStorageChange = (event: StorageEvent) => {
      if (event.key === null || event.key === keyFor(sessionId)) onChange()
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
