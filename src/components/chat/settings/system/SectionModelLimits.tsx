import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, Plus } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import {
  Popover,
  PopoverAnchor,
  PopoverContent,
} from "@/components/ui/popover"
import { cn } from "@/lib/utils"
import { getErrorMessage } from "@services/api"
import { serviceFactory } from "@services/common/ServiceFactory"
import { useAppStore } from "@shared/store/appStore"
import { useProviderStore } from "@shared/store/appStore/slices/providerSlice"
import { getUsedModels, removeUsedModel } from "@shared/utils/usedModels"
import { ConfirmDialog } from "./ConfirmDialog"
import { StatusLine } from "./StatusLine"
import {
  FALLBACK_DEFAULT,
  buildLimitRows,
  formatTokenCount,
  nextModelLimitRowId,
  validateLimitRows,
  type GlobalDefault,
  type LimitRowDraft,
} from "./modelLimits"
import type {
  SectionMessage,
  SystemBambooConfig,
  SystemConfigApi,
} from "./useSystemConfig"

interface ComboOption {
  value: string
  label: string
  description?: string
}

const CONTEXT_WINDOW_PRESETS: ComboOption[] = [
  { value: "16K", label: "16K", description: "16,000 tokens" },
  { value: "32K", label: "32K", description: "32,000 tokens" },
  { value: "64K", label: "64K", description: "64,000 tokens" },
  { value: "128K", label: "128K", description: "128,000 tokens" },
  { value: "200K", label: "200K", description: "200,000 tokens" },
  { value: "256K", label: "256K", description: "256,000 tokens" },
  { value: "258K", label: "258K", description: "258,000 tokens" },
  { value: "400K", label: "400K", description: "400,000 tokens" },
  { value: "1M", label: "1M", description: "1,000,000 tokens" },
  { value: "2M", label: "2M", description: "2,000,000 tokens" },
]

const MAX_OUTPUT_PRESETS: ComboOption[] = [
  { value: "4K", label: "4K", description: "4,000 tokens" },
  { value: "8K", label: "8K", description: "8,000 tokens" },
  { value: "16K", label: "16K", description: "16,000 tokens" },
  { value: "32K", label: "32K", description: "32,000 tokens" },
  { value: "64K", label: "64K", description: "64,000 tokens" },
  { value: "128K", label: "128K", description: "128,000 tokens" },
]

function parseGlobalDefault(response: {
  model_limits?: Array<Partial<GlobalDefault>>
}): GlobalDefault {
  const first = response.model_limits?.[0]
  const positive = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isSafeInteger(value) && value > 0 ? value : fallback
  const nonNegative = (value: unknown, fallback: number) =>
    typeof value === "number" && Number.isSafeInteger(value) && value >= 0 ? value : fallback

  return {
    max_context_tokens: positive(first?.max_context_tokens, FALLBACK_DEFAULT.max_context_tokens),
    max_output_tokens: positive(first?.max_output_tokens, FALLBACK_DEFAULT.max_output_tokens),
    safety_margin: nonNegative(first?.safety_margin, FALLBACK_DEFAULT.safety_margin),
  }
}

