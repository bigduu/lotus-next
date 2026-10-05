import { uiText } from "@shared/i18n/ui"
import type { WorkState } from "@services/tickets/types"

export const ticketWorkLabels: Record<WorkState, string> = { get draft() { return uiText("ticket_draft_2a2fd29b") }, get ready() { return uiText("ticket_ready_to_dispatch_918dbc75") }, get active() { return uiText("ticket_in_progress_5026a63b") }, get submitted() { return uiText("ticket_awaiting_acceptance_3aabdf81") }, get accepted() { return uiText("ticket_accepted_2b9fcea2") }, get blocked() { return uiText("ticket_blocked_9059acb4") }, get cancelled() { return uiText("cancelled_a37778f1") } }
