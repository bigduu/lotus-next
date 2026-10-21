import { uiText, useUiLocale } from "@shared/i18n/ui"
import { useEffect, useMemo, useRef, useState } from "react"
import { Check, ChevronDown, Search, X } from "lucide-react"
import { cn } from "@/lib/utils"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { Command, CommandInput, CommandItem, CommandList } from "@/components/ui/command"
import { isCommandComposing } from "@/lib/commandComposition"

export interface SearchableSelectProps<T, V> {
  /** Full list of selectable items. */
  items: readonly T[]
  /** Currently selected value. */
  value: V
  /** Called when the user selects a new value. */
  onChange: (value: V) => void
  /** Unique React key for an item. */
  getKey: (item: T) => string
  /** Value used for selection equality and emitted by onChange. */
  getValue: (item: T) => V
  /** Visible label for an item. */
  getLabel: (item: T) => string
  /** Additional strings to match when filtering (optional). */
  getSearchTerms?: (item: T) => readonly string[]
  /** Text shown in the trigger when no value is selected. */
  placeholder?: string
  /** Placeholder inside the search input. */
  searchPlaceholder?: string
  /** Accessible label for the clear-search button. */
  clearLabel?: string
  /** Message shown when filtering yields no items. */
  emptyText?: string
  /** Menu opening direction. */
  menuPlacement?: "up" | "down"
  /** Menu horizontal alignment. */
  menuAlign?: "left" | "right"
  /** Accessible label for the search input. */
  searchAriaLabel?: string
  /** Accessible label for the option list container. */
  optionListAriaLabel?: string
  /** Data attribute added to each option element for tests/adapters. */
  optionDataAttr?: `data-${string}`
  /** Optional container className applied to the trigger. */
  className?: string
  disabled?: boolean
  title?: string
}

/**
 * Generic searchable single-select wrapped in a popover.
 *
 * The component is intentionally unopinionated about item shape: callers map
 * their domain objects to keys, values, labels, and optional search terms.
 */
export function SearchableSelect<T, V>({
  items,
  value,
  onChange,
  getKey,
  getValue,
  getLabel,
  getSearchTerms,
  placeholder = uiText("select_4aea6b5f"),
  searchPlaceholder = uiText("search_a249f60c"),
  clearLabel = uiText("clear_search_b6f00afa"),
  emptyText = uiText("no_matching_options_e4a57cc0"),
  menuPlacement = "down",
  menuAlign = "left",
  searchAriaLabel = uiText("search_44ce7ae9"),
  optionListAriaLabel = uiText("options_c9710c82"),
  optionDataAttr = "data-searchable-option",
  className,
  disabled = false,
  title,
}: SearchableSelectProps<T, V>) {
  useUiLocale()
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState("")
  const searchRef = useRef<HTMLInputElement>(null)
  const triggerRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    if (disabled) {
      setOpen(false)
      setQuery("")
    }
  }, [disabled])

  const normalizedQuery = query.trim().toLowerCase()

  const filteredItems = useMemo(() => {
    if (!normalizedQuery) return items
    return items.filter((item) => {
      const label = getLabel(item).toLowerCase()
      if (label.includes(normalizedQuery)) return true
      const extra = getSearchTerms?.(item) ?? []
      return extra.some((term) => term.toLowerCase().includes(normalizedQuery))
    })
  }, [items, normalizedQuery, getLabel, getSearchTerms])

  const selectedItem = useMemo(
    () => items.find((item) => getValue(item) === value),
    [items, value, getValue],
  )

  const selectedLabel = selectedItem ? getLabel(selectedItem) : placeholder

  const changeOpen = (nextOpen: boolean) => {
    if (disabled && nextOpen) return
    setOpen(nextOpen)
    if (!nextOpen) setQuery("")
  }

  const pickItem = (item: T) => {
    onChange(getValue(item))
    changeOpen(false)
  }

  return (
    <Popover open={open && !disabled} onOpenChange={changeOpen}>
      <PopoverTrigger asChild>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          title={title}
          className={cn(
            "inline-flex max-w-[70vw] items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-[3px] focus-visible:ring-ring/50 disabled:cursor-not-allowed disabled:opacity-50 md:max-w-xs",
            className,
          )}
        >
          <span className="truncate">{selectedLabel}</span>
          <ChevronDown className="size-3 shrink-0 opacity-60" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        side={menuPlacement === "up" ? "top" : "bottom"}
        align={menuAlign === "right" ? "end" : "start"}
        className="w-72 max-w-[90vw] rounded-2xl p-1"
        onEscapeKeyDown={(event) => { if (isCommandComposing(event)) event.preventDefault() }}
        onOpenAutoFocus={(event) => {
          event.preventDefault()
          searchRef.current?.focus()
        }}
        onCloseAutoFocus={(event) => {
          event.preventDefault()
          const active = document.activeElement
          // Another selector or navigation destination may already own focus
          // when Radix finishes this popover's deferred close autofocus.
          if (active instanceof HTMLElement && active !== document.body && active.isConnected && !active.closest('[hidden], [inert], [aria-hidden="true"]')) return
          const trigger = triggerRef.current
          if (trigger?.isConnected && !trigger.disabled && !trigger.closest('[hidden], [inert], [aria-hidden="true"]')) trigger.focus()
        }}
      >
        <Command shouldFilter={false} label={searchAriaLabel}
          defaultValue={selectedItem ? JSON.stringify(getKey(selectedItem)) : undefined}>
        <div className="relative m-1 mb-1.5">
          <Search
            className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground"
            aria-hidden
          />
          <CommandInput
            ref={searchRef}
            aria-label={searchAriaLabel}
            placeholder={searchPlaceholder}
            value={query}
            onValueChange={setQuery}
            className="h-8 rounded-md border border-input bg-background pl-8 pr-8 text-xs shadow-xs focus-visible:border-ring focus-visible:ring-ring/50 focus-visible:ring-[3px]"
          />
          {query ? (
            <button
              type="button"
              aria-label={clearLabel}
              onKeyDown={(event) => {
                // Preserve native button activation without selecting a Command option.
                if (event.key === "Enter") event.stopPropagation()
              }}
              onClick={() => {
                setQuery("")
                searchRef.current?.focus()
              }}
              className="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          ) : null}
        </div>
        <CommandList className="max-h-60 p-1" label={optionListAriaLabel}>
          {filteredItems.length === 0 ? <p role="status" className="px-3 py-6 text-center text-xs text-muted-foreground">{emptyText}</p> : null}
          {filteredItems.map((item) => {
              const itemValue = getValue(item)
              const isSelected = itemValue === value
              return (
                <CommandItem
                  key={getKey(item)}
                  {...{ [optionDataAttr]: "" }}
                  value={JSON.stringify(getKey(item))}
                  onSelect={() => pickItem(item)}
                  className="w-full gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <Check
                    className={cn(
                      "size-4 shrink-0 text-primary",
                      isSelected ? "opacity-100" : "opacity-0",
                    )}
                  />
                  <span
                    className={cn("truncate", isSelected && "font-medium")}
                  >
                    {getLabel(item)}
                  </span>
                </CommandItem>
              )
            })}
        </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
