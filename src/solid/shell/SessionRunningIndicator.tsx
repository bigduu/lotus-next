import { LoaderCircle } from "@lucide/solid"

export function SessionRunningIndicator() {
  return (
    <span data-session-running="" aria-hidden="true" class="inline-flex size-3.5 shrink-0 text-muted-foreground">
      <LoaderCircle class="size-full motion-safe:animate-spin" />
    </span>
  )
}
