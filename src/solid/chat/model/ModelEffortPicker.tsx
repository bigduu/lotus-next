import { createEffect, createMemo, createSignal, createUniqueId, For, Show, untrack } from "solid-js"
import { Check, ChevronDown, ChevronLeft, ChevronRight, RotateCcw, Search, Sparkles, X } from "@lucide/solid"
import type { ProviderModelRef } from "@shared/types/providerModelRef"
import type { ReasoningEffortSelection } from "@shared/utils/reasoningEffort"
import type { ThinkingMode } from "@services/chat/AgentService"
import { cn } from "@/lib/utils"
import { composerControlClassName } from "@/components/chat/composerStyles"
import { createUiText } from "../../shell/uiText"
import { Input } from "../../ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "../../ui/popover"
import type { ThinkingPickerSelection } from "./createThinkingMode"

const METEORS = [
  { top: "22%", "animation-duration": "1.6s", "animation-delay": "-0.4s", "--meteor-rest": "-25%" },
  { top: "48%", "animation-duration": "2.7s", "animation-delay": "-1.8s", "--meteor-rest": "8%" },
  { top: "76%", "animation-duration": "2.1s", "animation-delay": "-0.9s", "--meteor-rest": "30%" },
] as const
const ORDINARY: ReasoningEffortSelection[] = ["auto", "none", "low", "medium", "high", "xhigh", "max"]
const labels = {
  auto: "auto_7eb336e4", none: "reasoning_none",
  low: "low_aa9e366f", medium: "medium_a567bdaa", high: "high_b1c27820",
  xhigh: "extra_high_392d0dce", max: "max_9730c15f", ultra: "ultra_orchestration_5857fcd7",
} as const
const accents: Record<ThinkingPickerSelection, string> = {
  auto: "var(--muted-foreground)", none: "var(--muted-foreground)", low: "#5294ed",
  medium: "#428cff", high: "#3b82f6", xhigh: "#818cf8", max: "#a78bfa", ultra: "#bd8bfa",
}
const adjustmentKeys = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"]

interface ModelGroup { provider: string; label: string; models: string[] }

