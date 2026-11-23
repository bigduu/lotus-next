import { omit } from "solid-js"
import type { ComponentProps } from "@solidjs/web"

import { cn } from "@/lib/utils"

function Card(props: ComponentProps<"div">) {
  return (
    <div
      data-slot="card"
      class={cn(
        "bg-card text-card-foreground flex flex-col gap-6 rounded-xl border py-6 shadow-sm",
        props.class
      )}
      {...omit(props, "class")}
    />
  )
}

function CardHeader(props: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-header"
      class={cn(
        "@container/card-header grid auto-rows-min grid-rows-[auto_auto] items-start gap-1.5 px-6 has-data-[slot=card-action]:grid-cols-[1fr_auto]",
        props.class
      )}
      {...omit(props, "class")}
    />
  )
}

function CardTitle(props: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-title"
      class={cn("leading-none font-semibold", props.class)}
      {...omit(props, "class")}
    />
  )
}

function CardDescription(props: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-description"
      class={cn("text-muted-foreground text-sm", props.class)}
      {...omit(props, "class")}
    />
  )
}

function CardAction(props: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-action"
      class={cn(
        "col-start-2 row-span-2 row-start-1 self-start justify-self-end",
        props.class
      )}
      {...omit(props, "class")}
    />
  )
}

function CardContent(props: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-content"
      class={cn("px-6", props.class)}
      {...omit(props, "class")}
    />
  )
}

function CardFooter(props: ComponentProps<"div">) {
  return (
    <div
      data-slot="card-footer"
      class={cn("flex items-center px-6", props.class)}
      {...omit(props, "class")}
    />
  )
}

export {
  Card,
  CardHeader,
  CardFooter,
  CardTitle,
  CardAction,
  CardDescription,
  CardContent,
}
