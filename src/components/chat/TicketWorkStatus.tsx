import { ListChecks, ChevronRight } from "lucide-react"
import { useUiText } from "@shared/i18n/ui"
import type { useTicketWork } from "@/hooks/useTicketWork"

export function TicketWorkStatus({ controller, onOpen }: { controller: ReturnType<typeof useTicketWork>; onOpen?: () => void }) {
  const uiText = useUiText()
  if (!controller.state || !onOpen) return null
  const overview = controller.state.current.scope.overview.data
  const attention = overview.open_questions + overview.open_approvals + overview.needs_acceptance
  return <button type="button" data-testid="ticket-work-status" onClick={onOpen}
    className="mx-4 mb-2 flex min-h-9 items-center gap-2 rounded-lg px-2 text-left text-xs text-muted-foreground hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
    <ListChecks className="size-4 shrink-0" aria-hidden="true" />
    <span>{uiText("supervisor_work_tab")}</span>
    <span>{uiText("ticket_work_count", { count: overview.work_count })}</span>
    {attention > 0 ? <span className="rounded-full bg-primary/10 px-2 py-0.5 text-primary">{uiText("supervisor_work_attention", { count: attention })}</span> : null}
    {!controller.connected || controller.error ? <span>{uiText("supervisor_work_connection_attention")}</span> : null}
    <ChevronRight className="ml-auto size-3.5 shrink-0" aria-hidden="true" />
  </button>
}
