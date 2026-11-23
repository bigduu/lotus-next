import { omit } from "solid-js"
import type { ComponentProps } from "@solidjs/web"
import * as SwitchPrimitive from "@kobalte/core/switch"

import { feedbackMotion } from "@/components/ui/motion"
import { cn } from "@/lib/utils"

type SwitchProps = SwitchPrimitive.SwitchRootProps<"div"> &
  Pick<ComponentProps<"input">, "tabindex"> &
  Partial<Pick<SwitchPrimitive.SwitchInputCommonProps<HTMLInputElement>, "aria-label" | "aria-labelledby" | "aria-describedby" | "onFocus" | "onBlur">> & {
    class?: string
    onCheckedChange?: (checked: boolean) => void
  }

function SwitchParts(props: SwitchProps) {
  const toggle = SwitchPrimitive.useSwitchContext()
  const state = () => toggle.checked() ? "checked" : "unchecked"

  return (
    <>
      <SwitchPrimitive.Input
        id={props.id}
        class="peer z-10 cursor-pointer opacity-0 disabled:cursor-not-allowed"
        style={{ inset: "0", width: "100%", height: "100%", margin: "0", clip: "auto", "clip-path": "none" }}
        aria-label={props["aria-label"]}
        aria-labelledby={props["aria-labelledby"]}
        aria-describedby={props["aria-describedby"]}
        tabindex={props.tabindex}
        onFocus={props.onFocus}
        onBlur={props.onBlur}
      />
      <SwitchPrimitive.Control
        aria-hidden="true"
        data-slot="switch"
        data-state={state()}
        class={cn(
          "data-[state=checked]:bg-primary data-[state=unchecked]:bg-input dark:data-[state=unchecked]:bg-input/80 pointer-events-none inline-flex h-[1.15rem] w-8 shrink-0 items-center rounded-full border border-transparent shadow-xs switch-feedback outline-none data-[disabled]:opacity-50 peer-focus-visible:ring-2 peer-focus-visible:ring-ring peer-focus-visible:ring-offset-2",
          feedbackMotion,
          props.class,
        )}
      >
        <SwitchPrimitive.Thumb
          data-slot="switch-thumb"
          data-state={state()}
          class={cn(
            "bg-background dark:data-[state=unchecked]:bg-foreground dark:data-[state=checked]:bg-primary-foreground pointer-events-none block size-4 rounded-full ring-0 transition-transform data-[state=checked]:translate-x-[calc(100%-2px)] data-[state=unchecked]:translate-x-0",
            feedbackMotion,
          )}
        />
      </SwitchPrimitive.Control>
    </>
  )
}

export function Switch(props: SwitchProps) {
  return (
    <SwitchPrimitive.Root
      id={props.id ? `${props.id}-root` : undefined}
      class="relative inline-flex"
      onChange={(checked) => (props.onCheckedChange ?? props.onChange)?.(checked)}
      {...omit(props, "id", "class", "children", "onChange", "onCheckedChange", "aria-label", "aria-labelledby", "aria-describedby", "tabindex", "onFocus", "onBlur")}
    >
      <SwitchParts {...props} />
    </SwitchPrimitive.Root>
  )
}
