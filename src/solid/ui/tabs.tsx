import { omit } from "solid-js"
import type { ComponentProps } from "@solidjs/web"
import * as TabsPrimitive from "@kobalte/core/tabs"

import { cn } from "@/lib/utils"

type TabsProps = ComponentProps<typeof TabsPrimitive.Root> & {
  onValueChange?: (value: string) => void
}

function Tabs(props: TabsProps) {
  return (
    <TabsPrimitive.Root
      data-slot="tabs"
      class={cn("flex flex-col gap-2", props.class)}
      onChange={(value) => (props.onValueChange ?? props.onChange)?.(value)}
      {...omit(props, "class", "onChange", "onValueChange")}
    />
  )
}

function TabsList(props: ComponentProps<typeof TabsPrimitive.List>) {
  return (
    <TabsPrimitive.List
      data-slot="tabs-list"
      class={cn(
        "bg-muted text-muted-foreground inline-flex h-9 w-fit items-center justify-center rounded-lg p-[3px]",
        props.class
      )}
      {...omit(props, "class")}
    />
  )
}

function TabsTrigger(props: ComponentProps<typeof TabsPrimitive.Trigger>) {
  return (
    <TabsPrimitive.Trigger
      data-slot="tabs-trigger"
      class={cn(
        "data-[selected]:bg-background dark:data-[selected]:text-foreground dark:data-[selected]:border-input dark:data-[selected]:bg-input/30 text-foreground dark:text-muted-foreground inline-flex h-[calc(100%-1px)] flex-1 items-center justify-center gap-1.5 rounded-md border border-transparent px-2 py-1 text-sm font-medium whitespace-nowrap transition-[color,box-shadow] disabled:pointer-events-none disabled:opacity-50 data-[selected]:shadow-sm [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        props.class
      )}
      {...omit(props, "class")}
    />
  )
}

function TabsContent(props: ComponentProps<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      data-slot="tabs-content"
      class={cn("flex-1 outline-none", props.class)}
      {...omit(props, "class")}
    />
  )
}

export { Tabs, TabsList, TabsTrigger, TabsContent }
