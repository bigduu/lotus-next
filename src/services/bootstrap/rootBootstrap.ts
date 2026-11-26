import type { uiEnUs } from "@shared/i18n/resources/ui-en-US"
import { ServiceFactory } from "@services/common/ServiceFactory"
import { requestServerBootstrap, type BootstrapOutcome, type BootstrapRequestState } from "./serverBootstrap"

const RETRY_DELAYS_MS = [250, 500] as const
const SIDECAR_STARTUP_RETRY_WINDOW_MS = 60_000
const SIDECAR_RETRY_MAX_DELAY_MS = 2_000

type NonReadyBootstrapOutcome = Exclude<BootstrapOutcome, { kind: "ready" }>
type DiagnosticOutcome = Exclude<NonReadyBootstrapOutcome, { kind: "auth-required" }>

export type BootstrapText = (key: keyof typeof uiEnUs) => string

export type RootView =
  | { kind: "loading" }
  | { kind: "setup"; message: string; ownerAccess: boolean }
  | { kind: "app"; ownerAccess: boolean }
  | { kind: "internal-failure" }
  | NonReadyBootstrapOutcome

interface ActiveOperation {
  generation: number
  controller: AbortController
  startedAt: number
}

const sidecarRetryDelay = (attempt: number): number =>
  Math.min(250 * 2 ** Math.min(attempt, 3), SIDECAR_RETRY_MAX_DELAY_MS)

const waitForRetry = (ms: number, signal: AbortSignal): Promise<boolean> =>
  new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false)
      return
    }

    const finish = (completed: boolean) => {
      clearTimeout(timer)
      signal.removeEventListener("abort", onAbort)
      resolve(completed)
    }
    const onAbort = () => finish(false)
    const timer = setTimeout(() => finish(true), ms)
    signal.addEventListener("abort", onAbort, { once: true })
  })

export const diagnosticCopy = (
  outcome: DiagnosticOutcome | { kind: "internal-failure" },
  text: BootstrapText,
): { title: string; description: string } => {
  switch (outcome.kind) {
    case "missing":
      return {
        title: text("backend_bootstrap_contract_missing_e730cff1"),
        description:
          text("this_backend_does_not_provide_the_canonical_bootstrap_r_978e5022"),
      }
    case "invalid":
      return {
        title: text("invalid_backend_bootstrap_response_a55ab584"),
        description:
          text("backend_startup_information_could_not_be_parsed_safely__0be87b82"),
      }
    case "incompatible":
      return {
        title: text("incompatible_backend_protocol_260abc98"),
        description:
          text("this_backend_does_not_meet_the_http_v1_and_v2_stream_co_7566de39"),
      }
    case "auth-unsupported":
      return {
        title: text("unsupported_authentication_method_5c205826"),
        description:
          text("this_deployment_accepts_only_device_credentials_this_lo_347b881c"),
      }
    case "repair":
      return {
        title: text("backend_access_configuration_needs_repair_47913701"),
        description:
          text("bamboo_has_isolated_access_control_for_safety_repair_or_e922553b"),
      }
    case "unavailable":
    case "internal-failure":
      return {
        title: text("backend_temporarily_unavailable_42868eee"),
        description:
          text("bamboo_is_temporarily_unavailable_check_that_the_servic_f2489632"),
      }
  }
}

/** One generation owns bootstrap retries and post-admission setup. */
export function createRootBootstrap({
  sidecarStartup,
  text,
  onViewChange,
  onReadyRequestState,
}: {
  sidecarStartup: boolean
  text: BootstrapText
  onViewChange: (view: RootView) => void
  onReadyRequestState?: (state: BootstrapRequestState) => void
}) {
  let view: RootView = { kind: "loading" }
  let generation = 0
  let activeOperation: ActiveOperation | null = null

  const publish = (next: RootView) => {
    view = next
    onViewChange(next)
  }

  const beginOperation = (): ActiveOperation => {
    activeOperation?.controller.abort()
    const operation = {
      generation: ++generation,
      controller: new AbortController(),
      startedAt: Date.now(),
    }
    activeOperation = operation
    return operation
  }

  const isCurrent = (operation: ActiveOperation) =>
    !operation.controller.signal.aborted &&
    activeOperation?.generation === operation.generation &&
    activeOperation.controller === operation.controller

  /** Preserve the existing setup card and fail-open behavior after admission. */
  const resolveSetup = async (operation: ActiveOperation, ownerAccess: boolean) => {
    try {
      const setup = await ServiceFactory.getInstance().getSetupStatus()
      if (!isCurrent(operation)) return
      if (!setup.is_complete && !setup.model_setup_in_app) {
        publish({
          kind: "setup",
          ownerAccess,
          message: setup.message || text("initial_app_setup_is_not_complete__38590db7"),
        })
        return
      }
    } catch {
      if (!isCurrent(operation)) return
      // The local/dev setup request may fail open only after bootstrap admission.
    }

    if (isCurrent(operation)) publish({ kind: "app", ownerAccess })
  }

  const runBootstrap = async (operation: ActiveOperation) => {
    for (let attempt = 0; ; attempt += 1) {
      let outcome: BootstrapOutcome
      const auth: { requestState?: BootstrapRequestState } = {}
      try {
        outcome = await requestServerBootstrap(operation.controller.signal, (state) => {
          auth.requestState = state
        })
      } catch {
        if (isCurrent(operation)) {
          // Unexpected rejections fail safely without exposing arbitrary errors.
          publish({ kind: "internal-failure" })
        }
        return
      }

      if (!isCurrent(operation)) return

      if (outcome.kind === "unavailable") {
        const elapsed = Date.now() - operation.startedAt
        const remaining = SIDECAR_STARTUP_RETRY_WINDOW_MS - elapsed
        const delay = sidecarStartup
          ? Math.min(sidecarRetryDelay(attempt), remaining)
          : RETRY_DELAYS_MS[attempt]

        if (delay === undefined || delay <= 0) {
          publish(outcome)
          return
        }

        const completed = await waitForRetry(delay, operation.controller.signal)
        if (!completed || !isCurrent(operation)) return
        continue
      }

      if (outcome.kind === "ready") {
        const requestState = auth.requestState
        if (requestState) onReadyRequestState?.(requestState)
        await resolveSetup(operation, requestState === "local_bypass" || requestState === "authenticated")
        return
      }

      publish(outcome)
      return
    }
  }

  const start = () => {
    const operation = beginOperation()
    publish({ kind: "loading" })
    void runBootstrap(operation)
  }

  const completeSetup = () => {
    if (view.kind !== "setup") return
    const { ownerAccess } = view
    const operation = beginOperation()
    publish({ kind: "loading" })
    void (async () => {
      await ServiceFactory.getInstance().markSetupComplete().catch(() => undefined)
      if (isCurrent(operation)) await resolveSetup(operation, ownerAccess)
    })()
  }

  const cancel = () => {
    generation += 1
    activeOperation?.controller.abort()
    activeOperation = null
  }

  return { start, completeSetup, cancel }
}
