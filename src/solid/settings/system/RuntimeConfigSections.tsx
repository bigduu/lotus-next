import { RefreshCw } from "@lucide/solid"
import { createMemo, createSignal, createUniqueId, For, onCleanup, onSettled, Show } from "solid-js"
import { apiClient, getErrorMessage } from "@services/api"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Select } from "../../ui/select"
import { Switch } from "../../ui/switch"
import type { ContextManagementStrategy, SaveSystemSection, SystemBambooConfig } from "./createSystemConfig"
import { createSystemAction, SaveSection, SettingToggle, StatusLine, SystemSection } from "./SystemFields"

type ConfigProps = { config: SystemBambooConfig; saveSection: SaveSystemSection }

export function ProxySettings(props: ConfigProps) {
  const text = createUiText()
  const [http, setHttp] = createSignal(props.config.http_proxy ?? "")
  const [https, setHttps] = createSignal(props.config.https_proxy ?? "")
  const action = createSystemAction()
  return (
    <SystemSection title={text("agent_5e84ea61")}>
      <label class="block space-y-1 text-xs text-muted-foreground">
        {text("http_proxy_fe51a8c8")}
        <Input placeholder="http://proxy.example.com:8080" value={http()} onInput={(event) => setHttp(event.currentTarget.value)} />
      </label>
      <label class="block space-y-1 text-xs text-muted-foreground">
        {text("https_proxy_67047f31")}
        <Input placeholder="https://proxy.example.com:8080" value={https()} onInput={(event) => setHttps(event.currentTarget.value)} />
      </label>
      <SaveSection action={action} onSave={() => { void action.run(async () => {
        await props.saveSection({ http_proxy: http().trim(), https_proxy: https().trim() })
      }) }} />
    </SystemSection>
  )
}

const strategies = [
  { value: "summary", label: "context_full_summary_label", description: "context_full_summary_description", unconfirmed: "the_backend_has_not_confirmed_the_summary_policy_it_is__a1931a8d" },
  { value: "message_summary", label: "context_message_summary_label", description: "context_message_summary_description", unconfirmed: "context_message_summary_unconfirmed" },
  { value: "retrieval_window", label: "context_retrieval_window_label", description: "context_retrieval_window_description", unconfirmed: "the_backend_has_not_confirmed_the_retrieval_window_poli_f71a7519" },
] as const

function readStrategy(config: SystemBambooConfig) {
  const value = config.context_management?.strategy
  return value === undefined ? "summary" : strategies.find((option) => option.value === value)?.value
}

export function ContextManagementSettings(props: ConfigProps) {
  const text = createUiText()
  const groupId = createUniqueId()
  const initial = readStrategy(props.config) ?? "summary"
  const [selected, setSelected] = createSignal<ContextManagementStrategy>(initial)
  const [persisted, setPersisted] = createSignal(initial)
  const action = createSystemAction()

  const save = () => action.run(async () => {
    const strategy = selected()
    const patch = strategy === "retrieval_window"
      ? { strategy, retrieval_window: { history_tool_required: true, fallback_strategy: "none" as const } }
      : { strategy }
    const result = await props.saveSection({ context_management: patch })
    const confirmed = readStrategy(result)
    if (confirmed !== strategy) throw new Error(text(strategies.find((option) => option.value === strategy)!.unconfirmed))
    setPersisted(confirmed)
  }, "compact_status_strategy_saved")

  return (
    <SystemSection title={text("context_management_29dde6e6")}>
      <div role="radiogroup" aria-label={text("context_management_29dde6e6")} class="space-y-2">
        <For each={strategies}>{(option) => (
          <label class={`flex cursor-pointer items-start gap-3 rounded-md border p-3 ${selected() === option.value ? "border-primary/40 bg-primary/5" : "border-border"}`}>
            <input type="radio" name={groupId} value={option.value} checked={selected() === option.value} disabled={action.busy()}
              aria-labelledby={`${groupId}-${option.value}-label`} aria-describedby={`${groupId}-${option.value}-description`}
              class="mt-0.5 size-4 shrink-0" style={{ "accent-color": "var(--primary)" }}
              onChange={() => { setSelected(option.value); action.setMessage(null) }} />
            <span class="min-w-0 space-y-1">
              <span id={`${groupId}-${option.value}-label`} class="block text-sm">{text(option.label)}</span>
              <span id={`${groupId}-${option.value}-description`} class="block text-xs leading-relaxed text-muted-foreground">{text(option.description)}</span>
            </span>
          </label>
        )}</For>
      </div>
      <p class="text-xs leading-relaxed text-muted-foreground">{text("no_restart_is_needed_changes_apply_to_the_next_run_acti_24de7c6e")}</p>
      <Show when={selected() === "retrieval_window"}>
        <p class="rounded-md bg-muted px-2 py-1.5 text-xs leading-relaxed text-muted-foreground">{text("sessions_with_existing_summaries_are_not_converted_auto_d1b0f8c0")}</p>
      </Show>
      <SaveSection action={action} disabled={selected() === persisted()} onSave={() => { void save() }} />
    </SystemSection>
  )
}

