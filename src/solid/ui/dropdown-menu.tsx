import { createContext, createSignal, omit, untrack, useContext, type Accessor } from "solid-js"
import type { ComponentProps, JSX } from "@solidjs/web"
import * as DropdownMenuPrimitive from "@kobalte/core/dropdown-menu"
import { Check, ChevronRight, Circle } from "@lucide/solid"

import { cn } from "@/lib/utils"
import { surfaceMotion } from "@shared/theme/motion"

import { DialogLayerMount } from "./layer-scope"

interface MenuDisclosure {
  open: Accessor<boolean>
  changeOpen: (open: boolean) => void
  trigger: Accessor<HTMLElement | undefined>
  setTrigger: (node: HTMLElement) => void
}

const MenuState = createContext<MenuDisclosure>()

function createDisclosure(props: Pick<ComponentProps<typeof DropdownMenuPrimitive.Root>, "open" | "defaultOpen" | "onOpenChange">): MenuDisclosure {
  const [open, setOpen] = createSignal(untrack(() => props.defaultOpen ?? false))
  const [trigger, setTrigger] = createSignal<HTMLElement | undefined>(undefined, { ownedWrite: true })
  return {
    trigger,
    setTrigger,
    open: () => props.open ?? open(),
    changeOpen: (next) => {
      if (props.open === undefined) setOpen(next)
      props.onOpenChange?.(next)
    },
  }
}

type MenuContentProps = ComponentProps<typeof DropdownMenuPrimitive.Content>

function menuEscapeHandler(menu: MenuDisclosure, props: MenuContentProps, restoreFocus = false): JSX.EventHandler<HTMLDivElement, KeyboardEvent> {
  return (event) => {
    const handler = props.onKeyDown
    if (typeof handler === "function") handler(event)
    else handler?.[0](handler[1], event)
    if (
      event.key !== "Escape" || event.defaultPrevented || event.isComposing ||
      event.target.closest("[role=menu]") !== event.currentTarget
    ) return
    props.onEscapeKeyDown?.(event)
    if (event.defaultPrevented) return
    event.preventDefault()
    event.stopPropagation()
    menu.changeOpen(false)
    if (restoreFocus) menu.trigger()?.focus({ preventScroll: true })
  }
}

function DropdownMenu(props: ComponentProps<typeof DropdownMenuPrimitive.Root>) {
  const menu = createDisclosure(props)
  return (
    <MenuState value={menu}>
      <DropdownMenuPrimitive.Root
        placement="bottom"
        gutter={4}
        open={menu.open()}
        onOpenChange={menu.changeOpen}
        {...omit(props, "open", "defaultOpen", "onOpenChange")}
      />
    </MenuState>
  )
}

function DropdownMenuTrigger(
  props: ComponentProps<typeof DropdownMenuPrimitive.Trigger>
) {
  const menu = useContext(MenuState)!
  return (
    <DropdownMenuPrimitive.Trigger
      data-slot="dropdown-menu-trigger"
      data-state={menu.open() ? "open" : "closed"}
      {...props}
    />
  )
}

