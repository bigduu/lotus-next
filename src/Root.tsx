import { i18nReady } from "@shared/i18n"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useCallback, useEffect, useRef, useState } from "react"
import { Loader2 } from "lucide-react"
import App from "./App"
import { OwnerAccessContext } from "@/hooks/ownerAccessContext"
import { PasswordGate } from "@/components/auth/PasswordGate"
import { Button } from "@/components/ui/button"
import {
  requestServerBootstrap,
  verifyServerPassword,
  type BootstrapOutcome,
} from "@/services/bootstrap/serverBootstrap"
import { ServiceFactory } from "@services/common/ServiceFactory"
import { getRuntimeConfig } from "@/runtime/runtimeConfig"

const RETRY_DELAYS_MS = [250, 500] as const
const SIDECAR_STARTUP_RETRY_WINDOW_MS = 60_000
const SIDECAR_RETRY_MAX_DELAY_MS = 2_000

type NonReadyBootstrapOutcome = Exclude<BootstrapOutcome, { kind: "ready" }>
type DiagnosticOutcome = Exclude<NonReadyBootstrapOutcome, { kind: "auth-required" }>

type RootView =
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

const diagnosticCopy = (
  outcome: DiagnosticOutcome | { kind: "internal-failure" },
): { title: string; description: string } => {
  switch (outcome.kind) {
    case "missing":
      return {
        title: uiText("backend_bootstrap_contract_missing_e730cff1"),
        description:
          uiText("this_backend_does_not_provide_the_canonical_bootstrap_r_978e5022"),
      }
    case "invalid":
      return {
        title: uiText("invalid_backend_bootstrap_response_a55ab584"),
        description:
          uiText("backend_startup_information_could_not_be_parsed_safely__0be87b82"),
      }
    case "incompatible":
      return {
        title: uiText("incompatible_backend_protocol_260abc98"),
        description:
          uiText("this_backend_does_not_meet_the_http_v1_and_v2_stream_co_7566de39"),
      }
    case "auth-unsupported":
      return {
        title: uiText("unsupported_authentication_method_5c205826"),
        description:
          uiText("this_deployment_accepts_only_device_credentials_this_lo_347b881c"),
      }
    case "repair":
      return {
        title: uiText("backend_access_configuration_needs_repair_47913701"),
        description:
          uiText("bamboo_has_isolated_access_control_for_safety_repair_or_e922553b"),
      }
    case "unavailable":
    case "internal-failure":
      return {
        title: uiText("backend_temporarily_unavailable_42868eee"),
        description:
          uiText("bamboo_is_temporarily_unavailable_check_that_the_servic_f2489632"),
      }
  }
}

/**
 * Shared boot composition for every Lotus Next surface.
 *
 * Bootstrap state is deliberately ephemeral and local to this root. A single
 * generation owns bootstrap retries plus the existing non-cancellable setup
 * request, so StrictMode, manual retry, password revalidation, and unmount can
 * never publish a stale result.
 */
