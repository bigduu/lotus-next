import { i18nReady } from "@shared/i18n"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useState } from "react"
import { Loader2 } from "lucide-react"
import App from "./App"
import { OwnerAccessContext } from "@/hooks/ownerAccessContext"
import { PasswordGate } from "@/components/auth/PasswordGate"
import { Button } from "@/components/ui/button"
import { verifyServerPassword } from "@/services/bootstrap/serverBootstrap"
import { createRootBootstrap, diagnosticCopy, type RootView } from "@/services/bootstrap/rootBootstrap"
import { getRuntimeConfig } from "@/runtime/runtimeConfig"

/** Shared boot composition for the React application. */
export default function Root() {
  useUiLocale()
  const runtime = getRuntimeConfig()
  const sidecarStartup = runtime.host.capabilities.sidecarBackend
  const [view, setView] = useState<RootView>({ kind: "loading" })
  const [bootstrap] = useState(() => createRootBootstrap({
    sidecarStartup,
    text: uiText,
    onViewChange: setView,
  }))

  useEffect(() => {
    bootstrap.start()
    return bootstrap.cancel
  }, [bootstrap])

  if (view.kind === "loading") {
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
          <Button className="mt-5 w-full" onClick={bootstrap.completeSetup}>
             {uiText("setup_complete_continue_0e3dd041")}</Button>
        </div>
      </div>
    )
  }

  if (view.kind === "auth-required") {
    return (
      <PasswordGate
        verifyPassword={verifyServerPassword}
        onVerified={bootstrap.start}
      />
    )
  }

  if (view.kind === "app") return (
    <OwnerAccessContext value={view.ownerAccess}><App /></OwnerAccessContext>
  )

  const copy = diagnosticCopy(view, uiText)
  return (
    <div className="flex h-full items-center justify-center bg-background p-6">
      <div className="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-lg">
        <h1 className="text-xl font-semibold">{copy.title}</h1>
        <p className="mt-2 text-sm leading-relaxed text-muted-foreground">{copy.description}</p>
        <p className="mt-3 break-all font-mono text-xs text-muted-foreground">
          {runtime.endpointSource} · v{runtime.artifact.version}
          {runtime.artifact.revision ? `@${runtime.artifact.revision}` : ""}
        </p>
        <Button className="mt-5 w-full" onClick={bootstrap.start}>
           {uiText("retry_b8784c8d")}</Button>
      </div>
    </div>
  )
}

// Bootstrap imports Root only after installing runtime. Await locale resources
// here so the first React render never flashes keys or the wrong language.
await i18nReady