export function MemorySettings(props: ConfigProps) {
  const text = createUiText()
  const [enabled, setEnabled] = createSignal(props.config.memory?.auto_dream_enabled ?? true)
  const [seconds, setSeconds] = createSignal(String(props.config.memory?.auto_dream_interval_secs ?? 1800))
  const action = createSystemAction()
  const save = () => action.run(async () => {
    const interval = Number(seconds())
    if (!Number.isInteger(interval) || interval < 60) throw new Error(text("interval_must_be_an_integer_of_at_least_60_seconds_2e4fa5c6"))
    await props.saveSection({ memory: { auto_dream_enabled: enabled(), auto_dream_interval_secs: interval } })
  })
  return (
    <SystemSection title={text("memory_7a6335b3")}>
      <SettingToggle label={text("automatic_organization_auto_dream_1e2006e6")}
        description={text("organize_session_memory_periodically_in_the_background_95c196c4")} checked={enabled()} onChange={setEnabled} />
      <label class="flex items-center justify-between gap-2 text-sm">
        {text("organization_interval_seconds_0a821075")}
        <Input class="w-28 text-right" inputmode="numeric" placeholder="1800" value={seconds()} onInput={(event) => setSeconds(event.currentTarget.value)} />
      </label>
      <SaveSection action={action} onSave={() => { void save() }} />
    </SystemSection>
  )
}

export function SubagentSettings(props: ConfigProps) {
  const text = createUiText()
  const [concurrency, setConcurrency] = createSignal(String(props.config.subagents?.max_concurrent ?? ""))
  const action = createSystemAction()
  const save = () => action.run(async () => {
    const value = concurrency().trim() ? Number(concurrency()) : null
    if (value !== null && (!Number.isInteger(value) || value < 1)) throw new Error(text("concurrency_must_be_an_integer_of_at_least_1_9240ee0f"))
    await props.saveSection({ subagents: { max_concurrent: value as number | undefined } })
  })
  return (
    <SystemSection title={text("sub_agent_acd37b4c")}>
      <label class="flex items-center justify-between gap-2">
        <div>
          <div class="text-sm">{text("maximum_concurrency_dd9fd5ce")}</div>
          <div class="text-xs text-muted-foreground">{text("maximum_simultaneous_subagent_processes_leave_blank_for_c6efded8")}</div>
        </div>
        <Input class="w-24 text-right" inputmode="numeric" placeholder="8" value={concurrency()} onInput={(event) => setConcurrency(event.currentTarget.value)} />
      </label>
      <SaveSection action={action} onSave={() => { void save() }} />
    </SystemSection>
  )
}

const normalizeNames = (names: string[]) => [...new Set(names.map((name) => name.trim()).filter(Boolean))].sort()

