import { createContext, createEffect, createMemo, createSignal, createUniqueId, omit, onSettled, Show, untrack, useContext, type Accessor } from "solid-js"
import type { ComponentProps, JSX } from "@solidjs/web"

import { isCommandComposing } from "@/lib/commandComposition"
import { cn } from "@/lib/utils"

interface CommandOption {
  id: string
  value: Accessor<string>
  terms: Accessor<readonly string[]>
  disabled: Accessor<boolean>
  node: Accessor<HTMLDivElement | undefined>
  choose: () => void
}

interface CommandState {
  inputId: string
  labelId: string
  listId: string
  query: Accessor<string>
  setQuery: (value: string) => void
  visible: Accessor<readonly CommandOption[]>
  isVisible: (option: CommandOption) => boolean
  active: Accessor<CommandOption | undefined>
  highlight: (option: CommandOption) => void
  register: (option: CommandOption) => () => void
}

const CommandContext = createContext<CommandState>()
const useCommand = () => useContext(CommandContext)!

type CommandProps = ComponentProps<"div"> & {
  label?: string
  defaultValue?: string
  shouldFilter?: boolean
  autoHighlight?: boolean
}

function Command(props: CommandProps) {
  const id = createUniqueId()
  const [query, setQuery] = createSignal("")
  const [options, setOptions] = createSignal<CommandOption[]>([])
  const [highlighted, highlight] = createSignal<CommandOption>()

  const visible = createMemo(() => {
    const search = props.shouldFilter === false ? "" : query().trim().toLocaleLowerCase()
    return options().filter((option) => {
      if (!search) return true
      return [option.value(), ...option.terms()].some((text) => text.toLocaleLowerCase().includes(search))
    }).sort((left, right) => {
      const first = left.node()
      const second = right.node()
      if (!first || !second) return 0
      return first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1
    })
  })
  const visibility = createMemo(() => new Set(visible()))
  const enabled = createMemo(() => visible().filter((option) => !option.disabled()))
  const active = createMemo(() => {
    const current = highlighted()
    const available = enabled()
    if (current && available.includes(current)) return current
    return available.find((option) => option.value() === props.defaultValue)
      ?? (props.autoHighlight !== false ? available[0] : undefined)
  })

  const state: CommandState = {
    inputId: `${id}-input`,
    labelId: `${id}-label`,
    listId: `${id}-list`,
    query,
    setQuery: (value) => {
      setQuery(value)
      highlight(undefined)
    },
    visible,
    isVisible: (option) => visibility().has(option),
    active,
    highlight,
    register: (option) => {
      setOptions((items) => [...items, option])
      return () => setOptions((items) => items.filter((item) => item !== option))
    },
  }

  const onKeyDown: JSX.EventHandler<HTMLDivElement, KeyboardEvent> = (event) => {
    const handler = props.onKeyDown
    if (typeof handler === "function") handler(event)
    else handler?.[0](handler[1], event)
    if (isCommandComposing(event)) {
      event.stopPropagation()
      return
    }
    if (event.defaultPrevented || event.target.id !== state.inputId) return
    const available = enabled()
    if (!available.length) return

    if (event.key === "Enter") {
      event.preventDefault()
      active()?.choose()
      return
    }
    const selected = active()
    const index = selected ? available.indexOf(selected) : -1
    let nextIndex: number
    switch (event.key) {
      case "Home":
        nextIndex = 0
        break
      case "End":
        nextIndex = available.length - 1
        break
      case "ArrowDown":
        nextIndex = Math.min(available.length - 1, index + 1)
        break
      case "ArrowUp":
        nextIndex = Math.max(0, index - 1)
        break
      default:
        return
    }
    event.preventDefault()
    const next = available[nextIndex]
    if (!next) return
    highlight(next)
    next.node()?.scrollIntoView({ block: "nearest" })
  }

  return (
    <CommandContext value={state}>
      <div
        data-slot="command"
        class={cn("flex w-full flex-col overflow-hidden bg-popover text-popover-foreground", props.class)}
        {...omit(props, "label", "class", "defaultValue", "shouldFilter", "autoHighlight", "children", "onKeyDown")}
        onKeyDown={onKeyDown}
      >
        <span id={state.labelId} class="sr-only">{props.label}</span>
        {props.children}
      </div>
    </CommandContext>
  )
}

type CommandInputProps = ComponentProps<"input"> & {
  onValueChange?: (value: string) => void
}

