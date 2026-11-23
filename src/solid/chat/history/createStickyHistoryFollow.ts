import { createSignal, onCleanup } from "solid-js"

const SCROLL_INTENT_MS = 500
const isAtBottom = (element: Element) => element.scrollHeight - element.clientHeight - element.scrollTop <= 2

/** Keep the main transcript pinned through measuring, until the reader scrolls upward. */
export function createStickyHistoryFollow(startAtBottom: boolean) {
  const [following, setFollowing] = createSignal(startAtBottom)
  let viewport: HTMLDivElement | null = null
  let observer: ResizeObserver | undefined
  let listeners: AbortController | undefined
  let frame: number | undefined
  let previousTop = 0
  let readingUntil = 0
  let returningUntil = 0
  let draggingScrollbar = false

  const follow = () => {
    if (!viewport || frame !== undefined) return
    frame = requestAnimationFrame(() => {
      frame = undefined
      if (!viewport || !following()) return
      const top = Math.max(0, viewport.scrollHeight - viewport.clientHeight)
      if (viewport.scrollTop !== top) viewport.scrollTo({ top, behavior: "instant" })
      previousTop = viewport.scrollTop
    })
  }
  const pause = () => {
    returningUntil = 0
    setFollowing(false)
  }
  const resume = () => {
    readingUntil = 0
    returningUntil = 0
    draggingScrollbar = false
    setFollowing(true)
    follow()
  }
  const onScroll = () => {
    if (!viewport) return
    const top = viewport.scrollTop
    if (isAtBottom(viewport)) {
      // A virtualizer or browser clamp can reach the bottom while the reader
      // is detached. Only downward reader input can restore the bottom pin.
      if (!following() && top > previousTop && (draggingScrollbar || Date.now() < returningUntil)) resume()
    } else if (top < previousTop - 1 && (draggingScrollbar || Date.now() < readingUntil)) pause()
    else if (following()) follow()
    previousTop = top
  }

  const disposeViewport = () => {
    observer?.disconnect()
    listeners?.abort()
    if (frame !== undefined) cancelAnimationFrame(frame)
    frame = undefined
    viewport = null
  }
  const bind = (element: HTMLDivElement | null) => {
    disposeViewport()
    viewport = element
    if (!element) return
    previousTop = element.scrollTop
    readingUntil = 0
    returningUntil = 0
    draggingScrollbar = false
    observer = new ResizeObserver(follow)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    listeners = new AbortController()
    const signal = listeners.signal
    const read = (event: Event, towardBottom: boolean) => {
      if (event.defaultPrevented) return
      for (let target = event.target instanceof Element ? event.target : null;
        target && target !== element; target = target.parentElement) {
        const canScroll = towardBottom ? !isAtBottom(target) : target.scrollTop > 0
        if (canScroll && /^(auto|scroll)$/.test(getComputedStyle(target).overflowY)) return
      }
      if (towardBottom) {
        readingUntil = 0
        if (!following()) {
          if (isAtBottom(element)) resume()
          else returningUntil = Date.now() + SCROLL_INTENT_MS
        }
      } else {
        readingUntil = Date.now() + SCROLL_INTENT_MS
        if (element.scrollTop > 0) pause()
      }
    }
    element.addEventListener("wheel", (event) => {
      if (event.deltaY !== 0) read(event, event.deltaY > 0)
    }, { passive: true, signal })
    element.addEventListener("pointerdown", (event) => {
      const right = element.getBoundingClientRect().right
      if (event.button === 0 && event.target === element && event.clientX >= right - 16 && event.clientX <= right) draggingScrollbar = true
    }, { passive: true, signal })
    const endDrag = () => {
      if (draggingScrollbar) {
        readingUntil = Date.now() + SCROLL_INTENT_MS
        returningUntil = readingUntil
      }
      draggingScrollbar = false
    }
    const owner = element.ownerDocument.defaultView
    owner?.addEventListener("pointerup", endDrag, { signal })
    owner?.addEventListener("pointercancel", endDrag, { signal })
    let touchY: number | undefined
    element.addEventListener("touchstart", (event) => { touchY = event.touches[0]?.clientY }, { passive: true, signal })
    element.addEventListener("touchmove", (event) => {
      const next = event.touches[0]?.clientY
      if (next !== undefined && touchY !== undefined && next !== touchY) read(event, next < touchY)
      touchY = next
    }, { passive: true, signal })
    element.addEventListener("keydown", (event) => {
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true]")) return
      if (event.key === " ") {
        if (event.target instanceof Element && event.target.closest("button, [role=button]")) return
        read(event, !event.shiftKey)
      } else if (["ArrowUp", "PageUp", "Home"].includes(event.key)) read(event, false)
      else if (["ArrowDown", "PageDown", "End"].includes(event.key)) read(event, true)
    }, { signal })
    follow()
  }
  onCleanup(disposeViewport)
  return { following, follow, onScroll, bind, pause, resume }
}
