import { createEffect, createMemo, createSignal, createUniqueId, For, Show } from "solid-js"
import { Check, ChevronDown } from "@lucide/solid"
import { cn } from "@/lib/utils"
import { createUiText } from "../../shell/uiText"
import { Input } from "../../ui/input"
import { Popover, PopoverAnchor, PopoverContent } from "../../ui/popover"

interface Option {
  value: string
  label: string
  description?: string
}

interface ValueComboboxProps {
  label: string
  value: string
  onChange: (value: string) => void
  options: readonly Option[]
  placeholder?: string
  disabled?: boolean
  inputMode?: "text" | "numeric" | "decimal"
}

/** Editing accepts arbitrary text as well as the shared service's presets. */
export function EditableValueCombobox(props: ValueComboboxProps) {
  const text = createUiText()
  const listboxId = createUniqueId()
  let input: HTMLInputElement | undefined
  let anchor: HTMLDivElement | undefined
  const [open, setOpen] = createSignal(false)
  const [active, setActive] = createSignal(-1)
  const [filtering, setFiltering] = createSignal(false)
  const displayValue = () => props.options.find((option) => option.value === props.value)?.label ?? props.value
  const filtered = createMemo(() => {
    const query = filtering() ? props.value.trim().toLocaleLowerCase() : ""
    if (!query) return props.options
    const matching = props.options.filter((option) =>
      [option.label, option.value, option.description].some((value) => value?.toLocaleLowerCase().includes(query)),
    )
    return matching.length ? matching : props.options
  })
  const visible = () => open() && !props.disabled && filtered().length > 0
  const optionId = (index: number) => listboxId + "-option-" + index

  createEffect(() => visible() ? active() : -1, (index) => {
    if (index >= 0) input?.ownerDocument.getElementById(optionId(index))?.scrollIntoView({ block: "nearest" })
  })

  function close() {
    setOpen(false)
    setActive(-1)
    setFiltering(false)
  }

  function choose(value: string) {
    if (props.disabled) return
    props.onChange(value)
    input?.focus()
    close()
  }

  function move(direction: 1 | -1) {
    const length = filtered().length
    if (!length) return
    setOpen(true)
    setActive((index) => index < 0 ? (direction === 1 ? 0 : length - 1) : (index + direction + length) % length)
  }

  return <Popover open={visible()} placement="bottom-start" onOpenChange={(next) => next ? setOpen(true) : close()}>
    <PopoverAnchor ref={(element: HTMLDivElement) => { anchor = element }} class="relative">
      <Input ref={(element) => { input = element }} role="combobox"
        aria-label={props.label} aria-autocomplete="list" aria-haspopup="listbox"
        aria-expanded={visible() ? "true" : "false"} aria-controls={visible() ? listboxId : undefined}
        aria-activedescendant={visible() && active() >= 0 && active() < filtered().length ? optionId(active()) : undefined}
        autocomplete="off" inputmode={props.inputMode} value={displayValue()} placeholder={props.placeholder}
        disabled={props.disabled} class={cn("h-8 text-xs", !!props.options.length && !props.disabled && "pr-8")}
        onFocus={() => {
          setFiltering(false)
          setOpen(props.options.length > 0)
        }}
        onBlur={close}
        onInput={(event) => {
          props.onChange(event.currentTarget.value)
          setFiltering(true)
          setOpen(props.options.length > 0)
          setActive(-1)
        }}
        onKeyDown={(event) => {
          if (event.isComposing || event.keyCode === 229) return
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault()
            move(event.key === "ArrowDown" ? 1 : -1)
          } else if (event.key === "Enter" && visible() && active() >= 0) {
            const option = filtered()[active()]
            if (!option) return
            event.preventDefault()
            choose(option.value)
          } else if (event.key === "Escape" && visible()) {
            event.preventDefault()
            event.stopPropagation()
            close()
          }
        }}
      />
      <Show when={props.options.length > 0 && !props.disabled}>
        <button type="button" aria-label={text("expand_options_fe7f0967", { v0: props.label })} tabindex={-1}
          class="absolute inset-y-0 right-0 flex w-8 items-center justify-center text-muted-foreground"
          onMouseDown={(event) => event.preventDefault()}
          onClick={() => {
            const next = !visible()
            input?.focus()
            if (next) setOpen(true)
            else close()
          }}>
          <ChevronDown class="size-3.5" aria-hidden="true" />
        </button>
      </Show>
    </PopoverAnchor>
    <PopoverContent id={listboxId} role="listbox" aria-label={props.label}
      class="z-[160] max-h-72 min-w-48 overflow-y-auto p-1"
      style={{ width: Math.max(anchor?.offsetWidth ?? 0, 192) + "px" }}
      onOpenAutoFocus={(event) => event.preventDefault()}
      onCloseAutoFocus={(event) => event.preventDefault()}
      onInteractOutside={(event) => {
        if (event.target instanceof Node && anchor?.contains(event.target)) event.preventDefault()
      }}>
      <For each={filtered()} keyed={(option) => option.value}>{(option, index) => {
        const selected = () => option().value.toLocaleLowerCase() === props.value.trim().toLocaleLowerCase()
        return <button id={optionId(index())} type="button" role="option" tabindex={-1}
          aria-selected={selected() ? "true" : "false"}
          class={cn("flex w-full items-start gap-2 rounded-sm px-2 py-1.5 text-left text-xs outline-none",
            index() === active() && "bg-accent text-accent-foreground")}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => setActive(index())}
          onClick={() => choose(option().value)}>
          <Check class={cn("mt-0.5 size-3.5 shrink-0", selected() ? "opacity-100" : "opacity-0")} aria-hidden="true" />
          <span class="min-w-0">
            <span class="block truncate font-medium">{option().label}</span>
            <Show when={option().description}>
              <span class="block truncate text-[11px] text-muted-foreground">{option().description}</span>
            </Show>
          </span>
        </button>
      }}</For>
    </PopoverContent>
  </Popover>
}