function EditableValueCombobox({
  ariaLabel,
  value,
  onChange,
  options,
  placeholder,
  disabled = false,
  inputMode,
}: {
  ariaLabel: string
  value: string
  onChange: (value: string) => void
  options: readonly ComboOption[]
  placeholder?: string
  disabled?: boolean
  inputMode?: "text" | "numeric" | "decimal"
}) {
  useUiLocale()
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)
  const [filtering, setFiltering] = useState(false)
  const filtered = useMemo(() => {
    if (!filtering) return options
    const query = value.trim().toLocaleLowerCase()
    if (!query) return options
    const matches = options.filter((option) =>
      `${option.label} ${option.value} ${option.description ?? ""}`
        .toLocaleLowerCase()
        .includes(query),
    )
    return matches.length > 0 ? matches : options
  }, [filtering, options, value])
  const showOptions = open && filtered.length > 0 && !disabled

  const choose = (next: string) => {
    onChange(next)
    setOpen(false)
    setActiveIndex(-1)
    setFiltering(false)
    inputRef.current?.focus()
  }

  const moveActive = (direction: 1 | -1) => {
    if (filtered.length === 0) return
    setOpen(true)
    setActiveIndex((current) => {
      if (current < 0) return direction === 1 ? 0 : filtered.length - 1
      return (current + direction + filtered.length) % filtered.length
    })
  }

  return (
    <Popover
      open={showOptions}
      onOpenChange={(next) => {
        setOpen(next)
        if (!next) {
          setActiveIndex(-1)
          setFiltering(false)
        }
      }}
    >
      <PopoverAnchor asChild>
        <div className="relative">
          <Input
            ref={inputRef}
            role="combobox"
            aria-label={ariaLabel}
            aria-autocomplete="list"
            aria-controls={listboxId}
            aria-expanded={showOptions}
            aria-activedescendant={
              showOptions && activeIndex >= 0 ? `${listboxId}-${activeIndex}` : undefined
            }
            autoComplete="off"
            inputMode={inputMode}
            value={value}
            placeholder={placeholder}
            disabled={disabled}
            className={cn("h-8 text-xs", options.length > 0 && !disabled && "pr-8")}
            onFocus={() => {
              setFiltering(false)
              setOpen(options.length > 0)
            }}
            onChange={(event) => {
              onChange(event.target.value)
              setFiltering(true)
              setOpen(options.length > 0)
              setActiveIndex(-1)
            }}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown") {
                event.preventDefault()
                moveActive(1)
              } else if (event.key === "ArrowUp") {
                event.preventDefault()
                moveActive(-1)
              } else if (event.key === "Enter" && showOptions && activeIndex >= 0) {
                event.preventDefault()
                const option = filtered[activeIndex]
                if (option) choose(option.value)
              } else if (event.key === "Escape" && open) {
                event.preventDefault()
                setOpen(false)
                setActiveIndex(-1)
                setFiltering(false)
              }
            }}
          />
          {options.length > 0 && !disabled ? (
            <button
              type="button"
              aria-label={uiText("expand_options_fe7f0967", { v0: ariaLabel })}
              tabIndex={-1}
              className="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground"
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => {
                setFiltering(false)
                setOpen((current) => !current)
                setActiveIndex(-1)
                inputRef.current?.focus()
              }}
            >
              <ChevronDown className="size-3.5" />
            </button>
          ) : null}
        </div>
      </PopoverAnchor>

      {showOptions ? (
        <PopoverContent
          id={listboxId}
          role="listbox"
          align="start"
          className="z-[160] max-h-72 min-w-48 overflow-y-auto p-1"
          style={{ width: Math.max(inputRef.current?.parentElement?.offsetWidth ?? 0, 192) }}
          onOpenAutoFocus={(event) => event.preventDefault()}
          onCloseAutoFocus={(event) => event.preventDefault()}
        >
          {filtered.map((option, index) => {
            const selected = option.value.toLocaleLowerCase() === value.trim().toLocaleLowerCase()
            return (
              <button
                key={option.value}
                id={`${listboxId}-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                className={cn(
                  "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none",
                  index === activeIndex && "bg-accent text-accent-foreground",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(option.value)}
              >
                <Check className={cn("mt-0.5 size-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0">
                  <span className="block truncate font-medium">{option.label}</span>
                  {option.description ? (
                    <span className="block truncate text-[11px] text-muted-foreground">
                      {option.description}
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </PopoverContent>
      ) : null}
    </Popover>
  )
}

/** Per-model token budgets, including acknowledged-model discovery from legacy Lotus. */
export function SectionModelLimits({
  config,
  saveSection,
}: {
  config: SystemBambooConfig
  saveSection: SystemConfigApi["saveSection"]
}) {
  useUiLocale()
  const availableModels = useAppStore((state) => state.models)
  const providerSnapshot = useProviderStore(
    (state) => state.providerSnapshot ?? state.providerRepairSnapshot,
  )
  const catalogModels = useProviderStore((state) => state.catalog?.models)
  const [globalDefault, setGlobalDefault] = useState<GlobalDefault>(FALLBACK_DEFAULT)
  const [usedModels, setUsedModels] = useState<string[]>(getUsedModels)
  // Seed once: another section save must not clobber in-progress edits.
  const [rows, setRows] = useState<LimitRowDraft[]>(() =>
    buildLimitRows(FALLBACK_DEFAULT, config.model_limits ?? [], getUsedModels()),
  )
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<SectionMessage>(null)
  const [confirmReset, setConfirmReset] = useState(false)
  const [resetError, setResetError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    serviceFactory
      .getModelLimitDefaults()
      .then((response) => {
        if (cancelled) return
        const defaults = parseGlobalDefault(response)
        setGlobalDefault(defaults)
        setRows((current) =>
          current.map((row) =>
            row.customized
              ? row
              : {
                  ...row,
                  max_context_tokens: formatTokenCount(defaults.max_context_tokens),
                  max_output_tokens: formatTokenCount(defaults.max_output_tokens),
                },
          ),
        )
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [])

  const knownModelOptions = useMemo<ComboOption[]>(() => {
    const ordered: string[] = []
    const seen = new Set<string>()
    const add = (value: unknown) => {
      if (typeof value !== "string") return
      const model = value.trim()
      const key = model.toLocaleLowerCase()
      if (!model || seen.has(key)) return
      seen.add(key)
      ordered.push(model)
    }

    usedModels.forEach(add)
    rows.forEach((row) => add(row.model_pattern))
    availableModels.forEach(add)
    catalogModels?.forEach((model) => add(model.reference.model))
    const defaults = providerSnapshot?.defaults
    add(defaults?.chat?.model)
    add(defaults?.fast?.model)
    add(defaults?.task_summary?.model)
    add(defaults?.vision?.model)
    add(defaults?.memory_background?.model)
    add(defaults?.planning?.model)
    add(defaults?.search?.model)
    add(defaults?.code_review?.model)
    add(defaults?.sub_agent?.model)
    Object.values(defaults?.subagent_models ?? {}).forEach((reference) => add(reference.model))

    return ordered.map((model) => ({ value: model, label: model }))
  }, [availableModels, catalogModels, providerSnapshot, rows, usedModels])

  const updateRow = (id: string, patch: Partial<LimitRowDraft>) => {
    setRows((current) => current.map((row) => (row.id === id ? { ...row, ...patch } : row)))
    setMsg(null)
  }

  const addRow = () => {
    setRows((current) => [
      ...current,
      {
        id: nextModelLimitRowId(),
        model_pattern: "",
        isCustom: true,
        customized: true,
        max_context_tokens: formatTokenCount(globalDefault.max_context_tokens),
        max_output_tokens: formatTokenCount(globalDefault.max_output_tokens),
        safety_margin: "",
      },
    ])
    setMsg(null)
  }

  const removeRow = (target: LimitRowDraft) => {
    if (!target.isCustom) setUsedModels(removeUsedModel(target.model_pattern))
    setRows((current) => current.filter((row) => row.id !== target.id))
    setMsg(null)
  }

  const revertRow = (id: string) => {
    setRows((current) =>
      current.map((row) =>
        row.id === id
          ? {
              ...row,
              customized: false,
              max_context_tokens: formatTokenCount(globalDefault.max_context_tokens),
              max_output_tokens: formatTokenCount(globalDefault.max_output_tokens),
              safety_margin: "",
            }
          : row,
      ),
    )
    setMsg(null)
  }

  const save = async () => {
    const result = validateLimitRows(rows)
    if ("error" in result) {
      setMsg({ kind: "error", text: result.error })
      return
    }
    setBusy(true)
    setMsg(null)
    try {
      const saved = await saveSection({ model_limits: result.overrides })
      const latestUsedModels = getUsedModels()
      setUsedModels(latestUsedModels)
      setRows(buildLimitRows(globalDefault, saved.model_limits ?? [], latestUsedModels))
      setMsg({ kind: "ok", text: uiText("saved_1bd91a7d") })
    } catch (error) {
      setMsg({ kind: "error", text: getErrorMessage(error) })
    } finally {
      setBusy(false)
    }
  }

  const resetAll = async () => {
    setBusy(true)
    setResetError(null)
    try {
      const saved = await saveSection({ model_limits: [] })
      const latestUsedModels = getUsedModels()
      setUsedModels(latestUsedModels)
      setRows(buildLimitRows(globalDefault, saved.model_limits ?? [], latestUsedModels))
      setConfirmReset(false)
      setMsg({ kind: "ok", text: uiText("restored_global_defaults_4f47beee") })
    } catch (error) {
      setResetError(getErrorMessage(error))
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold">{uiText("model_limits_05ff605e")}</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            {uiText("models_confirmed_through_sending_appear_automatically_u_1e3a1de2")}</p>
        </div>
        <Button size="sm" variant="secondary" onClick={addRow}>
          <Plus className="size-4" />{uiText("add_model_e552c2ac")}</Button>
      </div>

      <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        {uiText("global_defaults_context_b7667fd0")} <span className="font-medium text-foreground">{formatTokenCount(globalDefault.max_context_tokens)}</span>
        {" · "}{uiText("max_output_d6601037")} <span className="font-medium text-foreground">{formatTokenCount(globalDefault.max_output_tokens)}</span>
        {" · "}{uiText("safety_margin_40253c60")} <span className="font-medium text-foreground">{formatTokenCount(globalDefault.safety_margin)}</span>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        {uiText("choose_or_type_a_model_pattern_context_and_output_limit_eb2906c4")}</p>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[820px] text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:font-medium">
              <th className="w-[220px] text-left">{uiText("model_c98e118e")}</th>
              <th className="w-[150px] text-left">{uiText("context_window_bb074b86")}</th>
              <th className="w-[130px] text-left">{uiText("max_output_d6601037")}</th>
              <th className="w-[130px] text-left">{uiText("safety_margin_40253c60")}</th>
              <th className="w-[90px] text-left">{uiText("status_6320b4a8")}</th>
              <th className="w-[150px] text-right">{uiText("action_ed31fbb4")}</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t align-top [&>td]:px-2 [&>td]:py-2">
                <td>
                  {row.isCustom ? (
                    <EditableValueCombobox
                      ariaLabel={uiText("model_pattern_e5fe9bd4")}
                      value={row.model_pattern}
                      onChange={(value) => updateRow(row.id, { model_pattern: value })}
                      options={knownModelOptions}
                      placeholder={uiText("e_g_gpt_5_or_glm_5_3_63bebb83")}
                    />
                  ) : (
                    <div className="flex h-8 items-center font-mono font-medium" title={row.model_pattern}>
                      <span className="truncate">{row.model_pattern}</span>
                    </div>
                  )}
                </td>
                <td>
                  <EditableValueCombobox
                    ariaLabel={uiText("context_window_74c09029", { v0: row.model_pattern || uiText("new_model") })}
                    value={row.max_context_tokens}
                    onChange={(value) => updateRow(row.id, { max_context_tokens: value })}
                    options={CONTEXT_WINDOW_PRESETS}
                    placeholder={uiText("e_g_258k_or_1m_0a242a0c")}
                    disabled={!row.customized}
                    inputMode="decimal"
                  />
                </td>
                <td>
                  <EditableValueCombobox
                    ariaLabel={uiText("maximum_output_5e8920ca", { v0: row.model_pattern || uiText("new_model") })}
                    value={row.max_output_tokens}
                    onChange={(value) => updateRow(row.id, { max_output_tokens: value })}
                    options={MAX_OUTPUT_PRESETS}
                    placeholder={uiText("e_g_16k_or_32k_95dea87b")}
                    disabled={!row.customized}
                    inputMode="decimal"
                  />
                </td>
                <td>
                  <Input
                    className="h-8 text-xs"
                    aria-label={uiText("safety_margin_b3945952", { v0: row.model_pattern || uiText("new_model") })}
                    inputMode="decimal"
                    placeholder={formatTokenCount(globalDefault.safety_margin)}
                    value={row.safety_margin}
                    disabled={!row.customized}
                    onChange={(event) => updateRow(row.id, { safety_margin: event.target.value })}
                  />
                </td>
                <td className="pt-3!">
                  <Badge variant={row.customized ? "success" : "secondary"}>
                    {row.customized ? uiText("overridden_4ae1bfcb") : uiText("follow_defaults_a44f9f9f")}
                  </Badge>
                </td>
                <td>
                  <div className="flex justify-end gap-1">
                    {!row.customized ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2"
                        onClick={() => updateRow(row.id, { customized: true })}
                      >
                        {uiText("customize_4eafa9e9")}</Button>
                    ) : !row.isCustom ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2"
                        onClick={() => revertRow(row.id)}
                      >
                        {uiText("reset_to_default_ba2e93e7")}</Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-destructive hover:text-destructive"
                      onClick={() => removeRow(row)}
                    >
                      {uiText("remove_6135d415")}</Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="border-t px-3 py-8 text-center text-xs text-muted-foreground">
            {uiText("models_you_have_used_appear_here_after_sending_you_can__d8f967ba")}</div>
        ) : null}
      </div>

      <div className="flex items-center justify-between gap-2">
        <StatusLine msg={msg} />
        <div className="ml-auto flex gap-2">
          <Button
            size="sm"
            variant="secondary"
            disabled={busy}
            onClick={() => {
              setResetError(null)
              setConfirmReset(true)
            }}
          >
            {uiText("reset_all_to_default_3b6c48ce")}</Button>
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {busy ? uiText("saving_ff509c9b") : uiText("save_a3030bf8")}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={uiText("clear_all_model_limits_86ec2499")}
        description={uiText("remove_all_per_model_overrides_used_models_stay_in_the__d570aece")}
        confirmLabel={uiText("clear_bce23772")}
        busy={busy}
        error={resetError}
        onConfirm={() => void resetAll()}
      />
    </section>
  )
}
