import { For, Show } from "solid-js"
import { Dynamic } from "@solidjs/web"
import { Check, Copy, type LucideIcon } from "@lucide/solid"

interface ConfirmationIconProps {
  confirmed: boolean
  sequence: number
  fallback?: LucideIcon
  class?: string
}

export function ConfirmationIcon(props: ConfirmationIconProps) {
  return (
    <Show when={props.confirmed} fallback={<Dynamic component={props.fallback ?? Copy} aria-hidden="true" class={props.class} />}>
      <For each={[props.sequence]}>
        {() => (
          <Check
            aria-hidden="true"
            class={`confirmation-icon ${props.class ?? ""}`}
            data-copy-confirmation="true"
          />
        )}
      </For>
    </Show>
  )
}
