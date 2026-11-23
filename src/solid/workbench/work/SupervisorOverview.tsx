import { ChevronRight, CircleDot, FileText, MessageCircle } from "@lucide/solid"
import { createMemo, createSignal, For, Show } from "solid-js"
import { ticketWorkStatusLabel } from "@/components/chat/ticketWorkLabels"
import { createUiLocale, createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover"
import type { TicketWorkController } from "./createTicketWork"

const rowStyle = "flex w-full items-center gap-2 rounded-lg px-2 py-2 text-left text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"

export function SupervisorOverview(props: {
  controller: TicketWorkController
  running: boolean
  onSelectWork: (workId: string | null) => void
}) {
  const text = createUiText()
  const locale = createUiLocale()
  const [open, setOpen] = createSignal(false)
  let navigating = false
  const state = () => props.controller.state
  const overview = () => state()?.current.scope.overview.data
  const attention = () => {
    const counts = overview()
    return counts ? counts.open_questions + counts.open_approvals + counts.needs_acceptance : 0
  }
  const works = createMemo(() => Object.values(state()?.works ?? {})
    .filter((view) => view.ticket.kind === "work" && !view.ticket.archived)
    .sort((a, b) => b.ticket.updated_seq - a.ticket.updated_seq))
  const outputs = createMemo(() => {
    const artifacts = works().flatMap(({ ticket, submissions }) => {
      const published = submissions.filter((submission) => !submission.stale
        && (submission.id === ticket.accepted_submission || submission.id === ticket.current_submission))
      return published.flatMap((submission) => submission.artifacts.map((artifact, index) => ({
        key: JSON.stringify([ticket.id, submission.id, artifact.sha256, index]),
        ticket, number: index + 1,
      })))
    })
    return artifacts.slice(0, 3)
  })
  const label = () => `${text("ticket_work_count", { count: overview()?.work_count ?? 0 })} · ${text("supervisor_work_attention", { count: attention() })}`
  const statusLabel = (view: Parameters<typeof ticketWorkStatusLabel>[0]) => {
    locale()
    return ticketWorkStatusLabel(view)
  }
  const ready = () => props.controller.connected && state()?.current.complete === true
  const status = () => {
    if (!props.controller.connected) return "supervisor_work_connection_attention"
    if (props.controller.error) return "supervisor_work_status_attention"
    if (props.running) return "supervisor_overview_running"
    return !state()?.current.complete || (overview()?.states.active ?? 0) > 0
      ? "supervisor_work_status_attention" : "supervisor_overview_idle"
  }

  const select = (id: string | null) => {
    navigating = true
    setOpen(false)
    props.onSelectWork(id)
  }

  return (
    <Popover open={open()} onOpenChange={(next) => { if (next) navigating = false; setOpen(next) }}
      placement="bottom-end" gutter={10} overflowPadding={12}>
      <PopoverTrigger as={Button} type="button" size="icon" variant="ghost" class="relative shrink-0"
        data-testid="ticket-work-status" aria-label={`${text("supervisor_overview_open")} · ${label()}`}>
        <CircleDot aria-hidden="true" />
        <span class="sr-only">{label()}</span>
        <Show when={attention() > 0}>
          <span aria-hidden="true" class="absolute -right-1 -top-1 min-w-4 rounded-full bg-primary px-1 text-xs leading-4 text-primary-foreground">
            {attention() > 99 ? "99+" : attention()}
          </span>
        </Show>
      </PopoverTrigger>
      <PopoverContent aria-label={text("supervisor_overview_open")} data-testid="supervisor-overview"
        style={{ "max-height": "min(32rem, var(--kb-popper-content-available-height, calc(100dvh - 1.5rem)))", width: "min(22rem, calc(100vw - 1.5rem))" }}
        class="overflow-y-auto rounded-2xl p-4 shadow-lg"
        onCloseAutoFocus={(event) => { if (navigating) event.preventDefault() }}>
        <div class="flex items-center gap-3">
          <div class="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-primary/10 text-primary"><CircleDot class="size-6" aria-hidden="true" /></div>
          <div class="min-w-0"><strong class="text-sm">Supervisor</strong><p class="text-xs text-muted-foreground">{text(status())}</p></div>
        </div>
        <div class="mt-3 flex flex-wrap gap-2 text-xs text-muted-foreground">
          <span>{text("ticket_work_count", { count: overview()?.work_count ?? 0 })}</span>
          <Show when={attention() > 0}>
            <span class="rounded-full bg-primary/10 px-2 text-primary">{text("supervisor_work_attention", { count: attention() })}</span>
          </Show>
        </div>
        <Show when={!state()?.current.complete}>
          <p role="status" class="mt-2 text-xs text-muted-foreground">{text("ticket_only_some_work_is_shown_other_work_may_still__ee267ea7")}</p>
        </Show>
        <Show when={!props.controller.connected}>
          <p role="status" class="mt-2 text-xs text-muted-foreground">{text("ticket_the_connection_is_not_confirmed_answers_and_a_aaac8c0d")}</p>
        </Show>
        <Show when={props.controller.error}>
          <p role="alert" class="mt-2 break-words text-xs text-destructive">{text("supervisor_work_status_attention")}</p>
        </Show>
        <h2 class="mb-1 mt-5 text-xs font-medium text-muted-foreground">{text("supervisor_overview_recent")}</h2>
        <For each={works().slice(0, 5)} keyed={(view) => view.ticket.id} fallback={
          <p class="px-2 py-2 text-xs text-muted-foreground">{text(ready() ? "supervisor_overview_empty" : "supervisor_overview_pending")}</p>
        }>{(view) => (
          <button type="button" class={rowStyle} onClick={() => select(view().ticket.id)}>
            <MessageCircle class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate" title={view().ticket.contract.title}>{view().ticket.contract.title}</span>
            <span class="shrink-0 text-xs text-muted-foreground">{statusLabel(view())}</span>
          </button>
        )}</For>
        <h2 class="mb-1 mt-4 text-xs font-medium text-muted-foreground">{text("supervisor_overview_outputs")}</h2>
        <For each={outputs()} keyed={(output) => output.key} fallback={
          <p class="px-2 py-2 text-xs text-muted-foreground">{text(ready() ? "supervisor_overview_no_outputs" : "supervisor_overview_pending")}</p>
        }>{(output) => (
          <button type="button" class={rowStyle} onClick={() => select(output().ticket.id)}>
            <FileText class="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            <span class="min-w-0 flex-1 truncate" title={output().ticket.contract.title}>{output().ticket.contract.title}</span>
            <span class="shrink-0 text-xs text-muted-foreground">{text("ticket_artifact_label", { number: output().number })}</span>
          </button>
        )}</For>
        <button type="button" onClick={() => select(null)}
          class="mt-4 flex w-full items-center justify-center gap-2 rounded-xl border px-3 py-2 text-sm hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {text("supervisor_overview_all")}<ChevronRight class="size-4" aria-hidden="true" />
        </button>
      </PopoverContent>
    </Popover>
  )
}
