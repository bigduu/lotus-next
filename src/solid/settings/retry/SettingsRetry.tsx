import { createSignal, For, onSettled, Show } from "solid-js"
import { settingsService, type CoreSectionData, type LlmRetryConfig } from "@services/config/SettingsService"
import { createUiText } from "../../shell/uiText"
import { Button } from "../../ui/button"
import { Input } from "../../ui/input"
import { Label } from "../../ui/label"
import { Skeleton } from "../../ui/skeleton"

const CORE = "core"
type Field = keyof LlmRetryConfig
type Draft = Partial<LlmRetryConfig>
type TextKey = Parameters<ReturnType<typeof createUiText>>[0]

const FIELDS = [
  { key: "max_attempts", label: "retry_max_attempts", hint: "retry_max_attempts_hint", min: 1, max: 12 },
  { key: "attempt_timeout_ms", label: "retry_attempt_timeout", hint: "retry_attempt_timeout_hint", min: 1_000, max: 600_000 },
  { key: "total_budget_ms", label: "retry_total_budget", hint: "retry_total_budget_hint", min: 1_000, max: 3_600_000 },
  { key: "base_delay_ms", label: "retry_base_delay", hint: "retry_base_delay_hint", min: 1, max: 300_000 },
  { key: "max_delay_ms", label: "retry_max_delay", hint: "retry_max_delay_hint", min: 1, max: 300_000 },
] as const satisfies readonly { key: Field; label: TextKey; hint: TextKey; min: number; max: number }[]

function validateDraft(draft: Draft): { data: LlmRetryConfig } | { error: string } {
  // Mirrors bamboo_config::LlmRetryConfig::validate for immediate form feedback.
  for (const { key, min, max } of FIELDS) {
    const value = draft[key]
    if (value === undefined || !Number.isSafeInteger(value) || value < min || value > max) {
      return { error: key + ": " + min + "–" + max }
    }
  }
  const data = draft as LlmRetryConfig
  if (data.base_delay_ms > data.max_delay_ms) return { error: "base_delay_ms > max_delay_ms" }
  return { data }
}

function validEnvelope(envelope: { data: CoreSectionData; revision: number }) {
  return envelope?.data && typeof envelope.data === "object" && !Array.isArray(envelope.data)
    && Number.isSafeInteger(envelope.revision) && envelope.revision >= 0
}

export function SettingsRetry() {
  const text = createUiText()
  const [draft, setDraft] = createSignal<Draft | null>(null)
  const [revision, setRevision] = createSignal<number | null>(null)
  const [loading, setLoading] = createSignal(true)
  const [busy, setBusy] = createSignal(false)
  const [error, setError] = createSignal<string | null>(null)
  const [saved, setSaved] = createSignal(false)
  const edited = new Set<Field>()
  let active = true

  function apply(envelope: { data: CoreSectionData; revision: number }) {
    setDraft({ ...envelope.data.llm_retry })
    setRevision(envelope.revision)
    edited.clear()
  }

  async function load() {
    try {
      const envelope = await settingsService.getTypedSection<CoreSectionData>(CORE)
      if (!active) return false
      if (validEnvelope(envelope)) {
        apply(envelope)
        setError(null)
        return true
      }
    } catch {
      if (!active) return false
    }
    setRevision(null)
    setError(text("retry_load_failed"))
    return false
  }

  async function reload() {
    if (busy()) return
    setBusy(true)
    setSaved(false)
    try {
      await load()
    } finally {
      if (active) {
        setLoading(false)
        setBusy(false)
      }
    }
  }

  onSettled(() => {
    void reload()
    return () => { active = false }
  })

  async function save() {
    const initial = draft()
    if (!active || !initial || busy() || revision() === null) return
    const local = validateDraft(initial)
    if ("error" in local) {
      setError(local.error)
      return
    }

    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const current = await settingsService.getTypedSection<CoreSectionData>(CORE)
      if (!active) return
      if (!validEnvelope(current)) throw new Error(text("retry_load_failed"))
      // CAS is bound to a fresh section. Merge only fields edited in this panel.
      const merged = { ...current.data.llm_retry }
      for (const key of edited) merged[key] = local.data[key]
      const validated = validateDraft(merged)
      if ("error" in validated) {
        setError(validated.error)
        return
      }
      const response = await settingsService.putTypedSection<CoreSectionData>(
        CORE, { ...current.data, llm_retry: validated.data }, current.revision,
      )
      if (!active) return
      if (!validEnvelope(response)) throw new Error(text("retry_save_unconfirmed"))
      apply(response)
      setSaved(true)
    } catch {
      if (!active) return
      const refreshed = await load()
      if (active) setError(text(refreshed ? "retry_save_unconfirmed" : "retry_save_failed"))
    } finally {
      if (active) setBusy(false)
    }
  }

  return <Show when={!loading()} fallback={<Skeleton class="h-64 w-full rounded-lg" />}>
    <Show when={draft()} fallback={
      <section class="space-y-2 rounded-lg border p-3">
        <p role="alert" class="text-xs text-destructive">{error()}</p>
        <Button size="sm" variant="secondary" disabled={busy()} onClick={() => void reload()}>{text("retry_b8784c8d")}</Button>
      </section>
    }>{(current) =>
      <section class="space-y-4 rounded-lg border p-3" data-settings-retry="">
        <div class="space-y-1">
          <h3 class="text-sm font-medium">{text("retry_title")}</h3>
          <p class="text-xs text-muted-foreground">{text("retry_description")}</p>
        </div>
        <div class="space-y-3">
          <For each={FIELDS}>{({ key, label, hint, min, max }) => {
            const id = "llm-retry-" + key
            const value = () => {
              const next = current()[key]
              return Number.isFinite(next) ? String(next) : ""
            }
            return <div class="space-y-1">
              <Label for={id}>{text(label)}</Label>
              <Input id={id} type="number" inputmode="numeric" min={min} max={max} value={value()}
                aria-describedby={id + "-hint"} disabled={busy()}
                onInput={(event) => {
                  const next = event.currentTarget.valueAsNumber
                  setSaved(false)
                  edited.add(key)
                  setDraft((previous) => ({ ...previous, [key]: Number.isFinite(next) ? next : undefined }))
                }} />
              <p id={id + "-hint"} class="text-xs text-muted-foreground">{text(hint)}</p>
            </div>
          }}</For>
        </div>
        <div class="flex items-center gap-2">
          <Button size="sm" disabled={busy() || revision() === null} onClick={() => void save()}>{text("save_a3030bf8")}</Button>
          <Button size="sm" variant="secondary" disabled={busy()} onClick={() => void reload()}>{text("reload_state_df7392cc")}</Button>
        </div>
        <Show when={error()}><p role="alert" class="text-xs text-destructive">{error()}</p></Show>
        <Show when={saved()}><p role="status" class="text-xs text-muted-foreground">{text("retry_saved")}</p></Show>
      </section>
    }</Show>
  </Show>
}
