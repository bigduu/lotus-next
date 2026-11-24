import { createEffect, createMemo, createSignal, createUniqueId, For, Show } from "solid-js"
import { Check, ChevronDown } from "@lucide/solid"
import type { ProviderModelDescriptor } from "@shared/types/providerModelRef"
import { cn } from "@/lib/utils"
import { createUiText } from "../shell/uiText"
import { Input } from "../ui/input"

interface EditableModelComboboxProps {
  label: string
  value: string
  onChange: (value: string) => void
  models?: readonly ProviderModelDescriptor[]
  placeholder?: string
  disabled?: boolean
  hideLabel?: boolean
}

/** Catalog models are suggestions; the field can retain custom model ids. */
export function EditableModelCombobox(props: EditableModelComboboxProps) {
  const text = createUiText()
  let input!: HTMLInputElement
  const listboxId = createUniqueId()
  const labelId = createUniqueId()
  const [open, setOpen] = createSignal(false)
  const [activeIndex, setActiveIndex] = createSignal(-1)

  const options = createMemo(() => {
    const byId = new Map<string, ProviderModelDescriptor>()
    for (const model of props.models ?? []) {
      const id = model.reference.model.trim()
      if (id && !byId.has(id)) byId.set(id, model)
    }
    return [...byId.values()]
  })
  const filteredOptions = createMemo(() => {
    const query = props.value.trim().toLocaleLowerCase()
    if (!query) return options()
    const matches = options().filter((model) =>
      model.reference.model.toLocaleLowerCase().includes(query) ||
      model.display_name.toLocaleLowerCase().includes(query),
    )
    return matches.length > 0 ? matches : options()
  })
  const showOptions = () => !props.disabled && open() && filteredOptions().length > 0

  createEffect(
    () => showOptions() ? activeIndex() : -1,
    (index) => {
      if (index >= 0) input.ownerDocument.getElementById(`${listboxId}-option-${index}`)
        ?.scrollIntoView?.({ block: "nearest" })
    },
  )

  const close = () => {
    setOpen(false)
    setActiveIndex(-1)
  }
  const choose = (model: string) => {
    input.focus()
    props.onChange(model)
    close()
  }
  const moveActive = (direction: 1 | -1) => {
    const count = filteredOptions().length
    if (count === 0) return
    setOpen(true)
    setActiveIndex((current) => current < 0
      ? (direction === 1 ? 0 : count - 1)
      : (current + direction + count) % count)
  }

  return (
    <div class="relative" onFocusOut={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) close()
    }}>
      <span id={labelId} class={props.hideLabel ? "sr-only" : "mb-1 block text-xs text-muted-foreground"}>
        {props.label}
      </span>
      <div class="relative">
        <Input
          ref={(element) => { input = element }}
          role="combobox"
          aria-labelledby={labelId}
          aria-autocomplete="list"
          aria-controls={showOptions() ? listboxId : undefined}
          aria-expanded={showOptions() ? "true" : "false"}
          aria-activedescendant={showOptions() && activeIndex() >= 0 ? `${listboxId}-option-${activeIndex()}` : undefined}
          autocomplete="off"
          value={props.value}
          placeholder={props.placeholder}
          disabled={props.disabled}
          class={options().length > 0 ? "pr-9" : undefined}
          onFocus={() => setOpen(options().length > 0)}
          onInput={(event) => {
            props.onChange(event.currentTarget.value)
            setOpen(options().length > 0)
            setActiveIndex(-1)
          }}
          onKeyDown={(event) => {
            if (event.isComposing || event.keyCode === 229) return
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault()
              moveActive(event.key === "ArrowDown" ? 1 : -1)
            } else if (event.key === "Enter" && showOptions() && activeIndex() >= 0) {
              event.preventDefault()
              const selected = filteredOptions()[activeIndex()]
              if (selected) choose(selected.reference.model)
            } else if (event.key === "Escape" && open()) {
              event.preventDefault()
              event.stopPropagation()
              close()
            }
          }}
        />
        <Show when={options().length > 0}>
          <button type="button" aria-label={text("expand_options_fe7f0967", { v0: props.label })} tabindex={-1}
            disabled={props.disabled}
            class="absolute inset-y-0 right-0 flex w-9 items-center justify-center text-muted-foreground disabled:opacity-50"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              const next = !open()
              input.focus()
              setOpen(next)
              setActiveIndex(-1)
            }}>
            <ChevronDown class="size-4" />
          </button>
        </Show>
      </div>
      <Show when={showOptions()}>
        <div id={listboxId} role="listbox" aria-labelledby={labelId}
          class="absolute inset-x-0 top-full z-[140] mt-1 max-h-52 overflow-y-auto rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
          <For each={filteredOptions()}>{(model, index) => {
            const id = model.reference.model
            const selected = () => id === props.value
            return (
              <button id={`${listboxId}-option-${index()}`} type="button" role="option"
                aria-selected={selected() ? "true" : "false"}
                class={cn("flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-sm outline-none",
                  index() === activeIndex() && "bg-accent text-accent-foreground")}
                onMouseDown={(event) => event.preventDefault()}
                onMouseEnter={() => setActiveIndex(index())}
                onClick={() => choose(id)}>
                <Check class={cn("mt-0.5 size-3.5 shrink-0", selected() ? "opacity-100" : "opacity-0")} />
                <span class="min-w-0">
                  <span class="block truncate">{id}</span>
                  <Show when={model.display_name && model.display_name !== id}>
                    <span class="block truncate text-xs text-muted-foreground">{model.display_name}</span>
                  </Show>
                </span>
              </button>
            )
          }}</For>
        </div>
      </Show>
    </div>
  )
}
