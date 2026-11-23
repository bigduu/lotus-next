import { useSyncExternalStore } from "react"

const key = "lotus_draft_completion"
const changeEvent = "lotus-draft-completion-change"

function read(): boolean {
  try { return localStorage.getItem(key) === "true" }
  catch { return false }
}

function subscribe(listener: () => void): () => void {
  function onStorage(event: StorageEvent) {
    if (event.key === key || event.key === null) listener()
  }
  window.addEventListener("storage", onStorage)
  window.addEventListener(changeEvent, listener)
  return () => {
    window.removeEventListener("storage", onStorage)
    window.removeEventListener(changeEvent, listener)
  }
}

export function useDraftCompletionEnabled(): boolean {
  return useSyncExternalStore(subscribe, read, () => false)
}

export function setDraftCompletionEnabled(enabled: boolean): void {
  try { localStorage.setItem(key, String(enabled)) }
  catch { return }
  window.dispatchEvent(new Event(changeEvent))
}
