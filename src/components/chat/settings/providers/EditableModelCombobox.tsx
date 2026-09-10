import { useEffect, useId, useMemo, useRef, useState } from "react"
import { Check, ChevronDown } from "lucide-react"
import type { ProviderModelDescriptor } from "@shared/types/providerModelRef"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"

interface EditableModelComboboxProps {
  label: string
  value: string
  onChange: (value: string) => void
  models?: readonly ProviderModelDescriptor[]
  placeholder?: string
  disabled?: boolean
  hideLabel?: boolean
}

/**
 * Editable ARIA combobox for provider model ids.
 *
 * Catalog entries are suggestions only: the text input always remains the
 * authority, so an upstream catalog failure can never prevent a custom id.
 */
export function EditableModelCombobox({
  label,
  value,
  onChange,
  models = [],
  placeholder,
  disabled = false,
  hideLabel = false,
}: EditableModelComboboxProps) {
  const inputRef = useRef<HTMLInputElement>(null)
  const listboxId = useId()
  const labelId = useId()
  const [open, setOpen] = useState(false)
  const [activeIndex, setActiveIndex] = useState(-1)

  const options = useMemo(() => {
    const byId = new Map<string, ProviderModelDescriptor>()
    for (const model of models) {
      const id = model.reference.model.trim()
      if (id && !byId.has(id)) byId.set(id, model)
    }
    return [...byId.values()]
  }, [models])

  const filteredOptions = useMemo(() => {
    const query = value.trim().toLocaleLowerCase()
    if (!query) return options
    const matches = options.filter((model) => {
      const id = model.reference.model.toLocaleLowerCase()
      const displayName = model.display_name.toLocaleLowerCase()
      return id.includes(query) || displayName.includes(query)
    })
    return matches.length > 0 ? matches : options
  }, [options, value])

  const showOptions = open && filteredOptions.length > 0

  useEffect(() => {
    if (!showOptions || activeIndex < 0) return
    document
      .getElementById(`${listboxId}-option-${activeIndex}`)
      ?.scrollIntoView?.({ block: "nearest" })
  }, [activeIndex, listboxId, showOptions])

  const choose = (modelId: string) => {
    onChange(modelId)
    setOpen(false)
    setActiveIndex(-1)
    inputRef.current?.focus()
  }

  const moveActive = (direction: 1 | -1) => {
    if (filteredOptions.length === 0) return
    setOpen(true)
    setActiveIndex((current) => {
      if (current < 0) return direction === 1 ? 0 : filteredOptions.length - 1
      return (current + direction + filteredOptions.length) % filteredOptions.length
    })
  }

  return (
    <div
      className="relative"
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget as Node | null)) {
          setOpen(false)
          setActiveIndex(-1)
        }
      }}
    >
      <span
        id={labelId}
        className={cn(hideLabel ? "sr-only" : "mb-1 block text-xs text-muted-foreground")}
      >
        {label}
      </span>
      <div className="relative">
        <Input
          ref={inputRef}
          role="combobox"
          aria-labelledby={labelId}
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={showOptions}
          aria-activedescendant={
            showOptions && activeIndex >= 0 ? `${listboxId}-option-${activeIndex}` : undefined
          }
          autoComplete="off"
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          className={cn(options.length > 0 && "pr-9")}
          onFocus={() => setOpen(options.length > 0)}
          onChange={(event) => {
            onChange(event.target.value)
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
              const model = filteredOptions[activeIndex]
              if (model) choose(model.reference.model)
            } else if (event.key === "Escape" && open) {
              event.preventDefault()
              event.stopPropagation()
              setOpen(false)
              setActiveIndex(-1)
            }
          }}
        />
        {options.length > 0 ? (
          <button
            type="button"
            aria-label={`展开${label}选项`}
            tabIndex={-1}
            disabled={disabled}
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground disabled:opacity-50"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              setOpen((current) => !current)
              setActiveIndex(-1)
              inputRef.current?.focus()
            }}
          >
            <ChevronDown className="size-4" />
          </button>
        ) : null}
      </div>

      {showOptions ? (
        <div
          id={listboxId}
          role="listbox"
          aria-labelledby={labelId}
          className="absolute inset-x-0 top-full z-[140] mt-1 max-h-52 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md"
        >
          {filteredOptions.map((model, index) => {
            const modelId = model.reference.model
            const selected = modelId === value
            return (
              <button
                key={modelId}
                id={`${listboxId}-option-${index}`}
                type="button"
                role="option"
                aria-selected={selected}
                className={cn(
                  "flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none",
                  index === activeIndex && "bg-accent text-accent-foreground",
                )}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index)}
                onClick={() => choose(modelId)}
              >
                <Check className={cn("mt-0.5 size-3.5 shrink-0", selected ? "opacity-100" : "opacity-0")} />
                <span className="min-w-0">
                  <span className="block truncate">{modelId}</span>
                  {model.display_name && model.display_name !== modelId ? (
                    <span className="block truncate text-xs text-muted-foreground">
                      {model.display_name}
                    </span>
                  ) : null}
                </span>
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
