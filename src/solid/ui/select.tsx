import { createMemo, useContext } from "solid-js"
import * as SelectPrimitive from "@kobalte/core/select"
import { Check, ChevronDown } from "@lucide/solid"

import { surfaceMotion } from "@/components/ui/motion"
import { cn } from "@/lib/utils"

import { DialogLayerMount } from "./layer-scope"

export interface SelectOption {
  value: string
  label: string
  disabled?: boolean
}

interface SelectProps {
  options: SelectOption[]
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  placeholder?: string
  label: string
  name?: string
  disabled?: boolean
  required?: boolean
  size?: "sm" | "default"
  class?: string
}

type SelectItemProps = SelectPrimitive.SelectRootItemComponentProps<SelectOption>

function SelectItem(props: SelectItemProps) {
  return (
    <SelectPrimitive.Item
      item={props.item}
      data-slot="select-item"
      class="focus:bg-accent focus:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
    >
      <span class="absolute right-2 flex size-3.5 items-center justify-center">
        <SelectPrimitive.ItemIndicator><Check class="size-4" /></SelectPrimitive.ItemIndicator>
      </span>
      <SelectPrimitive.ItemLabel>{props.item.rawValue.label}</SelectPrimitive.ItemLabel>
    </SelectPrimitive.Item>
  )
}

function SelectContent() {
  const select = SelectPrimitive.useSelectContext()
  const dialogMount = useContext(DialogLayerMount)

  return (
    // Keep a nested listbox in the modal focus scope and accessibility tree.
    <SelectPrimitive.Portal mount={dialogMount()}>
      <SelectPrimitive.Content
        data-slot="select-content"
        data-state={select.isOpen() ? "open" : "closed"}
        class={cn(
          surfaceMotion,
          "bg-popover text-popover-foreground relative z-[140] max-h-(--kb-popper-content-available-height) min-w-[8rem] origin-(--kb-select-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border shadow-md",
        )}
      >
        <SelectPrimitive.Listbox data-slot="select-viewport" class="p-1 outline-none" />
      </SelectPrimitive.Content>
    </SelectPrimitive.Portal>
  )
}

type SelectTriggerProps = Pick<SelectProps, "label" | "size" | "class">

function SelectTrigger(props: SelectTriggerProps) {
  const select = SelectPrimitive.useSelectContext()
  return (
    <SelectPrimitive.Trigger
      aria-label={props.label}
      data-slot="select-trigger"
      data-size={props.size ?? "default"}
      data-state={select.isOpen() ? "open" : "closed"}
      data-placeholder={select.selectedOptions().length ? undefined : ""}
      class={cn(
        "border-input data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 aria-invalid:border-destructive dark:bg-input/30 dark:hover:bg-input/50 flex w-fit items-center justify-between gap-2 rounded-md border bg-transparent px-3 py-2 text-sm whitespace-nowrap shadow-xs transition-[color,box-shadow] outline-none disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        props.class,
      )}
    >
      <SelectPrimitive.Value<SelectOption> data-slot="select-value">
        {(state) => state.selectedOption()?.label}
      </SelectPrimitive.Value>
      <SelectPrimitive.Icon><ChevronDown class="size-4 opacity-50" /></SelectPrimitive.Icon>
    </SelectPrimitive.Trigger>
  )
}

export function Select(props: SelectProps) {
  const selected = createMemo(() => props.value === undefined
    ? undefined
    : props.options.find((option) => option.value === props.value) ?? null)

  return (
    <SelectPrimitive.Root<SelectOption>
      data-slot="select"
      options={props.options}
      optionValue="value"
      optionTextValue="label"
      optionDisabled="disabled"
      value={selected()}
      defaultValue={props.options.find((option) => option.value === props.defaultValue)}
      onChange={(option) => option && props.onValueChange?.(option.value)}
      name={props.name}
      disabled={props.disabled}
      required={props.required}
      placeholder={props.placeholder}
      placement="bottom-start"
      gutter={4}
      itemComponent={SelectItem}
    >
      <SelectPrimitive.HiddenSelect />
      <SelectTrigger label={props.label} size={props.size} class={props.class} />
      <SelectContent />
    </SelectPrimitive.Root>
  )
}
