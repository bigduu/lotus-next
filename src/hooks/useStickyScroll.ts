import { useCallback, useLayoutEffect, useRef, useState } from "react"

/** Follow content and viewport growth until the reader scrolls upward. */
export function useStickyScroll(currentSessionId: string | null | undefined) {
  // Callback refs reconnect when HomeDashboard gives way to MessageList.
  const [scrollElement, scrollRef] = useState<HTMLDivElement | null>(null)
  const [contentElement, contentRef] = useState<HTMLDivElement | null>(null)
  const stickRef = useRef(true)
  const lastScrollTop = useRef(0)
  const [atBottom, setAtBottom] = useState(true)

  const followBottom = useCallback(() => {
    if (!scrollElement || !stickRef.current) return
    // Instant scrolling cannot unpin itself through intermediate smooth-scroll events.
    scrollElement.scrollTo({ top: scrollElement.scrollHeight, behavior: "instant" })
    lastScrollTop.current = scrollElement.scrollTop
    setAtBottom(true)
  }, [scrollElement])

  const handleScroll = () => {
    if (!scrollElement) return
    const near = scrollElement.scrollHeight - scrollElement.scrollTop - scrollElement.clientHeight <= 2
    if (near) stickRef.current = true
    else if (scrollElement.scrollTop < lastScrollTop.current - 1) stickRef.current = false
    lastScrollTop.current = scrollElement.scrollTop
    setAtBottom(stickRef.current)
  }

  const pinToBottom = () => {
    stickRef.current = true
    followBottom()
  }

  useLayoutEffect(() => {
    stickRef.current = true
    setAtBottom(true)
    followBottom()
    if (!scrollElement || !contentElement) return
    const observer = new ResizeObserver(followBottom)
    observer.observe(contentElement)
    // Composer, queue, and window resizing change the available message height.
    observer.observe(scrollElement)
    return () => observer.disconnect()
  }, [scrollElement, contentElement, currentSessionId, followBottom])

  return { scrollRef, contentRef, atBottom, handleScroll, scrollToBottom: pinToBottom, pinToBottom }
}
