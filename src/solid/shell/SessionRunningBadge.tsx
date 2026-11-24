import { Badge } from "../ui/badge"

export function SessionRunningBadge(props: { label: string }) {
  return (
    <Badge data-session-running="" aria-hidden="true" class="rounded-full px-1.5 text-[11px] leading-4">
      <span class="relative flex size-2 shrink-0">
        <span class="absolute inset-0 rounded-full bg-current opacity-60 motion-safe:animate-ping" />
        <span class="relative size-2 rounded-full bg-current" />
      </span>
      {props.label}
    </Badge>
  )
}
