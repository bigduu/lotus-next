import { Show } from "solid-js"

import { createUiText } from "../shell/uiText"
import { Badge } from "../ui/badge"
import { projectScanBlockerText, projectScanModeText, projectScanResultText, type createProjectScan } from "./createProjectScan"

export function ProjectScanSummary({ scan }: { scan: ReturnType<typeof createProjectScan> }) {
  const text = createUiText()

  return (
    <Show when={scan.status() || scan.error()}>
      <section aria-label={text("project_scan_title")} class="mb-3 min-w-0 rounded-lg border px-3 py-2 text-sm">
        <Show when={scan.status()} fallback={<span class="font-medium">{text("project_scan_title")}</span>}>{(value) => {
          const activity = () => {
            if (value().mode !== "enabled") return null
            if (!value().available) return "project_scan_dispatch_unavailable" as const
            const result = value().last_result
            return result === "idle" || (result === "waiting" && value().last_check?.blocker)
              ? null : projectScanResultText[result]
          }
          return (
            <>
              <div class="flex min-w-0 flex-wrap items-center justify-between gap-x-4 gap-y-1">
                <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                  <span class="font-medium">{text("project_scan_title")}</span>
                  <Badge variant={value().mode === "enabled" ? "secondary" : "outline"} role="status">
                    {text(projectScanModeText[value().mode])}
                  </Badge>
                  <Show when={activity()}>{(key) => <span class="text-xs text-muted-foreground">{text(key())}</span>}</Show>
                </div>
                <div class="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
                  <Show when={value().model}>{(model) => (
                    <span class="min-w-0 wrap-anywhere">{text("project_scan_model", { model: model() })}</span>
                  )}</Show>
                  <span class="tabular-nums">{text("project_scan_usage", {
                    requests: value().usage.model_requests,
                    input: value().usage.tokens.prompt_tokens,
                    output: value().usage.tokens.completion_tokens,
                  })}</span>
                  <Show when={value().usage.unknown_requests > 0}>
                    <span>{text("project_scan_unknown_usage", { count: value().usage.unknown_requests })}</span>
                  </Show>
                </div>
              </div>
              <Show when={value().mode === "enabled" && value().available && value().last_check}>{(check) => (
                <div class="mt-2 min-w-0 space-y-0.5 border-t pt-2 text-xs wrap-anywhere">
                  <p class="font-medium" title={check().work_id}>{check().title}</p>
                  <Show when={check().blocker}>{(blocker) => {
                    const detail = () => {
                      const reason = blocker()
                      const key = projectScanBlockerText[reason.kind]
                      return reason.kind === "required_file_unavailable" ? text(key, { path: reason.path }) : text(key)
                    }
                    return <p class="text-muted-foreground">{detail()}</p>
                  }}</Show>
                  <Show when={check().summary}>{(summary) => <p class="text-muted-foreground">{summary()}</p>}</Show>
                </div>
              )}</Show>
            </>
          )
        }}</Show>
        <Show when={scan.error()}>{(message) => <p role="alert" class="mt-1 text-xs wrap-anywhere text-destructive">{message()}</p>}</Show>
      </section>
    </Show>
  )
}
