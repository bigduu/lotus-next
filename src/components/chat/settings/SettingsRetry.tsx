import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useCallback, useEffect, useState } from "react"
import { settingsService, type CoreSectionData, type LlmRetryConfig } from "@services/config/SettingsService"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Skeleton } from "@/components/ui/skeleton"

const CORE_SECTION = "core"

/** Narrowed to the generated key union; `uiText` is strictly typed. */
type UiTextKey = Parameters<typeof uiText>[0]

/** Backend-owned bounds (bamboo_config::LlmRetryConfig::validate). */
const LIMITS = {
  max_attempts: { min: 1, max: 12 },
  attempt_timeout_ms: { min: 1_000, max: 600_000 },
  total_budget_ms: { min: 1_000, max: 3_600_000 },
  base_delay_ms: { min: 1, max: 300_000 },
  max_delay_ms: { min: 1, max: 300_000 },
} as const

type Field = keyof LlmRetryConfig

const FIELDS: { key: Field; labelKey: UiTextKey; hintKey: UiTextKey }[] = [
  { key: "max_attempts", labelKey: "retry_max_attempts", hintKey: "retry_max_attempts_hint" },
  { key: "attempt_timeout_ms", labelKey: "retry_attempt_timeout", hintKey: "retry_attempt_timeout_hint" },
  { key: "total_budget_ms", labelKey: "retry_total_budget", hintKey: "retry_total_budget_hint" },
  { key: "base_delay_ms", labelKey: "retry_base_delay", hintKey: "retry_base_delay_hint" },
  { key: "max_delay_ms", labelKey: "retry_max_delay", hintKey: "retry_max_delay_hint" },
]

/** First out-of-range or inconsistent field, or null when the draft is valid. */
function validateDraft(draft: LlmRetryConfig): string | null {
  for (const [key, range] of Object.entries(LIMITS) as [Field, { min: number; max: number }][]) {
    const value = draft[key]
    if (!Number.isSafeInteger(value) || value < range.min || value > range.max) {
      return `${key}: ${range.min}–${range.max}`
    }
  }
  if (draft.base_delay_ms > draft.max_delay_ms) return "base_delay_ms > max_delay_ms"
  return null
}

/**
 * Initial-request retry policy for transient network failures and retryable
 * upstream statuses.
 *
 * Writes only the `core` section through its revision-guarded endpoint, so an
 * unrelated section cannot be clobbered by a whole-config save.
 */
export function SettingsRetry() {
  useUiLocale()
  const [draft, setDraft] = useState<LlmRetryConfig | null>(null)
  const [revision, setRevision] = useState<number | null>(null)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  // Fields this user actually changed. Saving merges only these onto the
  // freshly read section, so another panel's edit to a different field is
  // preserved instead of being restored to this panel's stale snapshot.
  const [edited, setEdited] = useState<ReadonlySet<Field>>(() => new Set<Field>())

  const apply = useCallback((envelope: { data: CoreSectionData; revision: number }) => {
    setDraft({ ...(envelope.data.llm_retry ?? ({} as LlmRetryConfig)) })
    setRevision(envelope.revision)
    setEdited(new Set<Field>())
  }, [])

  const reload = useCallback(async () => {
    try {
      apply(await settingsService.getTypedSection<CoreSectionData>(CORE_SECTION))
      setError(null)
      return true
    } catch {
      setRevision(null)
      setError(uiText("retry_load_failed"))
      return false
    }
  }, [apply])

  useEffect(() => {
    void reload().finally(() => setLoading(false))
  }, [reload])

  const save = async () => {
    if (!draft || revision === null || busy) return
    const invalid = validateDraft(draft)
    if (invalid) {
      setError(invalid)
      return
    }
    setBusy(true)
    setError(null)
    setSaved(false)
    try {
      const current = await settingsService.getTypedSection<CoreSectionData>(CORE_SECTION)
      // Re-read right before writing, then merge. Only fields this panel edited
      // are taken from the draft; everything else comes from the fresh read, so
      // a concurrent edit is kept rather than reverted to a stale value.
      const latest = current.data.llm_retry
      const merged: LlmRetryConfig = { ...(latest ?? ({} as LlmRetryConfig)) }
      for (const key of edited) merged[key] = draft[key]
      const invalidMerged = validateDraft(merged)
      if (invalidMerged) {
        setError(invalidMerged)
        return
      }
      apply(
        await settingsService.putTypedSection<CoreSectionData>(
          CORE_SECTION,
          { ...current.data, llm_retry: merged },
          current.revision,
        ),
      )
      setSaved(true)
    } catch {
      const refreshed = await reload()
      setError(refreshed ? uiText("retry_save_unconfirmed") : uiText("retry_save_failed"))
    } finally {
      setBusy(false)
    }
  }

  if (loading) return <Skeleton className="h-64 w-full rounded-lg" />
  if (!draft) {
    return (
      <section className="space-y-2 rounded-lg border p-3">
        <p className="text-xs text-destructive">{error}</p>
        <Button size="sm" variant="secondary" onClick={() => void reload()}>
          {uiText("retry_b8784c8d")}
        </Button>
      </section>
    )
  }

  return (
    <section className="space-y-4 rounded-lg border p-3">
      <div className="space-y-1">
        <h3 className="text-sm font-medium">{uiText("retry_title")}</h3>
        <p className="text-xs text-muted-foreground">{uiText("retry_description")}</p>
      </div>
      <div className="space-y-3">
        {FIELDS.map(({ key, labelKey, hintKey }) => (
          <div key={key} className="space-y-1">
            <Label htmlFor={`llm-retry-${key}`}>{uiText(labelKey)}</Label>
            <Input
              id={`llm-retry-${key}`}
              type="number"
              inputMode="numeric"
              min={LIMITS[key].min}
              max={LIMITS[key].max}
              value={Number.isFinite(draft[key]) ? String(draft[key]) : ""}
              disabled={busy}
              onChange={(event) => {
                const next = Number(event.target.value)
                setSaved(false)
                setEdited((previous) => new Set(previous).add(key))
                setDraft({ ...draft, [key]: Number.isFinite(next) ? next : 0 })
              }}
            />
            <p className="text-xs text-muted-foreground">{uiText(hintKey)}</p>
          </div>
        ))}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" disabled={busy || revision === null} onClick={() => void save()}>
          {uiText("save_a3030bf8")}
        </Button>
        <Button size="sm" variant="secondary" disabled={busy} onClick={() => void reload()}>
          {uiText("reload_state_df7392cc")}
        </Button>
      </div>
      {error ? <p role="alert" className="text-xs text-destructive">{error}</p> : null}
      {saved ? <p role="status" className="text-xs text-muted-foreground">{uiText("retry_saved")}</p> : null}
    </section>
  )
}
