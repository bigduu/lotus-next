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
  followingLatest?: boolean
  initialReadingAnchor?: HistoryReadingAnchor | null
  onReadingAnchor?: (anchor: HistoryReadingAnchor | null) => void
  onMissingReadingAnchor?: () => void
  onScrollElement?: (element: HTMLDivElement | null) => void
  registerScrollToEntry?: (scrollToEntry: ScrollToHistoryEntry | null) => void
  registerCaptureBeforePrepend?: (capture: (() => void) | null) => void
  onScroll?: () => void
}

/** Shared viewport for visible history rows, with app-owned message rendering. */
export function VirtualHistory<T extends HistoryEntry>(props: VirtualHistoryProps<T>) {
  const [viewport, setViewport] = createSignal<HTMLDivElement | null>(null)
  const [scrollMargin, setScrollMargin] = createSignal(0)
  const [outsideHistory, setOutsideHistory] = createSignal(0)
  const [prepend, setPrepend] = createSignal<{ entries: readonly T[]; anchor: HistoryReadingAnchor } | null>(null)
  let scroller!: HTMLDivElement
  let prefix!: HTMLDivElement
  let history!: HTMLDivElement
  let suffix!: HTMLDivElement
  let restored = false
  const preserveReading = () => props.preserveOnPrepend && !props.followingLatest
  const endPadding = () => preserveReading() ? outsideHistory() : 0

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
      paddingEnd: endPadding(),
      anchorTo: preserveReading() ? "end" : "start",
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

  createEffect(() => props.followingLatest, (following) => {
    // The sticky viewport owns end alignment while following. Deferring a
    // second correction here can replay it after the reader scrolls away.
    virtualizer.instance.shouldAdjustScrollPositionOnItemSizeChange = following ? () => false : undefined
  })

  onSettled(() => {
    const reportElement = props.onScrollElement
    const registerScroll = props.registerScrollToEntry
    const registerCapture = props.registerCaptureBeforePrepend
    setViewport(scroller)
    reportElement?.(scroller)
    registerScroll?.((key, align = "center") => {
      const index = props.entries.findIndex((entry) => entry.key === key)
      if (index < 0) return false
      virtualizer.instance.scrollToIndex(index, { align })
      return true
    })
    registerCapture?.(() => {
      const entries = props.entries
      if (!entries.length) return
      const top = scroller.getBoundingClientRect().top + scroller.clientTop
      const bottom = top + scroller.clientHeight
      for (const row of history.querySelectorAll<HTMLElement>("[data-history-entry-key]")) {
        const bounds = row.getBoundingClientRect()
        const key = row.dataset.historyEntryKey
        if (key && bounds.bottom > top && bounds.top < bottom) {
          setPrepend({ entries, anchor: { key, offset: top - bounds.top } })
          return
        }
      }
    })
    const measureLayout = () => {
      const offset = Math.max(0, Math.round(history.getBoundingClientRect().top -
        scroller.getBoundingClientRect().top + scroller.scrollTop - scroller.clientTop))
      setScrollMargin(offset)
      // Pending messages and live output are below the measured rows. Include
      // their space in end-anchor calculations without enlarging the DOM spacer.
      const trailing = suffix.parentElement!.getBoundingClientRect().bottom - suffix.getBoundingClientRect().top
      setOutsideHistory(offset + Math.max(0, Math.round(trailing)))
    }
    measureLayout()
    const Observer = scroller.ownerDocument.defaultView?.ResizeObserver
    const observer = Observer ? new Observer(measureLayout) : undefined
    observer?.observe(prefix)
    observer?.observe(suffix)
    return () => {
      observer?.disconnect()
      registerScroll?.(null)
      registerCapture?.(null)
      reportElement?.(null)
    }
  })

  createEffect(
    () => {
      const entries = props.entries
      const pending = prepend()
      const rebasing = pending && entries !== pending.entries ? pending : null
      return { anchor: rebasing?.anchor ?? props.initialReadingAnchor, entries, viewport: viewport(), rebasing }
    },
    ({ anchor, entries, viewport, rebasing }) => {
      if (!anchor || !entries.length || !viewport || (restored && !rebasing)) return
      const view = viewport.ownerDocument.defaultView
      if (!view) return
      const index = entries.findIndex((entry) => entry.key === anchor.key)
      const listeners = new AbortController()
      let frame: number
      let attempts = 0
      let stableFrames = 0
      const finish = () => {
        restored = true
        if (rebasing) setPrepend(null)
        listeners.abort()
        view.cancelAnimationFrame(frame)
      }
      const correct = () => {
        const position = index < 0 ? undefined : virtualizer.instance.getOffsetForIndex(index, "start")
        if (!position) {
          finish()
          props.onMissingReadingAnchor?.()
          return
        }
        const row = history.querySelector<HTMLElement>(`[data-index="${index}"]`)
        if (row?.dataset.historyEntryKey === anchor.key) {
          const top = row.getBoundingClientRect().top - viewport.getBoundingClientRect().top - viewport.clientTop
          const delta = top + anchor.offset
          // A fresh virtualizer has estimates for off-screen rows. Reconcile
          // the measured anchor after they mount instead of retaining the
          // absolute target calculated from their estimates.
          const target = Math.max(0, Math.min(viewport.scrollHeight - viewport.clientHeight, viewport.scrollTop + delta))
          if (Math.abs(target - viewport.scrollTop) > 1) {
            viewport.scrollTo({ top: target, behavior: "instant" })
            stableFrames = 0
          } else stableFrames += 1
        } else {
          viewport.scrollTo({ top: position[0] + anchor.offset, behavior: "instant" })
          stableFrames = 0
        }
        attempts += 1
        if (stableFrames >= 3 || attempts >= 12) {
          finish()
          return
        }
        frame = view.requestAnimationFrame(correct)
      }
      // A new reader gesture (including the adjacent jump-to-latest button)
      // takes over immediately.
      const controls = viewport.parentElement ?? viewport
      for (const event of ["wheel", "touchstart", "pointerdown", "keydown"]) {
        controls.addEventListener(event, finish, { capture: true, passive: true, signal: listeners.signal })
      }
      frame = view.requestAnimationFrame(correct)
      return () => {
        listeners.abort()
        view.cancelAnimationFrame(frame)
      }
    },
  )

  const captureReadingAnchor = () => {
    props.onScroll?.()
    const report = props.onReadingAnchor
    if (!report || (props.initialReadingAnchor && !restored) || prepend()) return
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
          style={{ height: `${Math.max(0, virtualizer.totalSize() - endPadding())}px` }}
        >
          <For each={virtualizer.items()} keyed={(row) => row.key}>{(row) => (
            <HistoryRow row={row} scrollMargin={scrollMargin} measure={virtualizer.measureRow}>
              {props.renderEntry(() => props.entries[row().index])}
            </HistoryRow>
          )}</For>
        </div>
        <div ref={(element) => { suffix = element }}>{props.after}</div>
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
