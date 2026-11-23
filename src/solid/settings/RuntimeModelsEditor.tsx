import { createMemo, createSignal, For, Show } from "solid-js"
import { RefreshCw } from "@lucide/solid"
import type { ProviderModelDescriptor } from "@shared/types/providerModelRef"
import { cn } from "@/lib/utils"
import { createUiText } from "../shell/uiText"
import { Button } from "../ui/button"
import { Input } from "../ui/input"

export interface ModelDiscoveryNotice {
  text: string
  tone: "loading" | "success" | "warning" | "error"
}

interface RuntimeModelsEditorProps {
  value: readonly string[]
  onChange: (models: string[]) => void
  candidates: readonly ProviderModelDescriptor[]
  modelCapabilities: Record<string, { supports_vision?: boolean | null }>
  onVisionChange: (model: string, supportsVision: boolean) => void
  onFetchModels?: () => void
  fetchingModels?: boolean
  fetchModelsNotice?: ModelDiscoveryNotice
  fetchModelsHint?: string
}

/** Discovered suggestions require explicit admission into the local draft. */
export function RuntimeModelsEditor(props: RuntimeModelsEditorProps) {
  const text = createUiText()
  const [query, setQuery] = createSignal("")
  const [custom, setCustom] = createSignal("")
  const selected = createMemo(() => new Set(props.value))
  const offered = createMemo(() => {
    const candidates = new Map<string, string>()
    for (const id of props.value) candidates.set(id, id)
    for (const model of props.candidates) {
      const id = model.reference.model.trim()
      if (id) candidates.set(id, model.display_name || id)
    }
    return candidates
  })
  const options = createMemo(() => {
    const search = query().trim().toLocaleLowerCase()
    return [...offered()].filter(([id, label]) => !search ||
      id.toLocaleLowerCase().includes(search) || label.toLocaleLowerCase().includes(search)).map(([id]) => id)
  })
  const addCustom = () => {
    const id = custom().trim()
    if (!id) return
    if (!selected().has(id)) props.onChange([...props.value, id])
    setCustom("")
  }

  return (
    <fieldset data-testid="runtime-models-editor" class="space-y-2 rounded-md border bg-background p-2.5">
      <legend class="px-1 text-xs font-medium">{text("runtime_models")}</legend>
      <p class="text-xs text-muted-foreground">{text("runtime_models_hint")}</p>
      <p class="text-xs text-muted-foreground">{text("model_vision_hint")}</p>
      <p role="status" class="text-xs text-muted-foreground">
        {text("runtime_models_selected", { count: props.value.length })}
      </p>
      <div class="flex flex-col gap-2 sm:flex-row">
        <Input type="search" class="min-w-0 flex-1" aria-label={text("runtime_models_search")}
          placeholder={text("runtime_models_search")} value={query()}
          onInput={(event) => setQuery(event.currentTarget.value)} />
        <Button type="button" size="sm" variant="secondary" class="shrink-0" aria-label={text("runtime_models_fetch")}
          aria-busy={props.fetchingModels ? "true" : "false"} disabled={!props.onFetchModels || props.fetchingModels}
          onClick={() => props.onFetchModels?.()}>
          <RefreshCw class={cn("size-3.5", props.fetchingModels && "animate-spin")} />
          {text(props.fetchingModels ? "runtime_models_fetching" : "runtime_models_fetch")}
        </Button>
      </div>
      <Show when={props.fetchModelsHint}><p class="text-xs text-muted-foreground">{props.fetchModelsHint}</p></Show>
      <Show when={props.fetchModelsNotice}>{(notice) => (
        <p role={notice().tone === "error" ? "alert" : "status"}
          class={cn("text-xs", {
            "text-emerald-500": notice().tone === "success",
            "text-muted-foreground": notice().tone === "loading",
            "text-amber-600 dark:text-amber-300": notice().tone === "warning",
            "text-destructive": notice().tone === "error",
          })}>{notice().text}</p>
      )}</Show>
      <div class="max-h-52 space-y-1 overflow-y-auto">
        <For each={options()} fallback={<p class="py-1 text-xs text-muted-foreground">{text("runtime_models_empty")}</p>}>
          {(id) => (
            <div class="flex flex-col items-start justify-between gap-2 rounded px-1 py-1.5 text-xs hover:bg-muted sm:flex-row">
              <label class="flex min-w-0 max-w-full flex-1 cursor-pointer items-start gap-2">
                <input type="checkbox" aria-label={id} checked={selected().has(id)} class="mt-0.5 shrink-0"
                  onChange={(event) => props.onChange(event.currentTarget.checked
                    ? [...props.value, id] : props.value.filter((model) => model !== id))} />
                <span class="min-w-0 break-all">
                  <span class="block font-mono">{id}</span>
                  <Show when={offered().get(id) !== id}>
                    <span class="block text-muted-foreground">{offered().get(id)}</span>
                  </Show>
                </span>
              </label>
              <Show when={selected().has(id)}>
                <label class="flex shrink-0 items-center gap-1">
                  <span>{text("model_vision_label")}</span>
                  <select aria-label={text("model_vision_for", { model: id })}
                    class="max-w-full rounded border bg-background px-1 py-1 text-xs"
                    value={String(props.modelCapabilities[id]?.supports_vision !== false)}
                    onChange={(event) => props.onVisionChange(id, event.currentTarget.value === "true")}>
                    <option value="true">{text("model_vision_yes")}</option>
                    <option value="false">{text("model_vision_no")}</option>
                  </select>
                </label>
              </Show>
            </div>
          )}
        </For>
      </div>
      <label class="block">
        <span class="mb-1 block text-xs text-muted-foreground">{text("runtime_models_custom_id")}</span>
        <div class="flex gap-2">
          <Input aria-label={text("runtime_models_custom_id")} value={custom()} placeholder="vendor/custom-model"
            onInput={(event) => setCustom(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.isComposing || event.keyCode === 229) return
              event.preventDefault()
              addCustom()
            }} />
          <Button type="button" size="sm" variant="secondary" disabled={!custom().trim()} onClick={addCustom}>
            {text("runtime_models_add")}
          </Button>
        </div>
      </label>
    </fieldset>
  )
}
