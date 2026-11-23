import { createEffect, createMemo, createSignal, For, Show } from "solid-js"
import { Check, ChevronDown, Search, X } from "@lucide/solid"

import { isCommandComposing } from "@/lib/commandComposition"
import { cn } from "@/lib/utils"
import { uiText } from "@shared/i18n/text"

import { Command, CommandInput, CommandItem, CommandList } from "./command"
import { Popover, PopoverContent, PopoverTrigger } from "./popover"

export interface SearchableSelectProps<T, V> {
  items: readonly T[]
  value: V
  onChange: (value: V) => void
  getKey: (item: T) => string
  getValue: (item: T) => V
  getLabel: (item: T) => string
  getSearchTerms?: (item: T) => readonly string[]
  placeholder?: string
  searchPlaceholder?: string
  clearLabel?: string
  emptyText?: string
  menuPlacement?: "up" | "down"
  menuAlign?: "left" | "right"
  searchAriaLabel?: string
  optionListAriaLabel?: string
  optionDataAttr?: `data-${string}`
  class?: string
  disabled?: boolean
  title?: string
}

export function SearchableSelect<T, V>(props: SearchableSelectProps<T, V>) {
  const [open, setOpen] = createSignal(false)
  const [query, setQuery] = createSignal("")
  let searchInput: HTMLInputElement | undefined

  const changeOpen = (next: boolean) => {
    if (next && props.disabled) return
    setOpen(next)
    if (!next) setQuery("")
  }
  createEffect(() => props.disabled, (disabled) => {
    if (disabled) changeOpen(false)
  })

  const visibleItems = createMemo(() => {
    const normalized = query().trim().toLowerCase()
    if (!normalized) return props.items
    return props.items.filter((item) =>
      [props.getLabel(item), ...(props.getSearchTerms?.(item) ?? [])]
        .some((term) => term.toLowerCase().includes(normalized)),
    )
  })
  const selectedItem = createMemo(() => props.items.find((item) => props.getValue(item) === props.value))
  const selectedLabel = () => {
    const item = selectedItem()
    return item === undefined ? props.placeholder ?? uiText("select_4aea6b5f") : props.getLabel(item)
  }
  const selectedKey = () => {
    const item = selectedItem()
    return item === undefined ? undefined : props.getKey(item)
  }

  return (
    <Popover
      open={open() && !props.disabled}
      onOpenChange={changeOpen}
      placement={`${props.menuPlacement === "up" ? "top" : "bottom"}-${props.menuAlign === "right" ? "end" : "start"}`}
    >
      <PopoverTrigger
        disabled={props.disabled}
        title={props.title}
        class={cn(
          "inline-flex max-w-[70vw] items-center gap-1 rounded-full border bg-card px-3 py-1 text-xs font-medium text-foreground outline-none transition-colors hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50 md:max-w-xs",
          props.class,
        )}
      >
        <span class="truncate">{selectedLabel()}</span>
        <ChevronDown class="size-3 shrink-0 opacity-60" />
      </PopoverTrigger>
      <PopoverContent
        class="w-72 max-w-[90vw] rounded-2xl p-1"
        aria-label={props.searchAriaLabel ?? uiText("search_44ce7ae9")}
        onEscapeKeyDown={(event: KeyboardEvent) => {
          if (isCommandComposing(event)) event.preventDefault()
        }}
        onOpenAutoFocus={(event: Event) => {
          event.preventDefault()
          searchInput?.focus()
        }}
      >
        <Command shouldFilter={false} label={props.searchAriaLabel ?? uiText("search_44ce7ae9")} defaultValue={selectedKey()}>
          <div class="relative m-1 mb-1.5">
            <Search class="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" aria-hidden="true" />
            <CommandInput
              ref={(node) => { searchInput = node }}
              placeholder={props.searchPlaceholder ?? uiText("search_a249f60c")}
              value={query()}
              onValueChange={setQuery}
              class="h-8 rounded-md border border-input bg-background pl-8 pr-8 text-xs shadow-xs"
            />
            <Show when={query()}>
              <button
                type="button"
                aria-label={props.clearLabel ?? uiText("clear_search_b6f00afa")}
                onClick={() => {
                  setQuery("")
                  searchInput?.focus()
                }}
                class="absolute right-1 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground hover:bg-accent hover:text-foreground"
              >
                <X class="size-3.5" />
              </button>
            </Show>
          </div>
          <CommandList class="max-h-60 p-1" label={props.optionListAriaLabel ?? uiText("options_c9710c82")}>
            <Show when={visibleItems().length === 0}>
              <p role="status" class="px-3 py-6 text-center text-xs text-muted-foreground">{props.emptyText ?? uiText("no_matching_options_e4a57cc0")}</p>
            </Show>
            <For each={visibleItems()}>{(item) => {
              const selected = () => props.getValue(item) === props.value
              return (
                <CommandItem
                  {...{ [props.optionDataAttr ?? "data-searchable-option"]: "" }}
                  value={props.getKey(item)}
                  onSelect={() => {
                    props.onChange(props.getValue(item))
                    changeOpen(false)
                  }}
                  class="w-full gap-2 rounded-xl px-3 py-2 text-left text-sm hover:bg-accent"
                >
                  <Check aria-hidden="true" class={cn("size-4 shrink-0 text-primary", selected() ? "opacity-100" : "opacity-0")} />
                  <span class={cn("truncate", selected() && "font-medium")}>{props.getLabel(item)}</span>
                </CommandItem>
              )
            }}</For>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
