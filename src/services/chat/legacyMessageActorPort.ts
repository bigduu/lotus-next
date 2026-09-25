import { agentClient, type MessageHistoryResponse } from "./AgentService"
import {
  subscribeMessages,
  type MessageChannelControl,
  type MessageChannelEvent,
} from "./v2Stream"
import type { ActorContentPort } from "./visibleActorSubscriptions"

export type LegacyActorMessage =
  | { type: "live"; event: MessageChannelEvent }
  | { type: "control"; control: Exclude<MessageChannelControl, { type: "gap" }> }
  | { type: "history"; response: MessageHistoryResponse }

/**
 * Compatibility port for child ActorSessions that are also current Sessions.
 * `subscribeMessages` uses the existing singleton authenticated /v2/stream;
 * it owns socket reconnect and sends a fresh message snapshot on subscribe.
 * The legacy `message.{sessionId}` channel has no resume cursor or canonical
 * ActorEventEnvelope, so this port's cursor is explicitly null. The canonical
 * actor-channel adapter remains dependent on Bamboo #928/#929.
 */
export const legacyMessageActorPort: ActorContentPort<null, LegacyActorMessage> = {
  subscribe(actorId, _cursor, handlers) {
    let terminal = false
    let historyCommitted = false
    let terminalReported = false
    const reportTerminal = () => {
      if (!terminal || !historyCommitted || terminalReported) return
      terminalReported = true
      handlers.onTerminal()
    }
    return subscribeMessages(actorId, {
      onEvent(event) {
        if (event.type === "snapshot") {
          terminal = event.terminal !== undefined
          historyCommitted = event.history_committed
          terminalReported = false
        } else if (event.type === "started") {
          terminal = false
          historyCommitted = false
          terminalReported = false
        }
        handlers.onEvent({ type: "live", event }, null)
        reportTerminal()
      },
      onControl(control) {
        if (control.type === "gap") {
          handlers.onGap()
          return
        }
        if (control.type === "terminal") terminal = true
        if (control.type === "history_committed") historyCommitted = true
        handlers.onEvent({ type: "control", control }, null)
        reportTerminal()
      },
    })
  },
  async recover(actorId) {
    const response = await agentClient.getMessageHistory(actorId)
    // The new message subscription supplies a fresh snapshot after this REST
    // recovery; no synthetic wire cursor is inferred from the history reply.
    return { snapshot: { type: "history", response }, cursor: null }
  },
}
