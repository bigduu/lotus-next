import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { getErrorMessage } from "@services/api"
import { StatusLine } from "./StatusLine"
import type {
  ContextManagementStrategy,
  SectionMessage,
  SystemBambooConfig,
  SystemConfigApi,
} from "./useSystemConfig"

const explicitlyPersistedStrategy = (
  config: SystemBambooConfig
): ContextManagementStrategy | null => {
  const strategy = config.context_management?.strategy
  return strategy === "summary" || strategy === "message_summary" || strategy === "retrieval_window"
    ? strategy
    : null
}

const configuredStrategy = (config: SystemBambooConfig): ContextManagementStrategy =>
  explicitlyPersistedStrategy(config) ?? "summary"

const strategyOptions = [
  {
    value: "summary",
    label: "context_full_summary_label",
    description: "context_full_summary_description",
    unconfirmed: "the_backend_has_not_confirmed_the_summary_policy_it_is__a1931a8d",
  },
  {
    value: "message_summary",
    label: "context_message_summary_label",
    description: "context_message_summary_description",
    unconfirmed: "context_message_summary_unconfirmed",
  },
  {
    value: "retrieval_window",
    label: "context_retrieval_window_label",
    description: "context_retrieval_window_description",
    unconfirmed: "the_backend_has_not_confirmed_the_retrieval_window_poli_f71a7519",
  },
] as const

/** Configure the model's history strategy without changing an active run. */
export function SectionContextManagement({
  config,
  saveSection,
}: {
  config: SystemBambooConfig
  saveSection: SystemConfigApi["saveSection"]
}) {
  useUiLocale()
  const groupId = useId()
  // Seed once at mount. Other sections share and refresh the same config;
  // re-seeding here would overwrite an unsaved local choice.
  const [selectedStrategy, setSelectedStrategy] = useState(() => configuredStrategy(config))
  const [savedStrategy, setSavedStrategy] = useState(() => configuredStrategy(config))
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<SectionMessage>(null)

  const dirty = selectedStrategy !== savedStrategy

  const save = async () => {
    setBusy(true)
    setMsg(null)
    try {
      const requestedStrategy = selectedStrategy
      const patch: SystemBambooConfig = requestedStrategy === "retrieval_window"
        ? {
            context_management: {
              strategy: "retrieval_window",
              retrieval_window: {
                // Exact-history selection must not silently generate summaries.
                history_tool_required: true,
                fallback_strategy: "none",
              },
            },
          }
        : { context_management: { strategy: requestedStrategy } }
      const saved = await saveSection(patch)
      const persistedStrategy = saved.context_management?.strategy === undefined
        ? "summary"
        : explicitlyPersistedStrategy(saved)
      if (persistedStrategy !== requestedStrategy) {
        const option = strategyOptions.find(({ value }) => value === requestedStrategy)!
        throw new Error(uiText(option.unconfirmed))
      }
      setSelectedStrategy(persistedStrategy)
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
      <div role="radiogroup" aria-label={uiText("context_management_29dde6e6")} className="space-y-2">
        {strategyOptions.map((option) => (
          <label
            key={option.value}
            className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${
              selectedStrategy === option.value ? "border-primary/40 bg-primary/5" : "border-border"
            }`}
          >
            <input
              type="radio"
              name={groupId}
              value={option.value}
              checked={selectedStrategy === option.value}
              disabled={busy}
              aria-labelledby={`${groupId}-${option.value}-label`}
              aria-describedby={`${groupId}-${option.value}-description`}
              className="mt-0.5 size-4 shrink-0"
              style={{ accentColor: "var(--primary)" }}
              onChange={() => {
                setSelectedStrategy(option.value)
                setMsg(null)
              }}
            />
            <span className="min-w-0 space-y-1">
              <span id={`${groupId}-${option.value}-label`} className="block text-sm">
                {uiText(option.label)}
              </span>
              <span id={`${groupId}-${option.value}-description`} className="block text-xs leading-relaxed text-muted-foreground">
                {uiText(option.description)}
              </span>
            </span>
          </label>
        ))}
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {uiText("no_restart_is_needed_changes_apply_to_the_next_run_acti_24de7c6e")}</p>

      {selectedStrategy === "retrieval_window" ? (
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
