import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useState } from "react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { getErrorMessage } from "@services/api"
import { StatusLine } from "./StatusLine"
import type {
  ContextManagementStrategy,
  SectionMessage,
  SystemBambooConfig,
  SystemConfigApi,
} from "./useSystemConfig"

const configuredStrategy = (config: SystemBambooConfig): ContextManagementStrategy =>
  config.context_management?.strategy === "retrieval_window" ? "retrieval_window" : "summary"

const explicitlyPersistedStrategy = (
  config: SystemBambooConfig
): ContextManagementStrategy | null => {
  const strategy = config.context_management?.strategy
  return strategy === "summary" || strategy === "retrieval_window" ? strategy : null
}

/** 上下文管理 — 在滚动摘要与精确历史检索窗口之间切换。 */
export function SectionContextManagement({
  config,
  saveSection,
}: {
  config: SystemBambooConfig
  saveSection: SystemConfigApi["saveSection"]
}) {
  useUiLocale()
  // Seed once at mount. Other sections share and refresh the same config;
  // re-seeding here would overwrite an unsaved local choice.
  const initialStrategy = configuredStrategy(config)
  const [summariesEnabled, setSummariesEnabled] = useState(initialStrategy === "summary")
  const [savedStrategy, setSavedStrategy] = useState<ContextManagementStrategy>(initialStrategy)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<SectionMessage>(null)

  const selectedStrategy: ContextManagementStrategy = summariesEnabled
    ? "summary"
    : "retrieval_window"
  const dirty = selectedStrategy !== savedStrategy

  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const requestedStrategy = selectedStrategy
      const patch: SystemBambooConfig = requestedStrategy === "summary"
        ? { context_management: { strategy: "summary" } }
        : {
            context_management: {
              strategy: "retrieval_window",
              retrieval_window: {
                // "Off" must really mean no model-generated summary fallback.
                history_tool_required: true,
                fallback_strategy: "none",
              },
            },
          }
      const saved = await saveSection(patch)
      const explicitStrategy = explicitlyPersistedStrategy(saved)
      const persistedStrategy = explicitStrategy ?? "summary"
      if (persistedStrategy !== requestedStrategy) {
        throw new Error(
          requestedStrategy === "retrieval_window"
            ? uiText("the_backend_has_not_confirmed_the_retrieval_window_poli_f71a7519")
            : uiText("the_backend_has_not_confirmed_the_summary_policy_it_is__a1931a8d")
        )
      }
      setSummariesEnabled(persistedStrategy === "summary")
      setSavedStrategy(persistedStrategy)
      setMsg({ kind: "ok", text: uiText("saved_1bd91a7d") })
    } catch (e) {
      setMsg({ kind: "error", text: getErrorMessage(e) })
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-2 rounded-lg border p-3">
      <div className="text-xs font-medium text-muted-foreground">{uiText("context_management_29dde6e6")}</div>
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 space-y-0.5">
          <div className="text-sm">{uiText("generate_context_summaries_automatically_20f4d495")}</div>
          <p className="text-xs leading-relaxed text-muted-foreground">
            {summariesEnabled
              ? uiText("generate_rolling_summaries_with_a_background_model_when_b05db783")
              : uiText("off_use_a_retrieval_window_original_messages_remain_in__98aada95")}
          </p>
        </div>
        <Switch
          checked={summariesEnabled}
          disabled={busy}
          onCheckedChange={(checked) => {
            setSummariesEnabled(checked)
            setMsg(null)
          }}
          aria-label={uiText("generate_context_summaries_automatically_20f4d495")}
        />
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {uiText("no_restart_is_needed_changes_apply_to_the_next_run_acti_24de7c6e")}</p>

      {!summariesEnabled ? (
        <p className="rounded-md bg-muted px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">
          {uiText("sessions_with_existing_summaries_are_not_converted_auto_d1b0f8c0")}</p>
      ) : null}

      <div className="flex items-center justify-between gap-2">
        <StatusLine msg={msg} />
        <Button size="sm" className="ml-auto" onClick={save} disabled={busy || !dirty}>
          {busy ? uiText("saving_ff509c9b") : uiText("save_a3030bf8")}
        </Button>
      </div>
    </section>
  )
}
