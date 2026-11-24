import { GitBranch, GitMerge } from "@lucide/solid"
import { Show } from "solid-js"
import type { CheckoutMergeState } from "@/lib/worktreeMergeState"
import { cn } from "@/lib/utils"
import { createUiText } from "./uiText"

export function WorktreeStateBadge(props: { merge: CheckoutMergeState; running: boolean }) {
  const text = createUiText()
  const merged = () => props.merge.state === "merged"
  const working = () => props.merge.state === "in_progress"
  const tone = () => merged() ? "text-primary" : working() ? "text-amber-500" : "text-muted-foreground"
  const label = () => text(`worktree_state_${props.merge.state}`, props.merge.baseRef ? { base: props.merge.baseRef } : undefined)

  return (
    <span role="img" aria-label={label()} title={label()} data-worktree-state={props.merge.state}
      class={`relative flex size-4 shrink-0 items-center justify-center ${tone()}`}>
      <Show when={merged()} fallback={<GitBranch class="size-3" aria-hidden="true" />}>
        <GitMerge class="size-3" aria-hidden="true" />
      </Show>
      <Show when={working()}>
        <span aria-hidden="true" class={cn("absolute right-0 top-0 size-1 rounded-full bg-amber-500",
          props.running && "animate-pulse")} />
      </Show>
    </span>
  )
}
