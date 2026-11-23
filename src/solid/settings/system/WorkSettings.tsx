import { createMemo, createSignal, createUniqueId, For, Show } from "solid-js"
import { isReasoningEffort } from "@shared/utils/reasoningEffort"
import { REASONING_OPTIONS } from "@/lib/settings/reasoningOptions"
import { createUiLocale, createUiText } from "../../shell/uiText"
import { Input } from "../../ui/input"
import { Select } from "../../ui/select"
import type { SaveSystemSection, WorkExecutionSettings, WorkFeatureFlags } from "./createSystemConfig"
import { createSystemAction, SaveSection, SettingToggle, StatusLine, SystemSection } from "./SystemFields"

const controls = [
  { flag: "ticket_mutation", label: "work_settings_mutation", description: "work_settings_mutation_description" },
  { flag: "ticket_dispatch", label: "work_settings_dispatch", description: "work_settings_dispatch_description" },
] as const

type FeaturePatch = Partial<Omit<WorkFeatureFlags, "work_execution">> & { work_execution?: Partial<WorkExecutionSettings> }

export function WorkSettings(props: { flags: WorkFeatureFlags; saveSection: SaveSystemSection }) {
  const text = createUiText()
  const locale = createUiLocale()
  const parallelId = createUniqueId()
  const [saved, setSaved] = createSignal(props.flags)
  const [draft, setDraft] = createSignal(props.flags)
  const [parallelInput, setParallelInput] = createSignal(String(props.flags.work_execution?.max_parallel ?? ""))
  const action = createSystemAction()
  const supportsUltra = () => typeof draft().work_ultra_by_default === "boolean"
  const isUltra = () => draft().work_ultra_by_default === true
  const concurrency = createMemo(() => {
    const value = parallelInput().trim()
    return value === "" ? null : /^\d+$/.test(value) ? Number(value) : Number.NaN
  })
  const parallelValid = () => concurrency() === null || (Number.isInteger(concurrency()) && concurrency()! >= 1 && concurrency()! <= 4_294_967_295)
  const changes = createMemo(() => {
    const flags: FeaturePatch = {}
    const previous = saved()
    const current = draft()
    for (const { flag } of controls) {
      if (current[flag] !== previous[flag]) flags[flag] = current[flag]
    }
    if (current.work_ultra_by_default !== previous.work_ultra_by_default) flags.work_ultra_by_default = current.work_ultra_by_default
    if (current.work_execution && previous.work_execution) {
      const changed: Partial<WorkExecutionSettings> = {}
      if (current.work_execution.reasoning_effort !== previous.work_execution.reasoning_effort) {
        changed.reasoning_effort = current.work_execution.reasoning_effort
      }
      if (concurrency() !== previous.work_execution.max_parallel) changed.max_parallel = concurrency()
      if (Object.keys(changed).length) flags.work_execution = changed
    }
    return flags
  })
  const options = createMemo(() => {
    locale()
    const choices = [{ value: "auto", label: text("auto_7eb336e4") }, ...REASONING_OPTIONS.map(({ value, label }) => ({ value, label }))]
    if (supportsUltra()) choices.push({ value: "ultra", label: text("ultra_orchestration_5857fcd7") })
    return choices
  })
  const setEffort = (value: string) => {
    const previous = draft()
    if (!previous.work_execution) return
    const reasoning_effort = value === "auto" ? null : isReasoningEffort(value) ? value : previous.work_execution.reasoning_effort
    setDraft({ ...previous, work_ultra_by_default: supportsUltra() ? value === "ultra" : undefined,
      work_execution: { ...previous.work_execution, reasoning_effort } })
    action.setMessage(null)
  }

  const save = () => action.run(async () => {
    if (!parallelValid()) return
    const patch = changes()
    const confirmed = (await props.saveSection({ features: patch })).features
    if (typeof confirmed?.ticket_mutation !== "boolean" || typeof confirmed.ticket_dispatch !== "boolean"
      || controls.some(({ flag }) => patch[flag] !== undefined && confirmed[flag] !== patch[flag])
      || (patch.work_ultra_by_default !== undefined && confirmed.work_ultra_by_default !== patch.work_ultra_by_default)
      || (patch.work_execution?.reasoning_effort !== undefined && confirmed.work_execution?.reasoning_effort !== patch.work_execution.reasoning_effort)
      || (patch.work_execution?.max_parallel !== undefined && confirmed.work_execution?.max_parallel !== patch.work_execution.max_parallel)) {
      throw new Error(text("work_settings_unconfirmed"))
    }
    const next: WorkFeatureFlags = { ...confirmed, ticket_mutation: confirmed.ticket_mutation, ticket_dispatch: confirmed.ticket_dispatch }
    setSaved(next)
    setDraft(next)
    setParallelInput(String(next.work_execution?.max_parallel ?? ""))
  })

  return (
    <SystemSection title={text("supervisor_settings_title")}>
      <For each={controls}>{(control) => (
        <SettingToggle label={text(control.label)} description={text(control.description)} checked={draft()[control.flag]}
          disabled={action.busy()} onChange={(checked) => {
            setDraft((previous) => ({ ...previous, [control.flag]: checked }))
            action.setMessage(null)
          }} />
      )}</For>
      <Show when={draft().work_execution}>{(execution) => (
        <>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0 space-y-1">
              <p class="text-sm">{text("work_settings_reasoning")}</p>
              <p class="text-xs text-muted-foreground">{text(isUltra() ? "work_settings_ultra_description" : "work_settings_reasoning_description")}</p>
            </div>
            <Select selectOnly label={text("work_settings_reasoning")} class="w-36" options={options()} disabled={action.busy()}
              value={isUltra() ? "ultra" : execution().reasoning_effort ?? "auto"} onValueChange={setEffort} />
          </div>
          <div class="flex flex-wrap items-center justify-between gap-2">
            <div class="min-w-0 space-y-1">
              <label for={parallelId} class="block text-sm">{text("work_settings_parallel")}</label>
              <p id={`${parallelId}-description`} class="text-xs text-muted-foreground">{text("work_settings_parallel_description")}</p>
            </div>
            <Input id={parallelId} aria-describedby={`${parallelId}-description`} aria-invalid={parallelValid() ? "false" : "true"}
              class="w-36" inputmode="numeric" placeholder={text("auto_7eb336e4")} disabled={action.busy()}
              value={parallelInput()} onInput={(event) => { setParallelInput(event.currentTarget.value); action.setMessage(null) }} />
          </div>
        </>
      )}</Show>
      <Show when={!parallelValid()}><StatusLine message={{ kind: "error", text: text("work_settings_parallel_invalid") }} /></Show>
      <SaveSection action={action} disabled={!parallelValid() || Object.keys(changes()).length === 0} onSave={() => { void save() }} />
    </SystemSection>
  )
}
