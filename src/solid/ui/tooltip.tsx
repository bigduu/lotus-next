import { createContext, omit, useContext } from "solid-js"
import type { ComponentProps, JSX } from "@solidjs/web"
import * as TooltipPrimitive from "@kobalte/core/tooltip"

import { surfaceMotion } from "@shared/theme/motion"
import { cn } from "@/lib/utils"

import { DialogLayerMount } from "./layer-scope"

interface TooltipProviderProps extends Pick<ComponentProps<typeof TooltipPrimitive.Root>, "children" | "skipDelayDuration"> {
  delayDuration?: number
}

const TooltipSettings = createContext<TooltipProviderProps>({})

export function TooltipProvider(props: TooltipProviderProps) {
  return <TooltipSettings value={props}>{props.children}</TooltipSettings>
}

export function Tooltip(props: ComponentProps<typeof TooltipPrimitive.Root>) {
  const settings = useContext(TooltipSettings)
  return <TooltipPrimitive.Root openDelay={settings.delayDuration ?? 0} skipDelayDuration={settings.skipDelayDuration} gutter={0} {...props} />
}

export function TooltipTrigger(props: ComponentProps<typeof TooltipPrimitive.Trigger>) {
  const tooltip = TooltipPrimitive.useTooltipContext()
  return (
    <TooltipPrimitive.Trigger
      data-slot="tooltip-trigger"
      onKeyDown={(event: Parameters<JSX.EventHandler<HTMLButtonElement, KeyboardEvent>>[0]) => {
        const handler = props.onKeyDown
        if (typeof handler === "function") handler(event)
        else handler?.[0](handler[1], event)
        if (event.key === "Escape" && !event.defaultPrevented && tooltip.isOpen()) {
          event.preventDefault()
          tooltip.hideTooltip(true)
        }
      }}
      {...omit(props, "onKeyDown")}
    />
  )
}

export function TooltipContent(props: ComponentProps<typeof TooltipPrimitive.Content>) {
  const tooltip = TooltipPrimitive.useTooltipContext()
  const dialogMount = useContext(DialogLayerMount)
  return (
    <TooltipPrimitive.Portal mount={dialogMount()}>
      <TooltipPrimitive.Content
        data-slot="tooltip-content"
        data-state={tooltip.isOpen() ? "open" : "closed"}
        class={cn(
          "bg-popover text-popover-foreground data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2 z-50 w-fit origin-(--kb-tooltip-content-transform-origin) rounded-md border px-3 py-1.5 text-xs text-balance shadow-md",
          surfaceMotion,
          props.class,
        )}
        {...omit(props, "class", "children")}
      >
        {props.children}
        <TooltipPrimitive.Arrow style={{ "--kb-popper-arrow-background": "var(--popover)" }} />
      </TooltipPrimitive.Content>
    </TooltipPrimitive.Portal>
  )
}
