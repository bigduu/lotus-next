import { useSyncExternalStore } from "react"
import { emptySessionOrder, sessionOrderSnapshot, subscribeSessionOrder, type SessionOrder } from "./sidebarSessionOrderState"

export * from "./sidebarSessionOrderState"

/** Subscribe the sidebar so a send can reorder rows immediately. */
export function useSessionOrder(): SessionOrder {
  return useSyncExternalStore(subscribeSessionOrder, sessionOrderSnapshot, () => emptySessionOrder)
}
