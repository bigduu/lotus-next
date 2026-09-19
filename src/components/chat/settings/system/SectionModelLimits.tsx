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
              aria-label={`展开${ariaLabel}选项`}
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
      setMsg({ kind: "ok", text: "已保存" })
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
      setMsg({ kind: "ok", text: "已恢复为全局默认" })
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
          <h2 className="text-sm font-semibold">模型限额</h2>
          <p className="mt-1 text-xs leading-relaxed text-muted-foreground">
            已确认发送过的模型会自动出现在列表中；未自定义的行继续跟随全局默认，只保存真正的覆盖。
          </p>
        </div>
        <Button size="sm" variant="secondary" onClick={addRow}>
          <Plus className="size-4" /> 新增模型
        </Button>
      </div>

      <div className="rounded-lg border bg-muted/20 px-3 py-2 text-xs text-muted-foreground">
        全局默认:上下文 <span className="font-medium text-foreground">{formatTokenCount(globalDefault.max_context_tokens)}</span>
        {" · "}最大输出 <span className="font-medium text-foreground">{formatTokenCount(globalDefault.max_output_tokens)}</span>
        {" · "}安全余量 <span className="font-medium text-foreground">{formatTokenCount(globalDefault.safety_margin)}</span>
      </div>

      <p className="text-xs leading-relaxed text-muted-foreground">
        模型支持下拉选择或直接输入匹配串；上下文窗口可快速选择 128K、258K、1M 等预设，也可输入任意整数或 K/M 简写。
      </p>

      <div className="overflow-x-auto rounded-lg border">
        <table className="w-full min-w-[820px] text-xs">
          <thead className="bg-muted/40 text-muted-foreground">
            <tr className="[&>th]:px-2 [&>th]:py-2 [&>th]:font-medium">
              <th className="w-[220px] text-left">模型</th>
              <th className="w-[150px] text-left">上下文窗口</th>
              <th className="w-[130px] text-left">最大输出</th>
              <th className="w-[130px] text-left">安全余量</th>
              <th className="w-[90px] text-left">状态</th>
              <th className="w-[150px] text-right">操作</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.id} className="border-t align-top [&>td]:px-2 [&>td]:py-2">
                <td>
                  {row.isCustom ? (
                    <EditableValueCombobox
                      ariaLabel="模型匹配串"
                      value={row.model_pattern}
                      onChange={(value) => updateRow(row.id, { model_pattern: value })}
                      options={knownModelOptions}
                      placeholder="如 gpt-5 或 glm-5.3"
                    />
                  ) : (
                    <div className="flex h-8 items-center font-mono font-medium" title={row.model_pattern}>
                      <span className="truncate">{row.model_pattern}</span>
                    </div>
                  )}
                </td>
                <td>
                  <EditableValueCombobox
                    ariaLabel={`${row.model_pattern || "新模型"} 上下文窗口`}
                    value={row.max_context_tokens}
                    onChange={(value) => updateRow(row.id, { max_context_tokens: value })}
                    options={CONTEXT_WINDOW_PRESETS}
                    placeholder="如 258K 或 1M"
                    disabled={!row.customized}
                    inputMode="decimal"
                  />
                </td>
                <td>
                  <Input
                    className="h-8 text-xs"
                    aria-label={`${row.model_pattern || "新模型"} 最大输出`}
                    inputMode="decimal"
                    value={row.max_output_tokens}
                    disabled={!row.customized}
                    onChange={(event) => updateRow(row.id, { max_output_tokens: event.target.value })}
                  />
                </td>
                <td>
                  <Input
                    className="h-8 text-xs"
                    aria-label={`${row.model_pattern || "新模型"} 安全余量`}
                    inputMode="decimal"
                    placeholder={formatTokenCount(globalDefault.safety_margin)}
                    value={row.safety_margin}
                    disabled={!row.customized}
                    onChange={(event) => updateRow(row.id, { safety_margin: event.target.value })}
                  />
                </td>
                <td className="pt-3!">
                  <Badge variant={row.customized ? "success" : "secondary"}>
                    {row.customized ? "已覆盖" : "跟随默认"}
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
                        自定义
                      </Button>
                    ) : !row.isCustom ? (
                      <Button
                        size="sm"
                        variant="ghost"
                        className="h-8 px-2"
                        onClick={() => revertRow(row.id)}
                      >
                        恢复默认
                      </Button>
                    ) : null}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-8 px-2 text-destructive hover:text-destructive"
                      onClick={() => removeRow(row)}
                    >
                      移除
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {rows.length === 0 ? (
          <div className="border-t px-3 py-8 text-center text-xs text-muted-foreground">
            发送消息后，实际使用过的模型会自动出现在这里；也可以现在新增一个模型。
          </div>
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
            全部恢复默认
          </Button>
          <Button size="sm" onClick={() => void save()} disabled={busy}>
            {busy ? "保存中…" : "保存"}
          </Button>
        </div>
      </div>

      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="清除全部模型限额?"
        description="将删除所有按模型的覆盖；已使用模型仍保留在列表中，并恢复为全局默认限额。"
        confirmLabel="清除"
        busy={busy}
        error={resetError}
        onConfirm={() => void resetAll()}
      />
    </section>
  )
}