export function ToolSettings(props: ConfigProps) {
  const text = createUiText()
  const initial = normalizeNames((props.config.tools?.disabled ?? []).filter((name): name is string => typeof name === "string"))
  const [available, setAvailable] = createSignal<string[]>([])
  const [disabled, setDisabled] = createSignal(initial)
  const [saved, setSaved] = createSignal(initial)
  const [loadError, setLoadError] = createSignal<string | null>(null)
  const [loading, setLoading] = createSignal(false)
  const action = createSystemAction()
  const names = createMemo(() => normalizeNames([...available(), ...disabled()]))
  const selected = createMemo(() => new Set(disabled()))
  const dirty = () => saved().length !== disabled().length || saved().some((name, index) => name !== disabled()[index])
  let request: AbortController | undefined

  const loadTools = async () => {
    request?.abort()
    const read = new AbortController()
    request = read
    setLoading(true)
    setLoadError(null)
    try {
      const result = await apiClient.get<{ tools: string[] }>("bamboo/tools", { signal: read.signal })
      if (!read.signal.aborted) setAvailable(normalizeNames(result.tools))
    } catch (error) {
      if (!read.signal.aborted) setLoadError(getErrorMessage(error))
    } finally {
      if (!read.signal.aborted) setLoading(false)
    }
  }
  onSettled(() => { void loadTools() })
  onCleanup(() => { request?.abort() })

  const toggle = (name: string, enabled: boolean) => {
    const next = new Set(disabled())
    if (enabled) next.delete(name)
    else next.add(name)
    setDisabled(normalizeNames([...next]))
  }
  const save = () => action.run(async () => {
    const requested = disabled()
    await props.saveSection({ tools: { disabled: requested } })
    setSaved(requested)
  })

  return (
    <SystemSection title={text("tool_5ca6730d")}>
      <p class="text-xs text-muted-foreground">{text("disabled_tools_are_removed_globally_from_models_availab_566d0b52")}</p>
      <div class="flex items-center justify-end">
        <Button variant="ghost" size="icon" disabled={loading()} aria-label={text("reload_tool_list_979c8a01")} onClick={() => { void loadTools() }}>
          <RefreshCw class="size-3.5" />
        </Button>
      </div>
      <Show when={loadError()}><p role="alert" class="text-xs text-destructive">{text("could_not_load_tool_list_875327bd")}{loadError()}</p></Show>
      <Show when={names().length > 0} fallback={<p class="text-xs text-muted-foreground">{text(loading() ? "loading_4927a53b" : "no_tools_yet_dae2b2c5")}</p>}>
        <ul class="max-h-56 space-y-1.5 overflow-y-auto pr-1">
          <For each={names()}>{(name) => (
            <li class="flex items-center justify-between gap-2">
              <code class="truncate font-mono text-xs">{name}</code>
              <Switch aria-label={name} checked={!selected().has(name)} onCheckedChange={(enabled) => toggle(name, enabled)} />
            </li>
          )}</For>
        </ul>
      </Show>
      <SaveSection action={action} disabled={!dirty()} onSave={() => { void save() }} />
    </SystemSection>
  )
}

type FallbackMode = "placeholder" | "error" | "ocr"
const fallbackMode = (value: string | undefined): FallbackMode => value === "error" || value === "ocr" ? value : "placeholder"

export function ImageHookSettings(props: ConfigProps) {
  const text = createUiText()
  const initial = props.config.hooks?.image_fallback
  const [state, setState] = createSignal({ enabled: initial?.enabled === true, mode: fallbackMode(initial?.mode) })
  const action = createSystemAction()
  const options = createMemo(() => [
    { value: "placeholder", label: text("replace_with_placeholder_text_a3640565") },
    { value: "error", label: text("return_an_error_3d9f8301") },
    { value: "ocr", label: text("extract_text_with_ocr_f28621fc") },
  ])
  const apply = (enabled: boolean, mode: FallbackMode) => action.run(async () => {
    const previous = state()
    setState({ enabled, mode })
    try {
      await props.saveSection({ hooks: { image_fallback: { enabled, mode } } })
    } catch (error) {
      setState(previous)
      throw error
    }
  })
  return (
    <SystemSection title="Hooks">
      <SettingToggle label={text("image_preflight_fallback_db10bcdd")}
        description={text("choose_how_to_handle_images_when_the_model_does_not_sup_91164dd4")} checked={state().enabled}
        disabled={action.busy()} onChange={(enabled) => { void apply(enabled, state().mode) }} />
      <div class="flex items-center justify-between gap-2">
        <span class="text-sm">{text("fallback_method_7d710102")}</span>
        <Select label={text("fallback_method_7d710102")} class="w-44" options={options()} value={state().mode}
          disabled={!state().enabled || action.busy()} onValueChange={(mode) => { void apply(state().enabled, fallbackMode(mode)) }} />
      </div>
      <StatusLine message={action.message()} />
    </SystemSection>
  )
}
