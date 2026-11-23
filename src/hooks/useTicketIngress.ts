import { useRef, useState, useSyncExternalStore } from "react"
import { useUiLocale } from "@shared/i18n/ui"
import {
  createTicketIngressOperations, hasPendingTicketIngress, subscribeIngress, ticketIngressReferences,
  ticketIngressRevision, ticketIngressState, type TicketIngressFailure, type TicketIngressView,
} from "@services/tickets/ingress"

export function useTicketIngress(sessionId?: string | null) {
  useUiLocale()
  const view = useRef<TicketIngressView>({ sessionId })
  if (view.current.sessionId !== sessionId) view.current = { sessionId }
  const [failure, setFailure] = useState<TicketIngressFailure>(null)
  const [operations] = useState(() => createTicketIngressOperations(() => view.current, setFailure))
  useSyncExternalStore(subscribeIngress, ticketIngressRevision)
  return {
    ...ticketIngressState(sessionId, failure?.view === view.current ? failure.message : null),
    ...operations,
    hasPending: hasPendingTicketIngress,
    references: ticketIngressReferences,
  }
}
