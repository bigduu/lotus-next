import { omit } from "solid-js"
import type { ComponentProps } from "@solidjs/web"
import * as DialogPrimitive from "@kobalte/core/dialog"

import { cn } from "@/lib/utils"
import { uiText } from "@shared/i18n/text"

import { Dialog, DialogClose, DialogContent, DialogTrigger } from "./dialog"

export const ResponsiveDialog = Dialog

export function ResponsiveDialogTrigger(props: ComponentProps<typeof DialogTrigger>) {
  return <DialogTrigger data-slot="responsive-dialog-trigger" {...props} />
}

export function ResponsiveDialogClose(props: ComponentProps<typeof DialogClose>) {
  return <DialogClose data-slot="responsive-dialog-close" {...props} />
}

export function ResponsiveDialogContent(props: ComponentProps<typeof DialogContent>) {
  return <DialogContent responsive closeLabel={uiText("close_3fd47edc")} {...props} />
}

export function ResponsiveDialogTitle(props: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      data-slot="responsive-dialog-title"
      class={cn("text-base leading-none font-semibold", props.class)}
      {...omit(props, "class")}
    />
  )
}

export function ResponsiveDialogDescription(props: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      data-slot="responsive-dialog-description"
      class={cn("text-muted-foreground text-sm", props.class)}
      {...omit(props, "class")}
    />
  )
}
