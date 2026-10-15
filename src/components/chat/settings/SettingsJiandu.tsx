import { lazy, Suspense, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

import { Button } from "@/components/ui/button"
import {
  JIANDU_MEMORY_STATUSES,
  JIANDU_MEMORY_TYPES,
  JianduMemoryApiError,
  jianduMemoryApi,
  type JianduMemoryOverview,
  type JianduMemoryOverviewClient,
} from "@/services/memory/jianduMemoryApi"

const ProjectMemories = lazy(() => import("./JianduProjectMemories").then((module) => ({
  default: module.JianduProjectMemories,
})))

type OverviewState =
  | { status: "loading" }
  | { status: "error"; error: "unavailable" | "malformed" | "denied" }
  | { status: "ready"; overview: JianduMemoryOverview }

/** System-wide entry: selecting a chat never selects the overview's scope. */
export function SettingsJiandu({ api = jianduMemoryApi }: { api?: JianduMemoryOverviewClient }) {
  const { t, i18n } = useTranslation()
  const [managingProject, setManagingProject] = useState(false)
  const [refresh, setRefresh] = useState(0)
  const [state, setState] = useState<OverviewState>({ status: "loading" })

  useEffect(() => {
    if (managingProject) return
    let cancelled = false
    setState({ status: "loading" })
    void api.getOverview().then((overview) => {
      if (!cancelled) setState({ status: "ready", overview })
    }).catch((error: unknown) => {
      if (cancelled) return
      const code = error instanceof JianduMemoryApiError ? error.code : null
      setState({ status: "error", error: code === "malformed_response" ? "malformed"
        : code === "access_denied" ? "denied" : "unavailable" })
    })
    return () => { cancelled = true }
  }, [api, managingProject, refresh])

  if (managingProject) return (
    <div className="mx-auto max-w-3xl space-y-4">
      <Button variant="outline" onClick={() => setManagingProject(false)}>
        {t("settings.jiandu.overview.back")}
      </Button>
      <Suspense fallback={<p role="status">{t("settings.jiandu.list.loading")}</p>}>
        <ProjectMemories />
      </Suspense>
    </div>
  )

  const overview = state.status === "ready" ? state.overview : null
  const timestamp = (value: string | null) => value
    ? new Intl.DateTimeFormat(i18n.language, { dateStyle: "medium", timeStyle: "short" }).format(new Date(value))
    : t("settings.jiandu.overview.noTimestamp")

  return (
    <div className="mx-auto max-w-3xl space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="space-y-1">
          <h2 className="text-lg font-semibold">{t("settings.jiandu.overview.title")}</h2>
          <p className="text-sm text-muted-foreground">{t("settings.jiandu.overview.description")}</p>
        </div>
        <Button variant="outline" disabled={state.status === "loading"} onClick={() => setRefresh((value) => value + 1)}>
          {t("settings.jiandu.overview.refresh")}
        </Button>
      </header>

      <section aria-label={t("settings.jiandu.overview.scopes")} className="flex flex-col gap-3 sm:flex-row">
        {(["global", "session", "project"] as const).map((scope) => (
          <div key={scope} className="min-w-0 flex-1 space-y-1 rounded-lg border p-3">
            <h3 className="text-sm font-medium">{t(`settings.jiandu.overview.${scope}Title`)}</h3>
            <p className="text-xs leading-relaxed text-muted-foreground">{t(`settings.jiandu.overview.${scope}Description`)}</p>
          </div>
        ))}
      </section>

      {state.status === "loading" ? <p role="status">{t("settings.jiandu.overview.loading")}</p> : null}
      {state.status === "error" ? (
        <p role="alert" className="rounded-lg border border-destructive/40 p-3 text-sm text-destructive">
          {t(`settings.jiandu.overview.errors.${state.error}`)}
        </p>
      ) : null}

      {overview ? (
        <section aria-label={t("settings.jiandu.overview.inventory")} className="space-y-3">
          <div>
            <h3 className="text-sm font-semibold">{t("settings.jiandu.overview.inventory")}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{t("settings.jiandu.overview.inventoryDescription")}</p>
          </div>
          <dl className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {([
              ["total", overview.totalMemories], ["globalCount", overview.globalMemories],
              ["projectCount", overview.projectMemories], ["projects", overview.projectCount],
            ] as const).map(([label, count]) => (
              <div key={label} className="rounded-lg border p-3">
                <dt className="text-xs text-muted-foreground">{t(`settings.jiandu.overview.${label}`)}</dt>
                <dd className="mt-1 text-xl font-semibold tabular-nums">{count.toLocaleString(i18n.language)}</dd>
              </div>
            ))}
          </dl>
          <div className="grid gap-3 sm:grid-cols-2">
            {([
              ["byType", JIANDU_MEMORY_TYPES, overview.byType, "types"],
              ["byStatus", JIANDU_MEMORY_STATUSES, overview.byStatus, "statuses"],
            ] as const).map(([label, keys, counts, translations]) => (
              <section key={label} aria-label={t(`settings.jiandu.overview.${label}`)} className="rounded-lg border p-3">
                <h4 className="mb-2 text-sm font-medium">{t(`settings.jiandu.overview.${label}`)}</h4>
                <dl className="space-y-2 text-sm">
                  {keys.map((key) => (
                    <div key={key} className="flex items-center justify-between gap-3">
                      <dt className="text-muted-foreground">{t(`settings.jiandu.${translations}.${key}`)}</dt>
                      <dd className="tabular-nums">{(counts as Record<string, number>)[key].toLocaleString(i18n.language)}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            ))}
          </div>
          <dl className="grid gap-2 text-xs sm:grid-cols-2">
            <div><dt className="text-muted-foreground">{t("settings.jiandu.overview.lastReindex")}</dt><dd>{timestamp(overview.lastReindexAt)}</dd></div>
            <div><dt className="text-muted-foreground">{t("settings.jiandu.overview.lastDream")}</dt><dd>{timestamp(overview.lastDreamAt)}</dd></div>
          </dl>
        </section>
      ) : null}

      <section className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-3">
        <p className="text-xs text-muted-foreground">{t("settings.jiandu.overview.manageDescription")}</p>
        <Button variant="outline" onClick={() => setManagingProject(true)}>{t("settings.jiandu.overview.manage")}</Button>
      </section>
    </div>
  )
}
