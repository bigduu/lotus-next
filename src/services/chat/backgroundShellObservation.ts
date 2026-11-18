import { isNotifyEnabled, notify, notifyPermission } from "@/lib/notify"
import { useAppStore } from "@shared/store/appStore"
import type { AgentEvent } from "./AgentService"
import { subscribeAgent } from "./v2Stream"

type ShellObservation = {
  pending: Set<string>
  awaitingNotifications: Set<string>
  notificationTimer?: ReturnType<typeof setTimeout>
  close: () => void
}

const NOTIFICATION_WAIT_MS = 5_000
const observations = new Map<string, ShellObservation>()
const deliveredNotifications = new WeakSet<AgentEvent>()

/** A pane and a shell observer can receive the same frame on the shared channel. */
export function deliverSessionNotification(event: AgentEvent): void {
  if (deliveredNotifications.has(event)) return
  deliveredNotifications.add(event)
  notify(event.title ?? "", event.body ?? "")
}

export function stopObservingBackgroundShells(sessionId: string): void {
  const observation = observations.get(sessionId)
  if (!observation) return
  observations.delete(sessionId)
  clearTimeout(observation.notificationTimer)
  observation.close()
}

export function stopAllBackgroundShellObservations(): void {
  for (const sessionId of observations.keys()) stopObservingBackgroundShells(sessionId)
}

function closeFinishedObservation(sessionId: string, observation: ShellObservation): void {
  if (observations.get(sessionId) !== observation || observation.pending.size > 0) return
  if (observation.awaitingNotifications.size === 0) {
    stopObservingBackgroundShells(sessionId)
    return
  }
  // Bamboo relays eligible notifications after the result. Preferences and
  // replayed results can leave the observer with no notification to receive.
  observation.notificationTimer ??= setTimeout(() => {
    if (observations.get(sessionId) === observation) stopObservingBackgroundShells(sessionId)
  }, NOTIFICATION_WAIT_MS)
}

export function recordBackgroundShellOutcome(sessionId: string, bashId: string, status: string, exitCode: number | null): void {
  if (!bashId) return
  const observation = observations.get(sessionId)
  const wasPending = observation?.pending.delete(bashId)
  if (wasPending && status !== "killed" && isNotifyEnabled() && notifyPermission() === "granted") {
    observation?.awaitingNotifications.add(`bash:${bashId}`)
  }
  useAppStore.getState().setBashCompleted(bashId, status, exitCode)
  if (wasPending && observation) closeFinishedObservation(sessionId, observation)
}

/** Keep known background results on the shared session channel after a pane releases its turn. */
export function observeBackgroundShells(sessionId: string, bashIds: readonly string[]): void {
  if (bashIds.length === 0) return
  const done = useAppStore.getState().backgroundBash
  const remaining = bashIds.filter((bashId) => !Object.hasOwn(done, bashId))
  if (remaining.length === 0) return

  const existing = observations.get(sessionId)
  if (existing) {
    for (const bashId of remaining) existing.pending.add(bashId)
    clearTimeout(existing.notificationTimer)
    existing.notificationTimer = undefined
    return
  }

  const pending = new Set(remaining)
  // Join synchronously so the run subscriber can leave without dropping the
  // wire channel. The shared transport also replays critical events on reconnect.
  const subscription = subscribeAgent(sessionId, {}, (event) => {
    const observation = observations.get(sessionId)
    if (observation?.pending !== pending) return
    if (event.type === "bash_completed" && event.bash_id) {
      // The outcome can arrive before this pane discovers the launch in history.
      recordBackgroundShellOutcome(sessionId, event.bash_id, typeof event.status === "string" ? event.status : "completed", event.exit_code ?? null)
    } else if (
      event.type === "notification" && event.session_id === sessionId && event.dedup_key &&
      observation.awaitingNotifications.delete(event.dedup_key)
    ) {
      deliverSessionNotification(event)
      closeFinishedObservation(sessionId, observation)
    }
  })
  const observation: ShellObservation = { pending, awaitingNotifications: new Set(), close: subscription.close }
  observations.set(sessionId, observation)
  void subscription.promise.then(() => {
    // The server may close the channel before a result is available. The next
    // visit or new launch can observe its replay without retrying in a loop.
    if (observations.get(sessionId) === observation) stopObservingBackgroundShells(sessionId)
  })
}
