import { SearchableSelect } from "@/components/ui/searchable-select"

/**
 * Composer model switcher — a pill that opens a clean checkmark menu (upward,
 * since it sits above the composer). Replaces the plain native <select>.
 */
export function ModelPicker({
  models,
  value,
  onChange,
  menuPlacement = "up",
  menuAlign = "left",
}: {
  models: string[]
  value: string
  onChange: (model: string) => void
  menuPlacement?: "up" | "down"
  menuAlign?: "left" | "right"
}) {
  if (models.length === 0) return null

  return (
    <SearchableSelect
      items={models}
      value={value}
      onChange={onChange}
      getKey={(model) => model}
      getValue={(model) => model}
      getLabel={(model) => model}
      placeholder={value || "选择模型"}
      searchPlaceholder="搜索模型…"
      clearLabel="清空模型搜索"
      emptyText="没有匹配的模型"
      menuPlacement={menuPlacement}
      menuAlign={menuAlign}
      searchAriaLabel="搜索模型"
      optionListAriaLabel="模型列表"
      optionDataAttr="data-model-option"
    />
  )
}