export default function Root() {
  useUiLocale()
  const runtime = getRuntimeConfig()
  const [view, setView] = useState<RootView>({ kind: "loading" })
  const generationRef = useRef(0)
  const activeOperationRef = useRef<ActiveOperation | null>(null)

  const beginOperation = useCallback((): ActiveOperation => {
    activeOperationRef.current?.controller.abort()
    const operation = {
      generation: generationRef.current + 1,
      controller: new AbortController(),
      startedAt: Date.now(),
    }
    generationRef.current = operation.generation
    activeOperationRef.current = operation
    return operation
  }, [])

  const isCurrent = useCallback(
    (operation: ActiveOperation): boolean =>
      !operation.controller.signal.aborted &&
      activeOperationRef.current?.generation === operation.generation &&
      activeOperationRef.current.controller === operation.controller,
    [],
  )

  /** Post-bootstrap: preserve the existing setup card and fail-open behavior. */
  const resolveSetup = useCallback(
    async (operation: ActiveOperation, ownerAccess: boolean) => {
      try {
        const setup = await ServiceFactory.getInstance().getSetupStatus()
        if (!isCurrent(operation)) return
        if (!setup.is_complete) {
          setView({
            kind: "setup",
            ownerAccess,
            message: setup.message || uiText("initial_app_setup_is_not_complete__38590db7"),
          })
          return
        }
      } catch {
        if (!isCurrent(operation)) return
        // Setup protocol migration is a separate slice. Preserve the current
        // local/dev fail-open behavior only after bootstrap admission.
      }

      if (isCurrent(operation)) setView({ kind: "app", ownerAccess })
    },
    [isCurrent],
  )

  const runBootstrap = useCallback(
    async (operation: ActiveOperation) => {
      for (let attempt = 0; ; attempt += 1) {
        let outcome: BootstrapOutcome
        let ownerAccess = false
        try {
          outcome = await requestServerBootstrap(operation.controller.signal, (state) => {
            ownerAccess = state === "local_bypass" || state === "authenticated"
          })
        } catch {
          if (!isCurrent(operation)) return
          // The service rejects only for caller cancellation. Any unexpected
          // rejection remains a safe, non-diagnostic failure and never mounts App.
          setView({ kind: "internal-failure" })
          return
        }

        if (!isCurrent(operation)) return

        if (outcome.kind === "unavailable") {
          const sidecarStartup = runtime.host.capabilities.sidecarBackend
          const elapsed = Date.now() - operation.startedAt
          const remaining = SIDECAR_STARTUP_RETRY_WINDOW_MS - elapsed
          const delay = sidecarStartup
            ? Math.min(sidecarRetryDelay(attempt), remaining)
            : RETRY_DELAYS_MS[attempt]

          if (delay === undefined || delay <= 0) {
            setView(outcome)
            return
          }

          const completed = await waitForRetry(delay, operation.controller.signal)
          if (!completed || !isCurrent(operation)) return
          continue
        }

        if (outcome.kind === "ready") {
          await resolveSetup(operation, ownerAccess)
          return
        }

        setView(outcome)
        return
      }
    },
    [isCurrent, resolveSetup, runtime.host.capabilities.sidecarBackend],
  )

  const startBootstrap = useCallback(() => {
    const operation = beginOperation()
    setView({ kind: "loading" })
    void runBootstrap(operation)
  }, [beginOperation, runBootstrap])

  const completeSetup = useCallback(() => {
    const ownerAccess = view.kind === "setup" && view.ownerAccess
    const operation = beginOperation()
    setView({ kind: "loading" })
    void (async () => {
      await ServiceFactory.getInstance().markSetupComplete().catch(() => undefined)
      if (!isCurrent(operation)) return
      await resolveSetup(operation, ownerAccess)
    })()
  }, [beginOperation, isCurrent, resolveSetup, view])

  useEffect(() => {
    startBootstrap()
    return () => {
      generationRef.current += 1
      activeOperationRef.current?.controller.abort()
      activeOperationRef.current = null
    }
  }, [startBootstrap])

  if (view.kind === "loading") {
    const sidecarStartup = runtime.host.capabilities.sidecarBackend
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div
          role="status"
          aria-live="polite"
          className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-lg"
        >
          <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
            <Loader2
              aria-hidden="true"
              className="size-6 animate-spin text-primary motion-reduce:animate-none"
            />
          </div>
          <h1 className="mt-4 text-xl font-semibold">
            {sidecarStartup ? uiText("starting_bodhi_41498861") : uiText("connecting_to_bamboo_a1d9b183")}
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
            {sidecarStartup ? uiText("waiting_for_the_local_bamboo_engine__da692f8f") : uiText("checking_backend_service_status__e695ea14")}
          </p>
          <p className="mt-2 text-xs text-muted-foreground">
            {sidecarStartup ? uiText("first_launch_or_complex_configuration_may_take_a_while__cd1be987") : uiText("please_wait__043bd055")}
          </p>
        </div>
      </div>
    )
  }

  if (view.kind === "setup") {
    return (
      <div className="flex h-full items-center justify-center bg-background p-6">
        <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-lg">
          <h1 className="text-xl font-semibold">{uiText("initial_setup_8a18eafe")}</h1>
          <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{view.message}</p>
          <p className="mt-2 text-xs text-muted-foreground">
             {uiText("configure_your_provider_and_api_key_in_the_backend_or_d_93002bfd")}</p>
          <Button className="mt-5 w-full" onClick={completeSetup}>
             {uiText("setup_complete_continue_0e3dd041")}</Button>
        </div>
      </div>
    )
  }

  if (view.kind === "auth-required") {
    return (
      <PasswordGate
        verifyPassword={verifyServerPassword}
        onVerified={startBootstrap}
      />
    )
  }

  if (view.kind === "app") return (
    <OwnerAccessContext value={view.ownerAccess}><App /></OwnerAccessContext>
  )

  const copy = diagnosticCopy(view)
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-lg">
        <h1 className="text-xl font-semibold">{copy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{copy.description}</p>
        <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
          {runtime.endpointSource} · v{runtime.artifact.version}
          {runtime.artifact.revision ? `@${runtime.artifact.revision}` : ""}
        </p>
        <Button className="mt-5 w-full" onClick={startBootstrap}>
           {uiText("retry_b8784c8d")}</Button>
      </div>
    </div>
  )
}

// Bootstrap imports Root only after installing runtime. Await locale resources
// here so the first React render never flashes keys or the wrong language.
await i18nReady
