import { createMemo, For, Show } from "solid-js"
import { createMetricFormatters } from "./format"

export interface BarListItem {
  label: string
  value: number
  meta?: string
}

export function BarList(props: { items: BarListItem[]; color?: string; emptyText: string }) {
  const { compact, exact } = createMetricFormatters()
  const color = () => props.color ?? "var(--mx-chat)"
  const max = createMemo(() => props.items.reduce((acc, item) => Math.max(acc, item.value), 0))

  return (
    <Show when={props.items.length} fallback={<p class="text-xs text-muted-foreground">{props.emptyText}</p>}>
      <ul class="space-y-2">
        <For each={props.items}>{(item) => (
          <li title={`${item.label}: ${exact(item.value)}`}>
            <div class="flex items-baseline justify-between gap-2">
              <span class="min-w-0 truncate text-xs">
                {item.label}
                <Show when={item.meta}>
                  <span class="ml-1.5 text-muted-foreground">{item.meta}</span>
                </Show>
              </span>
              <span class="shrink-0 text-xs font-medium tabular-nums">{compact(item.value)}</span>
            </div>
            <div
              class="mt-1 h-1.5 w-full rounded-full"
              style={{ background: `color-mix(in srgb, ${color()} 14%, transparent)` }}
            >
              <div
                class="h-full rounded-full"
                style={{
                  width: `${max() > 0 ? Math.max((item.value / max()) * 100, item.value > 0 ? 1.5 : 0) : 0}%`,
                  background: color(),
                }}
              />
            </div>
          </li>
        )}</For>
      </ul>
    </Show>
  )
}
