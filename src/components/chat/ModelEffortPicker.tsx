import { useEffect, useId, useRef, useState, type CSSProperties } from "react"
import { Check, ChevronDown, ChevronLeft, ChevronRight, RotateCcw, Search, Sparkles, X } from "lucide-react"
import { uiText, useUiLocale } from "@shared/i18n/ui"
import type { ReasoningEffortSelection } from "@shared/utils/reasoningEffort"
import type { ThinkingMode } from "@services/chat/AgentService"
import type { ThinkingPickerSelection } from "@/hooks/useRootThinkingMode"
import { cn } from "@/lib/utils"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import "./ModelEffortPicker.css"

const ORDINARY: ReasoningEffortSelection[] = ["auto", "none", "low", "medium", "high", "xhigh", "max"]
const labels = () => ({
  auto: uiText("auto_7eb336e4"), none: uiText("reasoning_none"),
  low: uiText("low_aa9e366f"), medium: uiText("medium_a567bdaa"),
  high: uiText("high_b1c27820"), xhigh: uiText("extra_high_392d0dce"),
  max: uiText("max_9730c15f"), ultra: uiText("ultra_orchestration_5857fcd7"),
})
const accents: Record<ThinkingPickerSelection, string> = {
  auto: "var(--muted-foreground)", none: "var(--muted-foreground)", low: "#5294ed",
  medium: "#428cff", high: "#3b82f6", xhigh: "#818cf8", max: "#a78bfa", ultra: "#bd8bfa",
}

