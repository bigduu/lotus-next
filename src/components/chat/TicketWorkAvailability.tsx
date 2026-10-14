import { uiText, useUiLocale } from "@shared/i18n/ui"
import type { TicketAvailability } from "@services/tickets/availability"

export function TicketWorkAvailability({ availability, refreshing, canRefresh, onRefresh }: {
  availability: TicketAvailability; refreshing: boolean; canRefresh: boolean; onRefresh: () => void
}) {
  useUiLocale()
  const kind = availability.kind
  const title = {
    loading: "supervisor_work_loading", ready: "supervisor_work_tab", disabled: "supervisor_work_disabled",
    uninitialized: "supervisor_work_uninitialized", unbound: "supervisor_work_unbound", unsupported: "supervisor_work_unsupported",
    forbidden: "supervisor_work_forbidden", error: "supervisor_work_error",
  } as const
  const guidance = {
    disabled: "supervisor_work_disabled_guidance", uninitialized: "supervisor_work_uninitialized_guidance",
    unbound: "supervisor_work_unbound_guidance", unsupported: "supervisor_work_unsupported_guidance",
    forbidden: "supervisor_work_forbidden_guidance", error: "supervisor_work_error_guidance",
  } as const
  return <section data-testid="ticket-work-availability" className="space-y-3 p-4 text-sm">
    <p role={kind === "error" || kind === "forbidden" ? "alert" : "status"} className="font-medium">{uiText(title[kind])}</p>
    {kind !== "loading" && kind !== "ready" ? <p className="text-muted-foreground">{uiText(guidance[kind])}</p> : null}
    {availability.detail ? <details className="text-xs text-muted-foreground"><summary className="cursor-pointer">{uiText("supervisor_work_service_detail")}</summary><p className="mt-2 whitespace-pre-wrap break-words">{availability.detail}</p></details> : null}
    {kind !== "loading" ? <button type="button" disabled={refreshing || !canRefresh} onClick={onRefresh} className="rounded-md border px-3 py-1.5 disabled:opacity-50">{uiText(refreshing ? "supervisor_work_loading" : "supervisor_work_retry")}</button> : null}
  </section>
}
