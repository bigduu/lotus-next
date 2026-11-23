import { useEffect, useSyncExternalStore } from "react"
import {
  markSessionRead,
  sessionReadMarkersSnapshot,
  subscribeSessionReadMarkers,
  type ReadState,
  type SessionReadActivity,
} from "./sessionReadMarkers"

export * from "./sessionReadMarkers"

const empty: ReadState = {}
export function useSessionReadState() {
  return useSyncExternalStore(subscribeSessionReadMarkers, sessionReadMarkersSnapshot, () => empty)
}

export function useMarkSessionRead(chat: SessionReadActivity | null | undefined) {
  useEffect(() => {
    if (!chat) return
    const mark = () => markSessionRead(chat)
    mark()
    document.addEventListener("visibilitychange", mark)
    return () => document.removeEventListener("visibilitychange", mark)
  }, [chat])
}
