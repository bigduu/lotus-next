import { useAppStore } from "@shared/store/appStore"
import { subscribeAgent } from "./v2Stream"

type ShellObservation = { pending: Set<string>; close: () => void }

const observations = new Map<string, ShellObservation>()

export function stopObservingBackgroundShells(sessionId: string): void {
  const observation = observations.get(sessionId)
  if (!observation) return
  observations.delete(sessionId)
  observation.close()
}

export function stopAllBackgroundShellObservations(): void {
  for (const sessionId of observations.keys()) stopObservingBackgroundShells(sessionId)
}

export function recordBackgroundShellOutcome(sessionId: string, bashId: string, status: string, exitCode: number | null): void {
  if (!bashId) return
  const observation = observations.get(sessionId)
  const wasPending = observation?.pending.delete(bashId)
  useAppStore.getState().setBashCompleted(bashId, status, exitCode)
  if (wasPending && observation?.pending.size === 0 && observations.get(sessionId) === observation) {
    stopObservingBackgroundShells(sessionId)
  }
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
    return
  }

  const pending = new Set(remaining)
  // Join synchronously so the run subscriber can leave without dropping the
  // wire channel. The shared transport also replays critical events on reconnect.
  const subscription = subscribeAgent(sessionId, {}, (event) => {
    if (event.type !== "bash_completed" || !event.bash_id) return
    if (observations.get(sessionId)?.pending !== pending) return
    // The outcome can arrive before this pane discovers the launch in history.
    recordBackgroundShellOutcome(sessionId, event.bash_id, typeof event.status === "string" ? event.status : "completed", event.exit_code ?? null)
  })
  const observation = { pending, close: subscription.close }
  observations.set(sessionId, observation)
  void subscription.promise.then(() => {
    // The server may close the channel before a result is available. The next
    // visit or new launch can observe its replay without retrying in a loop.
    if (observations.get(sessionId) === observation) observations.delete(sessionId)
  })
}
