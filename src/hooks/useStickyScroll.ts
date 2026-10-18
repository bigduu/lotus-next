import { useCallback, useLayoutEffect, useRef, useState } from "react"

/** Follow content and viewport growth until the reader scrolls upward. */
export function useStickyScroll(currentSessionId: string | null | undefined) {
  // Callback refs reconnect when HomeDashboard gives way to MessageList.
  const [scrollElement, scrollRef] = useState<HTMLDivElement | null>(null)
  const [contentElement, contentRef] = useState<HTMLDivElement | null>(null)
  const stickRef = useRef(true)
  const lastScrollTop = useRef(0)
  const readerScrollUntil = useRef(0)
  const pointerActive = useRef(false)
  const [atBottom, setAtBottom] = useState(true)

  const followBottom = useCallback(() => {
    if (!scrollElement || !stickRef.current) return
    // Instant scrolling cannot unpin itself through intermediate smooth-scroll events.
    const bottom = Math.max(0, scrollElement.scrollHeight - scrollElement.clientHeight)
    if (scrollElement.scrollTop !== bottom) {
      scrollElement.scrollTo({ top: bottom, behavior: "instant" })
    }
    lastScrollTop.current = scrollElement.scrollTop
    setAtBottom(true)
  }, [scrollElement])

  const handleScroll = () => {
    if (!scrollElement) return
    const near = scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight <= 2
    if (near) stickRef.current = true
    else if (scrollElement.scrollTop < lastScrollTop.current - 1 &&
      (pointerActive.current || Date.now() < readerScrollUntil.current)) stickRef.current = false
    else if (stickRef.current) {
      followBottom()
      return
    }
    lastScrollTop.current = scrollElement.scrollTop
    setAtBottom(stickRef.current)
  }

  const pinToBottom = () => {
    stickRef.current = true
    readerScrollUntil.current = 0
    pointerActive.current = false
    followBottom()
  }

  useLayoutEffect(() => {
    stickRef.current = true
    readerScrollUntil.current = 0
    pointerActive.current = false
    setAtBottom(true)
    followBottom()
    if (!scrollElement || !contentElement) return
    const observer = new ResizeObserver(followBottom)
    observer.observe(contentElement)
    // Composer, queue, and window resizing change the available message height.
    observer.observe(scrollElement)
    // Virtualized row measurements and browser anchoring can move scrollTop
    // upward too. Only reader input may release an existing bottom pin.
    const readerInput = (event: Event) => {
      if (event.defaultPrevented) return
      // Tool output/reasoning may have its own scrolling region. Let it consume
      // upward input while it has room, without releasing the transcript pin.
      for (let target = event.target instanceof Element ? event.target : null;
        target && target !== scrollElement; target = target.parentElement) {
        if (target.scrollTop > 0 && /^(auto|scroll)$/.test(getComputedStyle(target).overflowY)) return
      }
      readerScrollUntil.current = Date.now() + 500
      // Release on intent, before the browser delivers its scroll event. A
      // streaming/image resize can arrive first and otherwise pull the reader
      // straight back to the bottom while overwriting lastScrollTop.
      if (scrollElement.scrollTop > 0) {
        stickRef.current = false
        setAtBottom(false)
      }
    }
    const wheel = (event: WheelEvent) => { if (event.deltaY < 0) readerInput(event) }
    const pointerDown = (event: PointerEvent) => {
      const right = scrollElement.getBoundingClientRect().right
      if (event.button === 0 && event.target === scrollElement && event.clientX >= right - 16 && event.clientX <= right) {
        pointerActive.current = true
      }
    }
    const pointerUp = () => {
      if (pointerActive.current) readerScrollUntil.current = Date.now() + 500
      pointerActive.current = false
    }
    let touchY: number | null = null
    const touchStart = (event: TouchEvent) => { touchY = event.touches[0]?.clientY ?? null }
    const touchMove = (event: TouchEvent) => {
      const next = event.touches[0]?.clientY ?? null
      if (next !== null && touchY !== null && next > touchY) readerInput(event)
      touchY = next
    }
    const keyDown = (event: KeyboardEvent) => {
      if (event.target instanceof Element && event.target.closest("input, textarea, select, [contenteditable=true]")) return
      if (["ArrowUp", "PageUp", "Home"].includes(event.key) || (event.key === " " && event.shiftKey)) readerInput(event)
    }
    scrollElement.addEventListener("wheel", wheel, { passive: true })
    scrollElement.addEventListener("pointerdown", pointerDown, { passive: true })
    scrollElement.addEventListener("touchstart", touchStart, { passive: true })
    scrollElement.addEventListener("touchmove", touchMove, { passive: true })
    scrollElement.addEventListener("keydown", keyDown)
    const ownerWindow = scrollElement.ownerDocument.defaultView
    ownerWindow?.addEventListener("pointerup", pointerUp)
    ownerWindow?.addEventListener("pointercancel", pointerUp)
    return () => {
      observer.disconnect()
      scrollElement.removeEventListener("wheel", wheel)
      scrollElement.removeEventListener("pointerdown", pointerDown)
      scrollElement.removeEventListener("touchstart", touchStart)
      scrollElement.removeEventListener("touchmove", touchMove)
      scrollElement.removeEventListener("keydown", keyDown)
      ownerWindow?.removeEventListener("pointerup", pointerUp)
      ownerWindow?.removeEventListener("pointercancel", pointerUp)
    }
  }, [scrollElement, contentElement, currentSessionId, followBottom])

  return { scrollRef, contentRef, atBottom, handleScroll, scrollToBottom: pinToBottom, pinToBottom }
}
