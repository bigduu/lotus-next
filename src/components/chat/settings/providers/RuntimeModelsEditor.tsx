import { useMemo, useState } from "react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import type { ProviderModelDescriptor } from "@shared/types/providerModelRef"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"

/** Discovery suggests ids; this local draft is the explicit admission step. */
export function RuntimeModelsEditor({
  value,
  onChange,
  candidates,
  modelCapabilities,
  onVisionChange,
}: {
  value: readonly string[]
  onChange: (models: string[]) => void
  candidates: readonly ProviderModelDescriptor[]
  modelCapabilities: Record<string, { supports_vision?: boolean | null }>
  onVisionChange: (model: string, supportsVision: boolean | null) => void
}) {
  useUiLocale()
  const [query, setQuery] = useState("")
  const [customId, setCustomId] = useState("")
  const selected = useMemo(() => new Set(value), [value])
  const options = useMemo(() => {
    const byId = new Map<string, string>()
    for (const id of value) byId.set(id, id)
    for (const model of candidates) {
      const id = model.reference.model.trim()
      if (id) byId.set(id, model.display_name || id)
    }
    const search = query.trim().toLocaleLowerCase()
    return [...byId].filter(([id, label]) =>
      !search || id.toLocaleLowerCase().includes(search) || label.toLocaleLowerCase().includes(search),
    )
  }, [value, candidates, query])

  const addCustom = () => {
    const id = customId.trim()
    if (!id) return
    if (!selected.has(id)) onChange([...value, id])
    setCustomId("")
  }

  return (
    <fieldset data-testid="runtime-models-editor" className="space-y-2 rounded-md border bg-background p-2.5">
      <legend className="px-1 text-xs font-medium">{uiText("runtime_models")}</legend>
      <p className="text-xs text-muted-foreground">{uiText("runtime_models_hint")}</p>
      <p className="text-xs text-muted-foreground">{uiText("model_vision_hint")}</p>
      <p role="status" className="text-xs text-muted-foreground">
        {uiText("runtime_models_selected", { count: value.length })}
      </p>
      <Input
        type="search"
        aria-label={uiText("runtime_models_search")}
        placeholder={uiText("runtime_models_search")}
        value={query}
        onChange={(event) => setQuery(event.target.value)}
      />
      <div className="max-h-52 space-y-1 overflow-y-auto">
        {options.map(([id, label]) => (
          <div key={id} className="flex flex-wrap items-start justify-between gap-2 rounded px-1 py-1.5 text-xs hover:bg-muted">
          <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              aria-label={id}
              checked={selected.has(id)}
              className="mt-0.5 shrink-0"
              onChange={(event) => onChange(event.target.checked
                ? [...value, id]
                : value.filter((model) => model !== id))}
            />
            <span className="min-w-0 break-all">
              <span className="block font-mono">{id}</span>
              {label !== id ? <span className="block text-muted-foreground">{label}</span> : null}
            </span>
          </label>
          {selected.has(id) ? (
            <label className="flex shrink-0 items-center gap-1">
              <span>{uiText("model_vision_label")}</span>
              <select
                aria-label={uiText("model_vision_for", { model: id })}
                className="max-w-full rounded border bg-background px-1 py-1 text-xs"
                value={modelCapabilities[id]?.supports_vision == null ? "inherit" : String(modelCapabilities[id].supports_vision)}
                onChange={(event) => onVisionChange(id, event.target.value === "inherit" ? null : event.target.value === "true")}
              >
                <option value="inherit">{uiText("model_vision_inherit")}</option>
                <option value="true">{uiText("model_vision_yes")}</option>
                <option value="false">{uiText("model_vision_no")}</option>
              </select>
            </label>
          ) : null}
          </div>
        ))}
        {options.length === 0 ? <p className="py-1 text-xs text-muted-foreground">{uiText("runtime_models_empty")}</p> : null}
      </div>
      <label className="block">
        <span className="mb-1 block text-xs text-muted-foreground">{uiText("runtime_models_custom_id")}</span>
        <div className="flex gap-2">
          <Input
            aria-label={uiText("runtime_models_custom_id")}
            value={customId}
            placeholder="vendor/custom-model"
            onChange={(event) => setCustomId(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter" && !event.nativeEvent.isComposing && event.keyCode !== 229) {
                event.preventDefault()
                addCustom()
              }
            }}
          />
          <Button type="button" size="sm" variant="secondary" disabled={!customId.trim()} onClick={addCustom}>
            {uiText("runtime_models_add")}
          </Button>
        </div>
      </label>
    </fieldset>
  )
}
