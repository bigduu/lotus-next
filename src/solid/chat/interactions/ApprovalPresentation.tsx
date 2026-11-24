import { For, onSettled, Show } from "solid-js"
import type { JSX } from "@solidjs/web"
import { Button } from "../../ui/button"

export type ApprovalAction = { id: string; label: string; onSelect: () => void }

/** Present the actions supplied by the exact request's authority adapter. */
export function ApprovalPresentation(props: {
  title: string
  label?: string
  source?: JSX.Element
  description?: string
  actions: readonly ApprovalAction[]
  disabled?: boolean
  children?: JSX.Element
  footer?: JSX.Element
}) {
  let card!: HTMLElement
  onSettled(() => {
    const guardEnter = (event: KeyboardEvent) => {
      if (event.key === "Enter" && (event.repeat || event.isComposing || event.keyCode === 229)) {
        event.preventDefault()
        event.stopPropagation()
      }
    }
    card.addEventListener("keydown", guardEnter, true)
    return () => { card.removeEventListener("keydown", guardEnter, true) }
  })

  return (
    <article ref={(element) => { card = element }} aria-label={props.label ?? props.title}
      class="mx-auto w-full min-w-0 max-w-4xl space-y-2 rounded-xl border bg-card p-3 text-card-foreground" data-approval-presentation="">
      <div class="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h2 class="text-sm font-semibold">{props.title}</h2>
        {props.source}
      </div>
      <Show when={props.description}>
        <p class="whitespace-pre-wrap break-words text-sm text-muted-foreground">{props.description}</p>
      </Show>
      {props.children}
      <Show when={props.actions.length > 0}>
        <div class="flex flex-wrap items-center gap-2">
          <For each={props.actions} keyed={(action: ApprovalAction) => action.id}>
            {(action) => (
              <Button type="button" size="sm" variant="secondary"
                class="h-auto justify-start whitespace-normal py-2 text-left"
                disabled={props.disabled}
                onClick={() => action().onSelect()}>
                {action().label}
              </Button>
            )}
          </For>
        </div>
      </Show>
      {props.footer}
    </article>
  )
}
