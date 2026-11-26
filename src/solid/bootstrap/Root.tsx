import { createContext, createSignal, Match, onSettled, Switch, useContext } from "solid-js"
import type { JSX } from "@solidjs/web"
import { Loader2 } from "@lucide/solid"
import i18n, { i18nReady } from "@shared/i18n/runtime"
import { uiLanguage, uiText } from "@shared/i18n/text"
import { getRuntimeConfig } from "@/runtime/runtimeConfig"
import { verifyServerPassword } from "@/services/bootstrap/serverBootstrap"
import {
  createRootBootstrap,
  diagnosticCopy,
  type BootstrapText,
  type RootView,
} from "@/services/bootstrap/rootBootstrap"
import { Button } from "@/solid/ui/button"
import { PasswordGate } from "./PasswordGate"
import { discardComposerDrafts, localDraftOrigin } from "@/lib/composer/recoverableDrafts"
import { ComposerDraftOriginContext } from "./composerDraftOrigin"

const OwnerAccessContext = createContext(false)

export const useOwnerAccess = () => useContext(OwnerAccessContext)

/** Load this root after the canonical runtime is installed by the entry point. */
export function SolidRoot(props: { renderApp: (ownerAccess: boolean) => JSX.Element }) {
  const runtime = getRuntimeConfig()
  const sidecarStartup = runtime.host.capabilities.sidecarBackend
  const [view, setView] = createSignal<RootView>({ kind: "loading" })
  const [locale, setLocale] = createSignal(uiLanguage())
  const text: BootstrapText = (key) => {
    locale()
    return uiText(key)
  }
  const [draftOrigin, setDraftOrigin] = createSignal<string | null>(null)
  const endDraftScope = () => {
    setDraftOrigin(null)
    discardComposerDrafts()
  }
  const bootstrap = createRootBootstrap({
    sidecarStartup,
    text: uiText,
    onViewChange: (next) => {
      if (next.kind === "auth-required" || next.kind === "auth-unsupported" || next.kind === "repair") {
        endDraftScope()
      }
      setView(next)
    },
    onReadyRequestState: (state) => {
      const origin = state === "local_bypass" && runtime.endpointSource === "tauri-sidecar"
        ? localDraftOrigin(runtime.endpoints.origin, window.location, Boolean(window.opener) || window.top !== window)
        : null
      if (origin) setDraftOrigin(origin)
      else endDraftScope()
    },
  })

  onSettled(() => {
    const onLanguageChange = () => setLocale(uiLanguage())
    i18n.on("languageChanged", onLanguageChange)
    onLanguageChange()
    bootstrap.start()
    return () => {
      bootstrap.cancel()
      i18n.off("languageChanged", onLanguageChange)
    }
  })

  const setup = () => {
    const current = view()
    return current.kind === "setup" ? current : undefined
  }
  const app = () => {
    const current = view()
    return current.kind === "app" ? current : undefined
  }
  const diagnostic = () => {
    const current = view()
    if (current.kind === "loading" || current.kind === "setup" || current.kind === "app" || current.kind === "auth-required") {
      return undefined
    }
    return diagnosticCopy(current, text)
  }

  return (
    <Switch>
      <Match when={view().kind === "loading"}>
        <div class="flex h-full items-center justify-center bg-background p-6">
          <div
            role="status"
            aria-live="polite"
            class="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-lg"
          >
            <div class="mx-auto flex size-12 items-center justify-center rounded-full bg-primary/10">
              <Loader2 aria-hidden="true" class="size-6 animate-spin text-primary motion-reduce:animate-none" />
            </div>
            <h1 class="mt-4 text-xl font-semibold">
              {sidecarStartup ? text("starting_bodhi_41498861") : text("connecting_to_bamboo_a1d9b183")}
            </h1>
            <p class="mt-2 text-sm leading-relaxed text-muted-foreground">
              {sidecarStartup ? text("waiting_for_the_local_bamboo_engine__da692f8f") : text("checking_backend_service_status__e695ea14")}
            </p>
            <p class="mt-2 text-xs text-muted-foreground">
              {sidecarStartup ? text("first_launch_or_complex_configuration_may_take_a_while__cd1be987") : text("please_wait__043bd055")}
            </p>
          </div>
        </div>
      </Match>
      <Match when={setup()} keyed>
        {(current) => (
          <div class="flex h-full items-center justify-center bg-background p-6">
            <div class="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-lg">
              <h1 class="text-xl font-semibold">{text("initial_setup_8a18eafe")}</h1>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{current.message}</p>
              <p class="mt-2 text-xs text-muted-foreground">
                {text("configure_your_provider_and_api_key_in_the_backend_or_d_93002bfd")}
              </p>
              <Button class="mt-5 w-full" onClick={bootstrap.completeSetup}>
                {text("setup_complete_continue_0e3dd041")}
              </Button>
            </div>
          </div>
        )}
      </Match>
      <Match when={view().kind === "auth-required"}>
        <PasswordGate verifyPassword={verifyServerPassword} onVerified={bootstrap.start} text={text} />
      </Match>
      <Match when={app()} keyed>
        {(current) => (
          <OwnerAccessContext value={current.ownerAccess}>
            <ComposerDraftOriginContext value={draftOrigin}>
              {props.renderApp(current.ownerAccess)}
            </ComposerDraftOriginContext>
          </OwnerAccessContext>
        )}
      </Match>
      <Match when={diagnostic()}>
        {(copy) => (
          <div class="flex h-full items-center justify-center bg-background p-6">
            <div class="w-full max-w-sm rounded-2xl border bg-card p-6 text-center shadow-lg">
              <h1 class="text-xl font-semibold">{copy().title}</h1>
              <p class="mt-2 text-sm leading-relaxed text-muted-foreground">{copy().description}</p>
              <p class="mt-3 break-all font-mono text-xs text-muted-foreground">
                {runtime.endpointSource} · v{runtime.artifact.version}
                {runtime.artifact.revision ? `@${runtime.artifact.revision}` : ""}
              </p>
              <Button class="mt-5 w-full" onClick={bootstrap.start}>
                {text("retry_b8784c8d")}
              </Button>
            </div>
          </div>
        )}
      </Match>
    </Switch>
  )
}

// The composition root imports this module after installing the runtime.
await i18nReady
