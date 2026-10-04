import { uiText, useUiLocale } from "@shared/i18n/ui"
import { SearchableSelect } from "@/components/ui/searchable-select"

/**
 * Composer model switcher — a pill that opens a clean checkmark menu (upward,
 * since it sits above the composer). Replaces the plain native <select>.
 */
export function ModelPicker({
  models,
  value,
  onChange,
  disabled = false,
  menuPlacement = "up",
  menuAlign = "left",
}: {
  models: string[]
  value: string
  onChange: (model: string) => void
  disabled?: boolean
  menuPlacement?: "up" | "down"
  menuAlign?: "left" | "right"
}) {
  useUiLocale()
  if (models.length === 0) return null

  return (
    <SearchableSelect
      items={models}
      value={value}
      onChange={onChange}
      disabled={disabled}
      title={disabled ? uiText("this_session_is_busy_you_can_change_the_model_later_1a17aa96") : undefined}
      getKey={(model) => model}
      getValue={(model) => model}
      getLabel={(model) => model}
      placeholder={value || uiText("select_a_model_1afed6a8")}
      searchPlaceholder={uiText("search_models_8ec7b052")}
      clearLabel={uiText("clear_model_search_ff2b5895")}
      emptyText={uiText("no_matching_models_4b5e0ae1")}
      menuPlacement={menuPlacement}
      menuAlign={menuAlign}
      searchAriaLabel={uiText("search_models_93a8734c")}
      optionListAriaLabel={uiText("model_list_ea4bf042")}
      optionDataAttr="data-model-option"
    />
  )
}