function DropdownMenuContent(props: MenuContentProps) {
  const mount = useContext(DialogLayerMount)
  const menu = useContext(MenuState)!
  const onOpenAutoFocus = (event: Event) => {
    props.onOpenAutoFocus?.(event)
    if (event.defaultPrevented || !(event.currentTarget instanceof HTMLElement)) return
    const content = event.currentTarget
    if (!content.isConnected || !menu.open()) {
      event.preventDefault()
      return
    }
    // Kobalte resolves its keyboard target after the trap's initial scan.
    // Preserve a focused item, or use the current roving tab stop.
    const active = content.ownerDocument.activeElement
    if (active !== content && content.contains(active)) {
      event.preventDefault()
      return
    }
    const item = [...content.querySelectorAll<HTMLElement>('[data-highlighted][tabindex="0"]:not([aria-disabled="true"])')]
      .find((candidate) => candidate.closest('[role="menu"]') === content)
    if (item) {
      event.preventDefault()
      item.focus({ preventScroll: true })
    }
  }
  return (
    <DropdownMenuPrimitive.Portal mount={mount()}>
      <DropdownMenuPrimitive.Content
        data-slot="dropdown-menu-content"
        data-state={menu.open() ? "open" : "closed"}
        onKeyDown={menuEscapeHandler(menu, props)}
        onOpenAutoFocus={onOpenAutoFocus}
        class={cn(
          "bg-popover text-popover-foreground z-50 max-h-(--kb-popper-content-available-height) min-w-[8rem] origin-(--kb-menu-content-transform-origin) overflow-x-hidden overflow-y-auto rounded-md border p-1 shadow-md",
          surfaceMotion,
          props.class
        )}
        {...omit(props, "class", "onKeyDown", "onEscapeKeyDown", "onOpenAutoFocus")}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

function DropdownMenuGroup(
  props: ComponentProps<typeof DropdownMenuPrimitive.Group>
) {
  return (
    <DropdownMenuPrimitive.Group data-slot="dropdown-menu-group" {...props} />
  )
}

function DropdownMenuItem(props: ComponentProps<typeof DropdownMenuPrimitive.Item> & {
  inset?: boolean
  variant?: "default" | "destructive"
}) {
  return (
    <DropdownMenuPrimitive.Item
      data-slot="dropdown-menu-item"
      data-inset={props.inset ? "" : undefined}
      data-variant={props.variant ?? "default"}
      class={cn(
        "focus:bg-accent focus:text-accent-foreground data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 dark:data-[variant=destructive]:focus:bg-destructive/20 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        props.class
      )}
      {...omit(props, "class", "inset", "variant")}
    />
  )
}

type CheckboxItemProps = ComponentProps<typeof DropdownMenuPrimitive.CheckboxItem> & {
  onCheckedChange?: (checked: boolean) => void
}

function DropdownMenuCheckboxItem(props: CheckboxItemProps) {
  return (
    <DropdownMenuPrimitive.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      class={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        props.class
      )}
      checked={props.checked}
      onChange={(checked) => (props.onCheckedChange ?? props.onChange)?.(checked)}
      {...omit(props, "class", "children", "checked", "onCheckedChange", "onChange")}
    >
      <span class="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Check class="size-4" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {props.children}
    </DropdownMenuPrimitive.CheckboxItem>
  )
}

type RadioGroupProps = ComponentProps<typeof DropdownMenuPrimitive.RadioGroup<string>> & {
  onValueChange?: (value: string) => void
}

function DropdownMenuRadioGroup(props: RadioGroupProps) {
  return (
    <DropdownMenuPrimitive.RadioGroup<string>
      data-slot="dropdown-menu-radio-group"
      onChange={(value) => (props.onValueChange ?? props.onChange)?.(value)}
      {...omit(props, "onChange", "onValueChange")}
    />
  )
}

function DropdownMenuRadioItem(props: ComponentProps<typeof DropdownMenuPrimitive.RadioItem>) {
  return (
    <DropdownMenuPrimitive.RadioItem
      data-slot="dropdown-menu-radio-item"
      class={cn(
        "focus:bg-accent focus:text-accent-foreground relative flex cursor-default items-center gap-2 rounded-sm py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        props.class
      )}
      {...omit(props, "class", "children")}
    >
      <span class="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <DropdownMenuPrimitive.ItemIndicator>
          <Circle class="size-2 fill-current" />
        </DropdownMenuPrimitive.ItemIndicator>
      </span>
      {props.children}
    </DropdownMenuPrimitive.RadioItem>
  )
}

function DropdownMenuLabel(props: ComponentProps<"div"> & {
  inset?: boolean
}) {
  return (
    <div
      data-slot="dropdown-menu-label"
      data-inset={props.inset ? "" : undefined}
      class={cn(
        "px-2 py-1.5 text-sm font-medium data-[inset]:pl-8",
        props.class
      )}
      {...omit(props, "class", "inset")}
    />
  )
}

function DropdownMenuSeparator(props: ComponentProps<typeof DropdownMenuPrimitive.Separator>) {
  return (
    <DropdownMenuPrimitive.Separator
      data-slot="dropdown-menu-separator"
      class={cn("bg-border -mx-1 my-1 h-px", props.class)}
      {...omit(props, "class")}
    />
  )
}

function DropdownMenuShortcut(props: ComponentProps<"span">) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      class={cn(
        "text-muted-foreground ml-auto text-xs tracking-widest",
        props.class
      )}
      {...omit(props, "class")}
    />
  )
}

function DropdownMenuSub(
  props: ComponentProps<typeof DropdownMenuPrimitive.Sub>
) {
  const menu = createDisclosure(props)
  return (
    <MenuState value={menu}>
      <DropdownMenuPrimitive.Sub open={menu.open()} onOpenChange={menu.changeOpen} {...omit(props, "open", "defaultOpen", "onOpenChange")} />
    </MenuState>
  )
}

function DropdownMenuSubTrigger(props: ComponentProps<typeof DropdownMenuPrimitive.SubTrigger> & {
  inset?: boolean
}) {
  const menu = useContext(MenuState)!
  return (
    <DropdownMenuPrimitive.SubTrigger
      ref={[menu.setTrigger, props.ref]}
      data-slot="dropdown-menu-sub-trigger"
      data-state={menu.open() ? "open" : "closed"}
      data-inset={props.inset ? "" : undefined}
      class={cn(
        "focus:bg-accent focus:text-accent-foreground data-[state=open]:bg-accent data-[state=open]:text-accent-foreground flex cursor-default items-center rounded-sm px-2 py-1.5 text-sm outline-hidden select-none data-[inset]:pl-8",
        props.class
      )}
      {...omit(props, "ref", "class", "inset", "children")}
    >
      {props.children}
      <ChevronRight class="ml-auto size-4" />
    </DropdownMenuPrimitive.SubTrigger>
  )
}

function DropdownMenuSubContent(props: ComponentProps<typeof DropdownMenuPrimitive.SubContent>) {
  const mount = useContext(DialogLayerMount)
  const menu = useContext(MenuState)!
  return (
    <DropdownMenuPrimitive.Portal mount={mount()}>
      <DropdownMenuPrimitive.SubContent
        data-slot="dropdown-menu-sub-content"
        data-state={menu.open() ? "open" : "closed"}
        onKeyDown={menuEscapeHandler(menu, props, true)}
        class={cn(
          "bg-popover text-popover-foreground z-50 min-w-[8rem] origin-(--kb-menu-content-transform-origin) overflow-hidden rounded-md border p-1 shadow-lg",
          surfaceMotion,
          props.class,
        )}
        {...omit(props, "class", "onKeyDown", "onEscapeKeyDown")}
      />
    </DropdownMenuPrimitive.Portal>
  )
}

export {
  DropdownMenu,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
