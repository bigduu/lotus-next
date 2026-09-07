import { useEffect, useSyncExternalStore } from "react"

const KEY = "lotus-next.session-read.v1"
type Activity = { id: string; lastActivityAt?: string; updatedAt?: string; messageCount?: number; messages?: unknown[] }
export type ReadMarker = { at: number; count: number; readAt: number }
export type ReadState = Record<string, ReadMarker>
const empty: ReadState = {}

function activity(chat: Activity): Pick<ReadMarker, "at" | "count"> {
  const parsed = Date.parse(chat.lastActivityAt ?? "")
  const count = chat.messageCount ?? chat.messages?.length ?? 0
  return { at: Number.isFinite(parsed) ? parsed : 0, count: Number.isFinite(count) ? Math.max(0, count) : 0 }
}

export function parseReadState(raw: string | null): ReadState {
  try {
    const parsed: unknown = JSON.parse(raw ?? "null")
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {}
    return Object.fromEntries(Object.entries(parsed).filter(([id, marker]) => id && marker &&
      [marker.at, marker.count, marker.readAt].every((n) => typeof n === "number" && Number.isFinite(n) && n >= 0))
      .sort((a, b) => b[1].readAt - a[1].readAt).slice(0, 2_000))
  } catch { return {} }
}

export function isSessionUnread(chat: Activity, state: ReadState): boolean {
  const current = activity(chat)
  if (current.count === 0) return false
  const previous = Object.hasOwn(state, chat.id) ? state[chat.id] : undefined
  return !previous || current.count > previous.count || current.at > previous.at
}

export function mergeReadMarker(state: ReadState, chat: Activity, now = Date.now()): ReadState {
  const current = activity(chat)
  const previous = Object.hasOwn(state, chat.id) ? state[chat.id] : undefined
  if (previous && previous.at >= current.at && previous.count >= current.count) return state
  const marker = { at: Math.max(current.at, previous?.at ?? 0), count: Math.max(current.count, previous?.count ?? 0), readAt: now }
  return Object.fromEntries(Object.entries({ ...state, [chat.id]: marker })
    .sort((a, b) => b[1].readAt - a[1].readAt).slice(0, 2_000))
}

function load(): ReadState {
  try { return parseReadState(localStorage.getItem(KEY)) } catch { return {} }
}
let snapshot = load()
const listeners = new Set<() => void>()
function publish(next: ReadState) {
  if (next === snapshot) return
  snapshot = next
  for (const listener of listeners) listener()
}
function storageChanged(event: StorageEvent) {
  if (event.key === KEY || event.key === null) publish(load())
}
function subscribe(listener: () => void) {
  listeners.add(listener)
  if (listeners.size === 1) window.addEventListener("storage", storageChanged)
  return () => {
    listeners.delete(listener)
    if (!listeners.size) window.removeEventListener("storage", storageChanged)
  }
}
export function useSessionReadState() {
  return useSyncExternalStore(subscribe, () => snapshot, () => empty)
}

export function useMarkSessionRead(chat: Activity | null | undefined) {
  useEffect(() => {
    if (!chat) return
    const mark = () => {
      if (document.visibilityState === "hidden") return
      const next = mergeReadMarker(snapshot, chat)
      if (next === snapshot) return
      publish(next)
      try { localStorage.setItem(KEY, JSON.stringify(next)) } catch { /* Navigation remains available. */ }
    }
    mark()
    document.addEventListener("visibilitychange", mark)
    return () => document.removeEventListener("visibilitychange", mark)
  }, [chat])
}
