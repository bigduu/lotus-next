import { useRef, useState } from "react"
import { CircleDot, ChevronRight, FileText, MessageCircle } from "lucide-react"
import { useUiText } from "@shared/i18n/ui"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { ticketWorkLabels } from "./ticketWorkLabels"
import type { useTicketWork } from "@/hooks/useTicketWork"

export function SupervisorOverview({ controller, running, onSelectWork }: {
  controller: ReturnType<typeof useTicketWork>
  running: boolean
  onSelectWork?: (workId: string | null) => void
}) {
  const uiText = useUiText()
  const [open, setOpen] = useState(false)
  const navigating = useRef(false)
  const state = controller.state
  if (!state || !onSelectWork) return null
  const overview = state.current.scope.overview.data
  const attention = overview.open_questions + overview.open_approvals + overview.needs_acceptance
  const works = Object.values(state.works).filter((view) => view.ticket.kind === "work" && !view.ticket.archived)
    .sort((a, b) => b.ticket.updated_seq - a.ticket.updated_seq)
  const outputs = works.flatMap((view) => view.submissions
    .filter((submission) => !submission.stale && (submission.id === view.ticket.accepted_submission || submission.id === view.ticket.current_submission))
    .flatMap((submission) => submission.artifacts.map((artifact, index) => ({ work: view.ticket, artifact, submissionId: submission.id, number: index + 1 }))))
  const select = (id: string | null) => {
    navigating.current = true
    setOpen(false)
    onSelectWork(id)
  }
  return <Popover open={open} onOpenChange={(next) => { if (next) navigating.current = false; setOpen(next) }}>
    <PopoverTrigger asChild>
      <Button type="button" size="icon" variant="ghost" className="relative shrink-0" data-testid="ticket-work-status"
        aria-label={uiText("supervisor_overview_open") + " · " + uiText("ticket_work_count", { count: overview.work_count }) + " · " + uiText("supervisor_work_attention", { count: attention })}>
        <CircleDot aria-hidden="true" />
        <span className="sr-only">{uiText("ticket_work_count", { count: overview.work_count })} · {uiText("supervisor_work_attention", { count: attention })}</span>
        {attention > 0 ? <span aria-hidden="true" style={{ right: -4, top: -4, minWidth: 16 }} className="absolute rounded-full bg-primary px-1 text-xs leading-4 text-primary-foreground">{attention > 99 ? "99+" : attention}</span> : null}
      </Button>
    </PopoverTrigger>
    <PopoverContent align="end" side="bottom" sideOffset={10} collisionPadding={12}
      aria-label={uiText("supervisor_overview_open")} data-testid="supervisor-overview"
      style={{ maxHeight: "min(32rem, var(--radix-popover-content-available-height))", width: "min(22rem, calc(100vw - 1.5rem))" }}
      className="overflow-y-auto rounded-2xl p-4 shadow-lg"
      onCloseAutoFocus={(event) => { if (navigating.current) { event.preventDefault(); navigating.current = false } }}>
      <div className="flex items-center gap-3">
        <div className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><CircleDot className="size-6" aria-hidden="true" /></div>
        <div className="min-w-0"><strong className="text-sm">Supervisor</strong><p className="text-xs text-muted-foreground">{!controller.connected ? uiText("supervisor_work_connection_attention") : controller.error ? uiText("supervisor_work_status_attention") : running || (overview.states.active ?? 0) > 0 ? uiText("supervisor_overview_running") : uiText("supervisor_overview_idle")}</p></div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
        <span>{uiText("ticket_work_count", { count: overview.work_count })}</span>
        {attention > 0 ? <span className="rounded-full bg-primary/10 px-2 text-primary">{uiText("supervisor_work_attention", { count: attention })}</span> : null}
      </div>
      {!state.current.complete ? <p role="status" className="mt-2 text-xs text-muted-foreground">{uiText("ticket_only_some_work_is_shown_other_work_may_still__ee267ea7")}</p> : null}
      {!controller.connected ? <p role="status" className="mt-2 text-xs text-muted-foreground">{uiText("ticket_the_connection_is_not_confirmed_answers_and_a_aaac8c0d")}</p> : null}
      {controller.error ? <p role="alert" className="mt-2 break-words text-xs text-destructive">{uiText("supervisor_work_status_attention")}</p> : null}
      <h2 className="mb-1 mt-5 text-xs font-medium text-muted-foreground">{uiText("supervisor_overview_recent")}</h2>
      {works.length ? works.slice(0, 5).map(({ ticket }) => <button type="button" key={ticket.id} onClick={() => select(ticket.id)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <MessageCircle className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate" title={ticket.contract.title}>{ticket.contract.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{ticketWorkLabels[ticket.state]}</span>
      </button>) : <p className="px-2 py-2 text-xs text-muted-foreground">{uiText(state.current.complete && controller.connected ? "supervisor_overview_empty" : "supervisor_overview_pending")}</p>}
      <h2 className="mb-1 mt-4 text-xs font-medium text-muted-foreground">{uiText("supervisor_overview_outputs")}</h2>
      {outputs.length ? outputs.slice(0, 3).map(({ work, artifact, submissionId, number }) => <button type="button" key={work.id + submissionId + artifact.sha256 + number} onClick={() => select(work.id)}
        className="flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate" title={work.contract.title}>{work.contract.title}</span>
        <span className="shrink-0 text-xs text-muted-foreground">{uiText("ticket_artifact_label", { number })}</span>
      </button>) : <p className="px-2 py-2 text-xs text-muted-foreground">{uiText(state.current.complete && controller.connected ? "supervisor_overview_no_outputs" : "supervisor_overview_pending")}</p>}
      <button type="button" onClick={() => select(null)} className="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {uiText("supervisor_overview_all")}<ChevronRight className="size-4" aria-hidden="true" />
      </button>
    </PopoverContent>
  </Popover>
}
