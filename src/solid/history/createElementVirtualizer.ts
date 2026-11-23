import { createEffect, createMemo, createSignal, onSettled } from "solid-js"
import {
  elementScroll,
  observeElementOffset,
  observeElementRect,
  Virtualizer,
  type VirtualizerOptions,
} from "@tanstack/virtual-core"

type ElementOptions<TScroll extends HTMLElement, TRow extends HTMLElement> = Omit<
  VirtualizerOptions<TScroll, TRow>,
  "scrollToFn" | "observeElementOffset" | "observeElementRect"
> & Partial<Pick<
  VirtualizerOptions<TScroll, TRow>,
  "scrollToFn" | "observeElementOffset" | "observeElementRect"
>>

/** Own TanStack's subscriptions at the Solid scope and publish layout changes. */
export function createElementVirtualizer<TScroll extends HTMLElement, TRow extends HTMLElement>(
  readOptions: () => ElementOptions<TScroll, TRow>,
) {
  const [revision, setRevision] = createSignal(0)
  const instance = new Virtualizer<TScroll, TRow>({
    count: 0,
    estimateSize: () => 0,
    getScrollElement: () => null,
    scrollToFn: elementScroll,
    observeElementOffset: observeElementOffset,
    observeElementRect: observeElementRect,
  })
  let disposed = false

  const configured = createMemo(() => {
    const options = readOptions()
    const scrollElement = options.getScrollElement()
    instance.setOptions({
      ...options,
      scrollToFn: options.scrollToFn ?? elementScroll,
      observeElementOffset: options.observeElementOffset ?? observeElementOffset,
      observeElementRect: options.observeElementRect ?? observeElementRect,
      getScrollElement: () => scrollElement,
      onChange: (updated, scrolling) => {
        if (disposed) return
        setRevision((previous) => previous + 1)
        options.onChange?.(updated, scrolling)
      },
    })
    return options
  }, { equals: false })
  const items = createMemo(() => {
    configured()
    revision()
    return instance.getVirtualItems()
  })
  const totalSize = createMemo(() => {
    configured()
    revision()
    return instance.getTotalSize()
  })

  // setOptions computes the new row positions first. The update hook runs
  // after Solid applies spacer height and row transforms, when TanStack can
  // safely write the pending scroll anchor into the resized viewport.
  createEffect(configured, () => instance._willUpdate())
  onSettled(() => {
    const cleanup = instance._didMount()
    return () => {
      disposed = true
      cleanup()
      instance.elementsCache.clear()
    }
  })

  return {
    instance,
    items,
    totalSize,
    measureRow(element: TRow | null) {
      if (!disposed) instance.measureElement(element)
    },
  }
}
