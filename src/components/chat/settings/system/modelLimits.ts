import { uiText } from "@shared/i18n/ui"
import type { ModelLimitOverride } from "./useSystemConfig"

export interface GlobalDefault {
  max_context_tokens: number
  max_output_tokens: number
  safety_margin: number
}

export const FALLBACK_DEFAULT: GlobalDefault = {
  max_context_tokens: 1_000_000,
  max_output_tokens: 32_000,
  safety_margin: 10_000,
}

export interface LimitRowDraft {
  id: string
  model_pattern: string
  /** User-added/persisted-only rows can edit the model pattern itself. */
  isCustom: boolean
  /** False means the row follows Bamboo's global defaults and is not saved. */
  customized: boolean
  max_context_tokens: string
  max_output_tokens: string
  safety_margin: string
}

let rowCounter = 0
export const nextModelLimitRowId = () => `model-limit-${rowCounter++}`

/** Parse exact integers plus compact forms such as 258K and 1M. */
export function parseTokenCount(raw: string): number | null {
  const normalized = raw.trim().replace(/[,_\s]/g, "")
  const match = /^(\d+(?:\.\d+)?)([kKmM])?$/.exec(normalized)
  if (!match) return null

  const number = Number(match[1])
  const multiplier = match[2]?.toLowerCase() === "m"
    ? 1_000_000
    : match[2]?.toLowerCase() === "k"
      ? 1_000
      : 1
  const value = number * multiplier
  return Number.isSafeInteger(value) ? value : null
}

export function formatTokenCount(value: number): string {
  if (value >= 1_000_000 && value % 1_000_000 === 0) return `${value / 1_000_000}M`
  if (value >= 1_000 && value % 1_000 === 0) return `${value / 1_000}K`
  return String(value)
}

const toRow = (
  value: ModelLimitOverride,
  usedKeys: ReadonlySet<string>,
): LimitRowDraft => ({
  id: nextModelLimitRowId(),
  model_pattern: value.model_pattern,
  isCustom: !usedKeys.has(value.model_pattern.trim().toLocaleLowerCase()),
  customized: true,
  max_context_tokens: formatTokenCount(value.max_context_tokens),
  max_output_tokens: formatTokenCount(value.max_output_tokens ?? FALLBACK_DEFAULT.max_output_tokens),
  safety_margin: value.safety_margin != null ? formatTokenCount(value.safety_margin) : "",
})

/** Build display rows = persisted overrides union acknowledged used models. */
export function buildLimitRows(
  defaults: GlobalDefault,
  overrides: readonly ModelLimitOverride[],
  usedModels: readonly string[],
): LimitRowDraft[] {
  const usedKeys = new Set(
    usedModels.map((model) => model.trim().toLocaleLowerCase()).filter(Boolean),
  )
  const rows = overrides.map((override) => toRow(override, usedKeys))
  const seen = new Set(
    overrides.map((override) => override.model_pattern.trim().toLocaleLowerCase()),
  )

  for (const rawModel of usedModels) {
    const model = rawModel.trim()
    const key = model.toLocaleLowerCase()
    if (!model || seen.has(key)) continue
    seen.add(key)
    rows.push({
      id: nextModelLimitRowId(),
      model_pattern: model,
      isCustom: false,
      customized: false,
      max_context_tokens: formatTokenCount(defaults.max_context_tokens),
      max_output_tokens: formatTokenCount(defaults.max_output_tokens),
      safety_margin: "",
    })
  }

  return rows
}

export function validateLimitRows(
  rows: readonly LimitRowDraft[],
): { overrides: ModelLimitOverride[] } | { error: string } {
  const seen = new Set<string>()
  const overrides: ModelLimitOverride[] = []

  for (const row of rows) {
    if (!row.customized) continue
    const pattern = row.model_pattern.trim()
    if (!pattern) return { error: uiText("model_pattern_is_required_327363dc") }
    const key = pattern.toLocaleLowerCase()
    if (seen.has(key)) return { error: uiText("duplicate_model_8846705b", { v0: pattern }) }
    seen.add(key)

    const context = parseTokenCount(row.max_context_tokens)
    if (context === null || context < 1_000) {
      return { error: uiText("the_context_window_for_must_be_an_integer_of_at_least_1_3efecb54", { v0: pattern }) }
    }

    const output = parseTokenCount(row.max_output_tokens)
    if (output === null || output < 1) {
      return { error: uiText("maximum_output_for_must_be_an_integer_of_at_least_1_f032d4bd", { v0: pattern }) }
    }
    if (output > context) return { error: uiText("maximum_output_for_cannot_exceed_its_context_window_e5cd692f", { v0: pattern }) }

    let margin: number | undefined
    if (row.safety_margin.trim()) {
      const parsed = parseTokenCount(row.safety_margin)
      if (parsed === null || parsed < 0) {
        return { error: uiText("the_safety_margin_for_must_be_a_nonnegative_integer_e71fc7c5", { v0: pattern }) }
      }
      if (parsed >= context) return { error: uiText("the_safety_margin_for_must_be_smaller_than_its_context__94c4d58b", { v0: pattern }) }
      margin = parsed
    }

    overrides.push({
      model_pattern: pattern,
      max_context_tokens: context,
      max_output_tokens: output,
      ...(margin !== undefined ? { safety_margin: margin } : {}),
    })
  }

  return { overrides }
}