/** A controlled model/effort surface; persistence remains with ChatPane's handlers. */
export function ModelEffortPicker({
  models, model, onModelChange, modelDisabled = false, value, onChange, disabled = false,
  allowUltra = false, thinkingMode, menuPlacement = "up", menuAlign = "right",
}: {
  models: string[]
  model: string
  onModelChange: (model: string) => void
  modelDisabled?: boolean
  value: ReasoningEffortSelection
  onChange: (effort: ThinkingPickerSelection) => void
  disabled?: boolean
  allowUltra?: boolean
  thinkingMode?: ThinkingMode | null
  menuPlacement?: "up" | "down"
  menuAlign?: "left" | "right"
}) {
  useUiLocale()
  const pickerId = useId()
  const [open, setOpen] = useState(false)
  const [page, setPage] = useState<"effort" | "models">("effort")
  const [query, setQuery] = useState("")
  const [preview, setPreview] = useState<number | null>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const sliderRef = useRef<HTMLInputElement>(null)
  const modelButtonRef = useRef<HTMLButtonElement>(null)
  const pointerActive = useRef(false)
  const keyboardActive = useRef(false)
  const efforts: ThinkingPickerSelection[] = allowUltra ? [...ORDINARY, "ultra"] : ORDINARY
  const selected: ThinkingPickerSelection = allowUltra && thinkingMode === "ultra" ? "ultra" : value
  const unconfirmed = allowUltra && thinkingMode === null
  const effortDisabled = disabled || unconfirmed
  const unavailableModels = modelDisabled || models.length === 0
  const triggerDisabled = effortDisabled && unavailableModels
  const index = efforts.indexOf(selected)
  const displayIndex = effortDisabled ? index : preview ?? index
  const displayed = efforts[displayIndex]!
  const text = labels()
  const currentLabel = unconfirmed ? uiText("unconfirmed_c098e854") : text[selected]
  const accent = accents[displayed]
  const normalized = query.trim().toLowerCase()
  const filtered = normalized ? models.filter((item) => item.toLowerCase().includes(normalized)) : models

  useEffect(() => {
    if (!open) return
    if (page === "models") searchRef.current?.focus()
    else if (effortDisabled) modelButtonRef.current?.focus()
    else sliderRef.current?.focus()
  }, [open, page, effortDisabled])

  const changeOpen = (next: boolean) => {
    if (next && triggerDisabled) return
    setOpen(next)
    if (!next) { setPage("effort"); setQuery(""); setPreview(null); pointerActive.current = false; keyboardActive.current = false }
  }
  const commit = (nextIndex: number) => {
    setPreview(null)
    pointerActive.current = false
    keyboardActive.current = false
    const next = efforts[nextIndex]
    if (!effortDisabled && next && (next !== selected || unconfirmed)) onChange(next)
  }

  return (
    <Popover open={open && !triggerDisabled} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button type="button" data-testid="model-effort-picker" aria-label={uiText("model_and_reasoning_effort")}
          aria-describedby={`${pickerId}-model ${pickerId}-effort`}
          disabled={triggerDisabled}
          className="model-effort-trigger inline-flex min-w-0 max-w-[70vw] items-center gap-1.5 rounded-full border bg-card px-3 py-1.5 text-xs font-medium outline-none transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 md:max-w-xs">
          <span id={`${pickerId}-model`} className="truncate">{model || uiText("select_a_model_1afed6a8")}</span>
          <span id={`${pickerId}-effort`} className="shrink-0" style={{ color: accents[selected] }}>{currentLabel}</span>
          <ChevronDown className="size-3 shrink-0 text-muted-foreground" aria-hidden />
        </button>
      </PopoverTrigger>
      <PopoverContent side={menuPlacement === "up" ? "top" : "bottom"}
        align={menuAlign === "right" ? "end" : "start"}
        className="model-effort-panel w-80 max-w-[calc(100vw-1.5rem)] rounded-3xl p-3 shadow-xl"
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          if (effortDisabled) modelButtonRef.current?.focus()
          else sliderRef.current?.focus()
        }}>
        {page === "effort" ? (
          <>
            <div className="grid grid-cols-[2rem_1fr_2rem] items-center gap-2">
              {selected === "ultra" ? <Sparkles className="mx-auto size-4" style={{ color: accent }} aria-hidden />
                : <span aria-hidden />}
              <div className="min-w-0 text-center">
                <p className="text-base font-semibold" style={{ color: accent }} aria-live="polite">
                  {unconfirmed ? currentLabel : text[displayed]}
                </p>
                <button ref={modelButtonRef} type="button" data-testid="model-picker-model" disabled={unavailableModels}
                  onClick={() => { if (!unavailableModels) { setPage("models"); setPreview(null) } }}
                  className="mx-auto flex max-w-full items-center gap-0.5 rounded-md px-1 py-0.5 text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50">
                  <span className="truncate">{model || uiText("select_a_model_1afed6a8")}</span>
                  <ChevronRight className="size-3 shrink-0" aria-hidden />
                </button>
              </div>
              <button type="button" aria-label={uiText("restore_auto_reasoning")} title={uiText("restore_auto_reasoning")}
                disabled={effortDisabled || selected === "auto"}
                onClick={() => { if (!effortDisabled && selected !== "auto") onChange("auto") }}
                className="flex size-8 items-center justify-center rounded-full text-muted-foreground outline-none hover:bg-accent hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-40">
                <RotateCcw className="size-4" aria-hidden />
              </button>
            </div>
            <div className={cn("effort-slider mt-3", displayed === "ultra" && "effort-slider-ultra", effortDisabled && "opacity-40")}
              style={{ "--effort-accent": accent, "--effort-progress": displayIndex / (efforts.length - 1) } as CSSProperties}>
              <div className="effort-slider-fill" aria-hidden />
              <div className="effort-slider-ticks" aria-hidden>
                {efforts.map((effort) => <span key={effort} />)}
              </div>
              <input ref={sliderRef} type="range" min={0} max={efforts.length - 1} step={1} value={displayIndex}
                aria-label={uiText("reasoning_level_c8c14507")} aria-valuetext={unconfirmed ? currentLabel : text[displayed]}
                disabled={effortDisabled}
                onPointerDown={() => { pointerActive.current = true }}
                onChange={(event) => {
                  if (effortDisabled) return
                  const next = Number(event.currentTarget.value)
                  if (pointerActive.current || keyboardActive.current) setPreview(next)
                  else commit(next) // Assistive technologies may emit input without a pointer/key gesture.
                }}
                onPointerUp={(event) => commit(Number(event.currentTarget.value))}
                onPointerCancel={() => { pointerActive.current = false; setPreview(null) }}
                onKeyDown={(event) => {
                  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) keyboardActive.current = true
                }}
                onKeyUp={(event) => {
                  if (["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End", "PageUp", "PageDown"].includes(event.key)) commit(Number(event.currentTarget.value))
                }}
                onBlur={() => { keyboardActive.current = false; if (!pointerActive.current) setPreview(null) }}
              />
            </div>
            <div className="mt-1.5 flex justify-between px-1 text-[10px] text-muted-foreground" aria-hidden>
              <span>{text.auto}</span><span>{text[efforts[efforts.length - 1]!]}</span>
            </div>
            {displayed === "ultra" ? <p className="mt-2 border-t pt-2 text-xs leading-relaxed text-muted-foreground">{uiText("ultra_picker_description")}</p> : null}
          </>
        ) : (
          <>
            <div className="mb-2 flex items-center gap-1 text-sm text-muted-foreground">
              <button type="button" aria-label={uiText("back_2d1d8c1e")}
                onClick={() => { setPage("effort"); setQuery("") }}
                className="flex size-7 items-center justify-center rounded-full outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring">
                <ChevronLeft className="size-4" aria-hidden />
              </button>
              <span>{uiText("select_a_model_1afed6a8")}</span>
            </div>
            <div className="relative mb-2">
              <Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden />
              <Input ref={searchRef} type="text" role="searchbox"
                aria-label={uiText("search_models_93a8734c")} placeholder={uiText("search_models_8ec7b052")}
                value={query} onChange={(event) => setQuery(event.currentTarget.value)} className="model-effort-search h-8 pl-8 pr-8 text-xs" />
              {query ? <button type="button" aria-label={uiText("clear_model_search_ff2b5895")}
                onClick={() => { setQuery(""); searchRef.current?.focus() }}
                className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent">
                <X className="size-3.5" aria-hidden />
              </button> : null}
            </div>
            <div className="max-h-60 overflow-y-auto" aria-label={uiText("model_list_ea4bf042")}>
              {filtered.map((item) => <button key={item} type="button" data-model-option="" aria-pressed={item === model}
                disabled={unavailableModels} onClick={() => { if (!unavailableModels) { onModelChange(item); changeOpen(false) } }}
                className="flex w-full items-center gap-2 rounded-xl px-3 py-2 text-left text-sm outline-none hover:bg-accent focus-visible:bg-accent disabled:cursor-not-allowed disabled:opacity-50">
                <span className="min-w-0 flex-1 truncate">{item}</span>
                <Check className={cn("size-4 shrink-0 text-primary", item !== model && "opacity-0")} aria-hidden />
              </button>)}
              {filtered.length === 0 ? <p role="status" className="px-3 py-6 text-center text-xs text-muted-foreground">{uiText("no_matching_models_4b5e0ae1")}</p> : null}
            </div>
          </>
        )}
      </PopoverContent>
    </Popover>
  )
}
