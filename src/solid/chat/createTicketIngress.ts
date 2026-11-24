import { createMemo, createSignal, onSettled, type Accessor } from "solid-js"
import {
  createTicketIngressOperations, hasPendingTicketIngress, subscribeIngress, ticketIngressReferences,
  ticketIngressRevision, ticketIngressState, type TicketIngressFailure,
} from "@services/tickets/ingress"
import { createExternalSnapshot } from "./snapshots"

export function createTicketIngress(sessionId: Accessor<string | null>, authorityBlocked: Accessor<boolean>) {
  const view = createMemo(() => ({ sessionId: sessionId() }))
  const [failure, setFailure] = createSignal<TicketIngressFailure>(null)
  const revision = createExternalSnapshot(subscribeIngress, ticketIngressRevision)
  let mounted = true
  onSettled(() => () => { mounted = false })
  const state = createMemo(() => {
    revision()
    authorityBlocked()
    const current = view()
    const error = failure()
    return ticketIngressState(current.sessionId, error?.view === current ? error.message : null)
  })
  return {
    ...createTicketIngressOperations(() => mounted ? view() : null, setFailure),
    get busy() { return state().busy },
    get activationPending() { return state().executePending !== null },
    get starting() { return state().starting },
    get canRetryStart() { return state().canRetryStart },
    get error() { return state().error },
    get pending() { revision(); return hasPendingTicketIngress(sessionId()) },
    get references() { revision(); return ticketIngressReferences(sessionId()) },
  }
}