export function ModelEffortPicker(props: {
  modelGroups: ModelGroup[]
  model: string
  modelProvider?: string
  onModelChange: (model: ProviderModelRef) => void
  modelDisabled?: boolean
  value: ReasoningEffortSelection
  onChange: (effort: ThinkingPickerSelection) => void
  disabled?: boolean
  allowUltra?: boolean
  thinkingMode?: ThinkingMode | null
  menuPlacement?: "up" | "down"
  menuAlign?: "left" | "right"
}) {
  const text = createUiText()
  const pickerId = createUniqueId()
  const [open, setOpen] = createSignal(false)
  const [page, setPage] = createSignal<"effort" | "models">("effort")
  const [query, setQuery] = createSignal("")
  const [preview, setPreview] = createSignal<number | null>(null)
  let searchRef: HTMLInputElement | undefined
  let sliderRef: HTMLInputElement | undefined
  let modelButtonRef: HTMLButtonElement | undefined
  let pointerActive = false
  let keyboardActive = false

  const efforts = createMemo<ThinkingPickerSelection[]>(() => props.allowUltra ? [...ORDINARY, "ultra"] : ORDINARY)
  const selected = (): ThinkingPickerSelection => props.allowUltra && props.thinkingMode === "ultra" ? "ultra" : props.value
  const unconfirmed = () => Boolean(props.allowUltra && props.thinkingMode === null)
  const effortDisabled = () => Boolean(props.disabled || unconfirmed())
  const unavailableModels = () => Boolean(props.modelDisabled || props.modelGroups.length === 0)
  const triggerDisabled = () => effortDisabled() && unavailableModels()
  const index = () => Math.max(0, efforts().indexOf(selected()))
  const displayIndex = () => effortDisabled() ? index() : preview() ?? index()
  const displayed = () => efforts()[displayIndex()] ?? selected()
  const currentLabel = () => unconfirmed() ? text("unconfirmed_c098e854") : text(labels[selected()])
  const effortDescription = () => props.allowUltra && !unconfirmed()
    ? text(displayed() === "ultra" ? "ultra_reasoning_description" : "standard_reasoning_description")
    : undefined
  const accent = () => accents[displayed()]
  const modelText = () => props.model || text("select_a_model_1afed6a8")
  const filtered = createMemo(() => {
    const term = query().trim().toLowerCase()
    if (!term) return props.modelGroups
    return props.modelGroups.flatMap((group) => {
      if (`${group.label} ${group.provider}`.toLowerCase().includes(term)) return [group]
      const models = group.models.filter((item) => item.toLowerCase().includes(term))
      return models.length ? [{ ...group, models }] : []
    })
  })
  const providerLabel = () => props.modelGroups.find((group) => group.provider === props.modelProvider)?.label ?? props.modelProvider
  const providerDescription = () => props.model && providerLabel() ? ` · ${providerLabel()}` : ""
  const focus = (screen: "effort" | "models", disabled: boolean) => {
    if (screen === "models") searchRef?.focus()
    else if (disabled) modelButtonRef?.focus()
    else sliderRef?.focus()
  }

  createEffect(
    () => [open(), page()] as const,
    ([shown, screen]) => { if (shown) focus(screen, untrack(effortDisabled)) },
  )
  const changeOpen = (next: boolean) => {
    if (next && triggerDisabled()) return
    setOpen(next)
    if (!next) {
      setPage("effort")
      setQuery("")
      setPreview(null)
      pointerActive = false
      keyboardActive = false
    }
  }
  const commit = (nextIndex: number) => {
    setPreview(null)
    pointerActive = false
    keyboardActive = false
    const next = efforts()[nextIndex]
    if (!effortDisabled() && next && next !== selected()) props.onChange(next)
  }

  return (
    <Popover open={open()} onOpenChange={changeOpen} placement={
      `${props.menuPlacement === "down" ? "bottom" : "top"}-${props.menuAlign === "left" ? "start" : "end"}`
    }>
      <PopoverTrigger type="button" data-testid="model-effort-picker" aria-label={text("model_and_reasoning_effort")}
        aria-describedby={`${pickerId}-model${providerDescription() ? ` ${pickerId}-provider` : ""} ${pickerId}-effort`}
        title={`${modelText()} · ${currentLabel()}`} aria-disabled={!open() && triggerDisabled() ? "true" : undefined}
        class={cn("model-effort-trigger aria-disabled:cursor-not-allowed aria-disabled:opacity-50", composerControlClassName)}>
        <span id={`${pickerId}-model`} class="min-w-0 truncate text-left">{modelText()}</span>
        <span id={`${pickerId}-effort`} class="effort-trigger-label shrink-0 truncate">{currentLabel()}</span>
        <Show when={providerDescription()}><span id={`${pickerId}-provider`} class="sr-only">{providerDescription()}</span></Show>
        <ChevronDown class="size-3 shrink-0 text-muted-foreground" aria-hidden="true" />
      </PopoverTrigger>
      <PopoverContent class="model-effort-panel w-64 max-w-[calc(100vw-1.5rem)] rounded-2xl p-2.5 shadow-xl"
        onOpenAutoFocus={(event) => { event.preventDefault(); untrack(() => focus(page(), effortDisabled())) }}>
        <Show when={open()}>
          <Show when={page() === "effort"} fallback={
            <>
              <div class="mb-2 flex items-center gap-1 text-sm text-muted-foreground">
                <button type="button" aria-label={text("back_2d1d8c1e")} onClick={() => { setPage("effort"); setQuery("") }}
                  class="flex size-7 items-center justify-center rounded-full outline-none hover:bg-accent">
                  <ChevronLeft class="size-4" aria-hidden="true" />
                </button>
                <span>{text("select_a_model_1afed6a8")}</span>
              </div>
              <div class="relative mb-2">
                <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
                <Input ref={(node) => { searchRef = node }} type="text" role="searchbox"
                  aria-label={text("search_models_93a8734c")} placeholder={text("search_models_8ec7b052")}
                  value={query()} onInput={(event) => setQuery(event.currentTarget.value)} class="model-effort-search h-8 pl-8 pr-8 text-xs" />
                <Show when={query()}>
                  <button type="button" aria-label={text("clear_model_search_ff2b5895")}
                    onClick={() => { setQuery(""); searchRef?.focus() }}
                    class="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
                    <X class="size-3.5" aria-hidden="true" />
                  </button>
                </Show>
              </div>
              <div class="max-h-60 overflow-y-auto" aria-label={text("model_list_ea4bf042")}>
                <For each={filtered()} keyed={(group: ModelGroup) => group.provider}
                  fallback={<p role="status" class="px-3 py-6 text-center text-xs text-muted-foreground">{text("no_matching_models_4b5e0ae1")}</p>}>
                  {(group) => (
                    <div role="group" aria-label={group().label}>
                      <div class="truncate px-3 pb-1 pt-2 text-xs font-medium text-muted-foreground" title={group().label} aria-hidden="true">{group().label}</div>
                      <For each={group().models}>
                        {(model) => {
                          const isSelected = () => group().provider === props.modelProvider && model === props.model
                          return (
                            <button type="button" data-model-option="" aria-pressed={isSelected() ? "true" : "false"} title={model}
                              disabled={unavailableModels()} onClick={() => {
                                if (unavailableModels()) return
                                props.onModelChange({ provider: group().provider, model })
                                changeOpen(false)
                              }}
                              class="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:cursor-not-allowed disabled:opacity-50">
                              <span class="min-w-0 flex-1 truncate">{model}</span>
                              <Check class={cn("size-4 shrink-0 text-primary", !isSelected() && "opacity-0")} aria-hidden="true" />
                            </button>
                          )
                        }}
                      </For>
                    </div>
                  )}
                </For>
              </div>
            </>
          }>
            <div class="grid grid-cols-[2rem_1fr_2rem] items-center gap-2">
              <Show when={selected() === "ultra"} fallback={<span aria-hidden="true" />}>
                <Sparkles class="mx-auto size-4" style={{ color: accent() }} aria-hidden="true" />
              </Show>
              <div class="min-w-0 text-center">
                <p class="truncate text-sm font-semibold" style={{ color: accent() }} aria-live="polite"
                  title={effortDescription() ?? (unconfirmed() ? currentLabel() : text(labels[displayed()]))}>
                  {unconfirmed() ? currentLabel() : text(labels[displayed()])}
                </p>
                <button ref={(node) => { modelButtonRef = node }} type="button" data-testid="model-picker-model"
                  disabled={unavailableModels()} title={modelText()}
                  onClick={() => { if (!unavailableModels()) { setPage("models"); setPreview(null) } }}
                  class="mx-auto flex min-h-8 max-w-full items-center gap-0.5 rounded-md px-1 py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50">
                  <span class="min-w-0">
                    <span class="block truncate">{modelText()}</span>
                    <Show when={props.model && providerLabel()}><span class="block truncate text-[10px]">{providerLabel()}</span></Show>
                  </span>
                  <ChevronRight class="size-3 shrink-0" aria-hidden="true" />
                </button>
              </div>
              <button type="button" aria-label={text("restore_auto_reasoning")} title={text("restore_auto_reasoning")}
                disabled={effortDisabled() || selected() === "auto"}
                onClick={() => { if (!effortDisabled() && selected() !== "auto") props.onChange("auto") }}
                class="flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground disabled:cursor-not-allowed disabled:opacity-40">
                <RotateCcw class="size-4" aria-hidden="true" />
              </button>
            </div>
            <div class={cn("effort-slider mt-3", displayed() === "ultra" && "effort-slider-ultra", effortDisabled() && "opacity-40")}
              style={{ "--effort-accent": accent(), "--effort-progress": displayIndex() / (efforts().length - 1) }}>
              <div class="effort-slider-fill" aria-hidden="true">
                <Show when={displayed() === "ultra"}>
                  <span class="effort-meteors pointer-events-none absolute inset-0 overflow-hidden rounded-full">
                    <For each={METEORS}>
                      {(style) => <i class="absolute h-0.5 w-full opacity-70" style={{
                        ...style, transform: "translateX(var(--meteor-rest))",
                        background: "linear-gradient(90deg, #fff, transparent) center / 26px 2px no-repeat",
                      }} />}
                    </For>
                  </span>
                </Show>
              </div>
              <div class="effort-slider-ticks" aria-hidden="true"><For each={efforts()}>{(_effort) => <span />}</For></div>
              <input ref={(node) => { sliderRef = node }} type="range" min={0} max={efforts().length - 1} step={1} value={displayIndex()}
                aria-label={text("reasoning_level_c8c14507")} aria-valuetext={unconfirmed() ? currentLabel() : text(labels[displayed()])}
                aria-description={effortDescription()} aria-disabled={effortDisabled() ? "true" : undefined}
                class="aria-disabled:cursor-not-allowed"
                onPointerDown={(event) => {
                  if (effortDisabled()) event.preventDefault()
                  else pointerActive = true
                }}
                onInput={(event) => {
                  if (effortDisabled()) {
                    event.currentTarget.value = String(index())
                    return
                  }
                  const next = Number(event.currentTarget.value)
                  if (pointerActive || keyboardActive) setPreview(next)
                  else {
                    // Assistive input has no accompanying pointer or key gesture.
                    commit(next)
                    event.currentTarget.value = String(index())
                  }
                }}
                onPointerUp={(event) => {
                  if (pointerActive) commit(Number(event.currentTarget.value))
                }}
                onPointerCancel={() => { pointerActive = false; setPreview(null) }}
                onKeyDown={(event) => {
                  if (!adjustmentKeys.includes(event.key)) return
                  if (effortDisabled()) event.preventDefault()
                  else keyboardActive = true
                }}
                onKeyUp={(event) => {
                  if (keyboardActive && adjustmentKeys.includes(event.key)) commit(Number(event.currentTarget.value))
                }}
                onBlur={() => { keyboardActive = false; if (!pointerActive) setPreview(null) }} />
            </div>
          </Show>
        </Show>
      </PopoverContent>
    </Popover>
  )
}
