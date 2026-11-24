import { createEffect, createSignal, For, lazy, Loading, Match, Show, Switch } from "solid-js"
import {
  JIANDU_MEMORY_STATUSES, JIANDU_MEMORY_TYPES, JianduMemoryApiError, jianduMemoryApi,
  type JianduMemoryOverview, type JianduMemoryOverviewClient,
} from "@/services/memory/jianduMemoryApi"
import { Button } from "../../ui/button"
import { createJianduText } from "./text"

const ProjectMemories = lazy(() => import("./JianduProjectMemories"), { export: "JianduProjectMemories" })

type State = { status: "loading" }
  | { status: "error"; error: "unavailable" | "malformed" | "denied" }
  | { status: "ready"; overview: JianduMemoryOverview }

export function SettingsJiandu(props: { api?: JianduMemoryOverviewClient }) {
  const { t, locale } = createJianduText()
  const [management, setManagement] = createSignal(false)
  const [refresh, setRefresh] = createSignal(0)
  const [state, setState] = createSignal<State>({ status: "loading" })
  const overview = () => {
    const current = state()
    return current.status === "ready" ? current.overview : null
  }
  const error = () => {
    const current = state()
    return current.status === "error" ? current.error : null
  }

  createEffect(() => [props.api ?? jianduMemoryApi, management(), refresh()] as const, ([api, managing]) => {
    if (managing) return
    let current = true
    setState({ status: "loading" })
    void api.getOverview().then((value) => {
      if (current) setState({ status: "ready", overview: value })
    }).catch((failure: unknown) => {
      if (!current) return
      const code = failure instanceof JianduMemoryApiError ? failure.code : null
      setState({ status: "error", error: code === "malformed_response" ? "malformed" : code === "access_denied" ? "denied" : "unavailable" })
    })
    return () => { current = false }
  })

  const timestamp = (value: string | null) => value
    ? new Intl.DateTimeFormat(locale(), { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : t("overview.noTimestamp")

  return <div class="mx-auto max-w-3xl space-y-4" data-settings-jiandu="">
    <Switch>
      <Match when={management()}>
        <Button type="button" variant="outline" onClick={() => setManagement(false)}>{t("overview.back")}</Button>
        <Loading fallback={<p role="status">{t("list.loading")}</p>}>
          <ProjectMemories />
        </Loading>
      </Match>
      <Match when={!management()}>
        <header class="flex flex-wrap items-start justify-between gap-3">
          <div class="space-y-1">
            <h2 class="text-lg font-semibold">{t("overview.title")}</h2>
            <p class="text-sm text-muted-foreground">{t("overview.description")}</p>
          </div>
          <Button type="button" variant="outline" disabled={state().status === "loading"} onClick={() => setRefresh((value) => value + 1)}>
            {t("overview.refresh")}
          </Button>
        </header>
        <section aria-label={t("overview.scopes")} class="flex flex-col gap-3 sm:flex-row">
          <For each={["global", "session", "project"] as const}>{(scope) =>
            <div class="min-w-0 flex-1 space-y-1 rounded-lg border p-3">
              <h3 class="text-sm font-medium">{t("overview." + scope + "Title")}</h3>
              <p class="text-xs leading-relaxed text-muted-foreground">{t("overview." + scope + "Description")}</p>
            </div>
          }</For>
        </section>
        <Show when={state().status === "loading"}><p role="status">{t("overview.loading")}</p></Show>
        <Show when={error()}>{(failure) =>
          <p role="alert" class="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">{t("overview.errors." + failure())}</p>
        }</Show>
        <Show when={overview()}>{(current) =>
          <section aria-label={t("overview.inventory")} class="space-y-3">
            <div>
              <h3 class="text-sm font-semibold">{t("overview.inventory")}</h3>
              <p class="mt-1 text-xs text-muted-foreground">{t("overview.inventoryDescription")}</p>
            </div>
            <dl class="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <For each={[
                ["total", "totalMemories"], ["globalCount", "globalMemories"],
                ["projectCount", "projectMemories"], ["projects", "projectCount"],
              ] as const}>{([label, field]) =>
                <div class="rounded-lg border p-3">
                  <dt class="text-xs text-muted-foreground">{t("overview." + label)}</dt>
                  <dd class="mt-1 text-xl font-semibold tabular-nums">{current()[field].toLocaleString(locale())}</dd>
                </div>
              }</For>
            </dl>
            <div class="grid gap-3 sm:grid-cols-2">
              <For each={[
                ["byType", JIANDU_MEMORY_TYPES, "types"],
                ["byStatus", JIANDU_MEMORY_STATUSES, "statuses"],
              ] as const}>{([label, keys, translations]) =>
                <section aria-label={t("overview." + label)} class="rounded-lg border p-3">
                  <h4 class="mb-2 text-sm font-medium">{t("overview." + label)}</h4>
                  <dl class="space-y-2 text-sm">
                    <For each={keys as readonly string[]}>{(key) =>
                      <div class="flex items-center justify-between gap-3">
                        <dt class="text-muted-foreground">{t(translations + "." + key)}</dt>
                        <dd class="tabular-nums">{(current()[label] as Record<string, number>)[key].toLocaleString(locale())}</dd>
                      </div>
                    }</For>
                  </dl>
                </section>
              }</For>
            </div>
            <dl class="grid gap-2 text-xs sm:grid-cols-2">
              <div><dt class="text-muted-foreground">{t("overview.lastReindex")}</dt><dd>{timestamp(current().lastReindexAt)}</dd></div>
              <div><dt class="text-muted-foreground">{t("overview.lastDream")}</dt><dd>{timestamp(current().lastDreamAt)}</dd></div>
            </dl>
          </section>
        }</Show>
        <section class="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
          <p class="text-xs text-muted-foreground">{t("overview.manageDescription")}</p>
          <Button type="button" variant="outline" onClick={() => setManagement(true)}>{t("overview.manage")}</Button>
        </section>
      </Match>
    </Switch>
  </div>
}
