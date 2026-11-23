import { createSignal, onCleanup } from "solid-js"

/** Keep the main transcript pinned through measuring, until the reader scrolls upward. */
export function createStickyHistoryFollow(startAtBottom: boolean) {
  const [following, setFollowing] = createSignal(startAtBottom)
  let viewport: HTMLDivElement | null = null
  let observer: ResizeObserver | undefined
  let listeners: AbortController | undefined
  let frame: number | undefined
  let previousTop = 0
  let readingUntil = 0
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
  const pause = () => setFollowing(false)
  const resume = () => {
    readingUntil = 0
    draggingScrollbar = false
    setFollowing(true)
    follow()
  }
  const onScroll = () => {
    if (!viewport) return
    const top = viewport.scrollTop
    const near = viewport.scrollHeight - viewport.clientHeight - top <= 2
    if (near) setFollowing(true)
    else if (top < previousTop - 1 && (draggingScrollbar || Date.now() < readingUntil)) pause()
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
    observer = new ResizeObserver(follow)
    observer.observe(element)
    if (element.firstElementChild) observer.observe(element.firstElementChild)
    listeners = new AbortController()
    const signal = listeners.signal
    const read = (event: Event) => {
      if (event.defaultPrevented) return
      for (let target = event.target instanceof Element ? event.target : null;
        target && target !== element; target = target.parentElement) {
        if (target.scrollTop > 0 && /^(auto|scroll)$/.test(getComputedStyle(target).overflowY)) return
      }
      readingUntil = Date.now() + 500
      if (element.scrollTop > 0) pause()
    }
    element.addEventListener("wheel", (event) => { if (event.deltaY < 0) read(event) }, { passive: true, signal })
    element.addEventListener("pointerdown", (event) => {
      const right = element.getBoundingClientRect().right
      if (event.button === 0 && event.target === element && event.clientX >= right - 16 && event.clientX <= right) draggingScrollbar = true
    }, { passive: true, signal })
    const endDrag = () => {
      if (draggingScrollbar) readingUntil = Date.now() + 500
      draggingScrollbar = false
    }
    const owner = element.ownerDocument.defaultView
    owner?.addEventListener("pointerup", endDrag, { signal })
    owner?.addEventListener("pointercancel", endDrag, { signal })
    let touchY: number | undefined
    element.addEventListener("touchstart", (event) => { touchY = event.touches[0]?.clientY }, { passive: true, signal })
    element.addEventListener("touchmove", (event) => {
      const next = event.touches[0]?.clientY
      if (next !== undefined && touchY !== undefined && next > touchY) read(event)
      touchY = next
    }, { passive: true, signal })
    element.addEventListener("keydown", (event) => {
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true]")) return
      if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) read(event)
    }, { signal })
    follow()
  }
  onCleanup(disposeViewport)
  return { following, follow, onScroll, bind, pause, resume }
}
