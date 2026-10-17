import { uiText } from "@shared/i18n/ui"

const record = (value: unknown): value is Record<string, unknown> =>
  value !== null && typeof value === "object" && !Array.isArray(value)

/** Only message actions qualify; creating/inspecting an actor is not delivery. */
export function sessionMessagePresentation(toolName: string, params?: Record<string, unknown>, result?: { text: string; isError: boolean }) {
  const name = toolName.trim().split(/__|::|\./).at(-1)?.toLowerCase().replace(/[_-]/g, "")
  const messageAction = name === "sessionmessage" || (name === "subagent" &&
    (params?.action === "send_message" || (params?.intent === "chat" && typeof params.target === "string" && !!params.target.trim())))
  if (!messageAction) return null
  const label = params?.interrupt_running === true || params?.mode === "after_round"
    ? uiText("message_action_interject") : uiText("message_action_send")
  if (result?.isError) return { label, status: uiText("message_delivery_failed") }
  if (!result) return { label, status: uiText("message_delivery_pending") }
  let payload: unknown
  try { payload = JSON.parse(result.text) } catch { /* A normal tool completion is not a delivery receipt. */ }
  const status = record(payload) ? payload.observed_status ?? payload.status : undefined
  switch (status) {
    case "pending": return { label, status: uiText("message_delivery_pending") }
    case "queued":
    case "message_queued": return { label, status: uiText("message_delivery_queued") }
    case "activation_pending": return { label, status: uiText("message_delivery_activation_pending") }
    case "activation_retry_required": return { label, status: uiText("message_delivery_retry") }
    case "message_delivered_live": return { label, status: uiText("message_delivery_live") }
    case "delivered": return { label, status: uiText("message_delivery_delivered") }
    case "steering": return { label, status: uiText("message_delivery_steering") }
    default: return { label, status: uiText("message_delivery_unconfirmed") }
  }
}
