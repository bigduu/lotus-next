import type { TicketAvailability } from "@services/tickets/availability"
import { Show } from "solid-js"
import { createUiText } from "../../shell/uiText"

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

const reasons = {
  supervisor_mode_required: ["supervisor_work_mode_required", "supervisor_work_mode_guidance"],
  supervisor_identity_mismatch: ["supervisor_work_identity_mismatch", "supervisor_work_identity_guidance"],
  scope_binding_mismatch: ["supervisor_work_binding_mismatch", "supervisor_work_binding_guidance"],
  scope_requires_recovery: ["supervisor_work_requires_recovery", "supervisor_work_recovery_guidance"],
  scope_io_error: ["supervisor_work_storage_error", "supervisor_work_storage_guidance"],
} as const

export function TicketWorkAvailability(props: {
  availability: TicketAvailability
  refreshing: boolean
  canRefresh: boolean
  onRefresh: () => void
  canInitialize?: boolean
  initializing?: boolean
  initializationError?: string | null
  onInitialize?: () => void
}) {
  const text = createUiText()
  const kind = () => props.availability.kind
  const reason = () => {
    const code = props.availability.reasonCode
    if (code === "scope_uninitialized") {
      return ["supervisor_work_uninitialized", props.availability.initialization
        ? "supervisor_work_initialize_guidance" : "supervisor_work_uninitialized_waiting"] as const
    }
    return code && Object.hasOwn(reasons, code) ? reasons[code as keyof typeof reasons] : undefined
  }
  const body = () => {
    const current = kind()
    return current === "loading" || current === "ready" ? undefined : reason()?.[1] ?? guidance[current]
  }
  return <section data-testid="ticket-work-availability" class="space-y-3 p-4 text-sm">
    <p role={kind() === "error" || kind() === "forbidden" ? "alert" : "status"} class="font-medium">{text(reason()?.[0] ?? title[kind()])}</p>
    <Show when={body()}>{(message) => <p class="text-muted-foreground">{text(message())}</p>}</Show>
    <Show when={props.initializationError}><p role="alert" class="text-destructive">{props.initializationError}</p></Show>
    <Show when={props.availability.initialization && props.onInitialize}>
      <button type="button" disabled={!props.canInitialize || props.initializing || props.refreshing} onClick={() => props.onInitialize?.()} class="rounded-md border px-3 py-1.5 disabled:opacity-50">
        {text(props.initializing ? "supervisor_work_initializing" : "supervisor_work_initialize")}
      </button>
    </Show>
    <Show when={props.availability.detail}>
      <details class="text-xs text-muted-foreground">
        <summary class="cursor-pointer">{text("supervisor_work_service_detail")}</summary>
        <p class="mt-2 whitespace-pre-wrap break-words">{props.availability.detail}</p>
      </details>
    </Show>
    <Show when={kind() !== "loading"}>
      <button type="button" disabled={props.refreshing || props.initializing || !props.canRefresh} onClick={() => props.onRefresh()} class="rounded-md border px-3 py-1.5 disabled:opacity-50">
        {text(props.refreshing ? "supervisor_work_loading" : "supervisor_work_retry")}
      </button>
    </Show>
  </section>
}
