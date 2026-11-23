import { useId, useState } from "react"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { getErrorMessage } from "@services/api"
import { serviceFactory } from "@services/common/ServiceFactory"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import { isReasoningEffort } from "@shared/utils/reasoningEffort"
import { REASONING_OPTIONS } from "@/lib/settings/reasoningOptions"
import { StatusLine } from "./StatusLine"
import type { SectionMessage, SystemBambooConfig, WorkExecutionSettings, WorkFeatureFlags } from "./useSystemConfig"

const controls = [
  { flag: "ticket_mutation", label: "work_settings_mutation", description: "work_settings_mutation_description" },
  { flag: "ticket_dispatch", label: "work_settings_dispatch", description: "work_settings_dispatch_description" },
] as const

const MAX_PARALLEL = 4_294_967_295

export function SectionWork({ flags }: { flags: WorkFeatureFlags }) {
  useUiLocale()
  const id = useId()
  const [savedFlags, setSavedFlags] = useState(flags)
  const [draft, setDraft] = useState(flags)
  const [parallelInput, setParallelInput] = useState(() => String(flags.work_execution?.max_parallel ?? ""))
  const [saving, setSaving] = useState(false)
  const [message, setMessage] = useState<SectionMessage>(null)
  const work = draft.work_execution
  const ultraSupported = typeof draft.work_ultra_by_default === "boolean"
  const ultraSelected = draft.work_ultra_by_default === true

  const changes: Partial<Omit<WorkFeatureFlags, "work_execution">> = {}
  for (const { flag } of controls) {
    if (draft[flag] !== savedFlags[flag]) changes[flag] = draft[flag]
  }
  if (ultraSupported && draft.work_ultra_by_default !== savedFlags.work_ultra_by_default) {
    changes.work_ultra_by_default = draft.work_ultra_by_default
  }
  const workChanges: Partial<WorkExecutionSettings> = {}
  const trimmed = parallelInput.trim()
  const maxParallel = trimmed === "" ? null : Number(trimmed)
  const parallelValid = maxParallel === null
    || (/^\d+$/.test(trimmed) && Number.isInteger(maxParallel) && maxParallel >= 1 && maxParallel <= MAX_PARALLEL)
  if (work && savedFlags.work_execution) {
    if (work.reasoning_effort !== savedFlags.work_execution.reasoning_effort) {
      workChanges.reasoning_effort = work.reasoning_effort
    }
    if (maxParallel !== savedFlags.work_execution.max_parallel) {
      workChanges.max_parallel = maxParallel
    }
  }
  const policyChanged = Object.keys(workChanges).length > 0
  const dirty = Object.keys(changes).length > 0 || policyChanged

  async function save() {
    setSaving(true)
    setMessage(null)
    try {
      const response: SystemBambooConfig = await serviceFactory.setBambooConfig({
        features: { ...changes, ...(policyChanged ? { work_execution: workChanges } : {}) },
      })
      const confirmed = response.features
      if (typeof confirmed?.ticket_mutation !== "boolean" || typeof confirmed.ticket_dispatch !== "boolean"
        || controls.some(({ flag }) => changes[flag] !== undefined && confirmed[flag] !== changes[flag])
        || (workChanges.reasoning_effort !== undefined
          && confirmed.work_execution?.reasoning_effort !== workChanges.reasoning_effort)
        || (changes.work_ultra_by_default !== undefined
          && confirmed.work_ultra_by_default !== changes.work_ultra_by_default)
        || (workChanges.max_parallel !== undefined
          && confirmed.work_execution?.max_parallel !== workChanges.max_parallel)) {
        throw new Error(uiText("work_settings_unconfirmed"))
      }
      const next = {
        ticket_mutation: confirmed.ticket_mutation,
        ticket_dispatch: confirmed.ticket_dispatch,
        work_ultra_by_default: confirmed.work_ultra_by_default,
        work_execution: confirmed.work_execution,
      }
      setSavedFlags(next)
      setDraft(next)
      setParallelInput(String(next.work_execution?.max_parallel ?? ""))
      setMessage({ kind: "ok", text: uiText("saved_1bd91a7d") })
    } catch (error) {
      setMessage({ kind: "error", text: getErrorMessage(error) })
    } finally {
      setSaving(false)
    }
  }

  return (
    <section aria-labelledby={id} className="space-y-3 rounded-lg border p-3">
      <div id={id} className="text-xs font-medium text-muted-foreground">
        {uiText("supervisor_settings_title")}
      </div>
      {controls.map(({ flag, label, description }) => {
        const switchId = `${id}-${flag}`
        return (
          <div key={flag} className="flex items-center justify-between gap-3">
            <div className="min-w-0 space-y-1">
              <label htmlFor={switchId} className="block text-sm">{uiText(label)}</label>
              <p id={`${switchId}-description`} className="text-xs leading-relaxed text-muted-foreground">
                {uiText(description)}
              </p>
            </div>
            <Switch
              id={switchId}
              aria-describedby={`${switchId}-description`}
              checked={draft[flag]}
              disabled={saving}
              onCheckedChange={(checked) => {
                setDraft((previous) => ({ ...previous, [flag]: checked }))
                setMessage(null)
              }}
            />
          </div>
        )
      })}
      {work ? (
        <>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <label htmlFor={`${id}-effort`} className="block text-sm">{uiText("work_settings_reasoning")}</label>
              <p id={`${id}-effort-description`} className="text-xs leading-relaxed text-muted-foreground">
                {uiText(ultraSelected ? "work_settings_ultra_description" : "work_settings_reasoning_description")}
              </p>
            </div>
            <Select
              value={ultraSelected ? "ultra" : work.reasoning_effort ?? "auto"}
              disabled={saving}
              onValueChange={(value) => {
                setDraft((previous) => {
                  if (!previous.work_execution) return previous
                  const next = { ...previous.work_execution }
                  if (value === "auto") next.reasoning_effort = null
                  else if (isReasoningEffort(value)) next.reasoning_effort = value
                  return {
                    ...previous,
                    work_ultra_by_default: ultraSupported ? value === "ultra" : undefined,
                    work_execution: next,
                  }
                })
                setMessage(null)
              }}
            >
              <SelectTrigger id={`${id}-effort`} aria-describedby={`${id}-effort-description`} className="w-36">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">{uiText("auto_7eb336e4")}</SelectItem>
                {REASONING_OPTIONS.map(({ value, label }) => (
                  <SelectItem key={value} value={value}>{label}</SelectItem>
                ))}
                {ultraSupported ? (
                  <SelectItem value="ultra">{uiText("ultra_orchestration_5857fcd7")}</SelectItem>
                ) : null}
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="min-w-0 space-y-1">
              <label htmlFor={`${id}-parallel`} className="block text-sm">{uiText("work_settings_parallel")}</label>
              <p id={`${id}-parallel-description`} className="text-xs leading-relaxed text-muted-foreground">
                {uiText("work_settings_parallel_description")}
              </p>
            </div>
            <Input
              id={`${id}-parallel`}
              aria-describedby={`${id}-parallel-description`}
              aria-invalid={!parallelValid}
              className="w-36"
              inputMode="numeric"
              placeholder={uiText("auto_7eb336e4")}
              value={parallelInput}
              disabled={saving}
              onChange={(event) => {
                setParallelInput(event.target.value)
                setMessage(null)
              }}
            />
          </div>
        </>
      ) : null}
      <div className="flex items-center justify-between gap-2">
        <div aria-live="polite">
          <StatusLine msg={parallelValid ? message : { kind: "error", text: uiText("work_settings_parallel_invalid") }} />
        </div>
        <Button size="sm" className="ml-auto" onClick={save} disabled={saving || !dirty || !parallelValid}>
          {uiText(saving ? "saving_ff509c9b" : "save_a3030bf8")}
        </Button>
      </div>
    </section>
  )
}