function CommandInput(props: CommandInputProps) {
  const command = useCommand()

  createEffect(() => props.value, (value) => {
    if (typeof value === "string" && value !== untrack(command.query)) command.setQuery(value)
  })

  return (
    <input
      id={command.inputId}
      role="combobox"
      aria-expanded="true"
      aria-autocomplete="list"
      aria-controls={command.listId}
      aria-activedescendant={command.active()?.id}
      aria-labelledby={command.labelId}
      autocomplete="off"
      data-slot="command-input"
      class={cn("w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground disabled:cursor-not-allowed disabled:opacity-50", props.class)}
      value={props.value ?? command.query()}
      {...omit(props, "id", "class", "value", "onInput", "onValueChange", "onCompositionStart", "onCompositionEnd", "onBlur")}
      onInput={(event) => {
        const handler = props.onInput
        if (typeof handler === "function") handler(event)
        else handler?.[0](handler[1], event)
        command.setQuery(event.currentTarget.value)
        props.onValueChange?.(event.currentTarget.value)
      }}
      onCompositionStart={(event) => {
        event.currentTarget.dataset.commandComposing = "true"
        const handler = props.onCompositionStart
        if (typeof handler === "function") handler(event)
        else handler?.[0](handler[1], event)
      }}
      onCompositionEnd={(event) => {
        delete event.currentTarget.dataset.commandComposing
        const handler = props.onCompositionEnd
        if (typeof handler === "function") handler(event)
        else handler?.[0](handler[1], event)
      }}
      onBlur={(event) => {
        delete event.currentTarget.dataset.commandComposing
        const handler = props.onBlur
        if (typeof handler === "function") handler(event)
        else handler?.[0](handler[1], event)
      }}
    />
  )
}

type CommandListProps = ComponentProps<"div"> & { label?: string }

function CommandList(props: CommandListProps) {
  const command = useCommand()
  return (
    <div
      id={command.listId}
      role="listbox"
      aria-label={props.label}
      data-slot="command-list"
      class={cn("overflow-x-hidden overflow-y-auto scroll-py-1", props.class)}
      {...omit(props, "id", "class", "label")}
    />
  )
}

type CommandItemProps = Omit<ComponentProps<"div">, "onSelect"> & {
  value: string
  keywords?: readonly string[]
  disabled?: boolean
  onSelect?: (value: string) => void
}

function CommandItem(props: CommandItemProps) {
  const command = useCommand()
  const id = createUniqueId()
  const [node, setNode] = createSignal<HTMLDivElement | undefined>(undefined, { ownedWrite: true })
  const option: CommandOption = {
    id,
    value: () => props.value,
    terms: () => props.keywords ?? [],
    disabled: () => props.disabled ?? false,
    node,
    choose: () => { if (!props.disabled) props.onSelect?.(props.value) },
  }
  onSettled(() => command.register(option))

  return (
    <div
      ref={[setNode, props.ref]}
      id={id}
      role="option"
      aria-selected={command.active() === option ? "true" : "false"}
      aria-disabled={props.disabled ? "true" : undefined}
      data-selected={command.active() === option ? "true" : "false"}
      data-disabled={props.disabled ? "true" : undefined}
      data-slot="command-item"
      hidden={!command.isVisible(option)}
      class={cn("relative flex cursor-default select-none items-center outline-none data-[selected=true]:bg-accent data-[disabled=true]:pointer-events-none data-[disabled=true]:opacity-50", props.class)}
      {...omit(props, "ref", "id", "class", "value", "keywords", "disabled", "onSelect", "onClick", "onPointerMove")}
      onClick={(event) => {
        const handler = props.onClick
        if (typeof handler === "function") handler(event)
        else handler?.[0](handler[1], event)
        if (!event.defaultPrevented) option.choose()
      }}
      onPointerMove={(event) => {
        const handler = props.onPointerMove
        if (typeof handler === "function") handler(event)
        else handler?.[0](handler[1], event)
        if (event.pointerType === "mouse" && !props.disabled) command.highlight(option)
      }}
    />
  )
}

function CommandEmpty(props: ComponentProps<"div">) {
  const command = useCommand()
  return <Show when={!command.visible().length}><div role="status" data-slot="command-empty" {...props} /></Show>
}

export { Command, CommandEmpty, CommandInput, CommandItem, CommandList }
