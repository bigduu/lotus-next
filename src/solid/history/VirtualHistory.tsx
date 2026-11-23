import type { JSX } from "@solidjs/web"
import { createEffect, createSignal, For, onSettled, type Accessor } from "solid-js"
import { measureElement, observeElementRect, type VirtualItem } from "@tanstack/virtual-core"
import { cn } from "../../lib/utils"
import { createElementVirtualizer } from "./createElementVirtualizer"

const INITIAL_RECT = { width: 1024, height: 720 }
const HISTORY_ROW_GAP = 8

export interface HistoryReadingAnchor {
  key: string
  offset: number
}

type HistoryEntry = { key: string }
export type ScrollToHistoryEntry = (key: string, align?: "start" | "center" | "end") => boolean

export interface VirtualHistoryProps<T extends HistoryEntry> {
  /** Ordered history entries with distinct keys stable across page loads. */
  entries: readonly T[]
  estimateSize: (entry: T) => number
  renderEntry: (entry: Accessor<T>) => JSX.Element
  class?: string
  before?: JSX.Element
  after?: JSX.Element
  preserveOnPrepend?: boolean
  initialReadingAnchor?: HistoryReadingAnchor | null
  onReadingAnchor?: (anchor: HistoryReadingAnchor | null) => void
  onMissingReadingAnchor?: () => void
  onScrollElement?: (element: HTMLDivElement | null) => void
  registerScrollToEntry?: (scrollToEntry: ScrollToHistoryEntry | null) => void
  onScroll?: () => void
}

/** Shared viewport for visible history rows, with app-owned message rendering. */
export function VirtualHistory<T extends HistoryEntry>(props: VirtualHistoryProps<T>) {
  const [viewport, setViewport] = createSignal<HTMLDivElement | null>(null)
  const [scrollMargin, setScrollMargin] = createSignal(0)
  let scroller!: HTMLDivElement
  let prefix!: HTMLDivElement
  let history!: HTMLDivElement
  let restored = false

  const virtualizer = createElementVirtualizer<HTMLDivElement, HTMLDivElement>(() => {
    // A snapshot lets TanStack resolve the previous key through a prepend.
    const entries = props.entries
    const estimate = props.estimateSize
    const element = viewport()
    return {
      count: entries.length,
      getScrollElement: () => element,
      getItemKey: (index) => entries[index]?.key ?? index,
      estimateSize: (index) => entries[index] ? estimate(entries[index]) : 0,
      scrollMargin: scrollMargin(),
      anchorTo: props.preserveOnPrepend ? "end" : "start",
      gap: HISTORY_ROW_GAP,
      overscan: 6,
      initialRect: INITIAL_RECT,
      observeElementRect: (instance, update) => observeElementRect(instance, (rect) => {
        update({ width: rect.width || INITIAL_RECT.width, height: rect.height || INITIAL_RECT.height })
      }),
      measureElement: (element, entry, instance) => {
        const size = measureElement(element, entry, instance)
        if (size > 0) return size
        // A mounted transcript hidden behind Settings can report zero.
        const index = instance.indexFromElement(element)
        return instance.itemSizeCache.get(instance.options.getItemKey(index)) ?? instance.options.estimateSize(index)
      },
      useAnimationFrameWithResizeObserver: true,
    }
  })

  onSettled(() => {
    const reportElement = props.onScrollElement
    const registerScroll = props.registerScrollToEntry
    setViewport(scroller)
    reportElement?.(scroller)
    registerScroll?.((key, align = "center") => {
      const index = props.entries.findIndex((entry) => entry.key === key)
      if (index < 0) return false
      virtualizer.instance.scrollToIndex(index, { align })
      return true
    })
    const measureOrigin = () => {
      const offset = history.getBoundingClientRect().top - scroller.getBoundingClientRect().top +
        scroller.scrollTop - scroller.clientTop
      setScrollMargin(Math.max(0, Math.round(offset)))
    }
    measureOrigin()
    const Observer = scroller.ownerDocument.defaultView?.ResizeObserver
    const observer = Observer ? new Observer(measureOrigin) : undefined
    observer?.observe(prefix)
    return () => {
      observer?.disconnect()
      registerScroll?.(null)
      reportElement?.(null)
    }
  })

  createEffect(
    () => ({ anchor: props.initialReadingAnchor, entries: props.entries, viewport: viewport() }),
    ({ anchor, entries, viewport }) => {
      if (!anchor || !entries.length || !viewport || restored) return
      const view = viewport.ownerDocument.defaultView
      if (!view) return
      const missing = props.onMissingReadingAnchor
      const frame = view.requestAnimationFrame(() => {
        restored = true
        const index = entries.findIndex((entry) => entry.key === anchor.key)
        const position = index < 0 ? undefined : virtualizer.instance.getOffsetForIndex(index, "start")
        if (position) virtualizer.instance.scrollToOffset(position[0] + anchor.offset, { align: "start" })
        else missing?.()
      })
      return () => view.cancelAnimationFrame(frame)
    },
  )

  const captureReadingAnchor = () => {
    props.onScroll?.()
    const report = props.onReadingAnchor
    if (!report || (props.initialReadingAnchor && !restored)) return
    if (scroller.scrollHeight - scroller.clientHeight - scroller.scrollTop <= 2) {
      report(null)
      return
    }
    const row = virtualizer.instance.getVirtualItemForOffset(scroller.scrollTop)
    const key = row && props.entries[row.index]?.key
    if (row && key) report({ key, offset: Math.max(0, scroller.scrollTop - row.start) })
  }

  return (
    <div
      ref={(element) => { scroller = element }}
      class={cn("min-h-0 min-w-0 flex-1 overflow-y-auto px-3 [overflow-anchor:none]", props.class)}
      data-history-viewport=""
      onScroll={captureReadingAnchor}
    >
      <div data-message-list-content="" class="relative mx-auto flex min-w-0 w-full max-w-full flex-col py-4">
        <div ref={(element) => { prefix = element }} class="flex flex-col gap-2 empty:hidden">{props.before}</div>
        <div
          ref={(element) => { history = element }}
          class="relative w-full"
          data-virtual-history=""
          style={{ height: `${virtualizer.totalSize()}px` }}
        >
          <For each={virtualizer.items()} keyed={(row) => row.key}>{(row) => (
            <HistoryRow row={row} scrollMargin={scrollMargin} measure={virtualizer.measureRow}>
              {props.renderEntry(() => props.entries[row().index])}
            </HistoryRow>
          )}</For>
        </div>
        {props.after}
      </div>
    </div>
  )
}

function HistoryRow(props: {
  row: Accessor<VirtualItem>
  scrollMargin: Accessor<number>
  measure: (element: HTMLDivElement | null) => void
  children: JSX.Element
}) {
  let row!: HTMLDivElement

  createEffect(() => props.row().index, () => props.measure(row))
  onSettled(() => {
    const measure = props.measure
    // DOM removals happen after owner disposal. Let TanStack drop inactive
    // ResizeObserver targets once the old rows are actually disconnected.
    return () => queueMicrotask(() => measure(null))
  })

  return (
    <div
      ref={(element) => { row = element }}
      class="absolute left-0 top-0 w-full"
      data-history-entry-key={props.row().key}
      data-index={props.row().index}
      style={{ transform: `translateY(${props.row().start - props.scrollMargin()}px)` }}
    >
      {props.children}
    </div>
  )
}
