import { omit } from "solid-js"
import type { ComponentProps } from "@solidjs/web"
import * as DialogPrimitive from "@kobalte/core/dialog"

import { cn } from "@/lib/utils"

import { Dialog, DialogClose, DialogContent, DialogTrigger } from "./dialog"

export const Sheet = Dialog

export function SheetTrigger(props: ComponentProps<typeof DialogTrigger>) {
  return <DialogTrigger data-slot="sheet-trigger" {...props} />
}

export function SheetClose(props: ComponentProps<typeof DialogClose>) {
  return <DialogClose data-slot="sheet-close" {...props} />
}

type SheetContentProps = ComponentProps<typeof DialogContent> & {
  side?: "top" | "right" | "bottom" | "left"
}

export function SheetContent(props: SheetContentProps) {
  return <DialogContent sheetSide={props.side ?? "right"} {...omit(props, "side")} />
}

export function SheetHeader(props: ComponentProps<"div">) {
  return <div data-slot="sheet-header" class={cn("flex flex-col gap-1.5 p-4", props.class)} {...omit(props, "class")} />
}

export function SheetFooter(props: ComponentProps<"div">) {
  return <div data-slot="sheet-footer" class={cn("mt-auto flex flex-col gap-2 p-4", props.class)} {...omit(props, "class")} />
}

export function SheetTitle(props: ComponentProps<typeof DialogPrimitive.Title>) {
  return <DialogPrimitive.Title data-slot="sheet-title" class={cn("text-foreground font-semibold", props.class)} {...omit(props, "class")} />
}

export function SheetDescription(props: ComponentProps<typeof DialogPrimitive.Description>) {
  return <DialogPrimitive.Description data-slot="sheet-description" class={cn("text-muted-foreground text-sm", props.class)} {...omit(props, "class")} />
}
